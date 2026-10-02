import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const listWorkflows = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { organizationId } = await getWorkspace();
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("wf_workflows")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return { workflows: (data ?? []) as any[] };
});

export const getWorkflow = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const db = supabaseAdmin as any;
    const { data: wf, error } = await db
      .from("wf_workflows")
      .select("*")
      .eq("id", data.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { workflow: wf as any };
  });

export const saveWorkflow = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(200),
      description: z.string().max(2000).optional(),
      is_active: z.boolean().default(false),
      trigger_type: z.enum(["event", "schedule", "manual"]),
      trigger_config: z.record(z.string(), z.any()).default({}),
      definition: z.record(z.string(), z.any()),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId, userId } = await getWorkspace();
    const db = supabaseAdmin as any;
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
      const { error } = await db.from("wf_workflows").update(row).eq("id", data.id).eq("organization_id", organizationId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    row.created_by = userId;
    const { data: created, error } = await db.from("wf_workflows").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { id: created.id };
  });

export const toggleWorkflow = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const db = supabaseAdmin as any;
    const { error } = await db.from("wf_workflows").update({ is_active: data.is_active }).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWorkflow = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const db = supabaseAdmin as any;
    const { error } = await db.from("wf_workflows").delete().eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runWorkflowManually = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), payload: z.record(z.string(), z.any()).default({}) }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const { startRun } = await import("./executor.server");
    const runId = await startRun({ workflowId: data.id, organizationId, triggerPayload: data.payload });
    return { runId };
  });

export const listRuns = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ workflowId: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).default(50) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const db = supabaseAdmin as any;
    let q = db.from("wf_runs").select("*").eq("organization_id", organizationId).order("started_at", { ascending: false }).limit(data.limit);
    if (data.workflowId) q = q.eq("workflow_id", data.workflowId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { runs: (rows ?? []) as any[] };
  });

export const getRunDetail = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const db = supabaseAdmin as any;
    const [{ data: run }, { data: steps }] = await Promise.all([
      db.from("wf_runs").select("*").eq("id", data.runId).eq("organization_id", organizationId).maybeSingle(),
      db.from("wf_run_steps").select("*").eq("run_id", data.runId).order("step_index"),
    ]);
    return { run: run as any, steps: (steps ?? []) as any[] };
  });

export const listActionsCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const { ensureActionsRegistered, listActions } = await import("./actions/registry.server");
  await ensureActionsRegistered();
  return { actions: listActions() };
});
