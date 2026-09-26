import { registerAction, type ActionHandler } from "./registry.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as any;

// platform.event.emit — { type, payload?, aggregate_type?, aggregate_id? }
const eventEmit: ActionHandler = async (config, ctx) => {
  const type = String(config.type ?? "");
  if (!type) return { ok: false, error: "type required" };
  const { error } = await db.from("domain_events").insert({
    organization_id: ctx.organizationId,
    event_type: type,
    aggregate_type: config.aggregate_type ?? null,
    aggregate_id: config.aggregate_id ?? null,
    payload: config.payload ?? {},
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, output: { emitted: type } };
};

export function register() {
  registerAction("platform.event.emit", eventEmit);
}
