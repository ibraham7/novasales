import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { CURRENCY_CODES } from "@/modules/commerce/currencies";

export const listInvoices = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ organization_id: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getWorkspace } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const workspace = await getWorkspace();
    if (data.organization_id && data.organization_id !== workspace.organizationId) {
      const { requireBillingAdmin } = await import("./admin.server");
      await requireBillingAdmin();
    } else {
      const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
      await requireAnyPermission(["org.manage", "org:update"]);
    }
    const orgId = data.organization_id ?? workspace.organizationId;
    const { data: rows, error } = await db
      .from("billing_invoices")
      .select("*, organization:organizations(name)")
      .eq("organization_id", orgId)
      .order("issued_at", { ascending: false });
    if (error) throw new Error("تعذر تحميل أو تحديث الفواتير؛ تحقق من الحالة وأعد المحاولة");
    return rows ?? [];
  });

export const listAllInvoices = createServerFn({ method: "GET" }).handler(async () => {
  const { requireBillingAdmin } = await import("./admin.server");
  await requireBillingAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("billing_invoices")
    .select("*, organization:organizations(name, slug)")
    .order("issued_at", { ascending: false })
    .limit(500);
  if (error) throw new Error("تعذر تحميل أو تحديث الفواتير؛ تحقق من الحالة وأعد المحاولة");
  return data ?? [];
});

export const createInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        organization_id: z.string().uuid(),
        amount: z.number().min(0),
        currency: z
          .string()
          .trim()
          .toUpperCase()
          .refine((v) => CURRENCY_CODES.includes(v), "اختر عملة صحيحة")
          .default("USD"),
        due_at: z.string().optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
        period_start: z.string().optional().nullable(),
        period_end: z.string().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireBillingAdmin } = await import("./admin.server");
    await requireBillingAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    for (const v of [data.due_at, data.period_start, data.period_end])
      if (v && !Number.isFinite(Date.parse(v))) throw new Error("تاريخ الفاتورة غير صحيح");
    if (
      data.period_start &&
      data.period_end &&
      Date.parse(data.period_end) < Date.parse(data.period_start)
    )
      throw new Error("نهاية الفترة يجب أن تلي بدايتها");
    const number = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}-${crypto.randomUUID()}`;
    const { data: sub } = await db
      .from("billing_subscriptions")
      .select("id")
      .eq("organization_id", data.organization_id)
      .maybeSingle();
    const { error } = await db.from("billing_invoices").insert({
      organization_id: data.organization_id,
      subscription_id: sub?.id ?? null,
      number,
      amount: data.amount,
      currency: data.currency,
      status: "open",
      due_at: data.due_at,
      notes: data.notes,
      period_start: data.period_start,
      period_end: data.period_end,
      provider: "manual",
    });
    if (error) throw new Error("تعذر تحميل أو تحديث الفواتير؛ تحقق من الحالة وأعد المحاولة");
    return { ok: true, number };
  });

export const markInvoicePaid = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requireBillingAdmin } = await import("./admin.server");
    await requireBillingAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("billing_invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "open")
      .select("id")
      .single();
    if (error) throw new Error("تعذر تحميل أو تحديث الفواتير؛ تحقق من الحالة وأعد المحاولة");
    return { ok: true };
  });

export const voidInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requireBillingAdmin } = await import("./admin.server");
    await requireBillingAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("billing_invoices")
      .update({ status: "void" })
      .eq("id", data.id)
      .eq("status", "open")
      .select("id")
      .single();
    if (error) throw new Error("تعذر تحميل أو تحديث الفواتير؛ تحقق من الحالة وأعد المحاولة");
    return { ok: true };
  });
