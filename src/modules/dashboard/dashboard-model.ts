/** All ranges are [from,to): adjacent comparison windows never count the same event twice. */
export type DashboardFilters = {
  from: string;
  to: string;
  departmentId?: string;
  pipelineId?: string;
  ownerId?: string;
  currency?: string;
};
export type DashboardScope = {
  kind: "all" | "department" | "own";
  userId: string;
  departmentIds: string[];
  departmentUserIds?: string[];
};
export function visibleOpportunity(row: any, scope: DashboardScope, filters: DashboardFilters) {
  return (
    !row.deleted_at &&
    (scope.kind === "all" ||
      (scope.kind === "own"
        ? row.owner_agent_id === scope.userId
        : scope.departmentIds.includes(row.department_id))) &&
    (!filters.departmentId || row.department_id === filters.departmentId) &&
    (!filters.ownerId || row.owner_agent_id === filters.ownerId) &&
    (!filters.pipelineId || row.pipeline_id === filters.pipelineId)
  );
}
export function visibleLead(
  row: any,
  scope: DashboardScope,
  f: DashboardFilters,
  opps: any[] | Set<string>,
) {
  return (
    (scope.kind === "all" ||
      (scope.kind === "own"
        ? row.owner_user_id === scope.userId
        : scope.departmentIds.includes(row.department_id))) &&
    (!f.departmentId || row.department_id === f.departmentId) &&
    (!f.ownerId || row.owner_user_id === f.ownerId) &&
    (!f.pipelineId ||
      (opps instanceof Set ? opps.has(row.id) : opps.some((o) => o.lead_id === row.id)))
  );
}
export function entityVisibility(opps: any[], leads: any[]) {
  const ids = {
    opportunity: new Set(opps.map((o) => o.id)),
    lead: new Set(leads.map((l) => l.id)),
    contact: new Set([...opps, ...leads].map((r) => r.contact_id).filter(Boolean)),
  };
  return (row: any) =>
    Object.hasOwn(ids, row.entity_type) &&
    ids[row.entity_type as keyof typeof ids].has(row.entity_id);
}
export function scopedRelatedRecords(
  activities: any[],
  tasks: any[],
  timeline: any[],
  opps: any[],
  leads: any[],
  scope: DashboardScope,
  f: DashboardFilters,
) {
  const entity = entityVisibility(opps, leads);
  const restricted = scope.kind !== "all" || !!f.departmentId || !!f.pipelineId || !!f.ownerId;
  const ownUser = f.ownerId ?? (scope.kind === "own" ? scope.userId : undefined);
  const departmentActor = (row: any, field: string) =>
    row.entity_type !== "contact" ||
    !scope.departmentUserIds ||
    scope.departmentUserIds.includes(row[field]);
  const unlinkedTask = (t: any) =>
    !restricted ||
    (!f.pipelineId &&
      (scope.kind === "own"
        ? !f.departmentId && t.assignee_user_id === scope.userId
        : !!scope.departmentUserIds?.includes(t.assignee_user_id)));
  return {
    activities: activities.filter(
      (a) =>
        entity(a) &&
        departmentActor(a, "actor_user_id") &&
        (!ownUser || a.actor_user_id === ownUser),
    ),
    tasks: tasks.filter(
      (t) =>
        (t.entity_id ? entity(t) && departmentActor(t, "assignee_user_id") : unlinkedTask(t)) &&
        (!ownUser || t.assignee_user_id === ownUser),
    ),
    timeline: timeline.filter(
      (t) =>
        entity(t) &&
        departmentActor(t, "actor_user_id") &&
        (!ownUser || t.actor_user_id === ownUser),
    ),
  };
}
export const inRange = (date: string | null, from: string, to: string) =>
  !!date && Date.parse(date) >= Date.parse(from) && Date.parse(date) < Date.parse(to);
const sum = (rows: any[]) => rows.reduce((n, r) => n + Number(r.value ?? 0), 0);
const avg = (rows: number[]) => (rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0);
const rounded = (n: number) => Number(n.toFixed(1));
const delta = (a: number, b: number) => (b ? rounded(((a - b) / b) * 100) : a ? null : 0);
export function calculateDashboard(
  opps: any[],
  leads: any[],
  activities: any[],
  tasks: any[],
  f: DashboardFilters,
) {
  const span = Date.parse(f.to) - Date.parse(f.from),
    prevFrom = new Date(Date.parse(f.from) - span).toISOString();
  const opened = opps.filter((o) => inRange(o.opened_at, f.from, f.to));
  const closed = opps.filter((o) => inRange(o.closed_at, f.from, f.to));
  const prevClosed = opps.filter((o) => inRange(o.closed_at, prevFrom, f.from));
  const won = closed.filter((o) => o.outcome === "won"),
    lost = closed.filter((o) => o.outcome === "lost"),
    prevWon = prevClosed.filter((o) => o.outcome === "won");
  const money = (rows: any[]) => rows.filter((o) => o.currency === f.currency);
  const monetaryWon = money(won),
    revenue = sum(monetaryWon);
  const open = opps.filter((o) => !o.closed_at && Date.parse(o.opened_at) < Date.parse(f.to));
  const fresh = leads.filter((l) => inRange(l.opened_at, f.from, f.to));
  const acts = activities.filter((a) => inRange(a.occurred_at, f.from, f.to));
  const responsesByEntity = new Map<string, number[]>();
  for (const a of activities) {
    if (a.direction !== "outbound") continue;
    const key = `${a.entity_type}:${a.entity_id}`,
      times = responsesByEntity.get(key) ?? [];
    const time = Date.parse(a.occurred_at);
    if (time < Date.parse(f.to)) times.push(time);
    responsesByEntity.set(key, times);
  }
  for (const times of responsesByEntity.values()) times.sort((a, b) => a - b);
  const firstAfter = (key: string, opened: number) => {
    const times = responsesByEntity.get(key) ?? [];
    let start = 0,
      end = times.length;
    while (start < end) {
      const middle = (start + end) >>> 1;
      if (times[middle] < opened) start = middle + 1;
      else end = middle;
    }
    return times[start] ?? Infinity;
  };
  const response = fresh.flatMap((l) => {
    const opened = Date.parse(l.opened_at),
      first = Math.min(
        firstAfter(`contact:${l.contact_id}`, opened),
        firstAfter(`lead:${l.id}`, opened),
      );
    return Number.isFinite(first) ? [(first - opened) / 60000] : [];
  });
  const metric = (value: number, previous?: number, precision = 1) => ({
    value:
      Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * 10 ** precision) /
      10 ** precision,
    delta: previous === undefined ? 0 : delta(value, previous),
  });
  const kpis = {
    revenue: metric(revenue, sum(money(prevWon)), 2),
    newLeads: metric(
      fresh.length,
      leads.filter((l) => inRange(l.opened_at, prevFrom, f.from)).length,
    ),
    wonDeals: metric(won.length, prevWon.length),
    lostDeals: metric(lost.length, prevClosed.filter((o) => o.outcome === "lost").length),
    pipelineValue: metric(sum(money(open)), undefined, 2),
    forecastRevenue: metric(
      money(open).reduce(
        (n, o) =>
          n + (Number(o.value ?? 0) * Math.min(100, Math.max(0, Number(o.probability ?? 0)))) / 100,
        0,
      ),
      undefined,
      2,
    ),
    activities: metric(
      acts.length,
      activities.filter((a) => inRange(a.occurred_at, prevFrom, f.from)).length,
    ),
    avgDealSize: metric(monetaryWon.length ? revenue / monetaryWon.length : 0, undefined, 2),
    avgSalesCycleDays: metric(
      avg(
        won
          .filter((o) => Date.parse(o.closed_at) >= Date.parse(o.opened_at))
          .map((o) => (Date.parse(o.closed_at) - Date.parse(o.opened_at)) / 86_400_000),
      ),
    ),
    conversionRate: metric(
      fresh.length
        ? (fresh.filter(
            (l) =>
              !!l.converted_at &&
              Date.parse(l.converted_at) >= Date.parse(l.opened_at) &&
              Date.parse(l.converted_at) < Date.parse(f.to),
          ).length /
            fresh.length) *
            100
        : 0,
    ),
    winRate: metric(closed.length ? (won.length / (won.length + lost.length || 1)) * 100 : 0),
    leadResponseMinutes: { value: response.length ? rounded(avg(response)) : null, delta: 0 },
  };
  const trend = new Map<string, number>();
  for (let time = Date.parse(f.from); time < Date.parse(f.to); time += 86_400_000)
    trend.set(new Date(time).toISOString().slice(0, 10), 0);
  for (const o of monetaryWon) {
    const day = o.closed_at.slice(0, 10);
    trend.set(day, (trend.get(day) ?? 0) + Number(o.value ?? 0));
  }
  const stages = new Map<string, number>();
  for (const o of open)
    stages.set(
      o.stage_id ?? o.stage ?? "unknown",
      (stages.get(o.stage_id ?? o.stage ?? "unknown") ?? 0) + 1,
    );
  const activityBreakdown = new Map<string, number>();
  for (const a of acts)
    activityBreakdown.set(a.activity_type, (activityBreakdown.get(a.activity_type) ?? 0) + 1);
  const done = tasks.filter((t) => t.status === "done" && inRange(t.completed_at, f.from, f.to));
  const agentIds = new Set(
    [...opened, ...closed]
      .map((o) => o.owner_agent_id)
      .concat(
        acts.map((a) => a.actor_user_id),
        done.map((t) => t.assignee_user_id),
      )
      .filter(Boolean),
  );
  const agents = [...agentIds]
    .map((id) => {
      const deals = closed.filter((o) => o.owner_agent_id === id),
        win = deals.filter((o) => o.outcome === "won"),
        loss = deals.filter((o) => o.outcome === "lost");
      const owned = opened.filter((o) => o.owner_agent_id === id),
        resp = owned
          .filter(
            (o) =>
              o.first_response_at &&
              Date.parse(o.first_response_at) >= Date.parse(o.opened_at) &&
              Date.parse(o.first_response_at) < Date.parse(f.to),
          )
          .map((o) => (Date.parse(o.first_response_at) - Date.parse(o.opened_at)) / 60000);
      return {
        user_id: id,
        opps: owned.length,
        won: win.length,
        lost: loss.length,
        revenue: sum(money(win)),
        winRate:
          win.length + loss.length ? rounded((win.length / (win.length + loss.length)) * 100) : 0,
        avgResponseMinutes: resp.length ? rounded(avg(resp)) : null,
        tasksCompleted: done.filter((t) => t.assignee_user_id === id).length,
        activitiesPerDay: rounded(
          acts.filter((a) => a.actor_user_id === id).length / Math.max(1, span / 86400000),
        ),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
  const deptIds = new Set([...opened, ...closed].map((o) => o.department_id).filter(Boolean));
  const departments = [...deptIds]
    .map((id) => ({
      department_id: id,
      opps: opened.filter((o) => o.department_id === id).length,
      won: won.filter((o) => o.department_id === id).length,
      revenue: sum(money(won.filter((o) => o.department_id === id))),
    }))
    .sort((a, b) => b.revenue - a.revenue);
  return {
    kpis,
    revenueTrend: [...trend].map(([date, revenue]) => ({ date, revenue })),
    stageDist: [...stages].map(([stageId, count]) => ({ stageId, count })),
    activityBreak: [...activityBreakdown].map(([type, count]) => ({ type, count })),
    agents,
    departments,
  };
}
