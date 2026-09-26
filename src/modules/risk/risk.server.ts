/**
 * Risk Management Layer (WhatsApp numbers).
 *
 * Purpose: reduce the chance of a linked number getting restricted by WhatsApp.
 * - Post-link observation window (default 48h) → no cold outreach (welcome/campaign/automation).
 * - Health states: stable | observation | watch | high_risk (+ risk_score).
 * - Circuit breaker: pauses automated sending when the number looks unhealthy.
 * - Decision log: every send attempt records which rules passed/failed.
 * - Quotas: hourly/daily message + new-conversation caps per health state.
 *
 * Manual replies inside an existing conversation are never blocked — they are
 * the safest traffic and blocking them would break the agents' work.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as any;

export type SendSource = "manual" | "welcome" | "campaign" | "automation" | "forward";
export type HealthState = "stable" | "observation" | "watch" | "high_risk";

export type RiskDecision = {
  allowed: boolean;
  reason?: string;
  message?: string;
  health_state: HealthState;
  passed: string[];
  failed: string[];
};

type Caps = { hourly: number; daily: number; newConvDaily: number };

const CAPS: Record<HealthState, Caps> = {
  observation: { hourly: 25, daily: 120, newConvDaily: 15 },
  high_risk: { hourly: 10, daily: 40, newConvDaily: 3 },
  watch: { hourly: 40, daily: 250, newConvDaily: 30 },
  stable: { hourly: 120, daily: 800, newConvDaily: 80 },
};

const COLD_SOURCES: SendSource[] = ["welcome", "campaign", "automation"];

const EVENT_WEIGHTS: Record<string, number> = {
  disconnected: 15,
  relinked: 10,
  restricted: 45,
  send_failed: 5,
  reconnected: 0,
  manual_flag: 25,
};

function hourKey(d = new Date()) {
  return d.toISOString().slice(0, 13);
}
function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function observationRemainingMs(account: any): number {
  if (!account?.observation_started_at) return 0;
  const end = new Date(account.observation_started_at).getTime() + (account.observation_hours ?? 48) * 3600_000;
  return Math.max(0, end - Date.now());
}

export function resolveHealthState(account: any): HealthState {
  if (account?.send_paused_at || (account?.risk_score ?? 0) >= 40) return "high_risk";
  if (observationRemainingMs(account) > 0) return "observation";
  if ((account?.risk_score ?? 0) >= 15) return "watch";
  return "stable";
}

async function getQuota(accountId: string, bucket: "hour" | "day", key: string) {
  const { data } = await db
    .from("wa_send_quotas")
    .select("messages, new_conversations")
    .eq("channel_account_id", accountId)
    .eq("bucket", bucket)
    .eq("bucket_key", key)
    .maybeSingle();
  return { messages: data?.messages ?? 0, new_conversations: data?.new_conversations ?? 0 };
}

async function logDecision(input: {
  orgId: string;
  accountId: string | null;
  allowed: boolean;
  source: SendSource;
  peer?: string | null;
  passed: string[];
  failed: string[];
}) {
  await db.from("wa_send_decisions").insert({
    organization_id: input.orgId,
    channel_account_id: input.accountId,
    allowed: input.allowed,
    source: input.source,
    peer: input.peer ?? null,
    passed_rules: input.passed,
    failed_rules: input.failed,
  });
}

/**
 * Evaluate whether a send is allowed. Always logs the decision.
 */
export async function riskGuard(input: {
  orgId: string;
  accountId: string | null;
  source: SendSource;
  peer?: string | null;
  isNewConversation?: boolean;
}): Promise<RiskDecision> {
  const passed: string[] = [];
  const failed: string[] = [];

  if (!input.accountId) {
    return { allowed: true, health_state: "stable", passed: ["no_account"], failed };
  }

  const { data: account } = await db
    .from("msg_channel_accounts")
    .select(
      "id, status, risk_score, send_paused_at, observation_started_at, observation_hours, sensitivity, first_outbound_at",
    )
    .eq("id", input.accountId)
    .maybeSingle();

  if (!account) return { allowed: true, health_state: "stable", passed: ["account_missing"], failed };

  const state = resolveHealthState(account);
  const caps = CAPS[state];
  const isCold = COLD_SOURCES.includes(input.source);
  let reason: string | undefined;
  let message: string | undefined;

  // 1) Circuit breaker
  if (account.send_paused_at && input.source !== "manual") {
    failed.push("circuit_breaker");
    reason = "circuit_breaker";
    message = "تم إيقاف الإرسال التلقائي من هذا الرقم مؤقتاً لحماية الرقم من التقييد.";
  } else passed.push("circuit_breaker");

  // 2) Observation window — block cold outreach only
  const remaining = observationRemainingMs(account);
  if (remaining > 0 && isCold) {
    failed.push("observation_window");
    if (!reason) {
      reason = "observation_window";
      const hours = Math.ceil(remaining / 3600_000);
      message = `الرقم في فترة المراقبة (${hours} ساعة متبقية) — الرسائل التلقائية والحملات معطّلة مؤقتاً. الردود اليدوية تعمل بشكل طبيعي.`;
    }
  } else passed.push("observation_window");

  // 3) Quotas
  const [hour, day] = await Promise.all([
    getQuota(account.id, "hour", hourKey()),
    getQuota(account.id, "day", dayKey()),
  ]);
  if (hour.messages >= caps.hourly) {
    failed.push("hourly_cap");
    if (!reason) {
      reason = "hourly_cap";
      message = "تم الوصول للحد الساعي للرسائل من هذا الرقم. حاول بعد قليل.";
    }
  } else passed.push("hourly_cap");

  if (day.messages >= caps.daily) {
    failed.push("daily_cap");
    if (!reason) {
      reason = "daily_cap";
      message = "تم الوصول للحد اليومي للرسائل من هذا الرقم.";
    }
  } else passed.push("daily_cap");

  if (input.isNewConversation && day.new_conversations >= caps.newConvDaily) {
    failed.push("new_conversation_cap");
    if (!reason) {
      reason = "new_conversation_cap";
      message = "تم الوصول للحد اليومي لبدء محادثات جديدة من هذا الرقم.";
    }
  } else passed.push("new_conversation_cap");

  // Manual replies to existing conversations bypass quotas (safest traffic).
  const manualReply = input.source === "manual" && !input.isNewConversation;
  const allowed = manualReply ? true : failed.length === 0;
  if (manualReply && failed.length) passed.push("manual_reply_exempt");

  await logDecision({
    orgId: input.orgId,
    accountId: account.id,
    allowed,
    source: input.source,
    peer: input.peer ?? null,
    passed,
    failed,
  });

  return { allowed, reason: allowed ? undefined : reason, message: allowed ? undefined : message, health_state: state, passed, failed };
}

/** Count a successful/attempted outbound message towards the quotas + timestamps. */
export async function recordOutbound(input: {
  orgId: string;
  accountId: string | null;
  isNewConversation?: boolean;
  /** "phone" = typed on the handset, "system" = sent through NovaSales. */
  origin?: "phone" | "system";
}) {
  if (!input.accountId) return;
  const now = new Date();
  const nowIso = now.toISOString();
  const buckets: Array<{ bucket: "hour" | "day"; key: string }> = [
    { bucket: "hour", key: hourKey(now) },
    { bucket: "day", key: dayKey(now) },
  ];
  await Promise.all([
    ...buckets.map(async ({ bucket, key }) => {
      const current = await getQuota(input.accountId!, bucket, key);
      await db.from("wa_send_quotas").upsert(
        {
          organization_id: input.orgId,
          channel_account_id: input.accountId,
          bucket,
          bucket_key: key,
          messages: current.messages + 1,
          new_conversations: current.new_conversations + (input.isNewConversation ? 1 : 0),
        },
        { onConflict: "channel_account_id,bucket,bucket_key" },
      );
    }),
    db
      .from("msg_channel_accounts")
      .update({ last_outbound_at: nowIso })
      .eq("id", input.accountId),
    db
      .from("msg_channel_accounts")
      .update({
        first_outbound_at: nowIso,
        first_outbound_source: input.origin ?? "system",
        first_outbound_kind: input.isNewConversation ? "new_conversation" : "reply",
      })
      .eq("id", input.accountId)
      .is("first_outbound_at", null),
  ]);
}


export async function recordInbound(accountId: string | null) {
  if (!accountId) return;
  await db.from("msg_channel_accounts").update({ last_inbound_at: new Date().toISOString() }).eq("id", accountId);
}

/**
 * Record a health event (disconnect, restriction, failed send...) and recompute
 * the risk score. Trips the circuit breaker when the score crosses 40.
 */
export async function recordHealthEvent(input: {
  orgId: string;
  accountId: string | null;
  eventType: keyof typeof EVENT_WEIGHTS | string;
  detail?: Record<string, unknown>;
}) {
  if (!input.accountId) return;
  await db.from("wa_number_health_events").insert({
    organization_id: input.orgId,
    channel_account_id: input.accountId,
    event_type: input.eventType,
    detail: input.detail ?? {},
  });
  await recomputeRisk(input.orgId, input.accountId);
}

export async function recomputeRisk(orgId: string, accountId: string) {
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: events } = await db
    .from("wa_number_health_events")
    .select("event_type")
    .eq("channel_account_id", accountId)
    .gte("created_at", since);
  const score = (events ?? []).reduce(
    (sum: number, e: any) => sum + (EVENT_WEIGHTS[e.event_type] ?? 0),
    0,
  );
  const capped = Math.min(100, score);
  const { data: account } = await db
    .from("msg_channel_accounts")
    .select("send_paused_at, observation_started_at, observation_hours")
    .eq("id", accountId)
    .maybeSingle();

  const patch: Record<string, unknown> = { risk_score: capped };
  if (capped >= 40 && !account?.send_paused_at) patch.send_paused_at = new Date().toISOString();
  patch.health_state = resolveHealthState({ ...account, risk_score: capped, send_paused_at: patch.send_paused_at ?? account?.send_paused_at });
  await db.from("msg_channel_accounts").update(patch).eq("id", accountId);
  return capped;
}

/** Pick the healthiest connected account for cold outreach (campaign spreading). */
export async function pickBestAccountForOutreach(orgId: string, candidateIds?: string[]): Promise<string | null> {
  let q = db
    .from("msg_channel_accounts")
    .select("id, risk_score, send_paused_at, observation_started_at, observation_hours")
    .eq("organization_id", orgId)
    .eq("status", "connected");
  if (candidateIds?.length) q = q.in("id", candidateIds);
  const { data } = await q;
  const eligible = (data ?? []).filter(
    (a: any) => !a.send_paused_at && observationRemainingMs(a) === 0,
  );
  if (!eligible.length) return null;
  eligible.sort((a: any, b: any) => (a.risk_score ?? 0) - (b.risk_score ?? 0));
  return eligible[0].id;
}

/* ------------------------------------------------------------------ *
 * Number metrics, risk rules & restriction history (learning layer)
 * ------------------------------------------------------------------ */

export type NumberMetrics = {
  linked_at: string | null;
  link_age_hours: number;
  first_message_at: string | null;
  last_message_at: string | null;
  first_outbound_at: string | null;
  first_outbound_delay_minutes: number | null;
  first_message_kind: "reply" | "new_conversation" | null;
  first_message_source: "system" | "phone" | null;
  outbound_total: number;
  inbound_total: number;
  from_phone_total: number;
  from_system_total: number;
  new_conversations: number;
  conversations_started_by_us: number;
  conversations_started_by_peer: number;
  new_conversation_ratio: number;
  reply_rate: number;
  links_sent: number;
  media_sent: number;
  messages_24h: number;
  messages_7d: number;
  relink_count: number;
  last_relinked_at: string | null;
  restriction_count: number;
  last_restricted_at: string | null;
  was_under_observation: boolean;
  risk_score: number;
  health_state: HealthState;
  campaigns_count: number;
};

const URL_RE = /https?:\/\//i;
const MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

/** Collect every behavioural metric we track for one WhatsApp number. */
export async function collectNumberMetrics(accountId: string, account?: any): Promise<NumberMetrics> {
  const acc =
    account ??
    (await db.from("msg_channel_accounts").select("*").eq("id", accountId).maybeSingle()).data ??
    {};

  const now = Date.now();
  const d1 = new Date(now - 24 * 3600_000).toISOString();
  const d7 = new Date(now - 7 * 24 * 3600_000).toISOString();
  const linkedAt = acc.linked_at ?? acc.created_at ?? null;

  const { data: sessions } = await db
    .from("msg_sessions")
    .select("id, created_at")
    .eq("channel_account_id", accountId);
  const sessionIds = (sessions ?? []).map((s: any) => s.id);

  let msgs: any[] = [];
  if (sessionIds.length) {
    const { data } = await db
      .from("msg_messages")
      .select("session_id, direction, created_at, sent_by_user_id, is_internal, message_type, content")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: true })
      .limit(20000);
    msgs = (data ?? []).filter((m: any) => !m.is_internal);
  }

  let outbound = 0,
    inbound = 0,
    fromPhone = 0,
    last24 = 0,
    last7 = 0,
    links = 0,
    media = 0;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  let firstKind: NumberMetrics["first_message_kind"] = null;
  let firstSource: NumberMetrics["first_message_source"] = null;
  let firstOutboundAt: string | null = acc.first_outbound_at ?? null;
  const sessionFirst = new Map<string, any>();

  for (const m of msgs) {
    if (!sessionFirst.has(m.session_id)) sessionFirst.set(m.session_id, m);
    if (!firstAt) firstAt = m.created_at;
    lastAt = m.created_at;
    if (m.direction === "outbound") {
      outbound++;
      if (!m.sent_by_user_id) fromPhone++;
      if (!firstOutboundAt) firstOutboundAt = m.created_at;
      if (firstSource === null) firstSource = m.sent_by_user_id ? "system" : "phone";
      if (URL_RE.test(String(m.content ?? ""))) links++;
      if (MEDIA_TYPES.has(String(m.message_type ?? ""))) media++;
    } else inbound++;
    if (m.created_at >= d1) last24++;
    if (m.created_at >= d7) last7++;
  }

  let startedByUs = 0;
  let startedByPeer = 0;
  for (const first of sessionFirst.values()) {
    if (first.direction === "outbound") startedByUs++;
    else startedByPeer++;
  }
  if (msgs.length) firstKind = msgs[0].direction === "outbound" ? "new_conversation" : "reply";

  const [{ count: relinkCount }, { data: lastRelink }, { count: restrictionCount }, { data: lastRestriction }, { count: campaignsCount }] =
    await Promise.all([
      db
        .from("wa_number_health_events")
        .select("id", { count: "exact", head: true })
        .eq("channel_account_id", accountId)
        .in("event_type", ["relinked", "reconnected"]),
      db
        .from("wa_number_health_events")
        .select("created_at")
        .eq("channel_account_id", accountId)
        .in("event_type", ["relinked", "reconnected"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("wa_number_restrictions")
        .select("id", { count: "exact", head: true })
        .eq("channel_account_id", accountId),
      db
        .from("wa_number_restrictions")
        .select("detected_at")
        .eq("channel_account_id", accountId)
        .order("detected_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("cmp_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", acc.organization_id ?? "00000000-0000-0000-0000-000000000000"),
    ]);

  const delay =
    firstOutboundAt && linkedAt
      ? Math.max(0, Math.round((new Date(firstOutboundAt).getTime() - new Date(linkedAt).getTime()) / 60_000))
      : null;

  return {
    linked_at: linkedAt,
    link_age_hours: linkedAt ? Math.floor((now - new Date(linkedAt).getTime()) / 3600_000) : 0,
    first_message_at: firstAt,
    last_message_at: lastAt,
    first_outbound_at: firstOutboundAt,
    first_outbound_delay_minutes: delay,
    first_message_kind: firstKind,
    first_message_source: (acc.first_outbound_source as any) ?? firstSource,
    outbound_total: outbound,
    inbound_total: inbound,
    from_phone_total: fromPhone,
    from_system_total: Math.max(0, outbound - fromPhone),
    new_conversations: sessionIds.length,
    conversations_started_by_us: startedByUs,
    conversations_started_by_peer: startedByPeer,
    new_conversation_ratio: outbound + inbound > 0 ? Math.round((startedByUs / (outbound + inbound)) * 100) : 0,
    reply_rate: outbound > 0 ? Math.round((inbound / outbound) * 100) : 0,
    links_sent: links,
    media_sent: media,
    messages_24h: last24,
    messages_7d: last7,
    relink_count: relinkCount ?? 0,
    last_relinked_at: acc.last_relinked_at ?? lastRelink?.created_at ?? null,
    restriction_count: restrictionCount ?? 0,
    last_restricted_at: acc.last_restricted_at ?? lastRestriction?.detected_at ?? null,
    was_under_observation: observationRemainingMs(acc) > 0,
    risk_score: acc.risk_score ?? 0,
    health_state: resolveHealthState(acc),
    campaigns_count: campaignsCount ?? 0,
  };
}

export type RiskRule = { key: string; label: string; threshold: number | null; weight: number; is_enabled: boolean };

export async function loadRiskRules(): Promise<RiskRule[]> {
  const { data } = await db.from("wa_risk_rules").select("*").order("sort_order");
  return (data ?? []) as RiskRule[];
}

/** Apply the configurable rules to a metrics snapshot. Pure given the rules. */
export function applyRiskRules(m: NumberMetrics, rules: RiskRule[]): { points: number; reasons: Array<{ key: string; label: string; weight: number }> } {
  const reasons: Array<{ key: string; label: string; weight: number }> = [];
  const by = new Map(rules.filter((r) => r.is_enabled).map((r) => [r.key, r]));
  const hit = (key: string, cond: boolean) => {
    const r = by.get(key);
    if (r && cond) reasons.push({ key, label: r.label, weight: r.weight });
  };
  const t = (key: string, fallback: number) => Number(by.get(key)?.threshold ?? fallback);
  const d = m.first_outbound_delay_minutes;

  hit("first_outbound_under_minutes", d !== null && d < t("first_outbound_under_minutes", 30));
  hit(
    "first_outbound_under_hours",
    d !== null && d >= t("first_outbound_under_minutes", 30) && d < t("first_outbound_under_hours", 2) * 60,
  );
  hit("first_message_is_new_conversation", m.first_message_kind === "new_conversation");
  hit("first_message_from_phone", m.first_message_source === "phone");
  hit("zero_inbound", m.inbound_total === 0 && m.outbound_total > 0);
  hit("new_conversation_ratio_over", m.new_conversation_ratio > t("new_conversation_ratio_over", 20));
  hit("link_age_under_hours", m.link_age_hours < t("link_age_under_hours", 48));
  hit("reply_rate_under", m.outbound_total > 0 && m.reply_rate < t("reply_rate_under", 30));
  hit(
    "relinked_within_hours",
    Boolean(m.last_relinked_at) &&
      Date.now() - new Date(m.last_relinked_at!).getTime() < t("relinked_within_hours", 24) * 3600_000,
  );
  hit("previous_restriction_single", m.restriction_count === 1);
  hit("previous_restriction_multiple", m.restriction_count > 1);

  return { points: Math.min(100, reasons.reduce((s, r) => s + r.weight, 0)), reasons };
}

const AUTO_RESTRICTION_REASONS: Record<string, string> = {
  "401": "logged_out",
  "403": "temporary_ban",
  "405": "connection_blocked",
  "428": "connection_blocked",
};

/** Detect a restriction from provider connection data. Returns the reason or null. */
export function detectRestrictionReason(input: { state?: string; statusReason?: unknown; raw?: unknown }): string | null {
  const code = String(input.statusReason ?? "");
  if (AUTO_RESTRICTION_REASONS[code]) return AUTO_RESTRICTION_REASONS[code];
  const text = `${input.state ?? ""} ${JSON.stringify(input.raw ?? "")}`.toLowerCase();
  if (/temporar\w*\s*ban|banned|forbidden/.test(text)) return "temporary_ban";
  if (/logged\s*out|loggedout/.test(text)) return "logged_out";
  if (/blocked/.test(text)) return "connection_blocked";
  return null;
}

/**
 * Open a restriction record (automatic detection or manual by super admin) and
 * freeze a full snapshot of the number's state at that moment.
 */
export async function openRestriction(input: {
  orgId: string;
  accountId: string;
  source: "automatic" | "manual";
  reason?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}) {
  const { data: existing } = await db
    .from("wa_number_restrictions")
    .select("id")
    .eq("channel_account_id", input.accountId)
    .is("ended_at", null)
    .maybeSingle();
  if (existing) return existing.id as string;

  const metrics = await collectNumberMetrics(input.accountId);
  const rules = await loadRiskRules();
  const evaluation = applyRiskRules(metrics, rules);

  const { data: row } = await db
    .from("wa_number_restrictions")
    .insert({
      organization_id: input.orgId,
      channel_account_id: input.accountId,
      detection_source: input.source,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
      snapshot: { ...metrics, rule_points: evaluation.points, rule_reasons: evaluation.reasons },
    })
    .select("id")
    .maybeSingle();

  const { data: acc } = await db
    .from("msg_channel_accounts")
    .select("restriction_count")
    .eq("id", input.accountId)
    .maybeSingle();
  await db
    .from("msg_channel_accounts")
    .update({
      restriction_count: (acc?.restriction_count ?? 0) + 1,
      last_restricted_at: new Date().toISOString(),
      send_paused_at: new Date().toISOString(),
    })
    .eq("id", input.accountId);

  await recordHealthEvent({
    orgId: input.orgId,
    accountId: input.accountId,
    eventType: "restricted",
    detail: { source: input.source, reason: input.reason ?? null },
  });

  return row?.id as string | undefined;
}

/** Close the open restriction for a number (recovery) and compute its duration. */
export async function closeRestriction(accountId: string) {
  const { data: open } = await db
    .from("wa_number_restrictions")
    .select("id, detected_at")
    .eq("channel_account_id", accountId)
    .is("ended_at", null)
    .maybeSingle();
  if (!open) return false;
  const endedAt = new Date();
  await db
    .from("wa_number_restrictions")
    .update({
      ended_at: endedAt.toISOString(),
      duration_minutes: Math.max(0, Math.round((endedAt.getTime() - new Date(open.detected_at).getTime()) / 60_000)),
    })
    .eq("id", open.id);
  return true;
}
