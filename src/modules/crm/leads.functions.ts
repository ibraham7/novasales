import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { matchesSearch } from "@/lib/fuzzy-search";

const LeadStatus = z.enum(["new", "working", "qualified", "unqualified", "converted", "lost"]);

export const listLeads = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({
      status: LeadStatus.optional(),
      departmentId: z.string().uuid().optional(),
      ownerId: z.string().uuid().optional(),
      search: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(3000).default(200),
    }).parse(d ?? {})
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { applyLeadScope } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.leads.view"]);
    let q = db
      .from("crm_leads")
      .select("*")
      .eq("organization_id", organizationId)
      .order("opened_at", { ascending: false })
      .limit(data.search ? Math.max(data.limit, 2000) : data.limit);
    if (data.status) q = q.eq("status", data.status);
    q = applyLeadScope(q, access, { departmentId: data.departmentId, ownerId: data.ownerId });
    if (!q) return [];
    const { data: leads, error } = await q;
    if (error) throw new Error(error.message);
    const contactIds = Array.from(new Set((leads ?? []).map((l: any) => l.contact_id)));
    const wide = Boolean(data.search) && contactIds.length > 300;
    const [{ data: contacts }, { data: points }] = await Promise.all([
      wide
        ? db.from("crm_contacts").select("id, display_name, full_name").eq("organization_id", organizationId).limit(5000)
        : contactIds.length
          ? db.from("crm_contacts").select("id, display_name, full_name").in("id", contactIds)
          : Promise.resolve({ data: [] }),
      wide
        ? db
            .from("crm_contact_points")
            .select("contact_id, identifier, is_primary")
            .eq("organization_id", organizationId)
            .limit(5000)
        : contactIds.length
          ? db
              .from("crm_contact_points")
              .select("contact_id, identifier, is_primary")
              .eq("organization_id", organizationId)
              .in("contact_id", contactIds)
          : Promise.resolve({ data: [] }),
    ]);

    const cMap = new Map((contacts ?? []).map((c: any) => [c.id, c]));
    const phoneMap = new Map<string, string[]>();
    (points ?? []).forEach((p: any) => {
      const arr = phoneMap.get(p.contact_id) ?? [];
      if (p.is_primary) arr.unshift(p.identifier);
      else arr.push(p.identifier);
      phoneMap.set(p.contact_id, arr);
    });
    let rows = (leads ?? []).map((l: any) => {
      const c: any = cMap.get(l.contact_id);
      const phones = phoneMap.get(l.contact_id) ?? [];
      return {
        ...l,
        contact_name: c?.display_name ?? c?.full_name ?? null,
        contact_phone: phones[0] ?? null,
        contact_phones: phones,
      };
    });
    if (data.search) {
      rows = rows.filter((r: any) =>
        matchesSearch(data.search as string, [r.contact_name, r.source, ...(r.contact_phones ?? [])])
      );
    }
    return rows;
  });

export const getLead = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.leads.view"]);
    const { data: lead, error } = await db
      .from("crm_leads")
      .select("*")
      .eq("id", data.leadId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) return null;
    if (!canAccessOpportunityRow(access, { owner_agent_id: lead.owner_user_id, department_id: lead.department_id })) return null;
    const [{ data: contact }, { data: opps }] = await Promise.all([
      db.from("crm_contacts").select("*").eq("id", lead.contact_id).maybeSingle(),
      db.from("opp_opportunities").select("*").eq("lead_id", lead.id).order("opened_at", { ascending: false }),
    ]);
    return { ...lead, contact, opportunities: opps ?? [] };
  });

export const createLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      contactId: z.string().uuid().optional(),
      contactName: z.string().min(1).max(200).optional(),
      phone: z.string().max(50).optional(),
      email: z.string().email().max(200).optional(),
      departmentId: z.string().uuid().optional(),
      source: z.string().max(100).optional(),
      status: LeadStatus.default("new"),
      notes: z.string().max(2000).optional(),
      customFields: z.record(z.any()).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { validateAndApplyCustomFields } = await import("./custom-fields.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
    await requireAnyPermission(["crm.leads.create"]);
    const customFields = await validateAndApplyCustomFields(
      organizationId,
      "lead",
      data.customFields ?? {},
    );
    let contactId = data.contactId;
    if (!contactId) {
      if (!data.contactName) throw new Error("يجب تحديد جهة الاتصال أو اسم العميل");
      const { data: newC, error: cErr } = await db
        .from("crm_contacts")
        .insert({
          organization_id: organizationId,
          display_name: data.contactName,
          full_name: data.contactName,
          lifecycle_stage: "lead",
        })
        .select("id")
        .single();
      if (cErr) throw new Error(cErr.message);
      contactId = newC.id;
      if (data.phone) {
        await db.from("crm_contact_points").insert({
          organization_id: organizationId,
          contact_id: contactId,
          channel_type: "whatsapp",
          identifier: data.phone,
          is_primary: true,
        });
      }
      if (data.email) {
        await db.from("crm_contact_points").insert({
          organization_id: organizationId,
          contact_id: contactId,
          channel_type: "email",
          identifier: data.email,
          is_primary: !data.phone,
        });
      }
    }
    const { data: lead, error } = await db
      .from("crm_leads")
      .insert({
        organization_id: organizationId,
        contact_id: contactId,
        department_id: data.departmentId,
        source: data.source,
        status: data.status,
        notes: data.notes,
        owner_user_id: userId,
        custom_fields: customFields,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return lead;
  });

export const updateLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      leadId: z.string().uuid(),
      status: LeadStatus.optional(),
      departmentId: z.string().uuid().nullable().optional(),
      ownerUserId: z.string().uuid().nullable().optional(),
      source: z.string().max(100).nullable().optional(),
      score: z.number().int().min(0).max(100).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      customFields: z.record(z.any()).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.leads.update"]);
    const { data: current } = await db
      .from("crm_leads")
      .select("owner_user_id, department_id")
      .eq("id", data.leadId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!current || !canAccessOpportunityRow(access, { owner_agent_id: current.owner_user_id, department_id: current.department_id })) {
      throw new Error("لا تملك صلاحية تعديل هذا العميل المحتمل");
    }
    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) {
      patch.status = data.status;
      if (data.status === "converted") patch.converted_at = new Date().toISOString();
    }
    if (data.departmentId !== undefined) patch.department_id = data.departmentId;
    if (data.ownerUserId !== undefined) patch.owner_user_id = data.ownerUserId;
    if (data.source !== undefined) patch.source = data.source;
    if (data.score !== undefined) patch.score = data.score;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.customFields !== undefined) {
      const { validateAndApplyCustomFields } = await import("./custom-fields.server");
      const { data: existing } = await db
        .from("crm_leads")
        .select("custom_fields")
        .eq("id", data.leadId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      patch.custom_fields = await validateAndApplyCustomFields(
        organizationId,
        "lead",
        data.customFields,
        { existing: existing?.custom_fields ?? {} },
      );
    }
    const { error } = await db.from("crm_leads").update(patch).eq("id", data.leadId).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const convertLeadToOpportunity = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      leadId: z.string().uuid(),
      title: z.string().min(1).max(200).optional(),
      amount: z.number().min(0).optional(),
      currency: z.string().length(3).optional(),
      expectedCloseDate: z.string().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.create", "crm.leads.update"]);
    const { data: lead } = await db.from("crm_leads").select("*").eq("id", data.leadId).eq("organization_id", organizationId).maybeSingle();
    if (!lead) throw new Error("Lead غير موجود");
    if (!canAccessOpportunityRow(access, { owner_agent_id: lead.owner_user_id, department_id: lead.department_id })) {
      throw new Error("لا تملك صلاحية تحويل هذا العميل");
    }
    // Default pipeline + first stage
    const { data: pipe } = await db
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle();
    const { data: firstStage } = pipe
      ? await db.from("crm_pipeline_stages").select("*").eq("pipeline_id", pipe.id).order("ord").limit(1).maybeSingle()
      : { data: null };
    const { data: opp, error } = await db
      .from("opp_opportunities")
      .insert({
        organization_id: organizationId,
        contact_id: lead.contact_id,
        lead_id: lead.id,
        department_id: lead.department_id,
        owner_agent_id: lead.owner_user_id,
        pipeline_id: pipe?.id,
        stage_id: firstStage?.id,
        stage: "new",
        title: data.title,
        source: lead.source,
        value: data.amount,
        currency: data.currency,
        expected_close_date: data.expectedCloseDate,
        probability: firstStage?.probability ?? 10,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await db
      .from("crm_leads")
      .update({ status: "converted", converted_at: new Date().toISOString() })
      .eq("id", lead.id);
    return opp;
  });

export const deleteLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.leads.delete"]);
    const { data: current } = await db
      .from("crm_leads")
      .select("owner_user_id, department_id")
      .eq("id", data.leadId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!current || !canAccessOpportunityRow(access, { owner_agent_id: current.owner_user_id, department_id: current.department_id })) {
      throw new Error("لا تملك صلاحية حذف هذا العميل المحتمل");
    }
    const { error } = await db.from("crm_leads").delete().eq("id", data.leadId).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
