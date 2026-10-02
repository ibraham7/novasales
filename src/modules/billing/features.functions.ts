import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const listFeatures = createServerFn({ method: "GET" }).handler(async () => {
  const { requireBillingAdmin } = await import("./admin.server");
  await requireBillingAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data, error } = await db.from("billing_features").select("*").order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const upsertFeature = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        key: z
          .string()
          .trim()
          .min(2)
          .max(60)
          .regex(/^[a-z0-9_]+$/),
        label: z.string().trim().min(1).max(120),
        description: z.string().max(500).optional().nullable(),
        category: z.string().default("general"),
        is_active: z.boolean().default(true),
        sort_order: z.number().int().default(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireBillingAdmin } = await import("./admin.server");
    await requireBillingAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("billing_features").upsert(data, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteFeature = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ key: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { requireBillingAdmin } = await import("./admin.server");
    await requireBillingAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("billing_features").delete().eq("key", data.key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyEntitlements = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  await requireAnyPermission(["org.manage", "org:update"]);
  const { getEffectiveFeatures, getEffectiveLimits, getCurrentUsage, getSubscription } =
    await import("./billing.server");
  const [subscription, features, limits, usage] = await Promise.all([
    getSubscription(),
    getEffectiveFeatures(),
    getEffectiveLimits(),
    getCurrentUsage(),
  ]);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: labels, error } = await (supabaseAdmin as any)
    .from("billing_features")
    .select("key,label")
    .eq("is_active", true);
  if (error) throw new Error("تعذر تحميل أسماء الميزات");
  return {
    subscription,
    features,
    limits,
    usage,
    featureLabels: Object.fromEntries((labels ?? []).map((r: any) => [r.key, r.label])),
  };
});
