import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const startImpersonation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      target_user_id: z.string().uuid(),
      organization_id: z.string().uuid().optional(),
      reason: z.string().max(300).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getWorkspace } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const adminId = (await getWorkspace()).userId;

    // Prevent impersonating another admin
    const { data: targetRoles } = await db.from("user_roles").select("role").eq("user_id", data.target_user_id);
    if ((targetRoles ?? []).some((r: any) => r.role === "admin")) {
      throw new Error("لا يمكنك التنكر بمشرف عام آخر.");
    }

    const { data: session, error } = await db
      .from("platform_impersonation_sessions")
      .insert({
        admin_user_id: adminId,
        target_user_id: data.target_user_id,
        organization_id: data.organization_id ?? null,
        reason: data.reason ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await db.from("platform_audit_log").insert({
      actor_user_id: adminId,
      action: "impersonation.started",
      target_type: "user",
      target_id: data.target_user_id,
      organization_id: data.organization_id ?? null,
      metadata: { session_id: session.id, reason: data.reason },
    });

    return { session_id: session.id };
  });

export const stopImpersonation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ session_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("platform_impersonation_sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", data.session_id)
      .is("ended_at", null);
    if (error) throw new Error(error.message);
    await db.from("platform_audit_log").insert({
      action: "impersonation.stopped",
      target_type: "session",
      target_id: data.session_id,
    });
    return { ok: true };
  });
