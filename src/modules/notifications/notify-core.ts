import type { PushResult, VapidKeys } from "./webpush.ts";
import { clip, safeInternalUrl, type NotificationType, type PushPayload } from "./types.ts";

const CHUNK = 100;
const SEND_CONCURRENCY = 6;
/** Subscriptions that fail this many times in a row (not just "gone") are dropped. */
const MAX_FAILURES = 10;

const chunks = <T>(items: T[], size = CHUNK) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]);
      }
    }),
  );
  return results;
}

export type NotifyInput = {
  organizationId: string;
  type: NotificationType;
  userIds: string[];
  title: string;
  body?: string;
  url?: string;
  /** Notifications with the same tag replace each other on the device instead of stacking. */
  tag?: string;
  /** The same key never notifies the same person twice (an event processed again, a retried request). */
  dedupeKey?: string;
  /** The person who caused the event does not need to be told about it. */
  excludeUserId?: string | null;
  broadcastId?: string | null;
  /** A manual send keeps a row even for people without a device, so the manager sees who it did not reach. */
  logNoDevice?: boolean;
  urgency?: "low" | "normal" | "high";
  ttlSeconds?: number;
};

export type NotifyResult = {
  configured: boolean;
  /** People who could receive it (active members who did not turn this type off). */
  targeted: number;
  accepted: number;
  failed: number;
  noDevice: number;
  duplicates: number;
};

const EMPTY: NotifyResult = { configured: true, targeted: 0, accepted: 0, failed: 0, noDevice: 0, duplicates: 0 };

/**
 * Sends a notification to the given people, on every device they enabled. Only active members of
 * the organization are reached, and only if they did not turn this kind off. «Accepted» means a
 * push service took the message; whether it was shown is reported later by the device itself.
 */
export type Audience = { kind: "all" } | { kind: "departments"; departmentIds: string[] } | { kind: "users"; userIds: string[] };

export type NotifierDeps = {
  db: any;
  send: (subscription: { endpoint: string; p256dh: string; auth: string }, payload: unknown, vapid: VapidKeys, options?: { urgency?: "low" | "normal" | "high"; ttlSeconds?: number }) => Promise<PushResult>;
  vapid: () => VapidKeys | null;
};

export function createNotifier({ db, send: sendWebPush, vapid: vapidKeys }: NotifierDeps) {
async function notifyUsers(input: NotifyInput): Promise<NotifyResult> {
  const keys = vapidKeys();
  if (!keys) return { ...EMPTY, configured: false };
  const org = input.organizationId;
  let ids = [...new Set(input.userIds.filter(Boolean))];
  if (input.excludeUserId) ids = ids.filter((id) => id !== input.excludeUserId);
  if (!ids.length) return { ...EMPTY };

  // Only people who belong to this organization.
  const members = new Set<string>();
  for (const part of chunks(ids)) {
    const { data, error } = await db.from("org_memberships").select("user_id").eq("organization_id", org).eq("is_active", true).in("user_id", part);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) members.add(row.user_id);
  }
  // Who turned this kind off.
  const off = new Set<string>();
  for (const part of chunks([...members])) {
    const { data, error } = await db.from("push_preferences").select("user_id,disabled_types").eq("organization_id", org).in("user_id", part);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) if ((row.disabled_types ?? []).includes(input.type)) off.add(row.user_id);
  }
  const targets = [...members].filter((id) => !off.has(id));
  if (!targets.length) return { ...EMPTY };

  const subscriptions: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; failure_count: number }[] = [];
  for (const part of chunks(targets)) {
    const { data, error } = await db.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth,failure_count").eq("organization_id", org).in("user_id", part);
    if (error) throw new Error(error.message);
    subscriptions.push(...(data ?? []));
  }
  const devicesOf = new Map<string, typeof subscriptions>();
  for (const s of subscriptions) devicesOf.set(s.user_id, [...(devicesOf.get(s.user_id) ?? []), s]);

  const title = clip(input.title, 120) || "NovaSales";
  const body = clip(input.body, 240);
  const url = safeInternalUrl(input.url);
  const key = input.dedupeKey ?? `${input.type}:${crypto.randomUUID()}`;

  // One log row per person; the unique (person, key) makes a repeated event a no-op.
  const rows = targets
    .filter((id) => devicesOf.has(id) || input.logNoDevice)
    .map((id) => ({
      organization_id: org,
      recipient_user_id: id,
      type: input.type,
      title,
      body,
      url,
      dedupe_key: key,
      broadcast_id: input.broadcastId ?? null,
      status: devicesOf.has(id) ? "queued" : "no_device",
      devices_total: devicesOf.get(id)?.length ?? 0,
    }));
  const created: { id: string; recipient_user_id: string }[] = [];
  for (const part of chunks(rows)) {
    const { data, error } = await db.from("push_messages").upsert(part, { onConflict: "recipient_user_id,dedupe_key", ignoreDuplicates: true }).select("id,recipient_user_id");
    if (error) throw new Error(error.message);
    created.push(...(data ?? []));
  }
  const result: NotifyResult = { ...EMPTY, targeted: targets.length, duplicates: rows.length - created.length };

  type Job = { messageId: string; userId: string; sub: (typeof subscriptions)[number] };
  const jobs: Job[] = [];
  for (const message of created) {
    const devices = devicesOf.get(message.recipient_user_id);
    if (!devices) result.noDevice++;
    else for (const sub of devices) jobs.push({ messageId: message.id, userId: message.recipient_user_id, sub });
  }

  const outcome = new Map<string, { accepted: number; failed: number; error?: string }>();
  const goneIds: string[] = [];
  const succeededIds: string[] = [];
  const failures: { id: string; count: number; error: string }[] = [];
  await mapLimit(jobs, SEND_CONCURRENCY, async (job) => {
    const payload: PushPayload = { id: job.messageId, type: input.type, title, body, url, ...(input.tag ? { tag: input.tag } : {}) };
    const sent = await sendWebPush({ endpoint: job.sub.endpoint, p256dh: job.sub.p256dh, auth: job.sub.auth }, payload, keys, {
      urgency: input.urgency,
      ttlSeconds: input.ttlSeconds,
    });
    const entry = outcome.get(job.messageId) ?? { accepted: 0, failed: 0 };
    if (sent.ok) {
      entry.accepted++;
      succeededIds.push(job.sub.id);
    } else {
      entry.failed++;
      entry.error ??= sent.error;
      if (sent.gone) goneIds.push(job.sub.id);
      else failures.push({ id: job.sub.id, count: (job.sub.failure_count ?? 0) + 1, error: sent.error ?? "" });
    }
    outcome.set(job.messageId, entry);
  });

  for (const part of chunks(succeededIds)) await db.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0, last_error: null }).in("id", part);
  // The push service says the subscription no longer exists (uninstalled, permission revoked): remove it.
  for (const part of chunks(goneIds)) await db.from("push_subscriptions").delete().in("id", part);
  for (const f of failures) {
    if (f.count >= MAX_FAILURES) await db.from("push_subscriptions").delete().eq("id", f.id);
    else await db.from("push_subscriptions").update({ failure_count: f.count, last_error: f.error.slice(0, 300) }).eq("id", f.id);
  }

  for (const [messageId, entry] of outcome) {
    await db
      .from("push_messages")
      .update({
        status: entry.accepted > 0 ? "accepted" : "failed",
        devices_accepted: entry.accepted,
        devices_failed: entry.failed,
        error: entry.error ? entry.error.slice(0, 300) : null,
      })
      .eq("id", messageId);
    if (entry.accepted > 0) result.accepted++;
    else result.failed++;
  }
  return result;
}

/**
 * The people who manage an organization: anyone whose role carries `org.manage`, plus the
 * supervisors of the given department.
 */
async function resolveManagerIds(organizationId: string, departmentId?: string | null): Promise<string[]> {
  const ids = new Set<string>();
  const { data: roles } = await db.from("rbac_role_permissions").select("role_id").eq("permission_key", "org.manage");
  const roleIds = [...new Set<string>((roles ?? []).map((r: any) => r.role_id))];
  for (const part of chunks(roleIds)) {
    const { data } = await db.from("rbac_user_roles").select("user_id").eq("organization_id", organizationId).in("role_id", part);
    for (const row of data ?? []) ids.add(row.user_id);
  }
  if (departmentId) {
    const { data } = await db
      .from("org_department_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("department_id", departmentId)
      .eq("is_supervisor", true)
      .eq("is_active", true);
    for (const row of data ?? []) ids.add(row.user_id);
  }
  return [...ids];
}

/** Active members of the organization matching an audience. */
async function resolveAudienceUserIds(organizationId: string, audience: Audience): Promise<string[]> {
  if (audience.kind === "users") {
    const wanted = [...new Set(audience.userIds)];
    const found: string[] = [];
    for (const part of chunks(wanted)) {
      const { data } = await db.from("org_memberships").select("user_id").eq("organization_id", organizationId).eq("is_active", true).in("user_id", part);
      found.push(...(data ?? []).map((r: any) => r.user_id));
    }
    return found;
  }
  if (audience.kind === "departments") {
    const ids = new Set<string>();
    for (const part of chunks([...new Set(audience.departmentIds)])) {
      const { data } = await db.from("org_department_members").select("user_id").eq("organization_id", organizationId).eq("is_active", true).in("department_id", part);
      for (const row of data ?? []) ids.add(row.user_id);
    }
    return [...ids];
  }
  const { data } = await db.from("org_memberships").select("user_id").eq("organization_id", organizationId).eq("is_active", true).limit(5000);
  return (data ?? []).map((r: any) => r.user_id);
}

return { notifyUsers, resolveManagerIds, resolveAudienceUserIds };
}
