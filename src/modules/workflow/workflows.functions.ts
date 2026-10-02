import { workflowAccess, ownWorkflow } from "./access.server";
import { validateWorkflowDefinition } from "./definition";
import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const listWorkflows = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db, canManage, access } = await workflowAccess(false);
  const { data, error } = await db
    .from("wf_workflows")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return { canManage, workflows: (data ?? []) as any[] };
});

export const getWorkflow = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { organizationId, db, canManage, access } = await workflowAccess(false);
    const { data: wf, error } = await db
      .from("wf_workflows")
      .select("*")
      .eq("id", data.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!wf) throw new Error("الأتمتة غير موجودة");
    return { workflow: wf as any, canManage };
  });

export const saveWorkflow = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(200),
        description: z.string().max(2000).optional(),
        is_active: z.boolean().default(false),
        trigger_type: z.enum(["event", "manual"]),
        trigger_config: z.record(z.string(), z.any()).default({}),
        definition: z.record(z.string(), z.any()),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { organizationId, db, canManage, access } = await workflowAccess(true);
    validateWorkflowDefinition(data.definition, data.is_active);
    if (data.trigger_type === "event" && !data.trigger_config.event)
      throw new Error("اختر حدثًا لتشغيل الأتمتة");
    const { ensureActionsRegistered, getAction } = await import("./actions/registry.server");
    await ensureActionsRegistered();
    for (const step of data.definition.steps ?? [])
      if (step.type === "action" && !getAction(step.action)) throw new Error("الإجراء غير مدعوم");
    const row: Record<string, any> = {
      organization_id: organizationId,
      name: data.name,
      description: data.description ?? null,
      is_active: data.is_active,
      trigger_type: data.trigger_type,
      trigger_config: data.trigger_config,
      definition: data.definition,
    };
    if (data.id) {
      await ownWorkflow(db, data.id, organizationId);
      const { error } = await db
        .from("wf_workflows")
        .update(row)
        .eq("id", data.id)
        .eq("organization_id", organizationId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    row.created_by = access.userId;
    const { data: created, error } = await db
      .from("wf_workflows")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id };
  });

export const toggleWorkflow = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { organizationId, db, canManage, access } = await workflowAccess(true);
    const wf = await ownWorkflow(db, data.id, organizationId);
    if (data.is_active) validateWorkflowDefinition(wf.definition, true);
    const { error } = await db
      .from("wf_workflows")
      .update({ is_active: data.is_active })
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWorkflow = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { organizationId, db, canManage, access } = await workflowAccess(true);
    await ownWorkflow(db, data.id, organizationId);
    const { count } = await db
      .from("wf_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("workflow_id", data.id)
      .in("status", ["running", "waiting"]);
    if (count) throw new Error("أوقف أو أكمل التشغيلات الجارية قبل حذف الأتمتة");
    const { error } = await db
      .from("wf_workflows")
      .delete()
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runWorkflowManually = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ id: z.string().uuid(), payload: z.record(z.string(), z.any()).default({}) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { organizationId, db, canManage, access } = await workflowAccess(true);
    await ownWorkflow(db, data.id, organizationId);
    const { startRun } = await import("./executor.server");
    const runId = await startRun({
      workflowId: data.id,
      organizationId,
      triggerPayload: data.payload,
    });
    const { data: result, error } = await db
      .from("wf_runs")
      .select("status,error")
      .eq("id", runId)
      .eq("organization_id", organizationId)
      .single();
    if (error) throw new Error("تعذر قراءة نتيجة التشغيل");
    return { runId, status: result.status, error: result.error };
  });

export const listRuns = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        workflowId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { organizationId, db, canManage, access } = await workflowAccess(false);
    if (data.workflowId) await ownWorkflow(db, data.workflowId, organizationId);
    let q = db
      .from("wf_runs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(data.limit);
    if (data.workflowId) q = q.eq("workflow_id", data.workflowId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { runs: (rows ?? []) as any[] };
  });

export const getRunDetail = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { organizationId, db, canManage, access } = await workflowAccess(false);
    const { data: run, error } = await db
      .from("wf_runs")
      .select("*")
      .eq("id", data.runId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error || !run) throw new Error("سجل التشغيل غير موجود أو لا تتبع مؤسستك");
    const { data: steps, error: stepsError } = await db
      .from("wf_run_steps")
      .select("*")
      .eq("run_id", data.runId)
      .eq("organization_id", organizationId)
      .order("step_index");
    if (stepsError) throw new Error("تعذر تحميل خطوات التشغيل");
    return { run: run as any, steps: (steps ?? []) as any[] };
  });

export const listActionsCatalog = createServerFn({ method: "GET" }).handler(async () => {
  await workflowAccess();
  const { ensureActionsRegistered, listActions } = await import("./actions/registry.server");
  await ensureActionsRegistered();
  return { actions: listActions() };
});

export const processWorkflowJobs = createServerFn({ method: "POST" }).handler(async () => {
  const { organizationId } = await workflowAccess(true);
  const { tickWorkflows } = await import("./jobs.server");
  return tickWorkflows(organizationId);
});
