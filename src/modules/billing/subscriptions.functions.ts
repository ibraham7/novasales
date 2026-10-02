import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const listSubscriptions = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("billing_subscriptions")
    .select("*, plan:billing_plans(*), organization:organizations(id, name, slug)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getMySubscription = createServerFn({ method: "GET" }).handler(async () => {
  const { getSubscription } = await import("./billing.server");
  return getSubscription();
});

export const setSubscriptionPlan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      organization_id: z.string().uuid(),
      plan_id: z.string().uuid(),
      billing_period: z.enum(["monthly", "quarterly", "yearly"]).default("monthly"),
      start_trial: z.boolean().default(false),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: plan } = await db.from("billing_plans").select("trial_days").eq("id", data.plan_id).maybeSingle();
    const now = new Date();
    const periodMonths = data.billing_period === "monthly" ? 1 : data.billing_period === "quarterly" ? 3 : 12;
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + periodMonths);

    const trialEnds = data.start_trial && plan?.trial_days
      ? new Date(now.getTime() + plan.trial_days * 86400000).toISOString()
      : null;

    const patch = {
      plan_id: data.plan_id,
      billing_period: data.billing_period,
      status: trialEnds ? "trialing" : "active",
      trial_ends_at: trialEnds,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      canceled_at: null,
      cancel_at_period_end: false,
    };

    const { data: existing } = await db
      .from("billing_subscriptions")
      .select("id")
      .eq("organization_id", data.organization_id)
      .maybeSingle();

    if (existing) {
      const { error } = await db.from("billing_subscriptions").update(patch).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("billing_subscriptions").insert({ organization_id: data.organization_id, provider: "manual", ...patch });
      if (error) throw new Error(error.message);
    }

    await db.from("platform_audit_log").insert({
      action: "subscription.plan_changed",
      target_type: "organization",
      target_id: data.organization_id,
      organization_id: data.organization_id,
      metadata: { plan_id: data.plan_id, billing_period: data.billing_period },
    });

    return { ok: true };
  });

export const cancelSubscription = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      organization_id: z.string().uuid(),
      immediate: z.boolean().default(false),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const patch = data.immediate
      ? { status: "canceled", canceled_at: new Date().toISOString(), cancel_at_period_end: false }
      : { cancel_at_period_end: true, canceled_at: new Date().toISOString() };
    const { error } = await db.from("billing_subscriptions").update(patch).eq("organization_id", data.organization_id);
    if (error) throw new Error(error.message);
    await db.from("platform_audit_log").insert({
      action: "subscription.canceled",
      target_type: "organization",
      target_id: data.organization_id,
      organization_id: data.organization_id,
      metadata: { immediate: data.immediate },
    });
    return { ok: true };
  });

export const extendTrial = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ organization_id: z.string().uuid(), days: z.number().int().min(1).max(365) }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: sub } = await db
      .from("billing_subscriptions")
      .select("trial_ends_at")
      .eq("organization_id", data.organization_id)
      .maybeSingle();
    const base = sub?.trial_ends_at ? new Date(sub.trial_ends_at) : new Date();
    const newDate = new Date(base.getTime() + data.days * 86400000);
    const { error } = await db
      .from("billing_subscriptions")
      .update({ status: "trialing", trial_ends_at: newDate.toISOString() })
      .eq("organization_id", data.organization_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const suspendSubscription = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ organization_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("billing_subscriptions")
      .update({ status: "suspended" })
      .eq("organization_id", data.organization_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reactivateSubscription = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ organization_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("billing_subscriptions")
      .update({ status: "active", canceled_at: null, cancel_at_period_end: false })
      .eq("organization_id", data.organization_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
