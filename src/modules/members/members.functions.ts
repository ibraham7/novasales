import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { ROLE_RANK } from "./role-rank";

export const listMembers = createServerFn({ method: "GET" }).handler(async () => {
  const { requirePermission } = await import("@/platform/rbac/rbac.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { organizationId } = await requirePermission("members:read");
  const db = supabaseAdmin as any;

  const { data: memberships, error } = await db
    .from("org_memberships")
    .select("id, user_id, is_active, joined_at")
    .eq("organization_id", organizationId)
    .order("joined_at", { ascending: true });
  if (error) throw new Error(error.message);

  const userIds = (memberships ?? []).map((m: any) => m.user_id);
  if (userIds.length === 0) return [];

  const [{ data: profiles }, { data: userRoles }, authList] = await Promise.all([
    db.from("profiles").select("id, full_name").in("id", userIds),
    db.from("rbac_user_roles").select("user_id, role_id").eq("organization_id", organizationId).in("user_id", userIds),
    supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const emailByUser = new Map<string, string | null>(
    (authList.data?.users ?? []).map((u: any) => [u.id, u.email ?? null]),
  );

  const roleIds = Array.from(new Set((userRoles ?? []).map((r: any) => r.role_id)));
  const { data: roles } = roleIds.length
    ? await db.from("rbac_roles").select("id, key, name").in("id", roleIds)
    : { data: [] };
  const roleMap = new Map((roles ?? []).map((r: any) => [r.id, r]));
  const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));
  const rolesByUser = new Map<string, Array<{ id: string; key: string; name: string }>>();
  (userRoles ?? []).forEach((ur: any) => {
    const r = roleMap.get(ur.role_id);
    if (!r) return;
    const arr = rolesByUser.get(ur.user_id) ?? [];
    arr.push(r as any);
    rolesByUser.set(ur.user_id, arr);
  });

  return (memberships ?? []).map((m: any) => ({
    id: m.id,
    user_id: m.user_id,
    is_active: m.is_active,
    joined_at: m.joined_at,
    full_name: pMap.get(m.user_id) ?? null,
    email: emailByUser.get(m.user_id) ?? null,
    username: (emailByUser.get(m.user_id) ?? "").split("@")[0] || null,
    roles: rolesByUser.get(m.user_id) ?? [],
  }));
});

export const activateMember = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ membershipId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePermission("members:update");
    const db = supabaseAdmin as any;
    const { error } = await db.from("org_memberships").update({ is_active: true }).eq("id", data.membershipId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deactivateMember = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ membershipId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePermission("members:update");
    const db = supabaseAdmin as any;
    const { error } = await db.from("org_memberships").update({ is_active: false }).eq("id", data.membershipId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId } = await requirePermission("members:remove");
    const db = supabaseAdmin as any;
    // remove roles + membership
    await db.from("rbac_user_roles").delete().eq("organization_id", organizationId).eq("user_id", data.userId);
    const { error } = await db.from("org_memberships").delete().eq("organization_id", organizationId).eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setMemberRoles = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), roleIds: z.array(z.string().uuid()).max(1) }).parse(d)
  )
  .handler(async ({ data }) => {
    const { requirePermission, getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId, userId: callerId } = await requirePermission("roles:assign");
    const db = supabaseAdmin as any;

    const access = await getWorkspaceAccess();
    const callerRank = access.isSuperAdmin
      ? 5
      : Math.max(0, ...access.roleKeys.map((k) => ROLE_RANK[k] ?? 0));

    // الدور الحالي للمستخدم الهدف
    const { data: targetRows } = await db
      .from("rbac_user_roles")
      .select("rbac_roles!inner(key)")
      .eq("organization_id", organizationId)
      .eq("user_id", data.userId);
    const targetRank = Math.max(
      0,
      ...((targetRows ?? []).map((r: any) => ROLE_RANK[r.rbac_roles?.key] ?? 0)),
    );

    const { data: newRoles } = data.roleIds.length
      ? await db.from("rbac_roles").select("id, key").in("id", data.roleIds)
      : { data: [] };
    const newRank = Math.max(0, ...((newRoles ?? []).map((r: any) => ROLE_RANK[r.key] ?? 0)));

    if (data.userId === callerId && !access.isSuperAdmin) {
      throw new Error("لا يمكنك تعديل دورك الشخصي");
    }
    if (targetRank >= callerRank) {
      throw new Error("لا يمكنك تعديل دور شخص بنفس مستواك أو أعلى منك");
    }
    if (newRank >= callerRank) {
      throw new Error("لا يمكنك منح دور بنفس مستواك أو أعلى منك");
    }

    await db
      .from("rbac_user_roles")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", data.userId);
    if (data.roleIds.length > 0) {
      const { error } = await db.from("rbac_user_roles").insert({
        organization_id: organizationId,
        user_id: data.userId,
        role_id: data.roleIds[0],
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** تغيير اسم المستخدم و/أو كلمة المرور لعضو أدنى رتبة من المتصل. */
export const updateMemberCredentials = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        username: z.string().trim().min(3).max(64).optional(),
        password: z.string().min(6).max(72).optional(),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const { requirePermission, getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId, userId: callerId } = await requirePermission("members:update");
    const db = supabaseAdmin as any;

    const access = await getWorkspaceAccess();
    const callerRank = access.isSuperAdmin
      ? 5
      : Math.max(0, ...access.roleKeys.map((k) => ROLE_RANK[k] ?? 0));
    if (callerRank < 3) throw new Error("لا تملك صلاحية تغيير بيانات الدخول");

    const { data: targetRows } = await db
      .from("rbac_user_roles")
      .select("rbac_roles!inner(key)")
      .eq("organization_id", organizationId)
      .eq("user_id", data.userId);
    const targetRank = Math.max(
      0,
      ...((targetRows ?? []).map((r: any) => ROLE_RANK[r.rbac_roles?.key] ?? 0)),
    );
    if (data.userId !== callerId && targetRank >= callerRank) {
      throw new Error("لا يمكنك تعديل بيانات شخص بنفس مستواك أو أعلى منك");
    }

    const payload: Record<string, unknown> = {};
    if (data.username) {
      const raw = data.username.trim();
      payload.email = raw.includes("@") ? raw : `${raw.replace(/\s+/g, "").toLowerCase()}@demo.app`;
      payload.email_confirm = true;
    }
    if (data.password) payload.password = data.password;
    if (Object.keys(payload).length === 0) return { ok: true };

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, payload as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** دور المستخدم الحالي داخل مؤسسته + مرتبته. */
export const myMemberRole = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
    const access = await getWorkspaceAccess();
    const rank = access.isSuperAdmin
      ? 5
      : Math.max(0, ...access.roleKeys.map((k) => ROLE_RANK[k] ?? 0));
    return { roleKeys: access.roleKeys, rank, isSuperAdmin: access.isSuperAdmin };
  } catch {
    return { roleKeys: [] as string[], rank: 0, isSuperAdmin: false };
  }
});
