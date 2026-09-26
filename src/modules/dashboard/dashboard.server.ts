import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Simple in-memory cache with TTL for dashboard read-heavy queries.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

function cacheKey(orgId: string, name: string, filters: unknown) {
  return `${orgId}::${name}::${JSON.stringify(filters ?? {})}`;
}

async function cached<T>(orgId: string, name: string, filters: unknown, fn: () => Promise<T>): Promise<T> {
  const k = cacheKey(orgId, name, filters);
  const hit = cache.get(k);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.data as T;
  const data = await fn();
  cache.set(k, { at: now, data });
  // lazy cleanup
  if (cache.size > 500) {
    for (const [key, entry] of cache) {
      if (now - entry.at > CACHE_TTL_MS * 5) cache.delete(key);
    }
  }
  return data;
}

export function invalidateDashboardCache(orgId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${orgId}::`)) cache.delete(k);
}

export interface DashboardFilters {
  from: string; // ISO
  to: string; // ISO
  departmentId?: string;
  pipelineId?: string;
  ownerId?: string;
}

function previousRange(f: DashboardFilters) {
  const from = new Date(f.from).getTime();
  const to = new Date(f.to).getTime();
  const span = to - from;
  return {
    from: new Date(from - span).toISOString(),
    to: new Date(from).toISOString(),
  };
}

function delta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function db() {
  return supabaseAdmin as any;
}

function applyOppFilters(q: any, orgId: string, f: DashboardFilters) {
  q = q.eq("organization_id", orgId);
  if (f.departmentId) q = q.eq("department_id", f.departmentId);
  if (f.pipelineId) q = q.eq("pipeline_id", f.pipelineId);
  if (f.ownerId) q = q.eq("owner_agent_id", f.ownerId);
  return q;
}

async function fetchOpps(orgId: string, f: DashboardFilters, dateCol: "opened_at" | "closed_at") {
  let q = db()
    .from("opp_opportunities")
    .select("id, contact_id, value, currency, stage, outcome, opened_at, closed_at, first_response_at, department_id, owner_agent_id, pipeline_id, stage_id, probability")
    .gte(dateCol, f.from)
    .lte(dateCol, f.to);
  q = applyOppFilters(q, orgId, f);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<any>;
}

async function fetchOpenOpps(orgId: string, f: DashboardFilters) {
  let q = db()
    .from("opp_opportunities")
    .select("id, value, probability, stage, outcome, closed_at, opened_at, department_id, owner_agent_id, pipeline_id, stage_id")
    .is("closed_at", null);
  q = applyOppFilters(q, orgId, f);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<any>;
}

async function fetchLeads(orgId: string, f: DashboardFilters) {
  let q = db()
    .from("crm_leads")
    .select("id, contact_id, status, opened_at, converted_at, department_id, owner_user_id")
    .gte("opened_at", f.from)
    .lte("opened_at", f.to)
    .eq("organization_id", orgId);
  if (f.departmentId) q = q.eq("department_id", f.departmentId);
  if (f.ownerId) q = q.eq("owner_user_id", f.ownerId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<any>;
}

async function fetchActivities(orgId: string, f: DashboardFilters) {
  let q = db()
    .from("crm_activities")
    .select("id, activity_type, direction, actor_user_id, occurred_at")
    .gte("occurred_at", f.from)
    .lte("occurred_at", f.to)
    .eq("organization_id", orgId);
  if (f.ownerId) q = q.eq("actor_user_id", f.ownerId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<any>;
}

// ==================================================================
// KPIs
// ==================================================================

export async function getKpis(orgId: string, f: DashboardFilters) {
  return cached(orgId, "kpis", f, async () => {
    const [oppsInRange, openOpps, leads, activities] = await Promise.all([
      fetchOpps(orgId, f, "opened_at"),
      fetchOpenOpps(orgId, f),
      fetchLeads(orgId, f),
      fetchActivities(orgId, f),
    ]);
    // Closed within range (won/lost)
    const closed = oppsInRange.filter((o) => o.closed_at && o.closed_at >= f.from && o.closed_at <= f.to);
    // Some closed opps may have opened before window: also query separately
    let q = db()
      .from("opp_opportunities")
      .select("id, value, outcome, opened_at, closed_at, first_response_at, contact_id, department_id, owner_agent_id, pipeline_id")
      .gte("closed_at", f.from)
      .lte("closed_at", f.to);
    q = applyOppFilters(q, orgId, f);
    const { data: closedRows } = await q;
    const closedAll: any[] = closedRows ?? [];

    const won = closedAll.filter((o) => o.outcome === "won");
    const lost = closedAll.filter((o) => o.outcome === "lost");
    const revenue = won.reduce((s, o) => s + Number(o.value ?? 0), 0);
    const pipelineValue = openOpps.reduce((s, o) => s + Number(o.value ?? 0), 0);
    const forecast = openOpps.reduce(
      (s, o) => s + Number(o.value ?? 0) * ((o.probability ?? 0) / 100),
      0,
    );
    const avgDeal = won.length ? revenue / won.length : 0;
    // Avg sales cycle in days for won
    const cycles = won
      .filter((o) => o.opened_at && o.closed_at)
      .map((o) => (new Date(o.closed_at).getTime() - new Date(o.opened_at).getTime()) / 86_400_000);
    const avgCycle = cycles.length ? cycles.reduce((s, c) => s + c, 0) / cycles.length : 0;
    const conversionRate = leads.length
      ? (oppsInRange.length / leads.length) * 100
      : 0;
    const winRate =
      won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : 0;

    // Lead response time: average time between lead opened_at and first outbound activity for its contact
    const leadContactIds = leads.map((l) => l.contact_id);
    let responseAvg = 0;
    if (leadContactIds.length) {
      const { data: firstActs } = await db()
        .from("crm_activities")
        .select("entity_id, occurred_at, direction, entity_type")
        .eq("organization_id", orgId)
        .eq("entity_type", "contact")
        .in("entity_id", leadContactIds)
        .eq("direction", "outbound")
        .order("occurred_at", { ascending: true });
      const firstByContact = new Map<string, string>();
      for (const a of firstActs ?? []) {
        if (!firstByContact.has(a.entity_id)) firstByContact.set(a.entity_id, a.occurred_at);
      }
      const diffs: number[] = [];
      for (const l of leads) {
        const first = firstByContact.get(l.contact_id);
        if (first) {
          const d = (new Date(first).getTime() - new Date(l.opened_at).getTime()) / 60_000;
          if (d >= 0) diffs.push(d);
        }
      }
      responseAvg = diffs.length ? diffs.reduce((s, x) => s + x, 0) / diffs.length : 0;
    }

    // Deltas vs previous window
    const prev = previousRange(f);
    const [prevOpps, prevLeads, prevActivities] = await Promise.all([
      fetchOpps(orgId, { ...f, ...prev }, "opened_at"),
      fetchLeads(orgId, { ...f, ...prev }),
      fetchActivities(orgId, { ...f, ...prev }),
    ]);
    let pq = db()
      .from("opp_opportunities")
      .select("id, value, outcome")
      .gte("closed_at", prev.from)
      .lte("closed_at", prev.to);
    pq = applyOppFilters(pq, orgId, f);
    const { data: prevClosed } = await pq;
    const prevWon = (prevClosed ?? []).filter((o: any) => o.outcome === "won");
    const prevRevenue = prevWon.reduce((s: number, o: any) => s + Number(o.value ?? 0), 0);

    return {
      revenue: { value: revenue, delta: delta(revenue, prevRevenue) },
      newLeads: { value: leads.length, delta: delta(leads.length, prevLeads.length) },
      wonDeals: { value: won.length, delta: delta(won.length, prevWon.length) },
      lostDeals: { value: lost.length, delta: delta(lost.length, (prevClosed ?? []).filter((o: any) => o.outcome === "lost").length) },
      pipelineValue: { value: pipelineValue, delta: 0 },
      forecastRevenue: { value: forecast, delta: 0 },
      activities: { value: activities.length, delta: delta(activities.length, prevActivities.length) },
      avgDealSize: { value: avgDeal, delta: 0 },
      avgSalesCycleDays: { value: Number(avgCycle.toFixed(1)), delta: 0 },
      conversionRate: { value: Number(conversionRate.toFixed(1)), delta: 0 },
      winRate: { value: Number(winRate.toFixed(1)), delta: 0 },
      leadResponseMinutes: { value: Number(responseAvg.toFixed(1)), delta: 0 },
      prevOppsCount: prevOpps.length,
    };
  });
}

// ==================================================================
// Charts
// ==================================================================

export async function getRevenueTrend(orgId: string, f: DashboardFilters) {
  return cached(orgId, "revenue_trend", f, async () => {
    let q = db()
      .from("opp_opportunities")
      .select("value, closed_at")
      .eq("outcome", "won")
      .gte("closed_at", f.from)
      .lte("closed_at", f.to);
    q = applyOppFilters(q, orgId, f);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const buckets = new Map<string, number>();
    for (const r of data ?? []) {
      const day = String(r.closed_at).slice(0, 10);
      buckets.set(day, (buckets.get(day) ?? 0) + Number(r.value ?? 0));
    }
    return Array.from(buckets.entries())
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));
  });
}

export async function getStageDistribution(orgId: string, f: DashboardFilters) {
  return cached(orgId, "stage_dist", f, async () => {
    const opps = await fetchOpenOpps(orgId, f);
    const stages = new Map<string, { count: number; value: number }>();
    for (const o of opps) {
      const key = o.stage ?? "unknown";
      const cur = stages.get(key) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += Number(o.value ?? 0);
      stages.set(key, cur);
    }
    return Array.from(stages.entries()).map(([stage, v]) => ({ stage, ...v }));
  });
}

export async function getActivityBreakdown(orgId: string, f: DashboardFilters) {
  return cached(orgId, "activity_breakdown", f, async () => {
    const acts = await fetchActivities(orgId, f);
    const map = new Map<string, number>();
    for (const a of acts) {
      const key = a.activity_type ?? "other";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([type, count]) => ({ type, count }));
  });
}

// ==================================================================
// Agent & Department Performance
// ==================================================================

export async function getAgentPerformance(orgId: string, f: DashboardFilters) {
  return cached(orgId, "agent_perf", f, async () => {
    let q = db()
      .from("opp_opportunities")
      .select("id, value, outcome, owner_agent_id, opened_at, closed_at, first_response_at")
      .gte("opened_at", f.from)
      .lte("opened_at", f.to)
      .eq("organization_id", orgId);
    if (f.departmentId) q = q.eq("department_id", f.departmentId);
    if (f.pipelineId) q = q.eq("pipeline_id", f.pipelineId);
    const { data: opps } = await q;

    const acts = await fetchActivities(orgId, f);
    let tq = db()
      .from("crm_tasks")
      .select("id, status, assignee_user_id, completed_at")
      .eq("organization_id", orgId)
      .eq("status", "done")
      .gte("completed_at", f.from)
      .lte("completed_at", f.to);
    const { data: tasks } = await tq;

    const spanDays = Math.max(1, (new Date(f.to).getTime() - new Date(f.from).getTime()) / 86_400_000);

    const agg = new Map<string, {
      opps: number;
      won: number;
      lost: number;
      revenue: number;
      respTimes: number[];
      tasks: number;
      activities: number;
    }>();
    const get = (id: string) => {
      if (!agg.has(id)) agg.set(id, { opps: 0, won: 0, lost: 0, revenue: 0, respTimes: [], tasks: 0, activities: 0 });
      return agg.get(id)!;
    };
    for (const o of (opps ?? []) as any[]) {
      if (!o.owner_agent_id) continue;
      const g = get(o.owner_agent_id);
      g.opps += 1;
      if (o.outcome === "won") { g.won += 1; g.revenue += Number(o.value ?? 0); }
      if (o.outcome === "lost") g.lost += 1;
      if (o.first_response_at && o.opened_at) {
        const d = (new Date(o.first_response_at).getTime() - new Date(o.opened_at).getTime()) / 60_000;
        if (d >= 0) g.respTimes.push(d);
      }
    }
    for (const a of acts) {
      if (!a.actor_user_id) continue;
      get(a.actor_user_id).activities += 1;
    }
    for (const t of (tasks ?? []) as any[]) {
      if (!t.assignee_user_id) continue;
      get(t.assignee_user_id).tasks += 1;
    }

    const ids = Array.from(agg.keys());
    const { data: profs } = ids.length
      ? await db().from("profiles").select("id, full_name").in("id", ids)
      : { data: [] };
    const nameMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));

    return Array.from(agg.entries()).map(([id, g]) => ({
      user_id: id,
      name: nameMap.get(id) ?? "—",
      opps: g.opps,
      won: g.won,
      lost: g.lost,
      revenue: g.revenue,
      winRate: g.won + g.lost ? Number(((g.won / (g.won + g.lost)) * 100).toFixed(1)) : 0,
      avgResponseMinutes: g.respTimes.length
        ? Number((g.respTimes.reduce((s, x) => s + x, 0) / g.respTimes.length).toFixed(1))
        : 0,
      tasksCompleted: g.tasks,
      activitiesPerDay: Number((g.activities / spanDays).toFixed(2)),
    })).sort((a, b) => b.revenue - a.revenue);
  });
}

export async function getDepartmentPerformance(orgId: string, f: DashboardFilters) {
  return cached(orgId, "dept_perf", f, async () => {
    let q = db()
      .from("opp_opportunities")
      .select("id, value, outcome, department_id, opened_at, closed_at")
      .gte("opened_at", f.from)
      .lte("opened_at", f.to)
      .eq("organization_id", orgId);
    if (f.pipelineId) q = q.eq("pipeline_id", f.pipelineId);
    const { data: opps } = await q;

    const acts = await fetchActivities(orgId, f);

    const agg = new Map<string, { opps: number; won: number; lost: number; revenue: number; activities: number }>();
    const get = (id: string) => {
      if (!agg.has(id)) agg.set(id, { opps: 0, won: 0, lost: 0, revenue: 0, activities: 0 });
      return agg.get(id)!;
    };
    for (const o of (opps ?? []) as any[]) {
      if (!o.department_id) continue;
      const g = get(o.department_id);
      g.opps += 1;
      if (o.outcome === "won") { g.won += 1; g.revenue += Number(o.value ?? 0); }
      if (o.outcome === "lost") g.lost += 1;
    }
    // Activities per department (via actor's department membership) - approximation: skip if too costly
    // For now, count all department activities via opp -> dept mapping isn't 1-1. Leave activities empty for now.
    void acts;

    const ids = Array.from(agg.keys());
    const { data: depts } = ids.length
      ? await db().from("org_departments").select("id, name").in("id", ids)
      : { data: [] };
    const nameMap = new Map((depts ?? []).map((d: any) => [d.id, d.name]));

    return Array.from(agg.entries()).map(([id, g]) => ({
      department_id: id,
      name: nameMap.get(id) ?? "—",
      opps: g.opps,
      won: g.won,
      revenue: g.revenue,
      winRate: g.won + g.lost ? Number(((g.won / (g.won + g.lost)) * 100).toFixed(1)) : 0,
      activities: g.activities,
    })).sort((a, b) => b.revenue - a.revenue);
  });
}

// ==================================================================
// Widgets
// ==================================================================

export async function getRecentActivities(orgId: string, limit = 10) {
  return cached(orgId, "recent_acts", { limit }, async () => {
    const { data, error } = await db()
      .from("crm_timeline")
      .select("id, event_kind, title, description, occurred_at, actor_user_id, entity_type, entity_id")
      .eq("organization_id", orgId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
}

export async function getUpcomingTasks(orgId: string, limit = 10) {
  return cached(orgId, "upcoming_tasks", { limit }, async () => {
    const now = new Date().toISOString();
    const { data, error } = await db()
      .from("crm_tasks")
      .select("id, title, due_at, priority, status, assignee_user_id")
      .eq("organization_id", orgId)
      .neq("status", "done")
      .gte("due_at", now)
      .order("due_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
}

export async function getOverdueTasks(orgId: string, limit = 10) {
  return cached(orgId, "overdue_tasks", { limit }, async () => {
    const now = new Date().toISOString();
    const { data, error } = await db()
      .from("crm_tasks")
      .select("id, title, due_at, priority, status, assignee_user_id")
      .eq("organization_id", orgId)
      .neq("status", "done")
      .lt("due_at", now)
      .order("due_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
}
