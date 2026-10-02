import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

async function ctx() {
  const { getWorkspace } = await import("@/platform/workspace/workspace.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ws = await getWorkspace();
  const { checkedDb } = await import("./query.server");
  return { db: checkedDb(supabaseAdmin), ...ws };
}

async function requireSuperAdmin() {
  const c = await ctx();
  const { data } = await c.db.rpc("has_role", { _user_id: c.userId, _role: "admin" });
  if (data !== true) throw new Error("هذه البيانات متاحة للسوبر أدمن فقط");
  return c;
}

/** Health snapshot for the org's WhatsApp numbers (used by the sessions page). */
export const getNumbersRisk = createServerFn({ method: "GET" }).handler(async () => {
  const { db, organizationId } = await ctx();
  const { resolveHealthState, observationRemainingMs } = await import("./risk.server");
  const { data } = await db
    .from("msg_channel_accounts")
    .select("id, risk_score, send_paused_at, observation_started_at, observation_hours, linked_at, last_outbound_at, last_inbound_at")
    .eq("organization_id", organizationId);
  return (data ?? []).map((a: any) => ({
    id: a.id,
    risk_score: a.risk_score ?? 0,
    send_paused: Boolean(a.send_paused_at),
    health_state: resolveHealthState(a),
    observation_remaining_hours: Math.ceil(observationRemainingMs(a) / 3600_000),
    linked_at: a.linked_at,
    last_outbound_at: a.last_outbound_at,
    last_inbound_at: a.last_inbound_at,
  }));
});

/** Super-admin only: full operational activity + risk indicators for every WhatsApp number. */
export const getNumbersActivity = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await requireSuperAdmin();
  const { collectNumberMetrics, loadRiskRules, applyRiskRules } = await import("./risk.server");

  const { readAllRows } = await import("./query.server");
  const [accounts, plugins, orgs, rules] = await Promise.all([
    readAllRows(() => db.from("msg_channel_accounts").select("*").order("created_at", { ascending: false }).order("id")),
    readAllRows(() => db.from("plugin_whatsapp_evolution_instances").select("id, channel_account_id, phone_number, instance_name, raw_state").order("id")),
    readAllRows(() => db.from("organizations").select("id, name").order("id")),
    loadRiskRules(),
  ]);
  const pluginBy = new Map<string, any>((plugins ?? []).map((p: any) => [p.channel_account_id, p]));
  const orgBy = new Map<string, string>((orgs ?? []).map((o: any) => [o.id, o.name]));

  const rows = await Promise.all(
    (accounts ?? []).map(async (a: any) => {
      const metrics = await collectNumberMetrics(a.id, a);
      const evaluation = applyRiskRules(metrics, rules);

      const [{ count: healthCount }, { data: lastEvents }, { data: restrictions }] = await Promise.all([
        db.from("wa_number_health_events").select("id", { count: "exact", head: true }).eq("channel_account_id", a.id),
        db
          .from("wa_number_health_events")
          .select("event_type, created_at, detail")
          .eq("channel_account_id", a.id)
          .order("created_at", { ascending: false })
          .limit(5),
        db
          .from("wa_number_restrictions")
          .select("id, detected_at, ended_at, duration_minutes, detection_source, reason, notes")
          .eq("channel_account_id", a.id)
          .order("detected_at", { ascending: false })
          .limit(10),
      ]);

      return {
        id: a.id,
        organization_name: orgBy.get(a.organization_id) ?? "—",
        display_name: a.display_name ?? pluginBy.get(a.id)?.instance_name ?? "—",
        phone_number: pluginBy.get(a.id)?.phone_number ?? null,
        status: a.status,
        send_paused: Boolean(a.send_paused_at),
        observation_remaining_hours: Math.ceil(
          (metrics.was_under_observation
            ? new Date(a.observation_started_at).getTime() + (a.observation_hours ?? 48) * 3600_000 - Date.now()
            : 0) / 3600_000,
        ),
        uptime_hours: metrics.link_age_hours,
        health_events_total: healthCount ?? 0,
        recent_events: lastEvents ?? [],
        restrictions: restrictions ?? [],
        is_restricted_now: await db.from("wa_number_restrictions").select("id", { count: "exact", head: true }).eq("channel_account_id", a.id).is("ended_at", null).then((r: any) => (r.count ?? 0) > 0),
        rule_points: evaluation.points,
        rule_reasons: evaluation.reasons,
        ...metrics,
      };
    }),
  );
  rows.sort((x: any, y: any) => y.rule_points + y.risk_score - (x.rule_points + x.risk_score));
  return rows;
});

/** Super-admin only: averages for healthy numbers vs numbers that were restricted. */
export const getRiskComparison = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await requireSuperAdmin();
  const { collectNumberMetrics } = await import("./risk.server");
  const { readAllRows } = await import("./query.server");
  const accounts = await readAllRows(() => db.from("msg_channel_accounts").select("*").order("id"));

  const restrictedIds = new Set<string>(
    (await readAllRows(() => db.from("wa_number_restrictions").select("id, channel_account_id").order("id"))).map(
      (r: any) => r.channel_account_id,
    ),
  );
  const snapshots = (await readAllRows(() => db.from("wa_number_restrictions").select("id, snapshot").order("id")))
    .map((r: any) => r.snapshot)
    .filter(Boolean);

  const healthy: any[] = [];
  const restricted: any[] = [];
  for (const a of accounts ?? []) {
    const m = await collectNumberMetrics(a.id, a);
    (restrictedIds.has(a.id) ? restricted : healthy).push(m);
  }

  const avg = (rows: any[], key: string) => {
    const vals = rows.filter((r) => r?.[key] !== null && r?.[key] !== undefined).map((r) => Number(r[key])).filter((v) => Number.isFinite(v));
    if (!vals.length) return 0;
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  };
  const summarize = (rows: any[]) => ({
    count: rows.length,
    first_outbound_delay_minutes: avg(rows, "first_outbound_delay_minutes"),
    reply_rate: avg(rows, "reply_rate"),
    new_conversation_ratio: avg(rows, "new_conversation_ratio"),
    outbound_total: avg(rows, "outbound_total"),
    from_phone_total: avg(rows, "from_phone_total"),
    from_system_total: avg(rows, "from_system_total"),
    relink_count: avg(rows, "relink_count"),
  });

  return {
    healthy: summarize(healthy),
    restricted: summarize(restricted),
    /** Averages frozen at the moment each restriction was detected. */
    at_restriction: summarize(snapshots),
    under_observation: healthy.filter((m) => m.was_under_observation).length +
      restricted.filter((m) => m.was_under_observation).length,
    zero_inbound: [...healthy, ...restricted].filter((m) => m.inbound_total === 0 && m.outbound_total > 0).length,
    fast_first_send: [...healthy, ...restricted].filter(
      (m) => m.first_outbound_delay_minutes !== null && m.first_outbound_delay_minutes < 30,
    ).length,
  };
});

/** Super-admin only: read the configurable risk rules. */
export const listRiskRules = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await requireSuperAdmin();
  const { data } = await db.from("wa_risk_rules").select("*").order("sort_order");
  return data ?? [];
});

/** Super-admin only: tune a rule's threshold / weight / enabled state. */
export const updateRiskRule = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        key: z.string(),
        threshold: z.number().nullable().optional(),
        weight: z.number().int().min(0).max(100).optional(),
        is_enabled: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { db } = await requireSuperAdmin();
    const patch: Record<string, unknown> = {};
    if (data.threshold !== undefined) patch.threshold = data.threshold;
    if (data.weight !== undefined) patch.weight = data.weight;
    if (data.is_enabled !== undefined) patch.is_enabled = data.is_enabled;
    const { data: updated } = await db.from("wa_risk_rules").update(patch).eq("key", data.key).select("key").maybeSingle();
    if (!updated) throw new Error("قاعدة الخطورة غير موجودة");
    return { ok: true };
  });

/** Super-admin only: log a restriction manually (fallback when auto-detection misses it). */
export const recordRestriction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ accountId: z.string().uuid(), reason: z.string().optional(), notes: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const c = await requireSuperAdmin();
    const { openRestriction } = await import("./risk.server");
    const { data: acc } = await c.db
      .from("msg_channel_accounts")
      .select("organization_id")
      .eq("id", data.accountId)
      .maybeSingle();
    if (!acc) throw new Error("الرقم غير موجود");
    await openRestriction({
      orgId: acc.organization_id,
      accountId: data.accountId,
      source: "manual",
      reason: data.reason ?? "manual",
      notes: data.notes ?? null,
      createdBy: c.userId,
    });
    return { ok: true };
  });

/** Super-admin only: mark the open restriction as ended (number recovered). */
export const endRestriction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const { closeRestriction } = await import("./risk.server");
    const closed = await closeRestriction(data.accountId);
    if (!closed) throw new Error("لا يوجد تقييد نشط لهذا الرقم");
    return { ok: true };
  });


/** Super-admin only: recent send decisions (why a send was allowed/blocked). */
export const getSendDecisions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ accountId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { db } = await requireSuperAdmin();
    let q = db.from("wa_send_decisions").select("*").order("created_at", { ascending: false }).limit(100);
    if (data.accountId) q = q.eq("channel_account_id", data.accountId);
    const { data: rows } = await q;
    return rows ?? [];
  });

/** Super-admin only: manual control over observation window & circuit breaker. */
export const setNumberRiskControls = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        action: z.enum(["start_observation", "end_observation", "extend_observation", "pause_sending", "resume_sending", "reset_score"]),
        hours: z.number().int().min(1).max(720).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await requireSuperAdmin();
    await db.rpc("wa_apply_control", { _account: data.accountId, _action: data.action, _hours: data.hours ?? null, _actor: userId });
    return { ok: true };
  });
