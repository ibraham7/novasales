import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listAuditLog = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({
      limit: z.number().int().min(1).max(500).default(100),
      action_prefix: z.string().optional(),
      organization_id: z.string().uuid().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    let q = db
      .from("platform_audit_log")
      .select("*, actor:profiles!platform_audit_log_actor_user_id_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.action_prefix) q = q.ilike("action", `${data.action_prefix}%`);
    if (data.organization_id) q = q.eq("organization_id", data.organization_id);
    const { data: rows, error } = await q;
    if (error) {
      // fallback without join if FK missing
      const { data: fallback } = await db
        .from("platform_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(data.limit);
      return fallback ?? [];
    }
    return rows ?? [];
  });

export const listImpersonationSessions = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data } = await db
    .from("platform_impersonation_sessions")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(200);
  return data ?? [];
});
