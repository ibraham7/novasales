import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listPlans = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: plans, error } = await db
    .from("billing_plans")
    .select("*")
    .order("sort_order");
  if (error) throw new Error(error.message);

  const ids = (plans ?? []).map((p: any) => p.id);
  const [feats, lims] = await Promise.all([
    ids.length ? db.from("billing_plan_features").select("*").in("plan_id", ids) : { data: [] },
    ids.length ? db.from("billing_plan_limits").select("*").in("plan_id", ids) : { data: [] },
  ]);

  return (plans ?? []).map((p: any) => ({
    ...p,
    features: (feats.data ?? []).filter((f: any) => f.plan_id === p.id),
    limits: (lims.data ?? []).filter((l: any) => l.plan_id === p.id),
  }));
});

export const listPublicPlans = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: plans } = await db
    .from("billing_plans")
    .select("*")
    .eq("status", "published")
    .eq("is_public", true)
    .order("sort_order");
  const ids = (plans ?? []).map((p: any) => p.id);
  const [feats, lims] = await Promise.all([
    ids.length ? db.from("billing_plan_features").select("*").in("plan_id", ids) : { data: [] },
    ids.length ? db.from("billing_plan_limits").select("*").in("plan_id", ids) : { data: [] },
  ]);
  return (plans ?? []).map((p: any) => ({
    ...p,
    features: (feats.data ?? []).filter((f: any) => f.plan_id === p.id),
    limits: (lims.data ?? []).filter((l: any) => l.plan_id === p.id),
  }));
});

const upsertPlanSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(2).max(60).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  price_monthly: z.number().min(0).default(0),
  price_quarterly: z.number().min(0).default(0),
  price_yearly: z.number().min(0).default(0),
  currency: z.string().default("USD"),
  trial_days: z.number().int().min(0).default(0),
  is_public: z.boolean().default(true),
  sort_order: z.number().int().default(0),
  features: z.array(z.object({ feature_key: z.string(), is_enabled: z.boolean() })).default([]),
  limits: z.array(z.object({ limit_key: z.string(), limit_value: z.number().int() })).default([]),
});

export const upsertPlan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => upsertPlanSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { features, limits, id, ...planData } = data;

    let planId = id;
    if (planId) {
      const { error } = await db.from("billing_plans").update(planData).eq("id", planId);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await db.from("billing_plans").insert(planData).select("id").single();
      if (error) throw new Error(error.message);
      planId = inserted.id;
    }

    await db.from("billing_plan_features").delete().eq("plan_id", planId);
    if (features.length) {
      await db.from("billing_plan_features").insert(features.map((f) => ({ ...f, plan_id: planId })));
    }
    await db.from("billing_plan_limits").delete().eq("plan_id", planId);
    if (limits.length) {
      await db.from("billing_plan_limits").insert(limits.map((l) => ({ ...l, plan_id: planId })));
    }

    return { id: planId };
  });

export const deletePlan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { count } = await db
      .from("billing_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", data.id);
    if ((count ?? 0) > 0) {
      throw new Error("لا يمكن حذف خطة عليها اشتراكات. قم بأرشفتها بدلاً من ذلك.");
    }
    const { error } = await db.from("billing_plans").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
