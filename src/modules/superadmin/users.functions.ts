import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

const RoleSchema = z.enum(["admin", "owner", "supervisor", "department_supervisor", "sales", "user"]);

// Map system role → org-level RBAC role key
function rbacKeyForSystemRole(role: string): string | null {
  switch (role) {
    case "owner": return "owner";
    case "supervisor": return "supervisor";
    case "department_supervisor": return "department_supervisor";
    case "sales": return "sales";
    case "user": return "sales";
    case "admin": return null; // super admin: no org rbac
    default: return "sales";
  }
}

async function syncRbacRole(db: any, userId: string, organizationId: string, systemRole: string) {
  const key = rbacKeyForSystemRole(systemRole);
  if (!key) return;
  const { data: roles } = await db
    .from("rbac_roles")
    .select("id, organization_id")
    .eq("key", key)
    .or(`organization_id.eq.${organizationId},organization_id.is.null`);
  const role = (roles ?? []).sort((a: any, b: any) =>
    (a.organization_id === organizationId ? -1 : 0) - (b.organization_id === organizationId ? -1 : 0)
  )[0];
  if (!role) return;
  await db.from("rbac_user_roles").delete().eq("user_id", userId).eq("organization_id", organizationId);
  await db.from("rbac_user_roles").insert({ user_id: userId, organization_id: organizationId, role_id: role.id });
}

export const listAllUsers = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: profiles } = await db
    .from("profiles")
    .select("id, full_name, created_at, active_organization_id")
    .order("created_at", { ascending: false })
    .limit(500);
  const { data: roles } = await db.from("user_roles").select("user_id, role");
  const { data: memberships } = await db
    .from("org_memberships")
    .select("user_id, organization_id, is_active, organization:organizations(id, name)");
  const { data: authList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });

  const rolesByUser = new Map<string, string[]>();
  (roles ?? []).forEach((r: any) => {
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(r.role);
    rolesByUser.set(r.user_id, list);
  });
  const orgsByUser = new Map<string, any[]>();
  (memberships ?? []).filter((m: any) => m.is_active).forEach((m: any) => {
    const list = orgsByUser.get(m.user_id) ?? [];
    if (m.organization) list.push(m.organization);
    orgsByUser.set(m.user_id, list);
  });
  const authByUser = new Map<string, any>();
  authList.users.forEach((u) => authByUser.set(u.id, u));

  return (profiles ?? []).map((p: any) => {
    const auth = authByUser.get(p.id);
    return {
      id: p.id,
      full_name: p.full_name,
      email: auth?.email ?? null,
      created_at: p.created_at,
      last_sign_in_at: auth?.last_sign_in_at ?? null,
      roles: rolesByUser.get(p.id) ?? ["user"],
      organizations: orgsByUser.get(p.id) ?? [],
      banned: !!auth?.banned_until,
    };
  });
});

export const setUserRole = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      user_id: z.string().uuid(),
      role: RoleSchema,
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    await db.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await db.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    if (error) throw new Error(error.message);
    // Sync org-level RBAC for every active membership of this user
    const { data: mems } = await db
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", data.user_id)
      .eq("is_active", true);
    for (const m of mems ?? []) {
      await syncRbacRole(db, data.user_id, m.organization_id, data.role);
    }
    await db.from("platform_audit_log").insert({
      action: "user.role_changed",
      target_type: "user",
      target_id: data.user_id,
      metadata: { role: data.role },
    });
    return { ok: true };
  });

export const toggleUserBan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid(), banned: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.banned ? "876000h" : "none",
    } as any);
    if (error) throw new Error(error.message);
    await (supabaseAdmin as any).from("platform_audit_log").insert({
      action: data.banned ? "user.banned" : "user.unbanned",
      target_type: "user",
      target_id: data.user_id,
    });
    return { ok: true };
  });

export const sendPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ email: z.string().email() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: data.email,
    });
    if (error) throw new Error(error.message);
    return { ok: true, link: link.properties?.action_link ?? null };
  });

export const createUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      email: z.string().max(255).optional(),
      password: z.string().max(72).optional(),
      full_name: z.string().trim().min(1).max(120),
      role: RoleSchema,
      organization_id: z.string().uuid().optional().nullable(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const generated = String(Math.floor(1000000 + Math.random() * 9000000));
    const raw = (data.email ?? "").trim() || generated;
    const password = (data.password ?? "").trim() || raw.replace(/\s+/g, "").toLowerCase();
    const email = raw.includes("@") ? raw : `${raw.replace(/\s+/g, "").toLowerCase()}@demo.app`;

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name, role: data.role },
    });
    if (error) throw new Error(error.message);
    const uid = created.user!.id;

    // Ensure profile exists with full_name
    await db.from("profiles").upsert({ id: uid, full_name: data.full_name });

    // Ensure role (trigger might have set default; enforce chosen)
    await db.from("user_roles").delete().eq("user_id", uid);
    await db.from("user_roles").insert({ user_id: uid, role: data.role });

    if (data.organization_id) {
      await db.from("org_memberships").insert({
        user_id: uid,
        organization_id: data.organization_id,
        is_active: true,
      });
      await db.from("profiles").update({ active_organization_id: data.organization_id }).eq("id", uid);
      await syncRbacRole(db, uid, data.organization_id, data.role);
    }

    await db.from("platform_audit_log").insert({
      action: "user.created",
      target_type: "user",
      target_id: uid,
      organization_id: data.organization_id ?? null,
      metadata: { role: data.role, email },
    });

    return { ok: true, user_id: uid, username: email.split("@")[0], password };
  });

/** السوبر أدمن: تغيير اسم المستخدم و/أو كلمة المرور لأي مستخدم. */
export const updateUserCredentials = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      user_id: z.string().uuid(),
      username: z.string().trim().min(3).max(120).optional(),
      password: z.string().min(4).max(72).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload: Record<string, unknown> = {};
    if (data.username) {
      const raw = data.username.trim();
      payload.email = raw.includes("@") ? raw : `${raw.replace(/\s+/g, "").toLowerCase()}@demo.app`;
      payload.email_confirm = true;
    }
    if (data.password) payload.password = data.password;
    if (Object.keys(payload).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, payload as any);
    if (error) throw new Error(error.message);
    await (supabaseAdmin as any).from("platform_audit_log").insert({
      action: "user.credentials_changed",
      target_type: "user",
      target_id: data.user_id,
    });
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    await (supabaseAdmin as any).from("platform_audit_log").insert({
      action: "user.deleted",
      target_type: "user",
      target_id: data.user_id,
    });
    return { ok: true };
  });

export const addUserToOrganization = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      user_id: z.string().uuid(),
      organization_id: z.string().uuid(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("org_memberships").upsert({
      user_id: data.user_id,
      organization_id: data.organization_id,
      is_active: true,
    }, { onConflict: "user_id,organization_id" });
    if (error) throw new Error(error.message);
    await db.from("platform_audit_log").insert({
      action: "org.member_added",
      target_type: "user",
      target_id: data.user_id,
      organization_id: data.organization_id,
    });
    return { ok: true };
  });

export const removeUserFromOrganization = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      user_id: z.string().uuid(),
      organization_id: z.string().uuid(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("org_memberships")
      .delete()
      .eq("user_id", data.user_id)
      .eq("organization_id", data.organization_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
