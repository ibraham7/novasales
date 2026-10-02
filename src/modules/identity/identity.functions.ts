import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const getMyProfile = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { userId } = await getWorkspace();
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("profiles")
    .select("id, full_name, active_organization_id, created_at, updated_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
});

export const updateMyProfile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ fullName: z.string().trim().min(1).max(80) }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { userId } = await getWorkspace();
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("profiles")
      .update({ full_name: data.fullName })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyOrganizations = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { userId } = await getWorkspace();
  const db = supabaseAdmin as any;
  const { data: memberships, error } = await db
    .from("org_memberships")
    .select("organization_id, is_active, joined_at")
    .eq("user_id", userId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  const orgIds = (memberships ?? []).map((m: any) => m.organization_id);
  if (orgIds.length === 0) return [];
  const { data: orgs, error: e2 } = await db
    .from("organizations")
    .select("id, name, slug")
    .in("id", orgIds);
  if (e2) throw new Error(e2.message);
  return orgs ?? [];
});

export const switchActiveOrganization = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ organizationId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { userId } = await getWorkspace();
    const db = supabaseAdmin as any;
    // verify membership
    const { data: m, error: em } = await db
      .from("org_memberships")
      .select("id")
      .eq("user_id", userId)
      .eq("organization_id", data.organizationId)
      .eq("is_active", true)
      .maybeSingle();
    if (em) throw new Error(em.message);
    if (!m) throw new Error("Not a member of this organization");
    const { error } = await db
      .from("profiles")
      .update({ active_organization_id: data.organizationId })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyPermissions = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { getMyPermissions } = await import("@/platform/rbac/rbac.server");
    return await getMyPermissions();
  } catch {
    // جلسة غير صالحة أو غير مسجّل الدخول: لا صلاحيات بدل تعطيل الواجهة
    return [] as string[];
  }
});

export const getMyAccessSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { userId, organizationId } = await getWorkspace();
  const db = supabaseAdmin as any;
  const [{ data: access, error: accessError }, { data: isSuperAdmin, error: adminError }] = await Promise.all([
    db.rpc("get_workspace_access_fast", { _user_id: userId, _organization_id: organizationId }),
    db.rpc("has_role", { _user_id: userId, _role: "admin" }),
  ]);
  if (accessError) throw new Error(accessError.message);
  if (adminError) throw new Error(adminError.message);
  return {
    permissions: Array.isArray(access?.permissions) ? access.permissions as string[] : [],
    isSuperAdmin: isSuperAdmin === true,
  };
});
