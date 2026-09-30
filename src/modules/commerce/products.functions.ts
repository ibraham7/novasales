import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ProductInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  price: z.number().nonnegative(),
  currency: z.string().trim().min(3).max(8).default("USD"),
  images: z.array(z.string().url()).max(12).default([]),
  isActive: z.boolean().default(true),
});

export const listProducts = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({ search: z.string().max(120).optional(), activeOnly: z.boolean().default(true) })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId } = await requirePermission("products.view");
    const db = supabaseAdmin as any;

    let query = db
      .from("sales_products")
      .select("*, sales_inventory(quantity), sales_product_variants(*), sales_stock_batches(*)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    if (data.activeOnly) query = query.eq("is_active", true);
    if (data.search?.trim())
      query = query.or(`name.ilike.%${data.search.trim()}%,sku.ilike.%${data.search.trim()}%`);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertProduct = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ProductInput.parse(d))
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId, userId } = await requirePermission("products.manage");
    const db = supabaseAdmin as any;
    const payload = {
      organization_id: organizationId,
      name: data.name,
      sku: data.sku || null,
      description: data.description || null,
      price: data.price,
      currency: data.currency.toUpperCase(),
      images: data.images,
      is_active: data.isActive,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { data: row, error } = await db
        .from("sales_products")
        .update(payload)
        .eq("id", data.id)
        .eq("organization_id", organizationId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }

    const { data: row, error } = await db
      .from("sales_products")
      .insert({ ...payload, created_by: userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const { error: stockError } = await db
      .from("sales_inventory")
      .insert({ product_id: row.id, organization_id: organizationId, quantity: 0 });
    if (stockError) throw new Error(stockError.message);
    const { error: variantError } = await db
      .from("sales_product_variants")
      .insert({
        organization_id: organizationId,
        product_id: row.id,
        label: "أساسي — خصائص غير محددة",
        is_default: true,
      });
    if (variantError) throw new Error(variantError.message);
    return row;
  });

export const adjustInventory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        quantityDelta: z.number().refine((n) => n !== 0),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId, userId } = await requirePermission("inventory.manage");
    const db = supabaseAdmin as any;
    const { data: quantity, error } = await db.rpc("adjust_sales_inventory", {
      _organization_id: organizationId,
      _product_id: data.productId,
      _quantity_delta: data.quantityDelta,
      _reason: data.reason ?? null,
      _created_by: userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, quantity };
  });
