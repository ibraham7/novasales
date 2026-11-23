import { registerAction } from "./registry.server";
import { createCalendarActions } from "./calendar.actions";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export function register() {
  for (const [name, handler] of Object.entries(createCalendarActions({ db: supabaseAdmin as any }))) registerAction(name, handler);
}
