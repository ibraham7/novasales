import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resumeRun } from "./executor.server";
import { dispatchEvent } from "./dispatch.server";
import { tickWorkflowsCore } from "./tick-core";

const db = supabaseAdmin as any;

/** One round of the worker (see tick-core.ts for the rules). */
export async function tickWorkflows(organizationId?: string) {
  return tickWorkflowsCore({ db, dispatch: dispatchEvent, resume: resumeRun }, organizationId);
}
