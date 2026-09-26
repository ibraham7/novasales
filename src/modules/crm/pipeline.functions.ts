import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listStages = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const { data } = await db.from("opp_stages").select("*").order("ord", { ascending: true });
  return data ?? [];
});

export const getPipelinePageMeta = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { organizationId } = await getWorkspace();
  const { data, error } = await (supabaseAdmin as any).rpc("get_pipeline_meta_fast", {
    _organization_id: organizationId,
  });
  if (error) throw new Error(error.message);
  return {
    pipelines: data?.pipelines ?? [],
    departments: data?.departments ?? [],
    members: data?.members ?? [],
  };
});

export const listOpportunitiesBoard = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({
      departmentId: z.string().uuid().optional(),
      ownerAgentId: z.string().uuid().optional(),
      /** يجلب كل التذاكر (وليس أحدث 500) — يُستخدم أثناء البحث */
      all: z.boolean().optional(),
    }).parse(d ?? {})
  )
  .handler(async ({ data }) => {

    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { getWorkspaceAccess, requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { getOpportunityVisibility } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    await requireAnyPermission(["crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]);
    const access = await getWorkspaceAccess();
    const visibility = getOpportunityVisibility(access);
    let ownerAgentId = data.ownerAgentId ?? null;
    let departmentIds: string[] | null = data.departmentId ? [data.departmentId] : null;

    if (visibility === "own") {
      ownerAgentId = access.userId;
      departmentIds = null;
    } else if (visibility === "department") {
      if (data.departmentId && !access.departmentIds.includes(data.departmentId)) return [];
      departmentIds = data.departmentId ? [data.departmentId] : access.departmentIds;
      if (departmentIds.length === 0) return [];
    }

    const { data: rows, error } = await db.rpc("get_pipeline_board_fast", {
      _organization_id: organizationId,
      _owner_agent_id: ownerAgentId,
      _department_ids: departmentIds,
      _limit: data.all ? 3000 : 500,
    });

    if (error) throw new Error(error.message);
    return rows ?? [];
  });



export const moveOpportunityStage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      opportunityId: z.string().uuid(),
      stage: z.string().min(1),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission, getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.move", "crm.opportunities.update", "opportunities.manage"]);
    const { data: current } = await db
      .from("opp_opportunities")
      .select("id, owner_agent_id, department_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!current || !canAccessOpportunityRow(access ?? (await getWorkspaceAccess()), current)) throw new Error("لا تملك صلاحية تعديل هذه الفرصة");
    const { data: stage } = await db.from("opp_stages").select("key, is_terminal, won").eq("key", data.stage).maybeSingle();
    if (!stage) throw new Error("مرحلة غير معروفة");
    const patch: Record<string, unknown> = { stage: data.stage };
    if (stage.is_terminal) {
      patch.outcome = stage.won ? "won" : "lost";
      patch.closed_at = new Date().toISOString();
    } else {
      patch.outcome = null;
      patch.closed_at = null;
    }
    const { error } = await db.from("opp_opportunities").update(patch).eq("id", data.opportunityId);
    if (error) throw new Error(error.message);
    await db.from("domain_events").insert({
      organization_id: organizationId,
      event_type: "crm.opportunity.stage_changed",
      aggregate_type: "opportunity",
      aggregate_id: data.opportunityId,
      payload: { stage: data.stage },
    });
    return { ok: true };
  });
