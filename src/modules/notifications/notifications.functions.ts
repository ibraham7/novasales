import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_KEYS, safeInternalUrl, type NotificationType } from "./types";
import { isAllowedPushEndpoint } from "./webpush";
import { createRateLimiter } from "./rate-limit";

const MAX_DEVICES = 10;
const BROADCASTS_PER_HOUR = 20;
const registerLimiter = createRateLimiter(20, 60_000);
const testLimiter = createRateLimiter(5, 60_000);

const typeKey = z.enum(NOTIFICATION_TYPE_KEYS as [NotificationType, ...NotificationType[]]);

async function me() {
  const { getWorkspace } = await import("@/platform/workspace/workspace.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { userId, organizationId } = await getWorkspace();
  return { userId, organizationId, db: supabaseAdmin as any };
}

/** Managers of the organization only: checked here on the server, not just hidden in the page. */
async function manager() {
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const access = await requireAnyPermission(["org.manage"]);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: access.userId, organizationId: access.organizationId, db: supabaseAdmin as any };
}

/** Whether the server can send, and the public key the browser needs to subscribe. The private key never leaves the server. */
export const getPushStatus = createServerFn({ method: "GET" }).handler(async () => {
  await me();
  const { vapidKeys } = await import("./notify.server");
  const keys = vapidKeys();
  return { configured: !!keys, publicKey: keys?.publicKey ?? null };
});

export const registerPushSubscription = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        endpoint: z.string().max(2000),
        p256dh: z.string().min(20).max(200),
        auth: z.string().min(10).max(100),
        userAgent: z.string().max(300).optional(),
        deviceLabel: z.string().trim().max(80).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { userId, organizationId, db } = await me();
    if (!registerLimiter.allow(userId)) throw new Error("محاولات كثيرة؛ انتظر دقيقة ثم أعد المحاولة");
    if (!isAllowedPushEndpoint(data.endpoint)) throw new Error("عنوان الإشعارات غير مدعوم");
    // The same browser belongs to whoever is signed in on it now: a shared device follows the current account.
    const { error } = await db.from("push_subscriptions").upsert(
      {
        organization_id: organizationId,
        user_id: userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        user_agent: data.userAgent ?? null,
        device_label: data.deviceLabel ?? null,
        last_seen_at: new Date().toISOString(),
        failure_count: 0,
        last_error: null,
      },
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(error.message);
    // Keep the newest devices only.
    const { data: mine } = await db
      .from("push_subscriptions")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false });
    const extra = (mine ?? []).slice(MAX_DEVICES).map((row: any) => row.id);
    if (extra.length) await db.from("push_subscriptions").delete().in("id", extra);
    return { ok: true };
  });

export const unregisterPushSubscription = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ endpoint: z.string().max(2000) }).parse(data))
  .handler(async ({ data }) => {
    const { userId, db } = await me();
    const { error } = await db.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", data.endpoint);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removePushDevice = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { userId, organizationId, db } = await me();
    const { error } = await db.from("push_subscriptions").delete().eq("id", data.id).eq("user_id", userId).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** The person's devices and which kinds of notification they want. */
export const getMyNotificationSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { userId, organizationId, db } = await me();
  const [devices, prefs] = await Promise.all([
    db
      .from("push_subscriptions")
      .select("id,endpoint,device_label,user_agent,created_at,last_seen_at,last_success_at,last_error,failure_count")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false }),
    db.from("push_preferences").select("disabled_types").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle(),
  ]);
  if (devices.error) throw new Error(devices.error.message);
  const disabled = new Set<string>(prefs.data?.disabled_types ?? []);
  return {
    devices: devices.data ?? [],
    types: NOTIFICATION_TYPE_KEYS.map((key) => ({ key, ...NOTIFICATION_TYPES[key], enabled: !disabled.has(key) })),
  };
});

export const saveNotificationPreferences = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ disabledTypes: z.array(typeKey).max(50) }).parse(data))
  .handler(async ({ data }) => {
    const { userId, organizationId, db } = await me();
    const { error } = await db.from("push_preferences").upsert(
      { organization_id: organizationId, user_id: userId, disabled_types: [...new Set(data.disabledTypes)], updated_at: new Date().toISOString() },
      { onConflict: "organization_id,user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** A test notification to the person's own devices. It ignores the per-type choice, so it proves the device works. */
export const sendTestNotification = createServerFn({ method: "POST" }).handler(async () => {
  const { userId, organizationId } = await me();
  if (!testLimiter.allow(userId)) throw new Error("انتظر قليلاً قبل إرسال إشعار تجريبي آخر");
  const { notifyUsers, vapidKeys } = await import("./notify.server");
  if (!vapidKeys()) throw new Error("الإشعارات غير مُعدّة على الخادم بعد");
  const result = await notifyUsers({
    organizationId,
    userIds: [userId],
    type: "manual",
    title: "إشعار تجريبي",
    body: "إذا ظهر لك هذا الإشعار فجهازك جاهز لاستقبال إشعارات NovaSales.",
    url: "/settings/notifications",
    logNoDevice: true,
    urgency: "high",
  });
  if (result.noDevice) throw new Error("لا يوجد جهاز مفعّل لهذا الحساب؛ فعّل الإشعارات على هذا الجهاز أولاً");
  if (!result.accepted) throw new Error("رفضت خدمة الإشعارات الرسالة؛ أعد تفعيل الإشعارات على هذا الجهاز");
  return { accepted: result.accepted };
});

/* ----------------------------- manager ----------------------------- */

const audienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("departments"), departmentIds: z.array(z.string().uuid()).min(1).max(100) }),
  z.object({ kind: z.literal("users"), userIds: z.array(z.string().uuid()).min(1).max(500) }),
]);

export const getBroadcastOptions = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db } = await manager();
  const [departments, members] = await Promise.all([
    db.from("org_departments").select("id,name").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    db.from("org_memberships").select("user_id").eq("organization_id", organizationId).eq("is_active", true).limit(1000),
  ]);
  const ids = (members.data ?? []).map((m: any) => m.user_id);
  const profiles: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from("profiles").select("id,full_name").in("id", ids.slice(i, i + 100));
    profiles.push(...(data ?? []));
  }
  const withDevice = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from("push_subscriptions").select("user_id").eq("organization_id", organizationId).in("user_id", ids.slice(i, i + 100));
    for (const row of data ?? []) withDevice.add(row.user_id);
  }
  return {
    departments: departments.data ?? [],
    users: profiles.map((p) => ({ id: p.id, name: p.full_name || "بدون اسم", hasDevice: withDevice.has(p.id) })).sort((a, b) => a.name.localeCompare(b.name, "ar")),
    totalMembers: ids.length,
    devicesCount: withDevice.size,
  };
});

export const sendBroadcast = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        title: z.string().trim().min(1).max(120),
        body: z.string().trim().min(1).max(500),
        url: z.string().trim().max(300).optional(),
        audience: audienceSchema,
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { userId, organizationId, db } = await manager();
    const { notifyUsers, resolveAudienceUserIds, vapidKeys } = await import("./notify.server");
    if (!vapidKeys()) throw new Error("الإشعارات غير مُعدّة على الخادم بعد (مفاتيح VAPID)");

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await db.from("push_broadcasts").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).gte("created_at", since);
    if ((count ?? 0) >= BROADCASTS_PER_HOUR) throw new Error("تجاوزت الحد المسموح من الإشعارات اليدوية في الساعة؛ حاول لاحقاً");

    const recipients = await resolveAudienceUserIds(organizationId, data.audience);
    if (!recipients.length) throw new Error("لا يوجد مستلمون ضمن هذا الاختيار");
    const url = safeInternalUrl(data.url);
    const { data: broadcast, error } = await db
      .from("push_broadcasts")
      .insert({ organization_id: organizationId, created_by: userId, title: data.title, body: data.body, url, audience: data.audience, recipients_count: recipients.length })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const result = await notifyUsers({
      organizationId,
      userIds: recipients,
      type: "manual",
      title: data.title,
      body: data.body,
      url,
      dedupeKey: `broadcast:${broadcast.id}`,
      broadcastId: broadcast.id,
      logNoDevice: true,
      urgency: "high",
    });
    return { broadcastId: broadcast.id, recipients: recipients.length, ...result };
  });

/** Sent broadcasts with what happened to each: devices that took it, people without a device, and what devices reported. */
export const listBroadcasts = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db } = await manager();
  const { data: broadcasts, error } = await db
    .from("push_broadcasts")
    .select("id,title,body,url,audience,recipients_count,created_at,created_by")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  const ids = (broadcasts ?? []).map((b: any) => b.id);
  const stats = new Map<string, { accepted: number; failed: number; noDevice: number; shown: number; clicked: number }>();
  if (ids.length) {
    const { data: messages } = await db
      .from("push_messages")
      .select("broadcast_id,status,shown_at,clicked_at")
      .eq("organization_id", organizationId)
      .in("broadcast_id", ids)
      .limit(10000);
    for (const m of messages ?? []) {
      const s = stats.get(m.broadcast_id) ?? { accepted: 0, failed: 0, noDevice: 0, shown: 0, clicked: 0 };
      if (m.status === "accepted") s.accepted++;
      else if (m.status === "failed") s.failed++;
      else if (m.status === "no_device") s.noDevice++;
      if (m.shown_at) s.shown++;
      if (m.clicked_at) s.clicked++;
      stats.set(m.broadcast_id, s);
    }
  }
  const creatorIds = [...new Set<string>((broadcasts ?? []).map((b: any) => b.created_by).filter(Boolean))];
  const { data: creators } = creatorIds.length ? await db.from("profiles").select("id,full_name").in("id", creatorIds) : { data: [] };
  const names = new Map<string, string>((creators ?? []).map((p: any) => [p.id, p.full_name]));
  return (broadcasts ?? []).map((b: any) => ({
    ...b,
    created_by_name: names.get(b.created_by) ?? null,
    stats: stats.get(b.id) ?? { accepted: 0, failed: 0, noDevice: 0, shown: 0, clicked: 0 },
  }));
});
