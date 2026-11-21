/**
 * Sending through the gate: gathers the facts, asks the gate, writes ONE log row per message and only then (and
 * only on «send») calls the sender it was given. The database and the senders are parameters, so all of this is
 * tested without a database and without sending anything.
 *
 * A message is written to the log as «sending» BEFORE the sender is called, so a crash between the send and the
 * log can never make the same message go out twice (the row keeps the dedupe key). A row stuck in «sending» is
 * closed as «interrupted» later and is never retried.
 */
import { dayStart } from "../../campaigns/send-schedule.ts";
import { DEFAULT_SETTINGS, REASONS, evaluateGate, type GateDecision, type GateSettings, type SendChannel, type SendKind } from "./gate.ts";

export type SendRequest = {
  organizationId: string;
  workflowId?: string | null;
  runId?: string | null;
  stepId?: string | null;
  opportunityId?: string | null;
  contactId?: string | null;
  channel: SendChannel;
  kind: SendKind;
  /** Phone (digits, with country code) for WhatsApp, address for email. */
  to: string | null;
  /** The WhatsApp account that sends (required for WhatsApp). */
  accountId?: string | null;
  subject?: string;
  body: string;
  /** Identifies the message for the event it answers, e.g. `${workflowId}:${stepId}:${eventId}`. */
  dedupeKey: string;
  allowFirstContact?: boolean;
};

export type SenderResult = { ok: boolean; error?: string };
export type Senders = {
  whatsapp: (m: { organizationId: string; accountId: string; to: string; text: string; opportunityId?: string | null; contactId?: string | null }) => Promise<SenderResult>;
  email: (m: { organizationId: string; to: string; subject: string; text: string }) => Promise<SenderResult>;
};
export type SendDeps = { db: any; senders: Senders; now?: Date };

export type SendOutcome = { status: "sent" | "skipped" | "deferred" | "failed"; code: string | null; reason: string | null; logId: string | null; notBefore?: string };

const MISSING = new Set(["42P01", "PGRST205"]);
const digits = (v: string) => v.replace(/\D/g, "");

/** The organization's send settings; without a row (or before the SQL is run) the OFF defaults. */
export async function loadSendSettings(db: any, organizationId: string): Promise<GateSettings> {
  const { data, error } = await db.from("wf_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (error) {
    if (MISSING.has(error.code)) return DEFAULT_SETTINGS;
    throw new Error(error.message);
  }
  return data ? { ...DEFAULT_SETTINGS, ...pickSettings(data) } : DEFAULT_SETTINGS;
}
const pickSettings = (row: any): Partial<GateSettings> => ({
  sending_enabled: row.sending_enabled === true,
  timezone: row.timezone,
  send_window_start: row.send_window_start,
  send_window_end: row.send_window_end,
  daily_limit: row.daily_limit,
  gap_min_seconds: row.gap_min_seconds,
  gap_max_seconds: row.gap_max_seconds,
  defer_ttl_minutes: row.defer_ttl_minutes,
});

/** Is this address on the organization's «do not send» list? (The same list the outbound campaigns use.) */
export async function isOnStopList(db: any, organizationId: string, channel: SendChannel, to: string): Promise<boolean> {
  const candidates = channel === "whatsapp" ? [digits(to), `+${digits(to)}`] : [to.trim().toLowerCase()];
  const { data, error } = await db.from("ob_suppressions").select("identifier").eq("organization_id", organizationId).eq("channel", channel).in("identifier", candidates).limit(1);
  if (error) {
    if (MISSING.has(error.code)) return false;
    throw new Error(error.message);
  }
  return (data ?? []).length > 0;
}

/** Did this customer ever write to us? (An inbound message in a chat linked to one of their tickets.) */
export async function hasWrittenToUs(db: any, organizationId: string, contactId: string | null | undefined): Promise<boolean> {
  if (!contactId) return false;
  const { data: opps } = await db.from("opp_opportunities").select("id").eq("organization_id", organizationId).eq("contact_id", contactId).limit(50);
  const oppIds = (opps ?? []).map((o: any) => o.id);
  if (!oppIds.length) return false;
  const { data: links } = await db.from("crm_opportunity_sessions").select("session_ref").eq("organization_id", organizationId).in("opportunity_id", oppIds).limit(100);
  const sessionIds = (links ?? []).map((l: any) => l.session_ref);
  if (!sessionIds.length) return false;
  const { data: inbound } = await db.from("msg_messages").select("id").eq("organization_id", organizationId).eq("direction", "inbound").in("session_id", sessionIds).limit(1);
  return (inbound ?? []).length > 0;
}

/** Explicit consent to promotions is recorded on the contact (custom_fields.promo_consent = true). */
export async function hasPromoConsent(db: any, organizationId: string, contactId: string | null | undefined): Promise<boolean> {
  if (!contactId) return false;
  const { data } = await db.from("crm_contacts").select("custom_fields").eq("id", contactId).eq("organization_id", organizationId).maybeSingle();
  return data?.custom_fields?.promo_consent === true;
}

async function sentStats(db: any, req: SendRequest, settings: GateSettings, now: Date) {
  const from = dayStart(now, settings.timezone).toISOString();
  const scope = (q: any) => {
    q = q.eq("organization_id", req.organizationId).eq("channel", req.channel).eq("status", "sent");
    return req.channel === "whatsapp" && req.accountId ? q.eq("account_id", req.accountId) : q;
  };
  const today = await scope(db.from("wf_message_log").select("id,sent_at").gte("sent_at", from));
  const rows: any[] = today.data ?? [];
  const last = rows.map((r) => r.sent_at as string).sort().pop() ?? null;
  return { sentToday: rows.length, lastSentAt: last ? new Date(last) : null };
}

async function isDuplicate(db: any, req: SendRequest): Promise<boolean> {
  const { data } = await db.from("wf_message_log").select("id").eq("organization_id", req.organizationId).eq("dedupe_key", req.dedupeKey).in("status", ["sending", "sent", "deferred"]).limit(1);
  return (data ?? []).length > 0;
}

const logBase = (req: SendRequest) => ({
  organization_id: req.organizationId,
  workflow_id: req.workflowId ?? null,
  run_id: req.runId ?? null,
  step_id: req.stepId ?? null,
  opportunity_id: req.opportunityId ?? null,
  contact_id: req.contactId ?? null,
  channel: req.channel,
  kind: req.kind,
  to_address: req.to,
  account_id: req.accountId ?? null,
  subject: req.subject ?? null,
  body: req.body,
  dedupe_key: req.dedupeKey,
  allow_first_contact: !!req.allowFirstContact,
});

async function decide(deps: SendDeps, req: SendRequest, now: Date, duplicate: boolean): Promise<{ decision: GateDecision; settings: GateSettings }> {
  const { db } = deps;
  const settings = await loadSendSettings(db, req.organizationId);
  // Only look up what the decision may need, so a switched-off organization costs two queries.
  const off = !settings.sending_enabled;
  const [blocked, prior, consent, stats] = off || duplicate
    ? [false, false, false, { sentToday: 0, lastSentAt: null as Date | null }]
    : await Promise.all([
        req.to ? isOnStopList(db, req.organizationId, req.channel, req.to) : false,
        req.kind === "service" ? hasWrittenToUs(db, req.organizationId, req.contactId) : false,
        req.kind === "promo" ? hasPromoConsent(db, req.organizationId, req.contactId) : false,
        sentStats(db, req, settings, now),
      ]);
  const decision = evaluateGate({
    channel: req.channel, kind: req.kind, now, settings, duplicate,
    blocked, promoConsent: consent, hasPriorContact: prior, allowFirstContact: !!req.allowFirstContact,
    sentToday: stats.sentToday, lastSentAt: stats.lastSentAt, gapSeed: stats.lastSentAt?.toISOString(),
  });
  return { decision, settings };
}

/** Problems with the request itself, found before the gate (no address, no sender account, empty text). */
export function requestProblem(req: SendRequest): { code: string; reason: string } | null {
  if (!req.body?.trim()) return { code: "no_body", reason: REASONS.no_body! };
  if (!req.to?.trim() || (req.channel === "whatsapp" && digits(req.to).length < 7)) return { code: "no_address", reason: REASONS.no_address! };
  if (req.channel === "whatsapp" && !req.accountId) return { code: "no_account", reason: REASONS.no_account! };
  return null;
}

async function insertLog(db: any, row: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await db.from("wf_message_log").insert(row).select("id").single();
  if (error) {
    // The unique index says this very message is already sent or waiting (a race): report it as a duplicate.
    if (error.code === "23505") return null;
    throw new Error(error.message);
  }
  return data?.id ?? null;
}

async function transmit(deps: SendDeps, req: SendRequest, logId: string, now: Date): Promise<SendOutcome> {
  const { db, senders } = deps;
  let result: SenderResult;
  try {
    result = req.channel === "whatsapp"
      ? await senders.whatsapp({ organizationId: req.organizationId, accountId: req.accountId!, to: digits(req.to!), text: req.body, opportunityId: req.opportunityId, contactId: req.contactId })
      : await senders.email({ organizationId: req.organizationId, to: req.to!, subject: req.subject ?? "", text: req.body });
  } catch (e) {
    result = { ok: false, error: (e as Error).message };
  }
  const stamp = now.toISOString();
  if (result.ok) {
    await db.from("wf_message_log").update({ status: "sent", sent_at: stamp, updated_at: stamp, reason_code: null, reason: null }).eq("id", logId);
    return { status: "sent", code: null, reason: null, logId };
  }
  const reason = `${REASONS.send_failed}: ${String(result.error ?? "").slice(0, 300)}`;
  await db.from("wf_message_log").update({ status: "failed", reason_code: "send_failed", reason, updated_at: stamp }).eq("id", logId);
  return { status: "failed", code: "send_failed", reason, logId };
}

/** Sends one automatic message through the gate. Always leaves exactly one log row saying what happened. */
export async function sendThroughGate(deps: SendDeps, req: SendRequest): Promise<SendOutcome> {
  const now = deps.now ?? new Date();
  const { db } = deps;
  const problem = requestProblem(req);
  if (problem) {
    const id = await insertLog(db, { ...logBase(req), dedupe_key: null, status: "skipped", reason_code: problem.code, reason: problem.reason });
    return { status: "skipped", code: problem.code, reason: problem.reason, logId: id };
  }
  const duplicate = await isDuplicate(db, req);
  const { decision, settings } = await decide(deps, req, now, duplicate);
  if (decision.action === "skip") {
    // A duplicate leaves no second row (the first one already tells the story).
    if (decision.code === "duplicate") return { status: "skipped", code: "duplicate", reason: decision.reason, logId: null };
    const id = await insertLog(db, { ...logBase(req), dedupe_key: null, status: "skipped", reason_code: decision.code, reason: decision.reason });
    return { status: "skipped", code: decision.code, reason: decision.reason, logId: id };
  }
  if (decision.action === "defer") {
    const expires = new Date(now.getTime() + settings.defer_ttl_minutes * 60_000);
    const id = await insertLog(db, { ...logBase(req), status: "deferred", reason_code: decision.code, reason: decision.reason, not_before: decision.notBefore.toISOString(), expires_at: expires.toISOString() });
    if (!id) return { status: "skipped", code: "duplicate", reason: REASONS.duplicate!, logId: null };
    return { status: "deferred", code: decision.code, reason: decision.reason, logId: id, notBefore: decision.notBefore.toISOString() };
  }
  const id = await insertLog(db, { ...logBase(req), status: "sending", attempts: 1 });
  if (!id) return { status: "skipped", code: "duplicate", reason: REASONS.duplicate!, logId: null };
  return transmit(deps, req, id, now);
}

const requestFromRow = (row: any): SendRequest => ({
  organizationId: row.organization_id, workflowId: row.workflow_id, runId: row.run_id, stepId: row.step_id, opportunityId: row.opportunity_id,
  contactId: row.contact_id, channel: row.channel, kind: row.kind, to: row.to_address, accountId: row.account_id,
  subject: row.subject ?? undefined, body: row.body ?? "", dedupeKey: row.dedupe_key ?? "", allowFirstContact: row.allow_first_contact === true,
});

/**
 * One round over the held messages that are due: an expired one is dropped, the others pass the gate again with
 * fresh facts (the customer may have asked to stop since). Only rows this round claims are touched.
 */
export async function retryDeferred(deps: SendDeps, limit = 50): Promise<{ sent: number; deferred: number; skipped: number; failed: number }> {
  const now = deps.now ?? new Date();
  const { db } = deps;
  const stamp = now.toISOString();
  const out = { sent: 0, deferred: 0, skipped: 0, failed: 0 };
  // A row stuck in «sending» for 10 minutes: closed as interrupted, never retried.
  await db.from("wf_message_log").update({ status: "failed", reason_code: "interrupted", reason: REASONS.interrupted, updated_at: stamp }).eq("status", "sending").lt("updated_at", new Date(now.getTime() - 10 * 60_000).toISOString());
  const { data: due, error } = await db.from("wf_message_log").select("*").eq("status", "deferred").lte("not_before", stamp).order("not_before").limit(limit);
  if (error) {
    if (MISSING.has(error.code)) return out;
    throw new Error(error.message);
  }
  for (const row of due ?? []) {
    const { data: claimed } = await db.from("wf_message_log").update({ status: "sending", attempts: (row.attempts ?? 0) + 1, updated_at: stamp }).eq("id", row.id).eq("status", "deferred").select("id").maybeSingle();
    if (!claimed) continue;
    if (row.expires_at && new Date(row.expires_at) < now) {
      await db.from("wf_message_log").update({ status: "skipped", reason_code: "expired", reason: REASONS.expired, updated_at: stamp }).eq("id", row.id);
      out.skipped++;
      continue;
    }
    const req = requestFromRow(row);
    const { decision } = await decide(deps, req, now, false);
    if (decision.action === "skip") {
      await db.from("wf_message_log").update({ status: "skipped", reason_code: decision.code, reason: decision.reason, updated_at: stamp }).eq("id", row.id);
      out.skipped++;
    } else if (decision.action === "defer") {
      await db.from("wf_message_log").update({ status: "deferred", reason_code: decision.code, reason: decision.reason, not_before: decision.notBefore.toISOString(), updated_at: stamp }).eq("id", row.id);
      out.deferred++;
    } else {
      const r = await transmit(deps, req, row.id, now);
      out[r.status === "sent" ? "sent" : "failed"]++;
    }
  }
  return out;
}
