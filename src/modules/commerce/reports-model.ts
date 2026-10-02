export async function reportRows(makeQuery: () => any) {
  const rows: any[] = [];
  for (let offset = 0; ;) {
    const { data, error } = await makeQuery().range(offset, offset + 499);
    if (error) throw new Error("تعذر تحميل بيانات التقارير؛ أعد المحاولة");
    if (!data?.length) return rows;
    rows.push(...data);
    offset += data.length;
  }
}

export function reportWindow(period: string, now = new Date()) {
  const to = now.toISOString();
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  return {
    from: period === "all" ? null : new Date(now.getTime() - days * 86400000).toISOString(),
    to,
  };
}

export function filterReportData(
  allOrders: any[],
  allItems: any[],
  filters: {
    departmentId?: string;
    repId?: string;
    productId?: string;
    currency?: string;
  },
  window: { from: string | null; to: string },
) {
  let orders = allOrders.filter(
    (o) =>
      o.status === "confirmed" &&
      o.confirmed_at &&
      Date.parse(o.confirmed_at) < Date.parse(window.to) &&
      (!window.from || Date.parse(o.confirmed_at) >= Date.parse(window.from)) &&
      (!filters.departmentId || o.department_id === filters.departmentId) &&
      (!filters.repId || o.sales_rep_user_id === filters.repId) &&
      (!filters.currency || o.currency === filters.currency),
  );
  const ids = new Set(orders.map((o) => o.id));
  const items = allItems.filter(
    (i) => ids.has(i.order_id) && (!filters.productId || i.product_id === filters.productId),
  );
  if (filters.productId) {
    const totals = new Map<string, { total: number; subtotal: number }>();
    for (const item of items) {
      const row = totals.get(item.order_id) ?? { total: 0, subtotal: 0 };
      row.total += Number(item.line_total ?? Number(item.sold_unit_price) * Number(item.quantity));
      row.subtotal += Number(item.list_unit_price) * Number(item.quantity);
      totals.set(item.order_id, row);
    }
    orders = orders
      .filter((o) => totals.has(o.id))
      .map((o) => {
        const t = totals.get(o.id)!;
        return {
          ...o,
          total: t.total,
          subtotal: t.subtotal,
          discount_total: Math.max(0, t.subtotal - t.total),
        };
      });
  }
  return { orders, items };
}
