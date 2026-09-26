import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { FUNNEL_STAGES, normalizePhone, shapeContact } from "./contacts.server";

export const funnelStages = FUNNEL_STAGES;

export const listContacts = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ search: z.string().max(200).optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  await requireAnyPermission(["contacts.view", "contacts.view_department"]);
  const term = (data.search ?? "").trim();
  const digits = term.replace(/\D/g, "");
  let matchedIds: string[] | null = null;
  if (term) {
    // بحث على مستوى قاعدة البيانات: بالاسم أو برقم التواصل (حتى لو كان خارج أحدث 500 سجل).
    const [{ data: byName }, { data: byPhone }] = await Promise.all([
      db
        .from("crm_contacts")
        .select("id")
        .eq("organization_id", organizationId)
        .or(`display_name.ilike.%${term}%,full_name.ilike.%${term}%`)
        .limit(500),
      digits.length >= 3
        ? db
            .from("crm_contact_points")
            .select("contact_id")
            .eq("organization_id", organizationId)
            .ilike("identifier", `%${digits}%`)
            .limit(500)
        : Promise.resolve({ data: [] }),
    ]);
    matchedIds = Array.from(
      new Set([...(byName ?? []).map((r: any) => r.id), ...(byPhone ?? []).map((r: any) => r.contact_id)]),
    ) as string[];
    if (matchedIds.length === 0) return [];
  }
  let q = db
    .from("crm_contacts")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (matchedIds) q = q.in("id", matchedIds);
  const { data: rows0, error } = await q;
  if (error) throw new Error(error.message);
  const rows: any[] = [];
  for (const c of rows0 ?? []) rows.push(await shapeContact(organizationId, c, db));
  return rows;
});


export const upsertContact = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        phone: z.string().min(5).max(30),
        name: z.string().max(120).optional().nullable(),
        funnel_stage: z.enum(FUNNEL_STAGES).default("lead"),
        notes: z.string().max(2000).optional().nullable(),
        instance_id: z.string().uuid().optional().nullable(),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    await requireAnyPermission(["contacts.manage"]);
    const phone = normalizePhone(data.phone);

    let contactId = data.id ?? null;
    if (contactId) {
      const { error } = await db
        .from("crm_contacts")
        .update({
          display_name: data.name ?? null,
          full_name: data.name ?? null,
          lifecycle_stage: data.funnel_stage,
          notes: data.notes ?? null,
        })
        .eq("id", contactId)
        .eq("organization_id", organizationId);
      if (error) throw new Error(error.message);
    } else {
      // Try find by phone via contact_points
      const { data: cp } = await db
        .from("crm_contact_points")
        .select("contact_id")
        .eq("organization_id", organizationId)
        .eq("channel_type", "whatsapp")
        .eq("identifier", phone)
        .maybeSingle();
      if (cp?.contact_id) {
        contactId = cp.contact_id;
        await db
          .from("crm_contacts")
          .update({
            display_name: data.name ?? null,
            full_name: data.name ?? null,
            lifecycle_stage: data.funnel_stage,
            notes: data.notes ?? null,
          })
          .eq("id", contactId);
      } else {
        const { data: row, error } = await db
          .from("crm_contacts")
          .insert({
            organization_id: organizationId,
            display_name: data.name ?? null,
            full_name: data.name ?? null,
            lifecycle_stage: data.funnel_stage,
            notes: data.notes ?? null,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        contactId = row.id;
        await db.from("crm_contact_points").insert({
          organization_id: organizationId,
          contact_id: contactId,
          channel_type: "whatsapp",
          identifier: phone,
          is_primary: true,
          verified: true,
        });
      }
    }

    const { data: row } = await db.from("crm_contacts").select("*").eq("id", contactId).maybeSingle();
    return await shapeContact(organizationId, row, db);
  });

export const deleteContact = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    await requireAnyPermission(["contacts.manage"]);
    const { error } = await db
      .from("crm_contacts")
      .delete()
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateContactName = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ contactId: z.string().uuid(), name: z.string().min(1).max(120) }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    await requireAnyPermission(["contacts.manage", "crm.opportunities.update"]);
    const { error } = await db
      .from("crm_contacts")
      .update({ display_name: data.name, full_name: data.name })
      .eq("id", data.contactId)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

