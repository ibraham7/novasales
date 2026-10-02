import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const listDepartments = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  const { data, error } = await db
    .from("org_departments")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const createDepartment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(80),
      shortCode: z.string().max(16).optional().nullable(),
      subtitle: z.string().max(160).optional().nullable(),
      timezone: z.string().trim().min(1).max(64).default("Asia/Dubai"),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { data: row, error } = await db
      .from("org_departments")
      .insert({
        organization_id: organizationId,
        name: data.name,
        short_code: data.shortCode?.trim() || null,
        subtitle: data.subtitle?.trim() || null,
        timezone: data.timezone,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateDepartment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(80).optional(),
      shortCode: z.string().max(16).nullable().optional(),
      subtitle: z.string().max(160).nullable().optional(),
      timezone: z.string().trim().min(1).max(64).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.shortCode !== undefined) patch.short_code = data.shortCode?.trim() || null;
    if (data.subtitle !== undefined) patch.subtitle = data.subtitle?.trim() || null;
    if (data.timezone !== undefined) patch.timezone = data.timezone;
    const { error } = await db.from("org_departments").update(patch).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDepartment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("org_departments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMembers = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ departmentId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    let q = db
      .from("org_department_members")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    if (data.departmentId) q = q.eq("department_id", data.departmentId);
    const { data: rows, error } = await q.order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    // enrich with profile + channel_account
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    const accIds = Array.from(new Set((rows ?? []).map((r: any) => r.default_channel_account_id).filter(Boolean)));
    const [{ data: profiles }, { data: accs }, { data: plugins }] = await Promise.all([
      userIds.length
        ? db.from("profiles").select("id, full_name").in("id", userIds)
        : Promise.resolve({ data: [] }),
      accIds.length
        ? db.from("msg_channel_accounts").select("id, display_name").in("id", accIds)
        : Promise.resolve({ data: [] }),
      accIds.length
        ? db.from("plugin_whatsapp_evolution_instances").select("channel_account_id, phone_number").in("channel_account_id", accIds)
        : Promise.resolve({ data: [] }),
    ]);
    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));
    const aMap = new Map((accs ?? []).map((a: any) => [a.id, a.display_name]));
    const phoneMap = new Map((plugins ?? []).map((p: any) => [p.channel_account_id, p.phone_number]));
    return (rows ?? []).map((r: any) => ({
      ...r,
      profile_name: pMap.get(r.user_id) ?? null,
      channel_account_name: r.default_channel_account_id
        ? [aMap.get(r.default_channel_account_id), phoneMap.get(r.default_channel_account_id) ? `+${phoneMap.get(r.default_channel_account_id)}` : null]
            .filter(Boolean)
            .join(" — ")
        : null,
    }));
  });

/** مستخدمو المؤسسة المتاحون لإضافتهم كأعضاء في قسم (بدون إنشاء حسابات جديدة). */
export const listOrgUsers = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  const { data: memberships } = await db
    .from("org_memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  const userIds: string[] = Array.from(new Set((memberships ?? []).map((m: any) => String(m.user_id))));
  if (userIds.length === 0) return [];
  const { data: profiles } = await db.from("profiles").select("id, full_name").in("id", userIds);
  const pMap = new Map<string, string>((profiles ?? []).map((p: any) => [p.id, p.full_name]));
  return userIds.map((id) => ({ id, full_name: pMap.get(id) ?? "مستخدم" }));
});

export const addMember = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      departmentId: z.string().uuid(),
      userId: z.string().uuid(),
      displayName: z.string().trim().min(1).max(80).optional(),
      isSupervisor: z.boolean().default(false),
      defaultChannelAccountId: z.string().uuid().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();

    // العضو يجب أن يكون مستخدماً موجوداً في المؤسسة — لا ننشئ حسابات جديدة أبداً
    const { data: membership } = await db
      .from("org_memberships")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (!membership) throw new Error("هذا المستخدم ليس ضمن المؤسسة");

    const { data: existing } = await db
      .from("org_department_members")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("department_id", data.departmentId)
      .eq("user_id", data.userId)
      .maybeSingle();

    const { data: prof } = await db.from("profiles").select("full_name").eq("id", data.userId).maybeSingle();
    const displayName = data.displayName?.trim() || prof?.full_name || "مستخدم";

    if (existing) {
      const { error } = await db
        .from("org_department_members")
        .update({
          is_active: true,
          is_supervisor: data.isSupervisor,
          display_name: displayName,
          default_channel_account_id: data.defaultChannelAccountId ?? null,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { ok: true, userId: data.userId };
    }

    const { error: mErr } = await db.from("org_department_members").insert({
      organization_id: organizationId,
      department_id: data.departmentId,
      user_id: data.userId,
      is_supervisor: data.isSupervisor,
      display_name: displayName,
      default_channel_account_id: data.defaultChannelAccountId ?? null,
    });
    if (mErr) throw new Error(mErr.message);
    return { ok: true, userId: data.userId };
  });


export const updateMember = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      isSupervisor: z.boolean().optional(),
      defaultChannelAccountId: z.string().uuid().nullable().optional(),
      displayName: z.string().trim().min(1).max(80).optional(),
      welcomeTemplateOverride: z.string().max(2000).nullable().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const patch: Record<string, unknown> = {};
    if (data.isSupervisor !== undefined) patch.is_supervisor = data.isSupervisor;
    if (data.defaultChannelAccountId !== undefined) patch.default_channel_account_id = data.defaultChannelAccountId;
    if (data.displayName !== undefined) patch.display_name = data.displayName;
    if (data.welcomeTemplateOverride !== undefined) {
      const v = data.welcomeTemplateOverride?.trim();
      patch.welcome_template_override = v ? v : null;
    }
    const { error } = await db.from("org_department_members").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const removeMember = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("org_department_members").update({ is_active: false }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const assignAccountToDepartment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      accountId: z.string().uuid(),
      departmentId: z.string().uuid().nullable(),
      action: z.enum(["link", "unlink"]).default("link"),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();

    // Unlink: either a specific department, or (departmentId=null) all departments.
    if (data.action === "unlink") {
      let q = db.from("msg_channel_account_departments").delete().eq("account_id", data.accountId);
      if (data.departmentId) q = q.eq("department_id", data.departmentId);
      const { error } = await q;
      if (error) throw new Error(error.message);
      // Keep legacy single column in sync (first remaining link, if any).
      const { data: remaining } = await db
        .from("msg_channel_account_departments")
        .select("department_id")
        .eq("account_id", data.accountId)
        .limit(1)
        .maybeSingle();
      await db
        .from("msg_channel_accounts")
        .update({ department_id: remaining?.department_id ?? null })
        .eq("id", data.accountId);
      return { ok: true };
    }

    // Link (many-to-many): allow the same number to belong to multiple departments.
    if (!data.departmentId) throw new Error("departmentId required for link");
    const { error } = await db
      .from("msg_channel_account_departments")
      .upsert(
        {
          account_id: data.accountId,
          department_id: data.departmentId,
          organization_id: organizationId,
        },
        { onConflict: "account_id,department_id" },
      );
    if (error) throw new Error(error.message);
    // Keep legacy single column populated (first link) for older readers.
    await db
      .from("msg_channel_accounts")
      .update({ department_id: data.departmentId })
      .eq("id", data.accountId)
      .is("department_id", null);
    return { ok: true };
  });
