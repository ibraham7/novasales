import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const listInvoices = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ organization_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getWorkspace } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const orgId = data.organization_id ?? (await getWorkspace()).organizationId;
    const { data: rows, error } = await db
      .from("billing_invoices")
      .select("*, organization:organizations(name)")
      .eq("organization_id", orgId)
      .order("issued_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listAllInvoices = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("billing_invoices")
    .select("*, organization:organizations(name, slug)")
    .order("issued_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const createInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      organization_id: z.string().uuid(),
      amount: z.number().min(0),
      currency: z.string().default("USD"),
      due_at: z.string().optional().nullable(),
      notes: z.string().max(500).optional().nullable(),
      period_start: z.string().optional().nullable(),
      period_end: z.string().optional().nullable(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const number = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}-${Math.floor(Math.random() * 90000 + 10000)}`;
    const { data: sub } = await db.from("billing_subscriptions").select("id").eq("organization_id", data.organization_id).maybeSingle();
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
    if (error) throw new Error(error.message);
    return { ok: true, number };
  });

export const markInvoicePaid = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("billing_invoices").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const voidInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("billing_invoices").update({ status: "void" }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
