import { minimumPrice, validateSalePrice } from "./product-attributes";
import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

const OrderItem = z.object({
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  quantity: z.number().finite().positive().multipleOf(0.001),
  soldUnitPrice: z.number().finite().nonnegative().optional(),
});

const CreateOrderInput = z.object({
  contactId: z.string().uuid(),
  leadId: z.string().uuid().nullable().optional(),
  opportunityId: z.string().uuid().nullable().optional(),
  chatId: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  items: z.array(OrderItem).min(1),
});

/* =========================================================
 * Create sales order
 * ======================================================= */

export const createSalesOrder = createServerFn({
  method: "POST",
})
  .validator((data: unknown) => CreateOrderInput.parse(data))
  .handler(async ({ data }) => {
    const { requirePermission, getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");

    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { organizationId, userId } = await requirePermission("sales.orders.create");

    const access = await getWorkspaceAccess();

    const db = supabaseAdmin as any;

    /* -----------------------------------------------------
     * Validate contact
     * --------------------------------------------------- */

    const { data: contact, error: contactError } = await db
      .from("crm_contacts")
      .select("id")
      .eq("id", data.contactId)
      .eq("organization_id", organizationId)
      .single();

    if (contactError || !contact) {
      throw new Error("العميل غير موجود");
    }

    /* -----------------------------------------------------
     * Validate chat
     * --------------------------------------------------- */

    if (data.chatId) {
      const { data: session, error: sessionError } = await db
        .from("msg_sessions")
        .select("id")
        .eq("id", data.chatId)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (sessionError || !session) {
        throw new Error("المحادثة غير موجودة");
      }
    }

    /* -----------------------------------------------------
     * Validate opportunity + authorization
     * --------------------------------------------------- */

    let opportunity: any = null;

    if (data.opportunityId) {
      const { data: row, error } = await db
        .from("opp_opportunities")
        .select(
          `
          id,
          contact_id,
          lead_id,
          owner_agent_id,
          department_id,
          currency
        `,
        )
        .eq("id", data.opportunityId)
        .eq("organization_id", organizationId)
        .single();

      if (error || !row) {
        throw new Error(error?.message ?? "الفرصة غير موجودة");
      }

      opportunity = row;

      if (row.contact_id !== data.contactId) {
        throw new Error("الفرصة لا تنتمي لهذا العميل");
      }

      if (!canAccessOpportunityRow(access, row)) {
        throw new Error("لا يمكنك إنشاء عملية بيع لهذه الفرصة");
      }

      /* ---------------------------------------------------
       * Make sure chat belongs to opportunity
       * ------------------------------------------------- */

      if (data.chatId) {
        const { data: link, error: linkError } = await db
          .from("crm_opportunity_sessions")
          .select("opportunity_id")
          .eq("organization_id", organizationId)
          .eq("session_ref", data.chatId)
          .maybeSingle();

        if (linkError || !link || link.opportunity_id !== data.opportunityId) {
          throw new Error("المحادثة لا ترتبط بهذه الفرصة");
        }
      }
    }

    /* -----------------------------------------------------
     * Load products
     * --------------------------------------------------- */

    const productIds = [...new Set(data.items.map((item) => item.productId))];

    const { data: products, error: productError } = await db
      .from("sales_products")
      .select(
        `
        id,
        name,
        sku,
        price,
        currency,
        is_active,
        attributes,
        sales_inventory(quantity)
      `,
      )
      .eq("organization_id", organizationId)
      .in("id", productIds);

    if (productError) {
      throw new Error(productError.message);
    }

    if ((products ?? []).length !== productIds.length) {
      throw new Error("منتج واحد أو أكثر غير موجود");
    }

    const productsById = new Map((products ?? []).map((product: any) => [product.id, product]));

    /* -----------------------------------------------------
     * All order items must use same currency
     * --------------------------------------------------- */

    const currencies = new Set((products ?? []).map((product: any) => String(product.currency)));

    if (currencies.size !== 1) {
      throw new Error("يجب أن تكون جميع المنتجات بنفس العملة");
    }

    const { data: batches, error: batchError } = await db
      .from("sales_stock_batches")
      .select("*, sales_product_variants(label, attributes)")
      .eq("organization_id", organizationId)
      .in("id", [...new Set(data.items.map((i) => i.batchId))]);
    if (batchError) throw new Error(batchError.message);
    const requested = new Map<string, number>();
    for (const item of data.items)
      requested.set(item.batchId, (requested.get(item.batchId) ?? 0) + item.quantity);

    /* -----------------------------------------------------
     * Build order lines and validate inventory
     * --------------------------------------------------- */

    const { data: definitions, error: definitionError } = await db
      .from("sales_product_attributes")
      .select("*")
      .eq("organization_id", organizationId);
    if (definitionError) throw new Error(definitionError.message);
    const lines = data.items.map((item) => {
      const product: any = productsById.get(item.productId);

      if (!product) {
        throw new Error("المنتج غير موجود");
      }

      if (!product.is_active) {
        throw new Error(`المنتج غير فعال: ${product.name}`);
      }

      const batch = (batches ?? []).find(
        (b: any) => b.id === item.batchId && b.product_id === item.productId,
      );
      if (!batch) throw new Error("دفعة المخزون لا تنتمي لهذا المنتج");
      if (batch.expires_on && batch.expires_on < new Date().toISOString().slice(0, 10))
        throw new Error("لا يمكن بيع دفعة منتهية الصلاحية");
      if (Number(batch.quantity) < (requested.get(item.batchId) ?? 0))
        throw new Error(`الكمية غير كافية للدفعة ${batch.batch_code}`);

      const listPrice = Number(product.price);

      const soldPrice = item.soldUnitPrice ?? listPrice;
      const minimumUnitPrice = minimumPrice(product.attributes, definitions ?? []);
      validateSalePrice(soldPrice, listPrice, minimumUnitPrice);

      return {
        ...item,
        product,
        batch,
        listPrice,
        soldPrice,
        minimumUnitPrice,
        lineTotal: soldPrice * item.quantity,
      };
    });

    /* -----------------------------------------------------
     * Calculate totals
     * --------------------------------------------------- */

    const subtotal = lines.reduce((sum, line) => sum + line.listPrice * line.quantity, 0);

    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);

    const discountTotal = Math.max(0, subtotal - total);

    const currency = String(lines[0].product.currency);

    /* -----------------------------------------------------
     * Insert order
     * --------------------------------------------------- */

    const { data: order, error: orderError } = await db
      .from("sales_orders")
      .insert({
        organization_id: organizationId,

        contact_id: data.contactId,

        lead_id: data.leadId ?? opportunity?.lead_id ?? null,

        opportunity_id: data.opportunityId ?? null,

        chat_session_id: data.chatId ?? null,

        sales_rep_user_id: opportunity?.owner_agent_id ?? userId,

        department_id: opportunity?.department_id ?? null,

        currency,

        subtotal,

        discount_total: discountTotal,

        total,

        notes: data.notes ?? null,

        created_by: userId,
      })
      .select("*")
      .single();

    if (orderError || !order) {
      throw new Error(orderError?.message ?? "تعذر إنشاء الطلب");
    }

    /* -----------------------------------------------------
     * Insert order items
     * --------------------------------------------------- */

    const { error: itemError } = await db.from("sales_order_items").insert(
      lines.map((line) => ({
        organization_id: organizationId,

        order_id: order.id,

        product_id: line.productId,
        batch_id: line.batchId,
        batch_code: line.batch.batch_code,
        expires_on: line.batch.expires_on,
        variant_label: line.batch.sales_product_variants?.label,
        attributes_snapshot: line.batch.sales_product_variants?.attributes,

        product_name: line.product.name,

        sku: line.product.sku,

        quantity: line.quantity,

        list_unit_price: line.listPrice,

        sold_unit_price: line.soldPrice,
        minimum_unit_price: line.minimumUnitPrice,

        line_total: line.lineTotal,
      })),
    );

    if (itemError) {
      /*
       * Cleanup draft order if
       * its items could not be created.
       */

      await db
        .from("sales_orders")
        .delete()
        .eq("id", order.id)
        .eq("organization_id", organizationId);

      throw new Error(itemError.message);
    }

    return order;
  });

/* =========================================================
 * Confirm sales order
 * ======================================================= */

export const confirmSalesOrder = createServerFn({
  method: "POST",
})
  .validator((data: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { requirePermission, getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");

    const { canAccessSalesOrderRow } = await import("@/platform/rbac/data-scope.server");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { organizationId, userId } = await requirePermission("sales.orders.create");

    const access = await getWorkspaceAccess();

    const db = supabaseAdmin as any;

    /* -------------------------------------------------
     * Load order before RPC
     * ------------------------------------------------ */

    const { data: order, error: readError } = await db
      .from("sales_orders")
      .select(
        `
            id,
            sales_rep_user_id,
            department_id,
            status
          `,
      )
      .eq("id", data.orderId)
      .eq("organization_id", organizationId)
      .single();

    if (readError || !order) {
      throw new Error(readError?.message ?? "عملية البيع غير موجودة");
    }

    /* -------------------------------------------------
     * Authorization
     * ------------------------------------------------ */

    if (!canAccessSalesOrderRow(access, order)) {
      throw new Error("لا يمكنك تأكيد عملية بيع خارج نطاق صلاحياتك");
    }

    if (order.status !== "draft") {
      throw new Error("هذه العملية لم تعد بانتظار التأكيد");
    }

    /* -------------------------------------------------
     * Atomic confirmation RPC
     *
     * RPC handles:
     * - stock decrement
     * - inventory movements
     * - order confirmation
     * - customer lifecycle
     * - opportunity won
     * ------------------------------------------------ */

    const { error } = await db.rpc("confirm_sales_order", {
      _organization_id: organizationId,

      _order_id: data.orderId,

      _confirmed_by: userId,
    });

    if (error) {
      throw new Error(error.message);
    }

    return {
      ok: true,
    };
  });

/* =========================================================
 * List sales orders
 * ======================================================= */

export const listSalesOrders = createServerFn({
  method: "GET",
}).handler(async () => {
  const { requirePermission, getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");

  const { applySalesOrderScope } = await import("@/platform/rbac/data-scope.server");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { organizationId } = await requirePermission("sales.orders.view");

  const access = await getWorkspaceAccess();

  const db = supabaseAdmin as any;

  let query = db
    .from("sales_orders")
    .select(
      `
          *,
          sales_order_items(*)
        `,
    )
    .eq("organization_id", organizationId)
    .order("created_at", {
      ascending: false,
    });

  /* -----------------------------------------------------
   * Apply RBAC data scope
   * --------------------------------------------------- */

  const scopedQuery = applySalesOrderScope(query, access);

  if (!scopedQuery) {
    return [];
  }

  query = scopedQuery;

  const { data: orders, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  if (!orders?.length) {
    return [];
  }

  /* -----------------------------------------------------
   * Load contact + rep names
   * --------------------------------------------------- */

  const contactIds = [...new Set(orders.map((order: any) => order.contact_id).filter(Boolean))];

  const repIds = [...new Set(orders.map((order: any) => order.sales_rep_user_id).filter(Boolean))];

  const [contactsResult, repsResult] = await Promise.all([
    contactIds.length
      ? db
          .from("crm_contacts")
          .select(
            `
                id,
                display_name,
                full_name
              `,
          )
          .in("id", contactIds)
      : Promise.resolve({
          data: [],
          error: null,
        }),

    repIds.length
      ? db
          .from("profiles")
          .select(
            `
                id,
                full_name
              `,
          )
          .in("id", repIds)
      : Promise.resolve({
          data: [],
          error: null,
        }),
  ]);

  if (contactsResult.error) {
    throw new Error(contactsResult.error.message);
  }

  if (repsResult.error) {
    throw new Error(repsResult.error.message);
  }

  const contactMap = new Map(
    (contactsResult.data ?? []).map((contact: any) => [
      contact.id,
      contact.display_name || contact.full_name || "عميل بدون اسم",
    ]),
  );

  const repMap = new Map(
    (repsResult.data ?? []).map((rep: any) => [rep.id, rep.full_name || "مندوب"]),
  );

  return orders.map((order: any) => ({
    ...order,

    contact_name: contactMap.get(order.contact_id) ?? "عميل بدون اسم",

    sales_rep_name: repMap.get(order.sales_rep_user_id) ?? "—",
  }));
});

/* =========================================================
 * Sales statistics
 * ======================================================= */

export const getSalesStats = createServerFn({
  method: "GET",
}).handler(async () => {
  const { requirePermission, getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");

  const { applySalesOrderScope } = await import("@/platform/rbac/data-scope.server");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { organizationId } = await requirePermission("sales.orders.view");

  const access = await getWorkspaceAccess();

  const db = supabaseAdmin as any;

  let query = db
    .from("sales_orders")
    .select(
      `
          id,
          status,
          subtotal,
          discount_total,
          total,
          currency,
          contact_id,
          sales_rep_user_id,
          department_id,
          created_at
        `,
    )
    .eq("organization_id", organizationId);

  /* -----------------------------------------------------
   * Apply RBAC scope
   * --------------------------------------------------- */

  const scopedQuery = applySalesOrderScope(query, access);

  if (!scopedQuery) {
    return {
      confirmedOrders: 0,
      draftOrders: 0,
      revenue: 0,
      discounts: 0,
      customers: 0,
    };
  }

  query = scopedQuery;

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const orders = data ?? [];

  const confirmed = orders.filter((order: any) => order.status === "confirmed");

  const draft = orders.filter((order: any) => order.status === "draft");

  return {
    confirmedOrders: confirmed.length,

    draftOrders: draft.length,

    /*
     * Keep existing return format for UI compatibility.
     * Full accounting reports already separate currencies.
     */
    revenue: confirmed.reduce((sum: number, order: any) => sum + Number(order.total ?? 0), 0),

    discounts: confirmed.reduce(
      (sum: number, order: any) => sum + Number(order.discount_total ?? 0),
      0,
    ),

    customers: new Set(confirmed.map((order: any) => order.contact_id).filter(Boolean)).size,
  };
});
