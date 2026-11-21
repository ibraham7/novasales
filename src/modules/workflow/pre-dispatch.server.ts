import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { preDispatch, type PreEvent } from "./pre-dispatch";

const db = supabaseAdmin as any;

/** The real thing behind pre-dispatch: the stop list is the one the outbound campaigns use. */
export function runPreDispatch(evt: PreEvent) {
  return preDispatch(
    {
      db,
      suppress: async (organizationId, phone, reason) => {
        const { addSuppression } = await import("@/modules/marketing/outbound-core");
        await addSuppression(db, organizationId, `+${phone}`, { source: "keyword", reason });
      },
    },
    evt,
  );
}
