import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resumeRun } from "./executor.server";
import { dispatchEvent } from "./dispatch.server";
import { tickWorkflowsCore } from "./tick-core";

const db = supabaseAdmin as any;

/** One round of the worker (see tick-core.ts for the rules). */
export async function tickWorkflows(organizationId?: string) {
  const result = await tickWorkflowsCore({ db, dispatch: dispatchEvent, resume: resumeRun }, organizationId);
  // Held messages (outside the sending hours, over the day's limit…) go out when their time comes, through the gate again.
  // A problem here never hides what the round did.
  let messages: { sent: number; deferred: number; skipped: number; failed: number } | null = null;
  try {
    const { retryHeldMessages } = await import("./send/held.server");
    messages = await retryHeldMessages(organizationId);
  } catch (e) {
    console.error("[workflow] held messages failed", e instanceof Error ? e.message : e);
  }
  // Time-based triggers (stayed in a stage, no reply, stale, overdue task). A scan on the worker's own round is at most
  // once every 5 minutes; the manual «process now» button of one organization always scans.
  let time: { workflows: number; found: number; started: number; failed: number } | null = null;
  try {
    if (organizationId || Date.now() - lastTimeScan >= TIME_SCAN_EVERY_MS) {
      lastTimeScan = Date.now();
      const { scanTimeTriggers } = await import("./time-triggers");
      const { startRun } = await import("./executor.server");
      time = await scanTimeTriggers({ db, startRun }, organizationId);
    }
  } catch (e) {
    console.error("[workflow] time triggers failed", e instanceof Error ? e.message : e);
  }
  return { ...result, messages, time };
}

const TIME_SCAN_EVERY_MS = 5 * 60_000;
let lastTimeScan = 0;
