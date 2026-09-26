// Event dispatcher: given a domain event, find matching active workflows and waiting jobs.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { startRun, resumeRun } from "./executor.server";

const db = supabaseAdmin as any;

function matchesFilter(match: Record<string, any>, payload: Record<string, any>): boolean {
  for (const [k, v] of Object.entries(match ?? {})) {
    if (v == null) continue;
    // Support {{path}} references inside match
    let expected: any = v;
    if (typeof v === "string") {
      const m = v.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
      if (m) expected = m[1].split(".").reduce((acc: any, key) => (acc == null ? acc : acc[key]), payload);
    }
    if (payload?.[k] !== expected) return false;
  }
  return true;
}

export async function dispatchEvent(evt: {
  id?: string;
  organizationId: string;
  type: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  // 1) Start new runs for matching workflows
  const { data: wfs } = await db
    .from("wf_workflows")
    .select("id, trigger_config")
    .eq("organization_id", evt.organizationId)
    .eq("is_active", true)
    .eq("trigger_type", "event");
  for (const wf of (wfs ?? []) as any[]) {
    const cfg = wf.trigger_config ?? {};
    if (cfg.event !== evt.type) continue;
    if (cfg.match && !matchesFilter(cfg.match, evt.payload as any)) continue;
    try {
      await startRun({
        workflowId: wf.id,
        organizationId: evt.organizationId,
        triggerPayload: evt.payload,
        triggerEventId: evt.id,
      });
    } catch (e) {
      console.error("[wf.dispatch] startRun failed", e);
    }
  }

  // 2) Resume waiting jobs
  const { data: jobs } = await db
    .from("wf_jobs")
    .select("*")
    .eq("organization_id", evt.organizationId)
    .eq("status", "pending")
    .eq("wait_kind", "event");
  for (const job of (jobs ?? []) as any[]) {
    const wm = job.wait_match ?? {};
    if (wm.event !== evt.type) continue;
    if (wm.match && !matchesFilter(wm.match, evt.payload as any)) continue;
    // Claim
    const { data: claimed } = await db
      .from("wf_jobs")
      .update({ status: "done", claimed_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    try {
      await resumeRun(job.run_id, job.resume_step_id ?? null);
    } catch (e) {
      console.error("[wf.dispatch] resumeRun failed", e);
    }
  }
}
