// Lead Assignment functions — lead هو مصدر الحقيقة الوحيد للملكية.
// كل التغييرات هنا فقط. Trigger tg_sync_opp_owner_from_lead يزامن Opportunities.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { EventTypes } from "@/platform/events/types";

const ActionEnum = z.enum(["assign", "transfer", "reassign", "unassign"]);

async function ctx() {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const ws = await getWorkspace();
  return { db: supabaseAdmin as any, ...ws };
}

async function requireAssignPermission(userId: string, orgId: string, db: any) {
  const { data } = await db.rpc("has_permission", {
    _user_id: userId,
    _org_id: orgId,
    _permission: "crm.leads.assign",
  });
  if (!data) throw new Error("ليس لديك صلاحية توزيع العملاء");
}

export async function performAssignment(params: {
  action: z.infer<typeof ActionEnum>;
  leadId: string;
  toUserId: string | null;
  reason?: string | null;
  strategy?: string;
  sendingAccountId?: string | null;
  sendWelcome?: boolean;
}) {
  const { db, organizationId, userId: actorId } = await ctx();
  await requireAssignPermission(actorId, organizationId, db);
  const { getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
  const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
  const access = await getWorkspaceAccess();

  const { data: lead, error: leadErr } = await db
    .from("crm_leads")
    .select("id, organization_id, owner_user_id, department_id, contact_id")
    .eq("id", params.leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (leadErr) throw new Error(leadErr.message);
  if (!lead) throw new Error("Lead غير موجود");
  if (!canAccessOpportunityRow(access, { owner_agent_id: lead.owner_user_id, department_id: lead.department_id })) {
    throw new Error("لا تملك صلاحية توزيع هذا العميل");
  }

  let targetMember: { user_id: string; department_id: string | null; is_active: boolean } | null = null;
  if (params.toUserId) {
    let memberQuery = db
      .from("org_department_members")
      .select("user_id, department_id, is_active")
      .eq("organization_id", organizationId)
      .eq("user_id", params.toUserId)
      .eq("is_active", true);
    if (lead.department_id) {
      memberQuery = memberQuery.eq("department_id", lead.department_id);
    }
    const { data: memberRows } = await memberQuery.limit(1);
    targetMember = memberRows?.[0] ?? null;
    if (!targetMember) throw new Error("المندوب غير موجود ضمن المؤسسة");
  }

  if (params.toUserId && (params.action === "assign" || params.action === "transfer") && params.sendingAccountId) {
    const { assertAccountEligibleForNewLead } = await import("@/modules/risk/eligibility.server");
    await assertAccountEligibleForNewLead(organizationId, params.sendingAccountId);
  }

  const effectiveDepartmentId = lead.department_id ?? targetMember?.department_id ?? null;


  const fromUserId = lead.owner_user_id ?? null;
  if (params.action === "transfer" || params.action === "reassign") {
    if (!fromUserId) throw new Error("لا يمكن النقل/إعادة التعيين لعميل غير معيّن. استخدم Assign.");
  }
  if (params.action === "assign" && fromUserId) {
    throw new Error("العميل معيّن مسبقاً. استخدم Transfer.");
  }

  // Pick opportunity to attach (first open one) — optional
  const { data: opp } = await db
    .from("opp_opportunities")
    .select("id, department_id")
    .eq("organization_id", organizationId)
    .eq("lead_id", lead.id)
    .is("outcome", null)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Update lead ownership → trigger syncs opportunities.
  const leadPatch: Record<string, string | null> = { owner_user_id: params.toUserId };
  if (!lead.department_id && effectiveDepartmentId) {
    leadPatch.department_id = effectiveDepartmentId;
  }

  const { error: updErr } = await db
    .from("crm_leads")
    .update(leadPatch)
    .eq("id", lead.id);
  if (updErr) throw new Error(updErr.message);

  if (opp?.id && effectiveDepartmentId && !opp.department_id) {
    await db
      .from("opp_opportunities")
      .update({ department_id: effectiveDepartmentId })
      .eq("id", opp.id)
      .eq("organization_id", organizationId);
  }

  // Insert history row
  const { data: assignment, error: asgErr } = await db
    .from("crm_lead_assignments")
    .insert({
      organization_id: organizationId,
      lead_id: lead.id,
      opportunity_id: opp?.id ?? null,
      from_user_id: fromUserId,
      to_user_id: params.toUserId,
      action: params.action,
      reason: params.reason ?? null,
      strategy: params.strategy ?? "manual",
      department_id: effectiveDepartmentId,
      assigned_by: actorId,
    })
    .select()
    .single();
  if (asgErr) throw new Error(asgErr.message);

  // Domain event (namespaced)
  const evtType =
    params.action === "assign" ? EventTypes.CrmLeadAssigned :
    params.action === "transfer" ? EventTypes.CrmLeadTransferred :
    params.action === "reassign" ? EventTypes.CrmLeadReassigned :
    EventTypes.CrmLeadUnassigned;
  await db.from("domain_events").insert({
    organization_id: organizationId,
    event_type: evtType,
    aggregate_type: "lead",
    aggregate_id: lead.id,
    actor_user_id: actorId,
    payload: {
      lead_id: lead.id,
      opportunity_id: opp?.id ?? null,
      from_user_id: fromUserId,
      to_user_id: params.toUserId,
      strategy: params.strategy ?? "manual",
      action: params.action,
    },
  });

  // Send welcome (best-effort) — only when we have a new owner.
  // Hard-capped so a slow WhatsApp gateway can never stall the assignment.
  if (params.toUserId && (params.sendWelcome ?? true)) {
    try {
      const { dispatchWelcomeForAssignment } = await import(
        "@/modules/crm/welcome-message.handler"
      );
      const dispatch = dispatchWelcomeForAssignment({
        organizationId,
        assignmentId: assignment.id,
        leadId: lead.id,
        toUserId: params.toUserId,
        sendingAccountId: params.sendingAccountId ?? null,
        actorUserId: actorId,
      });
      await Promise.race([
        dispatch,
        new Promise((resolve) => setTimeout(resolve, 12_000)),
      ]);
    } catch (e) {
      console.error("[welcome] dispatch failed", e);
    }
  }

  return { ok: true, assignmentId: assignment.id };
}

export const assignLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      leadId: z.string().uuid(),
      toUserId: z.string().uuid(),
      reason: z.string().max(500).optional(),
      strategy: z.string().max(50).default("manual"),
      sendingAccountId: z.string().uuid().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) =>
    performAssignment({
      action: "assign",
      leadId: data.leadId,
      toUserId: data.toUserId,
      reason: data.reason,
      strategy: data.strategy,
      sendingAccountId: data.sendingAccountId,
    }),
  );

export const transferLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      leadId: z.string().uuid(),
      toUserId: z.string().uuid(),
      reason: z.string().max(500),
      sendWelcome: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ data }) =>
    performAssignment({
      action: "transfer",
      leadId: data.leadId,
      toUserId: data.toUserId,
      reason: data.reason,
      sendWelcome: data.sendWelcome,
    }),
  );

export const reassignLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      leadId: z.string().uuid(),
      toUserId: z.string().uuid(),
      reason: z.string().max(500),
    }).parse(d),
  )
  .handler(async ({ data }) =>
    performAssignment({
      action: "reassign",
      leadId: data.leadId,
      toUserId: data.toUserId,
      reason: data.reason,
      sendWelcome: false,
    }),
  );

export const unassignLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      leadId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) =>
    performAssignment({
      action: "unassign",
      leadId: data.leadId,
      toUserId: null,
      reason: data.reason,
      sendWelcome: false,
    }),
  );

export const listAssignmentHistory = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { db, organizationId } = await ctx();
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const access = await requireAnyPermission(["crm.leads.view", "crm.leads.assign"]);
    const { data: lead } = await db
      .from("crm_leads")
      .select("owner_user_id, department_id")
      .eq("id", data.leadId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!lead || !canAccessOpportunityRow(access, { owner_agent_id: lead.owner_user_id, department_id: lead.department_id })) return [];
    const { data: rows, error } = await db
      .from("crm_lead_assignments")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("lead_id", data.leadId)
      .order("assigned_at", { ascending: false });
    if (error) throw new Error(error.message);
    const userIds = Array.from(
      new Set(
        (rows ?? [])
          .flatMap((r: any) => [r.from_user_id, r.to_user_id, r.assigned_by])
          .filter(Boolean),
      ),
    ) as string[];
    const { data: profs } = userIds.length
      ? await db.from("profiles").select("id, full_name").in("id", userIds)
      : { data: [] as Array<{ id: string; full_name: string | null }> };
    const nameMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
    return (rows ?? []).map((r: any) => ({
      ...r,
      from_user_name: r.from_user_id ? nameMap.get(r.from_user_id) ?? null : null,
      to_user_name: r.to_user_id ? nameMap.get(r.to_user_id) ?? null : null,
      assigned_by_name: r.assigned_by ? nameMap.get(r.assigned_by) ?? null : null,
    }));
  });

/**
 * Assign/transfer by opportunityId — resilient path used by the pipeline UI.
 * If the opportunity has no lead_id yet (legacy/seed rows), we find-or-create
 * a lead for its contact, link it back, and then run the standard assignment.
 */
export const quickAssignOpportunity = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      opportunityId: z.string().uuid(),
      toUserId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { db, organizationId } = await ctx();
    const { data: opp, error: oe } = await db
      .from("opp_opportunities")
      .select("id, lead_id, contact_id, owner_agent_id, department_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (oe) throw new Error(oe.message);
    if (!opp) throw new Error("الفرصة غير موجودة");
    if (!opp.contact_id) throw new Error("لا يوجد جهة اتصال مرتبطة بهذه الفرصة");

    let leadId: string | null = opp.lead_id;
    if (!leadId) {
      const { data: existing } = await db
        .from("crm_leads")
        .select("id, department_id")
        .eq("organization_id", organizationId)
        .eq("contact_id", opp.contact_id)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        leadId = existing.id;
      } else {
        const { data: nl, error: ne } = await db
          .from("crm_leads")
          .insert({
            organization_id: organizationId,
            contact_id: opp.contact_id,
            department_id: opp.department_id ?? null,
            owner_user_id: opp.owner_agent_id ?? null,
            source: "auto_from_opportunity",
          })
          .select("id")
          .single();
        if (ne) throw new Error(ne.message);
        leadId = nl.id;
      }
      await db
        .from("opp_opportunities")
        .update({ lead_id: leadId })
        .eq("id", opp.id)
        .eq("organization_id", organizationId);
    }

    if (!leadId) throw new Error("تعذر تجهيز Lead لهذه الفرصة");

    const action: "assign" | "transfer" = opp.owner_agent_id ? "transfer" : "assign";

    // Advance the opportunity to the next stage first (cheap + instant on the
    // board), then run the assignment which may talk to WhatsApp.
    const advanceStage = (async () => {
      try {
        const { data: cur } = await db
          .from("opp_opportunities")
          .select("id, pipeline_id, stage_id")
          .eq("id", data.opportunityId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (!cur?.pipeline_id || !cur?.stage_id) return;
        const { data: stages } = await db
          .from("crm_pipeline_stages")
          .select("id, ord")
          .eq("pipeline_id", cur.pipeline_id)
          .order("ord", { ascending: true });
        const idx = (stages ?? []).findIndex((s: any) => s.id === cur.stage_id);
        if (idx === 0 && stages && stages.length > 1) {
          await db
            .from("opp_opportunities")
            .update({
              stage_id: stages[1].id,
              stage: "contacted",
              first_response_at: new Date().toISOString(),
            })
            .eq("id", cur.id)
            .eq("organization_id", organizationId);
        }
      } catch (e) {
        console.error("[quickAssign] stage advance failed", e);
      }
    })();

    const [result] = await Promise.all([
      performAssignment({
        action,
        leadId,
        toUserId: data.toUserId,
        reason: data.reason ?? (action === "transfer" ? "نقل من واجهة القمع" : "إسناد من واجهة القمع"),
        sendWelcome: true,
      }),
      advanceStage,
    ]);

    return result;
  });
