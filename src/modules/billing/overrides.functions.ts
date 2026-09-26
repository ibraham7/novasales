import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listOverrides = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ organization_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: rows, error } = await db
      .from("billing_subscription_overrides")
      .select("*")
      .eq("organization_id", data.organization_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createOverride = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      organization_id: z.string().uuid(),
      feature_key: z.string().optional().nullable(),
      is_enabled: z.boolean().optional().nullable(),
      limit_key: z.string().optional().nullable(),
      limit_value: z.number().int().optional().nullable(),
      reason: z.string().max(500).optional().nullable(),
      expires_at: z.string().optional().nullable(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("billing_subscription_overrides").insert(data);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteOverride = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("billing_subscription_overrides").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
