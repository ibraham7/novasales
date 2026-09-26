import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const createInvitation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      email: z.string().email(),
      roleId: z.string().uuid(),
      departmentId: z.string().uuid().nullable().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateInviteToken } = await import("./invitations.server");
    const { organizationId, userId } = await requirePermission("members:invite");
    const db = supabaseAdmin as any;
    const { token, hash } = generateInviteToken();
    const { data: row, error } = await db
      .from("org_invitations")
      .insert({
        organization_id: organizationId,
        email: data.email.toLowerCase().trim(),
        role_id: data.roleId,
        department_id: data.departmentId ?? null,
        token_hash: hash,
        invited_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { invitation: row, token };
  });

export const listInvitations = createServerFn({ method: "GET" }).handler(async () => {
  const { requirePermission } = await import("@/platform/rbac/rbac.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { organizationId } = await requirePermission("members:read");
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("org_invitations")
    .select("id, email, role_id, department_id, expires_at, accepted_at, revoked_at, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const roleIds = Array.from(new Set((data ?? []).map((i: any) => i.role_id)));
  const { data: roles } = roleIds.length
    ? await db.from("rbac_roles").select("id, name").in("id", roleIds)
    : { data: [] };
  const rMap = new Map((roles ?? []).map((r: any) => [r.id, r.name]));
  return (data ?? []).map((i: any) => ({ ...i, role_name: rMap.get(i.role_id) ?? null }));
});

export const revokeInvitation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId } = await requirePermission("members:invite");
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("org_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getInvitationByToken = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashInviteToken } = await import("./invitations.server");
    const db = supabaseAdmin as any;
    const hash = hashInviteToken(data.token);
    const { data: inv, error } = await db
      .from("org_invitations")
      .select("id, organization_id, email, role_id, department_id, expires_at, accepted_at, revoked_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) return null;
    const [{ data: org }, { data: role }] = await Promise.all([
      db.from("organizations").select("id, name").eq("id", inv.organization_id).maybeSingle(),
      db.from("rbac_roles").select("id, name").eq("id", inv.role_id).maybeSingle(),
    ]);
    const now = new Date();
    let status: "valid" | "accepted" | "revoked" | "expired" = "valid";
    if (inv.accepted_at) status = "accepted";
    else if (inv.revoked_at) status = "revoked";
    else if (new Date(inv.expires_at) < now) status = "expired";
    return {
      id: inv.id,
      email: inv.email,
      organization: org,
      role: role,
      status,
      expires_at: inv.expires_at,
    };
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { hashInviteToken } = await import("./invitations.server");
    const db = supabaseAdmin as any;
    const { userId } = await getWorkspace();
    const hash = hashInviteToken(data.token);
    const { data: inv, error } = await db
      .from("org_invitations")
      .select("*")
      .eq("token_hash", hash)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invalid invitation");
    if (inv.accepted_at) throw new Error("Invitation already accepted");
    if (inv.revoked_at) throw new Error("Invitation revoked");
    if (new Date(inv.expires_at) < new Date()) throw new Error("Invitation expired");

    // create membership
    await db.from("org_memberships").upsert(
      { user_id: userId, organization_id: inv.organization_id, is_active: true },
      { onConflict: "user_id,organization_id" }
    );
    // assign role
    await db.from("rbac_user_roles").upsert(
      { organization_id: inv.organization_id, user_id: userId, role_id: inv.role_id },
      { onConflict: "organization_id,user_id,role_id" }
    );
    // optional department
    if (inv.department_id) {
      await db.from("org_department_members").upsert({
        organization_id: inv.organization_id,
        department_id: inv.department_id,
        user_id: userId,
        is_supervisor: false,
        is_active: true,
      }, { onConflict: "department_id,user_id" }).catch(() => {});
    }
    // mark accepted
    await db.from("org_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", inv.id);
    // set active org
    await db.from("profiles").update({ active_organization_id: inv.organization_id }).eq("id", userId);

    return { ok: true, organizationId: inv.organization_id };
  });
