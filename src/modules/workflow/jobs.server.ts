import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resumeRun } from "./executor.server";
import { dispatchEvent } from "./dispatch.server";
const db = supabaseAdmin as any;
export async function tickWorkflows(organizationId?: string) {
  const now = new Date().toISOString();
  let processed = 0,
    failed = 0;
  let eventsQ = db
    .from("domain_events")
    .select("*")
    .eq("workflow_status", "pending")
    .order("created_at")
    .order("id")
    .limit(100);
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
        await dispatchEvent({
          id: event.id,
          organizationId: event.organization_id,
          type: event.event_type,
          payload: {
            ...event.payload,
            ...(event.aggregate_id && event.aggregate_type
              ? { [`${event.aggregate_type}_id`]: event.aggregate_id }
              : {}),
          },
        });
      await db.from("domain_events").update({ workflow_status: "done" }).eq("id", event.id);
      processed++;
    } catch (e) {
      await db
        .from("domain_events")
        .update({ workflow_status: "failed", workflow_error: (e as Error).message })
        .eq("id", event.id);
      failed++;
    }
  }
  let jobsQ = db
    .from("wf_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("resume_at", now)
    .order("resume_at")
    .order("id")
    .limit(100);
  if (organizationId) jobsQ = jobsQ.eq("organization_id", organizationId);
  const { data: jobs, error } = await jobsQ;
  if (error) throw new Error("تعذر تحميل المهام المؤجلة");
  for (const job of jobs ?? []) {
    const { data: claimed, error } = await db
      .from("wf_jobs")
      .update({ status: "processing", claimed_at: now })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw new Error("تعذر حجز المهمة المؤجلة");
    if (!claimed) continue;
    try {
      await resumeRun(
        job.run_id,
        job.wait_kind === "event" ? job.timeout_step_id : job.resume_step_id,
      );
      await db.from("wf_jobs").update({ status: "done" }).eq("id", job.id);
      processed++;
    } catch (e) {
      await db
        .from("wf_jobs")
        .update({ status: "failed", error: (e as Error).message })
        .eq("id", job.id);
      failed++;
    }
  }
  return { processed, failed };
}
