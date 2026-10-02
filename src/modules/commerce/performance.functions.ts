import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { reportRows, reportWindow } from "./reports-model";
import { visiblePerformanceRep, responseSamples } from "./performance-model";
const PerformanceInput = z.object({
  period: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional(),
});
export const getSalesPerformance = createServerFn({ method: "GET" })
  .validator((input: unknown) => PerformanceInput.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getOpportunityVisibility, applySalesOrderScope, applyOpportunityScope } =
      await import("@/platform/rbac/data-scope.server");
    const access = await requireAnyPermission(["sales.performance.view"]),
      organizationId = access.organizationId,
      db = supabaseAdmin as any;
    const window = reportWindow(data.period),
      scope = getOpportunityVisibility(access);
    const roles = await reportRows(() =>
      db
        .from("rbac_roles")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("key", "sales")
        .order("id"),
    );
    const roleRows = roles.length
      ? await reportRows(() =>
          db
            .from("rbac_user_roles")
            .select("user_id")
            .eq("organization_id", organizationId)
            .in(
              "role_id",
              roles.map((r) => r.id),
            )
            .order("user_id"),
        )
      : [];
    const memberships = await reportRows(() =>
      db
        .from("org_memberships")
        .select("user_id")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("user_id"),
    );
    const active = new Set(memberships.map((r) => r.user_id));
    const departmentRows =
      scope === "department" && access.departmentIds.length
        ? await reportRows(() =>
            db
              .from("org_department_members")
              .select("user_id")
              .eq("organization_id", organizationId)
              .eq("is_active", true)
              .in("department_id", access.departmentIds)
              .order("user_id"),
          )
        : [];
    const departmentUsers = new Set<string>(departmentRows.map((r) => r.user_id));
    const repIds = [...new Set<string>(roleRows.map((r) => r.user_id))].filter(
      (id) => active.has(id) && visiblePerformanceRep(id, scope, access.userId, departmentUsers),
    );
    const allOrders: any[] = [],
      opportunities: any[] = [],
      profiles: any[] = [],
      links: any[] = [],
      messages: any[] = [];
    for (let i = 0; i < repIds.length; i += 100) {
      const ids = repIds.slice(i, i + 100);
      const makeOrders = () => {
        let q = applySalesOrderScope(
          db
            .from("sales_orders")
            .select("id,sales_rep_user_id,contact_id,total,discount_total,currency,confirmed_at")
            .eq("organization_id", organizationId)
            .eq("status", "confirmed")
            .in("sales_rep_user_id", ids)
            .lt("confirmed_at", window.to)
            .order("confirmed_at")
            .order("id"),
          access,
        );
        return window.from ? q?.gte("confirmed_at", window.from) : q;
      };
      const makeOpps = () => {
        let q = applyOpportunityScope(
          db
            .from("opp_opportunities")
            .select("id,owner_agent_id,opened_at")
            .eq("organization_id", organizationId)
            .is("deleted_at", null)
            .in("owner_agent_id", ids)
            .lt("opened_at", window.to)
            .order("opened_at")
            .order("id"),
          access,
        );
        return window.from ? q?.gte("opened_at", window.from) : q;
      };
      if (makeOrders()) allOrders.push(...(await reportRows(makeOrders)));
      if (makeOpps()) opportunities.push(...(await reportRows(makeOpps)));
      profiles.push(
        ...(await reportRows(() =>
          db.from("profiles").select("id,full_name,avatar_url").in("id", ids).order("id"),
        )),
      );
    }
    for (let i = 0; i < allOrders.length; i += 100) {
      const ids = allOrders.slice(i, i + 100).map((o) => o.id);
      const items = await reportRows(() =>
        db
          .from("sales_order_items")
          .select("id,order_id,quantity")
          .eq("organization_id", organizationId)
          .in("order_id", ids)
          .order("id"),
      );
      for (const order of allOrders.slice(i, i + 100))
        order.sales_order_items = items.filter((item) => item.order_id === order.id);
    }
    for (let i = 0; i < opportunities.length; i += 100)
      links.push(
        ...(await reportRows(() =>
          db
            .from("crm_opportunity_sessions")
            .select("opportunity_id,session_ref")
            .eq("organization_id", organizationId)
            .in(
              "opportunity_id",
              opportunities.slice(i, i + 100).map((o) => o.id),
            )
            .order("opportunity_id")
            .order("session_ref"),
        )),
      );
    const sessionIds = [...new Set(links.map((l) => l.session_ref))];
    for (let i = 0; i < sessionIds.length; i += 100)
      messages.push(
        ...(await reportRows(() =>
          db
            .from("msg_messages")
            .select("id,session_id,sent_by_user_id,direction,status,is_internal,created_at")
            .eq("organization_id", organizationId)
            .in("session_id", sessionIds.slice(i, i + 100))
            .eq("direction", "outbound")
            .lt("created_at", window.to)
            .order("created_at")
            .order("id"),
        )),
      );
    const samples = responseSamples(opportunities, links, messages, window.to);
    const currencies = [
      ...new Set<string>(allOrders.map((o) => o.currency).filter(Boolean)),
    ].sort();
    const orders = data.currency
      ? allOrders.filter((o) => o.currency === data.currency)
      : allOrders;
    const performance = new Map<
      string,
      {
        revenue: number;
        orders: number;
        products: number;
        customers: Set<string>;
        discounts: number;
        revenueByCurrency: Record<string, number>;
        responseMinutes: number[];
      }
    >();

    for (const repId of repIds) {
      performance.set(repId, {
        revenue: 0,
        orders: 0,
        products: 0,
        customers: new Set(),
        discounts: 0,
        revenueByCurrency: {},
        responseMinutes: samples.get(repId) ?? [],
      });
    }

    for (const order of orders) {
      const repId = order.sales_rep_user_id;

      if (!repId) continue;

      const row = performance.get(repId);

      if (!row) continue;

      const total = Number(order.total ?? 0);
      const discount = Number(order.discount_total ?? 0);

      row.orders += 1;
      if (data.currency || currencies.length <= 1) row.revenue += total;
      if (data.currency || currencies.length <= 1) row.discounts += discount;

      if (order.contact_id) {
        row.customers.add(order.contact_id);
      }

      const currency = String(order.currency ?? "USD");

      row.revenueByCurrency[currency] = (row.revenueByCurrency[currency] ?? 0) + total;

      const items = Array.isArray(order.sales_order_items) ? order.sales_order_items : [];

      row.products += items.reduce((sum: number, item: any) => sum + Number(item.quantity ?? 0), 0);
    }

    const profileMap = new Map(profiles.map((profile: any) => [profile.id, profile]));

    const rows = repIds.map((repId) => {
      const stat = performance.get(repId)!;
      const profile = profileMap.get(repId);

      const avgResponseMinutes =
        stat.responseMinutes.length > 0
          ? stat.responseMinutes.reduce((sum, value) => sum + value, 0) /
            stat.responseMinutes.length
          : null;

      return {
        userId: repId,

        name: profile?.full_name ?? "مندوب مبيعات",

        avatarUrl: profile?.avatar_url ?? null,

        revenue: stat.revenue,

        revenueByCurrency: stat.revenueByCurrency,

        confirmedOrders: stat.orders,

        productsSold: stat.products,

        customers: stat.customers.size,

        discounts: stat.discounts,

        avgResponseMinutes,

        responseSamples: stat.responseMinutes.length,
      };
    });

    return {
      rows,
      currencies,
      mixedCurrencies: !data.currency && currencies.length > 1,

      summary: {
        reps: rows.length,

        orders: rows.reduce((sum, row) => sum + row.confirmedOrders, 0),

        products: rows.reduce((sum, row) => sum + row.productsSold, 0),

        customers: new Set(orders.map((order: any) => order.contact_id).filter(Boolean)).size,

        revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      },
    };
  });
