export function visiblePerformanceRep(
  id: string,
  scope: string,
  userId: string,
  departmentUsers: Set<string>,
) {
  return scope === "all" || (scope === "own" ? id === userId : departmentUsers.has(id));
}
export function responseSamples(opps: any[], links: any[], messages: any[], until: string) {
  const sessions = new Map<string, Set<string>>();
  for (const link of links) {
    const ids = sessions.get(link.opportunity_id) ?? new Set<string>();
    ids.add(link.session_ref);
    sessions.set(link.opportunity_id, ids);
  }
  const result = new Map<string, number[]>();
  for (const opp of opps) {
    const opened = Date.parse(opp.opened_at);
    let first = Infinity;
    for (const msg of messages) {
      const time = Date.parse(msg.created_at);
      if (
        sessions.get(opp.id)?.has(msg.session_id) &&
        msg.sent_by_user_id === opp.owner_agent_id &&
        msg.direction === "outbound" &&
        !msg.is_internal &&
        ["sent", "delivered", "read"].includes(msg.status) &&
        time >= opened &&
        time < Date.parse(until)
      )
        first = Math.min(first, time);
    }
    if (Number.isFinite(first)) {
      const times = result.get(opp.owner_agent_id) ?? [];
      times.push((first - opened) / 60000);
      result.set(opp.owner_agent_id, times);
    }
  }
  return result;
}
export function performanceSortKey(sort: string, mixed: boolean) {
  return sort === "revenue" && mixed ? "orders" : sort;
}
export function performanceLeader(rows: any[], sort: string) {
  const value = (r: any) =>
    sort === "response"
      ? r.avgResponseMinutes
      : sort === "revenue"
        ? r.revenue
        : sort === "products"
          ? r.productsSold
          : sort === "customers"
            ? r.customers
            : r.confirmedOrders;
  if (!rows.length || value(rows[0]) == null || (sort !== "response" && value(rows[0]) <= 0))
    return false;
  return rows.length === 1 || value(rows[0]) !== value(rows[1]);
}
