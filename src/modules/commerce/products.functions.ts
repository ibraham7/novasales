import { minimumPrice, validateAttributes } from "./product-attributes";
import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

import { ProductInput } from "./product-input";

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
    const { data: defs, error: defsError } = await db
      .from("sales_product_attributes")
      .select("*")
      .eq("organization_id", organizationId);
    if (defsError) throw new Error(defsError.message);
    return (rows ?? []).map((p: any) => ({
      ...p,
      minimum_price: minimumPrice(p.attributes, defs ?? []),
    }));
  });

export const upsertProduct = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ProductInput.parse(d))
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId, userId } = await requirePermission("products.manage");
    const db = supabaseAdmin as any;
    const { data: defs, error: defsError } = await db
      .from("sales_product_attributes")
      .select("*")
      .eq("organization_id", organizationId);
    if (defsError) throw new Error(defsError.message);
    let values = data.attributes;
    if (values === undefined && data.id) {
      const { data: existing, error } = await db
        .from("sales_products")
        .select("attributes")
        .eq("id", data.id)
        .eq("organization_id", organizationId)
        .single();
      if (error) throw new Error(error.message);
      values = existing.attributes;
    }
    values ??= {};
    validateAttributes(values, defs ?? [], "product");
    if (data.price < minimumPrice(values, defs ?? []))
      throw new Error("سعر المبيع أقل من الحد الأدنى المحدد للتكلفة");
    const payload = {
      attributes: values,
      organization_id: organizationId,
      name: data.name,
      sku: data.sku || null,
      description: data.description || null,
      price: data.price,
      currency: data.currency.toUpperCase(),
      images: data.images,
      videos: data.videos,
      is_active: data.isActive,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      if (data.initialVariants?.length) throw new Error("المخزون الأولي يخص المنتج الجديد؛ استخدم إدارة الدفعات لتعديل المخزون");
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

    const initialVariants = (data.initialVariants ?? []).map(v => ({...v,attributes:Object.fromEntries(Object.entries(v.attributes).map(([id,value])=>[id,Array.isArray(value)?[...value].sort():value]))}));
    if (initialVariants.some(v => v.batches.length)) await requirePermission("inventory.manage");
    const codes = new Set<string>();
    for (const v of initialVariants) {
      validateAttributes(v.attributes, defs ?? [], "variant");
      for (const b of v.batches) {
        if (codes.has(b.batchCode)) throw new Error("رقم الدفعة مكرر؛ استخدم رقمًا مستقلًا لكل دفعة");
        codes.add(b.batchCode);
      }
    }
    const { data: row, error } = await db.rpc("create_sales_product_with_stock", {
      _organization_id: organizationId, _created_by: userId, _product: payload, _variants: initialVariants,
    });
    if (error) throw new Error(error.code === "23505" ? "توجد تركيبة أو دفعة مكررة؛ راجع البيانات" : error.message);
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
