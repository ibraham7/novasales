import { validateAttributes } from "./product-attributes";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DateValue = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "تاريخ غير صالح",
  );
const Value = z.union([
  z.string().trim().max(500),
  z.number().finite(),
  z.array(z.string().trim().max(100)).max(100),
]);

async function context(permission: string) {
  const { requirePermission } = await import("@/platform/rbac/rbac.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { ...(await requirePermission(permission)), db: supabaseAdmin as any };
}

export const listProductAttributes = createServerFn({ method: "GET" }).handler(async () => {
  const { db, organizationId } = await context("products.view");
  const { data, error } = await db
    .from("sales_product_attributes")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const saveProductAttribute = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(80),
        kind: z.enum(["text", "select", "multiselect", "number", "date", "money"]),
        scope: z.enum(["product", "variant"]).default("variant"),
        isPriceFloor: z.boolean().default(false),
        options: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { db, organizationId } = await context("products.manage");
    const options = [...new Set(data.options)];
    if (data.kind === "money" && data.scope !== "product")
      throw new Error("حقول الأسعار تخص المنتج");
    if (data.isPriceFloor && (data.kind !== "money" || data.scope !== "product"))
      throw new Error("الحد الأدنى يتطلب حقل سعر للمنتج");
    if (["select", "multiselect"].includes(data.kind) && !options.length)
      throw new Error("أضف خيارًا واحدًا على الأقل");
    if (data.id) {
      const { data: old, error } = await db
        .from("sales_product_attributes")
        .select("*")
        .eq("id", data.id)
        .eq("organization_id", organizationId)
        .single();
      if (error) throw new Error(error.message);
      // Existing values must remain valid. Names can be edited and options extended.
      if (
        old.kind !== data.kind ||
        old.scope !== data.scope ||
        (old.options as string[]).some((v) => !options.includes(v))
      )
        throw new Error(
          "يمكن تعديل الاسم وإضافة خيارات؛ لتغيير النوع أو حذف خيارات أنشئ خاصية جديدة",
        );
    }
    const row = {
      name: data.name,
      kind: data.kind,
      options,
      scope: data.scope,
      is_price_floor: data.isPriceFloor,
    };
    const q = data.id
      ? db
          .from("sales_product_attributes")
          .update(row)
          .eq("id", data.id)
          .eq("organization_id", organizationId)
      : db.from("sales_product_attributes").insert({ ...row, organization_id: organizationId });
    const { data: result, error } = await q.select("*").single();
    if (error) throw new Error(error.message);
    return result;
  });

export const createProductVariant = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        label: z.string().trim().min(1).max(200),
        attributes: z.record(z.string().uuid(), Value),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { db, organizationId } = await context("products.manage");
    const { data: product, error: pe } = await db
      .from("sales_products")
      .select("id")
      .eq("id", data.productId)
      .eq("organization_id", organizationId)
      .single();
    if (pe || !product) throw new Error("المنتج غير موجود");
    const { data: definitions, error: de } = await db
      .from("sales_product_attributes")
      .select("*")
      .eq("organization_id", organizationId);
    if (de) throw new Error(de.message);
    if (!Object.keys(data.attributes).length) throw new Error("حدد خاصية واحدة على الأقل للمتغير");
    validateAttributes(data.attributes, definitions, "variant");
    const attributes = Object.fromEntries(
      Object.entries(data.attributes).map(([id, v]) => [id, Array.isArray(v) ? [...v].sort() : v]),
    );
    const { data: row, error } = await db
      .from("sales_product_variants")
      .insert({
        organization_id: organizationId,
        product_id: data.productId,
        label: data.label,
        attributes,
      })
      .select("*")
      .single();
    if (error)
      throw new Error(error.code === "23505" ? "هذه التركيبة موجودة بالفعل" : error.message);
    return row;
  });

export const receiveStockBatch = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        variantId: z.string().uuid(),
        batchCode: z.string().trim().min(1).max(100),
        expiresOn: DateValue.nullable(),
        quantity: z.number().finite().positive().multipleOf(0.001),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { db, organizationId, userId } = await context("inventory.manage");
    const { data: id, error } = await db.rpc("create_sales_stock_batch", {
      _organization_id: organizationId,
      _product_id: data.productId,
      _variant_id: data.variantId,
      _batch_code: data.batchCode,
      _expires_on: data.expiresOn,
      _quantity: data.quantity,
      _created_by: userId,
    });
    if (error)
      throw new Error(
        error.code === "23505"
          ? "رقم الدفعة موجود؛ استخدم رقمًا جديدًا للاستلام الجديد"
          : error.message,
      );
    return { id };
  });

export const adjustStockBatch = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        batchId: z.string().uuid(),
        delta: z
          .number()
          .finite()
          .multipleOf(0.001)
          .refine((v) => v !== 0),
        reason: z.string().trim().min(1).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { db, organizationId, userId } = await context("inventory.manage");
    const { error } = await db.rpc("adjust_sales_stock_batch", {
      _organization_id: organizationId,
      _product_id: data.productId,
      _batch_id: data.batchId,
      _quantity_delta: data.delta,
      _reason: data.reason,
      _created_by: userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
