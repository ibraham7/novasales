import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listPipelines = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  const { data: pipes, error } = await db
    .from("crm_pipelines")
    .select("*")
    .eq("organization_id", organizationId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const ids = (pipes ?? []).map((p: any) => p.id);
  const { data: stages } = ids.length
    ? await db.from("crm_pipeline_stages").select("*").in("pipeline_id", ids).order("ord", { ascending: true })
    : { data: [] };
  const byPipe = new Map<string, any[]>();
  for (const s of stages ?? []) {
    const arr = byPipe.get(s.pipeline_id) ?? [];
    arr.push(s);
    byPipe.set(s.pipeline_id, arr);
  }
  return (pipes ?? []).map((p: any) => ({ ...p, stages: byPipe.get(p.id) ?? [] }));
});

export const getDefaultPipeline = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  const { data: p } = await db
    .from("crm_pipelines")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_default", true)
    .maybeSingle();
  if (!p) return null;
  const { data: stages } = await db
    .from("crm_pipeline_stages")
    .select("*")
    .eq("pipeline_id", p.id)
    .order("ord", { ascending: true });
  return { ...p, stages: stages ?? [] };
});

export const createPipeline = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ name: z.string().min(1).max(100), description: z.string().max(500).optional(), isDefault: z.boolean().optional() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
    if (data.isDefault) {
      await db.from("crm_pipelines").update({ is_default: false }).eq("organization_id", organizationId);
    }
    const { data: row, error } = await db
      .from("crm_pipelines")
      .insert({
        organization_id: organizationId,
        name: data.name,
        description: data.description,
        is_default: !!data.isDefault,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updatePipeline = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      pipelineId: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).nullable().optional(),
      isDefault: z.boolean().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    if (data.isDefault) {
      await db.from("crm_pipelines").update({ is_default: false }).eq("organization_id", organizationId);
    }
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.isDefault !== undefined) patch.is_default = data.isDefault;
    const { error } = await db.from("crm_pipelines").update(patch).eq("id", data.pipelineId).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePipeline = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ pipelineId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { data: p } = await db.from("crm_pipelines").select("is_default").eq("id", data.pipelineId).maybeSingle();
    if (p?.is_default) throw new Error("لا يمكن حذف القمع الافتراضي");
    const { error } = await db.from("crm_pipelines").delete().eq("id", data.pipelineId).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertStage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      pipelineId: z.string().uuid(),
      name: z.string().min(1).max(100),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#94a3b8"),
      ord: z.number().int().min(0).max(1000),
      probability: z.number().int().min(0).max(100).default(0),
      isWon: z.boolean().default(false),
      isLost: z.boolean().default(false),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const row = {
      pipeline_id: data.pipelineId,
      name: data.name,
      color: data.color,
      ord: data.ord,
      probability: data.probability,
      is_won: data.isWon,
      is_lost: data.isLost,
    };
    if (data.id) {
      const { error } = await db.from("crm_pipeline_stages").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: inserted, error } = await db.from("crm_pipeline_stages").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id };
  });

export const deleteStage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ stageId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { count } = await db
      .from("opp_opportunities")
      .select("*", { count: "exact", head: true })
      .eq("stage_id", data.stageId);
    if ((count ?? 0) > 0) throw new Error("لا يمكن حذف مرحلة تحتوي على فرص");
    const { error } = await db.from("crm_pipeline_stages").delete().eq("id", data.stageId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderStages = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      pipelineId: z.string().uuid(),
      order: z.array(z.object({ id: z.string().uuid(), ord: z.number().int().min(0) })),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    await Promise.all(
      data.order.map((r) => db.from("crm_pipeline_stages").update({ ord: r.ord }).eq("id", r.id).eq("pipeline_id", data.pipelineId))
    );
    return { ok: true };
  });

export const moveOpportunityToStage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ opportunityId: z.string().uuid(), stageId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
    const { data: stage } = await db
      .from("crm_pipeline_stages")
      .select("id, name, probability, is_won, is_lost, pipeline_id")
      .eq("id", data.stageId)
      .maybeSingle();
    if (!stage) throw new Error("المرحلة غير موجودة");
    const patch: Record<string, unknown> = {
      stage_id: stage.id,
      pipeline_id: stage.pipeline_id,
      probability: stage.probability,
    };
    if (stage.is_won) {
      patch.outcome = "won";
      patch.closed_at = new Date().toISOString();
      patch.stage = "won";
    } else if (stage.is_lost) {
      patch.outcome = "lost";
      patch.closed_at = new Date().toISOString();
      patch.stage = "lost";
    } else {
      patch.outcome = null;
      patch.closed_at = null;
    }
    const { data: opp, error } = await db
      .from("opp_opportunities")
      .update(patch)
      .eq("id", data.opportunityId)
      .select("id, contact_id, lead_id")
      .single();
    if (error) throw new Error(error.message);

    // Emit timeline event
    await db.from("crm_timeline").insert({
      organization_id: organizationId,
      entity_type: "opportunity",
      entity_id: opp.id,
      event_kind: "stage.changed",
      title: `تم النقل إلى المرحلة: ${stage.name}`,
      actor_user_id: userId,
      ref_type: "opportunity",
      ref_id: opp.id,
      metadata: { stage_id: stage.id, stage_name: stage.name },
    });
    await db.from("domain_events").insert({
      organization_id: organizationId,
      event_type: "crm.opportunity.stage_changed",
      aggregate_type: "opportunity",
      aggregate_id: opp.id,
      payload: { stage_id: stage.id },
    });
    return { ok: true };
  });
