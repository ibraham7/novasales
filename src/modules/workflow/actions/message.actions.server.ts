import { registerAction } from "./registry.server";
import { createMessageActions } from "../send/message-actions";
import { realSenders } from "../send/senders.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Registers the message and staff-alert steps with the real database, senders and notifier. */
export function register() {
  const handlers = createMessageActions({
    db: supabaseAdmin as any,
    senders: realSenders,
    notify: async (input) => {
      const { notifyUsers } = await import("@/modules/notifications/notify.server");
      return notifyUsers(input);
    },
    managers: async (organizationId) => {
      const { resolveManagerIds } = await import("@/modules/notifications/notify.server");
      return resolveManagerIds(organizationId);
    },
  });
  for (const [name, handler] of Object.entries(handlers)) registerAction(name, handler);
}
