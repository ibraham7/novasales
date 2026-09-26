import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PerformanceInput = z.object({
  period: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
  currency: z.string().max(12).nullable().optional(),
});

function getCutoff(period: "7d" | "30d" | "90d" | "all") {
  if (period === "all") return null;

  const days =
    period === "7d"
      ? 7
      : period === "30d"
        ? 30
        : 90;

  return new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export const getSalesPerformance = createServerFn({
  method: "GET",
})
  .validator((d: unknown) =>
    PerformanceInput.parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { requirePermission } = await import(
      "@/platform/rbac/rbac.server"
    );

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { organizationId } = await requirePermission(
      "sales.performance.view",
    );

    const db = supabaseAdmin as any;

    const cutoff = getCutoff(data.period);

    const { data: salesRole, error: roleError } = await db
      .from("rbac_roles")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("key", "sales")
      .maybeSingle();

    if (roleError) {
      throw new Error(roleError.message);
    }

    if (!salesRole?.id) {
      return {
        rows: [],
        currencies: [],
        summary: {
          reps: 0,
          orders: 0,
          products: 0,
          customers: 0,
          revenue: 0,
        },
      };
    }

    const { data: roleRows, error: rolesError } = await db
      .from("rbac_user_roles")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("role_id", salesRole.id);

    if (rolesError) {
      throw new Error(rolesError.message);
    }

    const repIds = [
      ...new Set(
        (roleRows ?? [])
          .map((row: any) => row.user_id)
          .filter(Boolean),
      ),
    ] as string[];

    if (!repIds.length) {
      return {
        rows: [],
        currencies: [],
        summary: {
          reps: 0,
          orders: 0,
          products: 0,
          customers: 0,
          revenue: 0,
        },
      };
    }

    let ordersQuery = db
      .from("sales_orders")
      .select(`
        id,
        sales_rep_user_id,
        contact_id,
        total,
        discount_total,
        currency,
        confirmed_at,
        sales_order_items(
          quantity
        )
      `)
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .in("sales_rep_user_id", repIds)
      .order("confirmed_at", {
        ascending: false,
      })
      .limit(10000);

    if (cutoff) {
      ordersQuery = ordersQuery.gte(
        "confirmed_at",
        cutoff,
      );
    }

    let opportunitiesQuery = db
      .from("opp_opportunities")
      .select(`
        id,
        owner_agent_id,
        opened_at,
        first_response_at
      `)
      .eq("organization_id", organizationId)
      .in("owner_agent_id", repIds)
      .not("first_response_at", "is", null)
      .not("opened_at", "is", null)
      .limit(10000);

    if (cutoff) {
      opportunitiesQuery = opportunitiesQuery.gte(
        "opened_at",
        cutoff,
      );
    }

    const [
      profilesResult,
      ordersResult,
      opportunitiesResult,
    ] = await Promise.all([
      db
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", repIds),

      ordersQuery,

      opportunitiesQuery,
    ]);

    if (profilesResult.error) {
      throw new Error(profilesResult.error.message);
    }

    if (ordersResult.error) {
      throw new Error(ordersResult.error.message);
    }

    if (opportunitiesResult.error) {
      throw new Error(opportunitiesResult.error.message);
    }

    const allOrders = ordersResult.data ?? [];

    const currencies = [
      ...new Set(
        allOrders
          .map((order: any) => order.currency)
          .filter(Boolean),
      ),
    ].sort();

    const orders =
      data.currency && data.currency !== "all"
        ? allOrders.filter(
            (order: any) =>
              order.currency === data.currency,
          )
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
        responseMinutes: [],
      });
    }

    for (const order of orders) {
      const repId = order.sales_rep_user_id;

      if (!repId) continue;

      const row = performance.get(repId);

      if (!row) continue;

      const total = Number(order.total ?? 0);
      const discount = Number(
        order.discount_total ?? 0,
      );

      row.orders += 1;
      row.revenue += total;
      row.discounts += discount;

      if (order.contact_id) {
        row.customers.add(order.contact_id);
      }

      const currency = String(
        order.currency ?? "USD",
      );

      row.revenueByCurrency[currency] =
        (row.revenueByCurrency[currency] ?? 0) +
        total;

      const items = Array.isArray(
        order.sales_order_items,
      )
        ? order.sales_order_items
        : [];

      row.products += items.reduce(
        (sum: number, item: any) =>
          sum + Number(item.quantity ?? 0),
        0,
      );
    }

    for (const opp of opportunitiesResult.data ?? []) {
      const repId = opp.owner_agent_id;

      if (!repId) continue;

      const row = performance.get(repId);

      if (!row) continue;

      const opened = new Date(
        opp.opened_at,
      ).getTime();

      const firstResponse = new Date(
        opp.first_response_at,
      ).getTime();

      const diffMinutes =
        (firstResponse - opened) / 60000;

      if (
        Number.isFinite(diffMinutes) &&
        diffMinutes >= 0
      ) {
        row.responseMinutes.push(diffMinutes);
      }
    }

    const profileMap = new Map(
      (profilesResult.data ?? []).map(
        (profile: any) => [
          profile.id,
          profile,
        ],
      ),
    );

    const rows = repIds.map((repId) => {
      const stat = performance.get(repId)!;
      const profile = profileMap.get(repId);

      const avgResponseMinutes =
        stat.responseMinutes.length > 0
          ? stat.responseMinutes.reduce(
              (sum, value) => sum + value,
              0,
            ) / stat.responseMinutes.length
          : null;

      return {
        userId: repId,

        name:
          profile?.full_name ??
          "مندوب مبيعات",

        avatarUrl:
          profile?.avatar_url ?? null,

        revenue: stat.revenue,

        revenueByCurrency:
          stat.revenueByCurrency,

        confirmedOrders:
          stat.orders,

        productsSold:
          stat.products,

        customers:
          stat.customers.size,

        discounts:
          stat.discounts,

        avgResponseMinutes,

        responseSamples:
          stat.responseMinutes.length,
      };
    });

    return {
      rows,
      currencies,

      summary: {
        reps: rows.length,

        orders: rows.reduce(
          (sum, row) =>
            sum + row.confirmedOrders,
          0,
        ),

        products: rows.reduce(
          (sum, row) =>
            sum + row.productsSold,
          0,
        ),

        customers: new Set(
          orders
            .map(
              (order: any) =>
                order.contact_id,
            )
            .filter(Boolean),
        ).size,

        revenue: rows.reduce(
          (sum, row) =>
            sum + row.revenue,
          0,
        ),
      },
    };
  });