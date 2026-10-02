import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

/** List roles available to the current org (system + org-owned custom). */
export const listRoles = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { organizationId } = await requireAnyPermission(["roles:read", "roles:assign", "members:update"]);
  const db = supabaseAdmin as any;
  const { data: roles, error } = await db
    .from("rbac_roles")
    .select("id, key, name, description, is_system, organization_id, created_at")
    .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
    .order("is_system", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  const ids = (roles ?? []).map((r: any) => r.id);
  const { data: rp } = ids.length
    ? await db.from("rbac_role_permissions").select("role_id, permission_key").in("role_id", ids)
    : { data: [] };
  const map = new Map<string, string[]>();
  (rp ?? []).forEach((row: any) => {
    const arr = map.get(row.role_id) ?? [];
    arr.push(row.permission_key);
    map.set(row.role_id, arr);
  });
  return (roles ?? []).map((r: any) => ({ ...r, permissions: map.get(r.id) ?? [] }));
});

export const listPermissions = createServerFn({ method: "GET" }).handler(async () => {
  const { requirePermission } = await import("@/platform/rbac/rbac.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await requirePermission("roles:read");
  const db = supabaseAdmin as any;
  const { data, error } = await db.from("rbac_permissions").select("key, description").order("key");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const createRole = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      key: z.string().trim().min(2).max(40).regex(/^[a-z0-9_-]+$/),
      name: z.string().trim().min(1).max(80),
      permissions: z.array(z.string()).default([]),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId } = await requirePermission("roles:manage");
    const db = supabaseAdmin as any;
    const { data: role, error } = await db
      .from("rbac_roles")
      .insert({ organization_id: organizationId, key: data.key, name: data.name, is_system: false })
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (data.permissions.length > 0) {
      const rows = data.permissions.map((p) => ({ role_id: role.id, permission_key: p }));
      const { error: pe } = await db.from("rbac_role_permissions").insert(rows);
      if (pe) throw new Error(pe.message);
    }
    return role;
  });

export const updateRole = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80).optional() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId } = await requirePermission("roles:manage");
    const db = supabaseAdmin as any;
    const { data: role, error: re } = await db
      .from("rbac_roles").select("id, is_system, organization_id").eq("id", data.id).maybeSingle();
    if (re) throw new Error(re.message);
    if (!role) throw new Error("Role not found");
    if (role.is_system || role.organization_id !== organizationId) throw new Error("Cannot modify system role");
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    const { error } = await db.from("rbac_roles").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteRole = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId } = await requirePermission("roles:manage");
    const db = supabaseAdmin as any;
    const { data: role } = await db.from("rbac_roles").select("is_system, organization_id").eq("id", data.id).maybeSingle();
    if (!role) throw new Error("Role not found");
    if (role.is_system || role.organization_id !== organizationId) throw new Error("Cannot delete system role");
    const { error } = await db.from("rbac_roles").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setRolePermissions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ roleId: z.string().uuid(), permissions: z.array(z.string()) }).parse(d)
  )
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId } = await requirePermission("roles:manage");
    const db = supabaseAdmin as any;
    const { data: role } = await db.from("rbac_roles").select("is_system, organization_id").eq("id", data.roleId).maybeSingle();
    if (!role) throw new Error("Role not found");
    if (role.is_system || role.organization_id !== organizationId) throw new Error("Cannot modify system role permissions");
    // replace all
    await db.from("rbac_role_permissions").delete().eq("role_id", data.roleId);
    if (data.permissions.length > 0) {
      const rows = data.permissions.map((p) => ({ role_id: data.roleId, permission_key: p }));
      const { error } = await db.from("rbac_role_permissions").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const assignUserRole = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), roleId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId } = await requirePermission("roles:assign");
    const db = supabaseAdmin as any;
    const { error } = await db.from("rbac_user_roles").upsert(
      { organization_id: organizationId, user_id: data.userId, role_id: data.roleId },
      { onConflict: "organization_id,user_id,role_id" }
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unassignUserRole = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), roleId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId } = await requirePermission("roles:assign");
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("rbac_user_roles")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", data.userId)
      .eq("role_id", data.roleId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
