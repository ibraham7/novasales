/** The worker's second job: sends the held messages whose time has come (each one passes the gate again). */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { retryDeferred } from "./send-core";
import { realSenders } from "./senders.server";

export function retryHeldMessages(organizationId?: string) {
  return retryDeferred({ db: supabaseAdmin as any, senders: realSenders }, 50, organizationId);
}
