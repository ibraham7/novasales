import { registerAction, type ActionHandler } from "./registry.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as any;

// crm.lead.assign — { lead_id, owner_user_id, department_id?, reason? }
const leadAssign: ActionHandler = async (config, ctx) => {
  const leadId = (config.lead_id ?? ctx.triggerPayload?.lead_id) as string | undefined;
  const ownerUserId = config.owner_user_id as string | undefined;
  if (!leadId || !ownerUserId) return { ok: false, error: "lead_id and owner_user_id required" };
  const { data: cur } = await db
    .from("crm_leads")
    .select("owner_user_id, department_id")
    .eq("id", leadId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  const fromUser = cur?.owner_user_id ?? null;
  const { error } = await db
    .from("crm_leads")
    .update({
      owner_user_id: ownerUserId,
      department_id: config.department_id ?? cur?.department_id ?? null,
    })
    .eq("id", leadId)
    .eq("organization_id", ctx.organizationId);
  if (error) return { ok: false, error: error.message };
  await db.from("crm_lead_assignments").insert({
    organization_id: ctx.organizationId,
    lead_id: leadId,
    from_user_id: fromUser,
    to_user_id: ownerUserId,
    action: fromUser ? "transfer" : "assign",
    reason: config.reason ?? "workflow",
    strategy: "workflow",
    department_id: config.department_id ?? cur?.department_id ?? null,
  });
  await db.from("domain_events").insert({
    organization_id: ctx.organizationId,
    event_type: fromUser ? "crm.lead.transferred" : "crm.lead.assigned",
    aggregate_type: "lead",
    aggregate_id: leadId,
    payload: { from_user_id: fromUser, to_user_id: ownerUserId, source: "workflow" },
  });
  return { ok: true, output: { lead_id: leadId, owner_user_id: ownerUserId } };
};

export function register() {
  registerAction("crm.lead.assign", leadAssign);
  registerAction("crm.lead.transfer", leadAssign);
}
