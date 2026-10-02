import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const listFeatures = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data, error } = await db.from("billing_features").select("*").order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const upsertFeature = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      key: z.string().trim().min(2).max(60).regex(/^[a-z0-9_]+$/),
      label: z.string().trim().min(1).max(120),
      description: z.string().max(500).optional().nullable(),
      category: z.string().default("general"),
      is_active: z.boolean().default(true),
      sort_order: z.number().int().default(0),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("billing_features").upsert(data, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteFeature = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ key: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("billing_features").delete().eq("key", data.key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyEntitlements = createServerFn({ method: "GET" }).handler(async () => {
  const { getEffectiveFeatures, getEffectiveLimits, getCurrentUsage, getSubscription } = await import("./billing.server");
  const [subscription, features, limits, usage] = await Promise.all([
    getSubscription(),
    getEffectiveFeatures(),
    getEffectiveLimits(),
    getCurrentUsage(),
  ]);
  return { subscription, features, limits, usage };
});
