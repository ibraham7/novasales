// Workflow executor. Loads run + workflow, advances one step at a time,
// records step logs, handles delay / wait_for_event / condition / action / end.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { WORKFLOW_MAX_STEPS, type WfDefinition, type WfStep } from "./types";
import { ensureActionsRegistered, getAction } from "./actions/registry.server";

const db = supabaseAdmin as any;

async function loadRun(runId: string) {
  const { data: run } = await db.from("wf_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) throw new Error("run not found");
  const { data: wf } = await db.from("wf_workflows").select("*").eq("id", run.workflow_id).maybeSingle();
  if (!wf) throw new Error("workflow not found");
  return { run, wf };
}

const findStep = (steps: WfStep[], id: string | null | undefined): WfStep | undefined =>
  steps.find((s) => s.id === id);

const firstStep = (steps: WfStep[]): WfStep | undefined => steps[0];

function evalCondition(expr: any, ctx: Record<string, unknown>): boolean {
  // Simple JSON-logic-like: { "eq": ["{{path}}", value] } or boolean
  if (typeof expr === "boolean") return expr;
  if (!expr || typeof expr !== "object") return true;
  const resolve = (v: any): any => {
    if (typeof v === "string") {
      const m = v.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
      if (m) {
        return m[1].split(".").reduce((acc: any, k) => (acc == null ? acc : acc[k]), ctx);
      }
    }
    return v;
  };
  if ("eq" in expr) { const [a, b] = expr.eq; return resolve(a) === resolve(b); }
  if ("neq" in expr) { const [a, b] = expr.neq; return resolve(a) !== resolve(b); }
  if ("truthy" in expr) return Boolean(resolve(expr.truthy));
  if ("and" in expr) return (expr.and as any[]).every((e) => evalCondition(e, ctx));
  if ("or" in expr) return (expr.or as any[]).some((e) => evalCondition(e, ctx));
  return true;
}

async function finish(runId: string, status: "completed" | "failed", error?: string) {
  await db.from("wf_runs").update({
    status,
    finished_at: new Date().toISOString(),
    next_step_id: null,
    error: error ?? null,
  }).eq("id", runId);
  const { data: r } = await db.from("wf_runs").select("organization_id, workflow_id").eq("id", runId).maybeSingle();
  if (r) {
    await db.from("domain_events").insert({
      organization_id: r.organization_id,
      event_type: status === "completed" ? "wf.run.finished" : "wf.run.failed",
      aggregate_type: "wf_run",
      aggregate_id: runId,
      payload: { workflow_id: r.workflow_id, error: error ?? null },
    });
  }
}

export async function advanceRun(runId: string): Promise<void> {
  await ensureActionsRegistered();
  const { run, wf } = await loadRun(runId);
  if (run.status !== "running") return;
  const def = (wf.definition ?? { steps: [] }) as WfDefinition;
  const steps = def.steps ?? [];
  if (!steps.length) { await finish(runId, "completed"); return; }

  let currentId: string | null = run.next_step_id ?? firstStep(steps)?.id ?? null;
  let stepCount: number = run.step_count ?? 0;
  const ctxObj = { trigger: run.context?.trigger ?? {}, ...(run.context?.data ?? {}) };

  while (currentId) {
    const step = findStep(steps, currentId);
    if (!step) { await finish(runId, "failed", `step_not_found:${currentId}`); return; }

    stepCount++;
    if (stepCount > WORKFLOW_MAX_STEPS) {
      await db.from("wf_runs").update({ step_count: stepCount }).eq("id", runId);
      await finish(runId, "failed", "max_steps_exceeded");
      return;
    }

    if (step.type === "end") {
      await db.from("wf_runs").update({ step_count: stepCount, next_step_id: null }).eq("id", runId);
      await finish(runId, "completed");
      return;
    }

    if (step.type === "delay") {
      const resumeAt = new Date(Date.now() + Math.max(1, step.duration_minutes) * 60_000).toISOString();
      await db.from("wf_jobs").insert({
        organization_id: run.organization_id,
        run_id: runId,
        wait_kind: "delay",
        resume_step_id: step.next ?? null,
        resume_at: resumeAt,
      });
      await db.from("wf_runs").update({ status: "waiting", step_count: stepCount, next_step_id: step.next ?? null }).eq("id", runId);
      await db.from("wf_run_steps").insert({
        organization_id: run.organization_id, run_id: runId, step_index: stepCount,
        step_id: step.id, step_type: step.type, status: "waiting", input: { minutes: step.duration_minutes }, output: {},
      });
      return;
    }

    if (step.type === "wait_for_event") {
      const resumeAt = new Date(Date.now() + Math.max(1, step.timeout_minutes) * 60_000).toISOString();
      await db.from("wf_jobs").insert({
        organization_id: run.organization_id,
        run_id: runId,
        wait_kind: "event",
        wait_match: { event: step.event, match: step.match ?? {} },
        resume_step_id: step.onEvent ?? step.next ?? null,
        timeout_step_id: step.onTimeout ?? null,
        resume_at: resumeAt,
      });
      await db.from("wf_runs").update({ status: "waiting", step_count: stepCount }).eq("id", runId);
      await db.from("wf_run_steps").insert({
        organization_id: run.organization_id, run_id: runId, step_index: stepCount,
        step_id: step.id, step_type: step.type, status: "waiting",
        input: { event: step.event, match: step.match ?? {}, timeout_minutes: step.timeout_minutes }, output: {},
      });
      return;
    }

    if (step.type === "condition") {
      const truthy = evalCondition(step.expr, ctxObj);
      await db.from("wf_run_steps").insert({
        organization_id: run.organization_id, run_id: runId, step_index: stepCount,
        step_id: step.id, step_type: step.type, status: "ok", input: { expr: step.expr }, output: { truthy },
      });
      currentId = (truthy ? step.onTrue : step.onFalse) ?? step.next ?? null;
      continue;
    }

    if (step.type === "action") {
      const handler = getAction(step.action);
      if (!handler) {
        await db.from("wf_run_steps").insert({
          organization_id: run.organization_id, run_id: runId, step_index: stepCount,
          step_id: step.id, step_type: step.type, action: step.action, status: "failed",
          input: step.config, output: {}, error: "unknown_action",
        });
        await finish(runId, "failed", `unknown_action:${step.action}`);
        return;
      }
      try {
        const result = await handler(step.config ?? {}, {
          organizationId: run.organization_id,
          runId,
          workflowId: run.workflow_id,
          triggerPayload: (run.context?.trigger ?? {}) as Record<string, unknown>,
          runContext: (run.context?.data ?? {}) as Record<string, unknown>,
        });
        await db.from("wf_run_steps").insert({
          organization_id: run.organization_id, run_id: runId, step_index: stepCount,
          step_id: step.id, step_type: step.type, action: step.action,
          status: result.ok ? "ok" : "failed", input: step.config, output: result.output ?? {}, error: result.error ?? null,
        });
        if (!result.ok) {
          await db.from("domain_events").insert({
            organization_id: run.organization_id,
            event_type: "wf.run.step_failed",
            aggregate_type: "wf_run", aggregate_id: runId,
            payload: { step_id: step.id, action: step.action, error: result.error },
          });
          await finish(runId, "failed", result.error);
          return;
        }
      } catch (e) {
        const msg = (e as Error).message;
        await db.from("wf_run_steps").insert({
          organization_id: run.organization_id, run_id: runId, step_index: stepCount,
          step_id: step.id, step_type: step.type, action: step.action,
          status: "failed", input: step.config, output: {}, error: msg,
        });
        await finish(runId, "failed", msg);
        return;
      }
      currentId = step.next ?? null;
      continue;
    }

    // unknown step type
    await finish(runId, "failed", `unknown_step_type:${(step as any).type}`);
    return;
  }

  await db.from("wf_runs").update({ step_count: stepCount, next_step_id: null }).eq("id", runId);
  await finish(runId, "completed");
}

export async function startRun(input: {
  workflowId: string;
  organizationId: string;
  triggerPayload?: Record<string, unknown>;
  triggerEventId?: string;
}): Promise<string> {
  const { data: run, error } = await db.from("wf_runs").insert({
    organization_id: input.organizationId,
    workflow_id: input.workflowId,
    status: "running",
    trigger_event_id: input.triggerEventId ?? null,
    context: { trigger: input.triggerPayload ?? {}, data: {} },
    step_count: 0,
  }).select("id").single();
  if (error) throw new Error(error.message);
  await db.from("domain_events").insert({
    organization_id: input.organizationId,
    event_type: "wf.run.started",
    aggregate_type: "wf_run",
    aggregate_id: run.id,
    payload: { workflow_id: input.workflowId },
  });
  await advanceRun(run.id);
  return run.id;
}

// Resume from a waiting job. jumpToStepId overrides the run's next_step_id.
export async function resumeRun(runId: string, jumpToStepId: string | null): Promise<void> {
  await db.from("wf_runs").update({ status: "running", next_step_id: jumpToStepId }).eq("id", runId);
  await advanceRun(runId);
}
