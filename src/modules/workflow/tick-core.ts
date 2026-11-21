/**
 * One round of the automation worker: first the waiting events, then the jobs that are due. The database and
 * the two things that really act (dispatching an event, resuming a run) are passed in, so the rules below are
 * tested without a database and without running anything.
 *
 * An event older than STALE_EVENT_MS is never run: it is marked as skipped. That keeps a switched-on worker
 * from firing automations on tickets that moved weeks ago, which is what a backlog of old events would do.
 */
export const STALE_EVENT_MS = 6 * 60 * 60 * 1000;
export const STALE_EVENT_NOTE = "حدث قديم تخطّته الأتمتة";
const BATCH = 100;

export type TickDeps = {
  db: any;
  dispatch: (event: { id: string; organizationId: string; type: string; payload: Record<string, unknown> }) => Promise<void>;
  resume: (runId: string, stepId: string | null) => Promise<void>;
  now?: Date;
};

export type TickResult = { processed: number; failed: number; skipped: number };

/** Marks every pending event older than the limit as skipped (without running it); returns how many. */
export async function skipStaleEvents(deps: TickDeps, organizationId?: string): Promise<number> {
  const cutoff = new Date((deps.now ?? new Date()).getTime() - STALE_EVENT_MS).toISOString();
  let q = deps.db
    .from("domain_events")
    .update({ workflow_status: "done", workflow_error: STALE_EVENT_NOTE })
    .eq("workflow_status", "pending")
    .lt("created_at", cutoff);
  if (organizationId) q = q.eq("organization_id", organizationId);
  const { data, error } = await q.select("id");
  if (error) throw new Error("تعذر تخطّي الأحداث القديمة");
  return (data ?? []).length;
}

export async function tickWorkflowsCore(deps: TickDeps, organizationId?: string): Promise<TickResult> {
  const { db } = deps;
  const now = (deps.now ?? new Date()).toISOString();
  let processed = 0;
  let failed = 0;
  const skipped = await skipStaleEvents(deps, organizationId);

  let eventsQ = db.from("domain_events").select("*").eq("workflow_status", "pending").order("created_at").order("id").limit(BATCH);
  if (organizationId) eventsQ = eventsQ.eq("organization_id", organizationId);
  const { data: events, error: eventError } = await eventsQ;
  if (eventError) throw new Error("تعذر تحميل أحداث الأتمتة");
  for (const event of events ?? []) {
    const { data: claim, error } = await db
      .from("domain_events")
      .update({ workflow_status: "processing" })
      .eq("id", event.id)
      .eq("workflow_status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw new Error("تعذر حجز حدث الأتمتة");
    if (!claim) continue;
    try {
      if (event.organization_id)
        await deps.dispatch({
          id: event.id,
          organizationId: event.organization_id,
          type: event.event_type,
          payload: {
            ...event.payload,
            ...(event.aggregate_id && event.aggregate_type ? { [`${event.aggregate_type}_id`]: event.aggregate_id } : {}),
          },
        });
      await db.from("domain_events").update({ workflow_status: "done" }).eq("id", event.id);
      processed++;
    } catch (e) {
      await db.from("domain_events").update({ workflow_status: "failed", workflow_error: (e as Error).message }).eq("id", event.id);
      failed++;
    }
  }

  let jobsQ = db.from("wf_jobs").select("*").eq("status", "pending").lte("resume_at", now).order("resume_at").order("id").limit(BATCH);
  if (organizationId) jobsQ = jobsQ.eq("organization_id", organizationId);
  const { data: jobs, error } = await jobsQ;
  if (error) throw new Error("تعذر تحميل المهام المؤجلة");
  for (const job of jobs ?? []) {
    const { data: claimed, error: claimError } = await db
      .from("wf_jobs")
      .update({ status: "processing", claimed_at: now })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error("تعذر حجز المهمة المؤجلة");
    if (!claimed) continue;
    try {
      await deps.resume(job.run_id, job.wait_kind === "event" ? job.timeout_step_id : job.resume_step_id);
      await db.from("wf_jobs").update({ status: "done" }).eq("id", job.id);
      processed++;
    } catch (e) {
      await db.from("wf_jobs").update({ status: "failed", error: (e as Error).message }).eq("id", job.id);
      failed++;
    }
  }
  return { processed, failed, skipped };
}
