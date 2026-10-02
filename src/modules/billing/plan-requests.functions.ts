import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
export const requestPlan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ planId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const a = await requireAnyPermission(["org.manage", "org:update"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: plan, error: pe } = await db
      .from("billing_plans")
      .select("id")
      .eq("id", data.planId)
      .eq("status", "published")
      .eq("is_public", true)
      .single();
    if (pe || !plan) throw new Error("الخطة غير متاحة");
    const { error } = await db
      .from("billing_plan_requests")
      .insert({ organization_id: a.organizationId, plan_id: data.planId, requested_by: a.userId });
    if (error && error.code !== "23505") throw new Error("تعذر تسجيل طلب الخطة");
    return { ok: true };
  });
export const listPlanRequests = createServerFn({ method: "GET" }).handler(async () => {
  const { requireBillingAdmin } = await import("./admin.server");
  await requireBillingAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_plan_requests")
    .select("*,organization:organizations(name),plan:billing_plans(name)")
    .eq("status", "pending")
    .order("created_at");
  if (error) throw new Error("تعذر تحميل طلبات الخطط");
  return data ?? [];
});

export const resolvePlanRequest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requireBillingAdmin } = await import("./admin.server");
    await requireBillingAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("billing_plan_requests")
      .update({ status: "resolved" })
      .eq("id", data.id)
      .eq("status", "pending")
      .select("id")
      .single();
    if (error) throw new Error("تعذر إغلاق الطلب");
    return { ok: true };
  });
