import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { reportRows, reportWindow, filterReportData } from "./reports-model";
const ReportsInput = z.object({
  period: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
  departmentId: z.string().uuid().optional(),
  repId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});
export const getSalesReports = createServerFn({ method: "GET" })
  .validator((input: unknown) => ReportsInput.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { applySalesOrderScope } = await import("@/platform/rbac/data-scope.server");
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission([
      "sales.reports.view",
      "reports.view",
      "reports.view_department",
    ]);
    const db = supabaseAdmin as any;
    const window = reportWindow(data.period);
    const makeOrders = () =>
      applySalesOrderScope(
        db
          .from("sales_orders")
          .select(
            "id,contact_id,sales_rep_user_id,department_id,status,currency,subtotal,discount_total,total,confirmed_at,created_at",
          )
          .eq("organization_id", organizationId)
          .eq("status", "confirmed")
          .order("confirmed_at")
          .order("id"),
        access,
      );
    const allOrders = makeOrders() ? await reportRows(makeOrders) : [];
    const allItems: any[] = [];
    for (let i = 0; i < allOrders.length; i += 100) {
      const ids = allOrders.slice(i, i + 100).map((o: any) => o.id);
      allItems.push(
        ...(await reportRows(() =>
          db
            .from("sales_order_items")
            .select(
              "id,order_id,product_id,product_name,sku,quantity,list_unit_price,sold_unit_price,line_total",
            )
            .eq("organization_id", organizationId)
            .in("order_id", ids)
            .order("id"),
        )),
      );
    }
    const repIds = [...new Set(allOrders.map((o: any) => o.sales_rep_user_id).filter(Boolean))];
    const departmentIds = [...new Set(allOrders.map((o: any) => o.department_id).filter(Boolean))];
    async function names(table: string, ids: any[], select: string, tenant: boolean) {
      const rows: any[] = [];
      for (let i = 0; i < ids.length; i += 100)
        rows.push(
          ...(await reportRows(() => {
            let q = db
              .from(table)
              .select(select)
              .in("id", ids.slice(i, i + 100))
              .order("id");
            return tenant ? q.eq("organization_id", organizationId) : q;
          })),
        );
      return rows;
    }
    const [reps, depts] = await Promise.all([
      names("profiles", repIds, "id,full_name,avatar_url", false),
      names("org_departments", departmentIds, "id,name", true),
    ]);
    const repNames = new Map<string, any>(reps.map((r: any) => [r.id, r]));
    const departmentNames = new Map<string, any>(depts.map((r: any) => [r.id, r]));
    const options = {
      reps: repIds.map((id) => ({ id, name: repNames.get(id)?.full_name || "مندوب" })),
      departments: departmentIds.map((id) => ({
        id,
        name: departmentNames.get(id)?.name || "قسم",
      })),
      products: Array.from(
        new Map(
          allItems
            .filter((i) => i.product_id)
            .map((i) => [i.product_id, { id: i.product_id, name: i.product_name }]),
        ).values(),
      ),
      currencies: [...new Set(allOrders.map((o) => o.currency))].sort(),
    };
    const { orders, items } = filterReportData(allOrders, allItems, data, window);
    const orderMap = new Map<string, any>(orders.map((o: any) => [o.id, o]));
    const customerIds = new Set(orders.map((order: any) => order.contact_id).filter(Boolean));

    const currencies: Record<string, number> = {};

    const discounts: Record<string, number> = {};

    let unitsSold = 0;

    for (const order of orders) {
      const currency = String(order.currency ?? "USD");

      currencies[currency] = (currencies[currency] ?? 0) + Number(order.total ?? 0);

      discounts[currency] = (discounts[currency] ?? 0) + Number(order.discount_total ?? 0);
    }

    for (const item of items) {
      unitsSold += Number(item.quantity ?? 0);
    }

    const dailyMap = new Map<
      string,
      {
        date: string;
        orders: number;
        units: number;
        currencies: Record<string, number>;
        discounts: Record<string, number>;
      }
    >();

    for (const order of orders) {
      const date = String(order.confirmed_at ?? order.created_at).slice(0, 10);

      if (!dailyMap.has(date)) {
        dailyMap.set(date, {
          date,
          orders: 0,
          units: 0,
          currencies: {},
          discounts: {},
        });
      }

      const row = dailyMap.get(date)!;

      const currency = String(order.currency ?? "USD");

      row.orders += 1;

      row.currencies[currency] = (row.currencies[currency] ?? 0) + Number(order.total ?? 0);

      row.discounts[currency] = (row.discounts[currency] ?? 0) + Number(order.discount_total ?? 0);
    }

    for (const item of items) {
      const order = orderMap.get(item.order_id);

      if (!order) {
        continue;
      }

      const date = String(order.confirmed_at ?? order.created_at).slice(0, 10);

      const row = dailyMap.get(date);

      if (row) {
        row.units += Number(item.quantity ?? 0);
      }
    }

    const repsMap = new Map<
      string,
      {
        id: string;
        name: string;
        avatarUrl: string | null;
        orders: number;
        customers: Set<string>;
        units: number;
        currencies: Record<string, number>;
        discounts: Record<string, number>;
      }
    >();

    for (const order of orders) {
      if (!order.sales_rep_user_id) {
        continue;
      }

      const rep = repNames.get(order.sales_rep_user_id);

      if (!repsMap.has(order.sales_rep_user_id)) {
        repsMap.set(order.sales_rep_user_id, {
          id: order.sales_rep_user_id,

          name: rep?.full_name || "مندوب",

          avatarUrl: rep?.avatar_url ?? null,

          orders: 0,

          customers: new Set(),

          units: 0,

          currencies: {},

          discounts: {},
        });
      }

      const row = repsMap.get(order.sales_rep_user_id)!;

      row.orders += 1;

      if (order.contact_id) {
        row.customers.add(order.contact_id);
      }

      const currency = String(order.currency ?? "USD");

      row.currencies[currency] = (row.currencies[currency] ?? 0) + Number(order.total ?? 0);

      row.discounts[currency] = (row.discounts[currency] ?? 0) + Number(order.discount_total ?? 0);
    }

    for (const item of items) {
      const order = orderMap.get(item.order_id);

      if (!order?.sales_rep_user_id) {
        continue;
      }

      const row = repsMap.get(order.sales_rep_user_id);

      if (row) {
        row.units += Number(item.quantity ?? 0);
      }
    }

    const productMap = new Map<
      string,
      {
        productId: string;
        name: string;
        sku: string | null;
        units: number;
        orders: Set<string>;
        currencies: Record<string, number>;
        discounts: Record<string, number>;
      }
    >();

    for (const item of items) {
      const order = orderMap.get(item.order_id);

      if (!order) {
        continue;
      }

      const productKey = item.product_id ?? item.product_name;

      if (!productMap.has(productKey)) {
        productMap.set(productKey, {
          productId: item.product_id,

          name: item.product_name,

          sku: item.sku,

          units: 0,

          orders: new Set(),

          currencies: {},

          discounts: {},
        });
      }

      const row = productMap.get(productKey)!;

      const quantity = Number(item.quantity ?? 0);

      const listPrice = Number(item.list_unit_price ?? 0);

      const soldPrice = Number(item.sold_unit_price ?? 0);

      const lineTotal = Number(item.line_total ?? soldPrice * quantity);

      const currency = String(order.currency ?? "USD");

      row.units += quantity;

      row.orders.add(item.order_id);

      row.currencies[currency] = (row.currencies[currency] ?? 0) + lineTotal;

      row.discounts[currency] =
        (row.discounts[currency] ?? 0) + Math.max(0, (listPrice - soldPrice) * quantity);
    }

    const departmentStats = new Map<
      string,
      {
        id: string;
        name: string;
        orders: number;
        customers: Set<string>;
        units: number;
        currencies: Record<string, number>;
      }
    >();

    for (const order of orders) {
      if (!order.department_id) {
        continue;
      }

      const department = departmentNames.get(order.department_id);

      if (!departmentStats.has(order.department_id)) {
        departmentStats.set(order.department_id, {
          id: order.department_id,

          name: department?.name || "قسم",

          orders: 0,

          customers: new Set(),

          units: 0,

          currencies: {},
        });
      }

      const row = departmentStats.get(order.department_id)!;

      row.orders += 1;

      if (order.contact_id) {
        row.customers.add(order.contact_id);
      }

      const currency = String(order.currency ?? "USD");

      row.currencies[currency] = (row.currencies[currency] ?? 0) + Number(order.total ?? 0);
    }

    for (const item of items) {
      const order = orderMap.get(item.order_id);

      if (!order?.department_id) {
        continue;
      }

      const row = departmentStats.get(order.department_id);

      if (row) {
        row.units += Number(item.quantity ?? 0);
      }
    }

    return {
      options,
      window,
      summary: {
        orders: orders.length,

        customers: customerIds.size,

        unitsSold,

        currencies,

        discounts,
      },

      daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),

      reps: Array.from(repsMap.values())
        .map((row) => ({
          id: row.id,

          name: row.name,

          avatarUrl: row.avatarUrl,

          orders: row.orders,

          customers: row.customers.size,

          units: row.units,

          currencies: row.currencies,

          discounts: row.discounts,
        }))
        .sort((a, b) => b.units - a.units),

      products: Array.from(productMap.values())
        .map((row) => ({
          productId: row.productId,

          name: row.name,

          sku: row.sku,

          units: row.units,

          orders: row.orders.size,

          currencies: row.currencies,

          discounts: row.discounts,
        }))
        .sort((a, b) => b.units - a.units),

      departments: Array.from(departmentStats.values())
        .map((row) => ({
          id: row.id,

          name: row.name,

          orders: row.orders,

          customers: row.customers.size,

          units: row.units,

          currencies: row.currencies,
        }))
        .sort((a, b) => b.units - a.units),
    };
  });
