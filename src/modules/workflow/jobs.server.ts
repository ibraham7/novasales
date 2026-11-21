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
  return { ...result, messages };
}
