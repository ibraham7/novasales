import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getAllSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data, error } = await db.from("platform_settings").select("*").order("key");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const updateSetting = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ key: z.string().min(1), value: z.any() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("platform_settings").upsert({
      key: data.key,
      value: data.value,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    await db.from("platform_audit_log").insert({
      action: "setting.updated",
      target_type: "setting",
      target_id: data.key,
      metadata: { value: data.value },
    });
    return { ok: true };
  });
