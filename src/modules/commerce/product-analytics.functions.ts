import { currencyTotals } from "./currencies";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  period: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
});

function cutoffFor(period: "7d" | "30d" | "90d" | "all") {
  if (period === "all") {
    return null;
  }

  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;

  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export const getProductAnalytics = createServerFn({
  method: "GET",
})
  .validator((input: unknown) => Input.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { organizationId } = await requirePermission("products.page.view");

    const db = supabaseAdmin as any;

    const cutoff = cutoffFor(data.period);

    const { data: products, error: productsError } = await db
      .from("sales_products")
      .select(
        `
          id,
          name,
          sku,
          price,
          currency,
          images,
          is_active
        `,
      )
      .eq("organization_id", organizationId);

    if (productsError) {
      throw new Error(productsError.message);
    }

    let ordersQuery = db
      .from("sales_orders")
      .select(
        `
            id,
            currency,
            confirmed_at
          `,
      )
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .limit(10000);

    if (cutoff) {
      ordersQuery = ordersQuery.gte("confirmed_at", cutoff);
    }

    const { data: orders, error: ordersError } = await ordersQuery;

    if (ordersError) {
      throw new Error(ordersError.message);
    }

    const orderIds = (orders ?? []).map((order: any) => order.id);

    let items: any[] = [];

    if (orderIds.length) {
      const { data: itemRows, error: itemsError } = await db
        .from("sales_order_items")
        .select(
          `
              id,
              order_id,
              product_id,
              quantity,
              list_unit_price,
              sold_unit_price,
              line_total
            `,
        )
        .eq("organization_id", organizationId)
        .in("order_id", orderIds)
        .limit(20000);

      if (itemsError) {
        throw new Error(itemsError.message);
      }

      items = itemRows ?? [];
    }

    let interactionQuery = db
      .from("sales_product_interactions")
      .select(
        `
            product_id,
            interaction_type,
            created_at
          `,
      )
      .eq("organization_id", organizationId)
      .limit(20000);

    if (cutoff) {
      interactionQuery = interactionQuery.gte("created_at", cutoff);
    }

    const { data: interactions, error: interactionError } = await interactionQuery;

    if (interactionError) {
      throw new Error(interactionError.message);
    }

    const analytics = new Map<
      string,
      {
        unitsSold: number;
        orderIds: Set<string>;
        revenue: number;
        revenueByCurrency: Record<string, number>;
        discountByCurrency: Record<string, number>;
        grossValue: number;
        discount: number;
        sentCount: number;
        askedCount: number;
        viewedCount: number;
      }
    >();

    for (const product of products ?? []) {
      analytics.set(product.id, {
        unitsSold: 0,

        orderIds: new Set(),

        revenue: 0,
        revenueByCurrency: {},
        discountByCurrency: {},

        grossValue: 0,

        discount: 0,

        sentCount: 0,

        askedCount: 0,

        viewedCount: 0,
      });
    }

    const orderCurrencies = new Map<string, string>(
      (orders ?? []).map((order: any) => [order.id, String(order.currency)]),
    );
    for (const item of items) {
      const stat = analytics.get(item.product_id);

      if (!stat) {
        continue;
      }

      const quantity = Number(item.quantity ?? 0);

      const listPrice = Number(item.list_unit_price ?? 0);

      const soldPrice = Number(item.sold_unit_price ?? 0);

      const revenue = Number(item.line_total ?? soldPrice * quantity);

      const currency = orderCurrencies.get(item.order_id)!;
      stat.revenueByCurrency[currency] = (stat.revenueByCurrency[currency] ?? 0) + revenue;
      stat.discountByCurrency[currency] =
        (stat.discountByCurrency[currency] ?? 0) + Math.max(0, (listPrice - soldPrice) * quantity);
      stat.unitsSold += quantity;

      stat.orderIds.add(item.order_id);

      stat.revenue += revenue;

      stat.grossValue += listPrice * quantity;

      stat.discount += Math.max(0, (listPrice - soldPrice) * quantity);
    }

    for (const interaction of interactions ?? []) {
      const stat = analytics.get(interaction.product_id);

      if (!stat) {
        continue;
      }

      if (interaction.interaction_type === "sent") {
        stat.sentCount += 1;
      }

      if (interaction.interaction_type === "asked") {
        stat.askedCount += 1;
      }

      if (interaction.interaction_type === "viewed") {
        stat.viewedCount += 1;
      }
    }

    const rows = ((products ?? []) as any[]).map((product: any) => {
      const stat = analytics.get(product.id)!;

      const averageDiscountPercent =
        stat.grossValue > 0 ? (stat.discount / stat.grossValue) * 100 : 0;

      return {
        productId: product.id,

        name: product.name,

        sku: product.sku,

        image: Array.isArray(product.images) ? (product.images[0] ?? null) : null,

        price: Number(product.price),

        currency: product.currency,

        isActive: product.is_active,

        unitsSold: stat.unitsSold,

        confirmedOrders: stat.orderIds.size,

        revenue: stat.revenue,
        revenueByCurrency: stat.revenueByCurrency,
        discountByCurrency: stat.discountByCurrency,

        grossValue: stat.grossValue,

        discount: stat.discount,

        averageDiscountPercent,

        sentCount: stat.sentCount,

        askedCount: stat.askedCount,

        viewedCount: stat.viewedCount,
      };
    });

    return {
      rows,

      summary: {
        revenueByCurrency: currencyTotals(rows, "revenueByCurrency"),
        discountByCurrency: currencyTotals(rows, "discountByCurrency"),
        totalUnitsSold: rows.reduce((sum, row) => sum + row.unitsSold, 0),

        totalOrders: orderIds.length,

        totalRevenue: rows.reduce((sum, row) => sum + row.revenue, 0),

        totalDiscount: rows.reduce((sum, row) => sum + row.discount, 0),

        totalSent: rows.reduce((sum, row) => sum + row.sentCount, 0),
      },
    };
  });
