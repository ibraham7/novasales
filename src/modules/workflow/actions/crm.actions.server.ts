import { registerAction, type ActionHandler } from "./registry.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as any;

const resolveLeadId = (config: Record<string, unknown>, ctx: any): string | undefined =>
  (config.lead_id as string | undefined) ?? (ctx.triggerPayload?.lead_id as string | undefined);
const resolveOppId = (config: Record<string, unknown>, ctx: any): string | undefined =>
  (config.opportunity_id as string | undefined) ?? (ctx.triggerPayload?.opportunity_id as string | undefined);

const leadUpdateFields: ActionHandler = async (config, ctx) => {
  const leadId = resolveLeadId(config, ctx);
  if (!leadId) return { ok: false, error: "lead_id required" };
  const patch: Record<string, unknown> = {};
  if (config.status) patch.status = config.status;
  if (config.notes) patch.notes = config.notes;
  if (config.custom_fields) patch.custom_fields = config.custom_fields;
  const { error } = await db.from("crm_leads").update(patch).eq("id", leadId).eq("organization_id", ctx.organizationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, output: { lead_id: leadId } };
};

const oppMoveStage: ActionHandler = async (config, ctx) => {
  const oppId = resolveOppId(config, ctx);
  if (!oppId) return { ok: false, error: "opportunity_id required" };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (config.stage_id) patch.stage_id = config.stage_id;
  if (config.stage_key) patch.stage = config.stage_key;
  const { error } = await db.from("opp_opportunities").update(patch).eq("id", oppId).eq("organization_id", ctx.organizationId);
  if (error) return { ok: false, error: error.message };
  await db.from("domain_events").insert({
    organization_id: ctx.organizationId,
    event_type: "crm.opportunity.stage_changed",
    aggregate_type: "opportunity",
    aggregate_id: oppId,
    payload: { stage_id: config.stage_id ?? null, stage: config.stage_key ?? null, source: "workflow" },
  });
  return { ok: true, output: { opportunity_id: oppId } };
};

const taskCreate: ActionHandler = async (config, ctx) => {
  const row: Record<string, unknown> = {
    organization_id: ctx.organizationId,
    title: String(config.title ?? "Task"),
    description: config.description ?? null,
    priority: config.priority ?? "normal",
    status: "open",
    due_at: config.due_at ?? null,
    assignee_user_id: config.assignee_user_id ?? null,
    entity_type: config.entity_type ?? null,
    entity_id: config.entity_id ?? null,
  };
  const { data, error } = await db.from("crm_tasks").insert(row).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, output: { task_id: data.id } };
};

const noteAdd: ActionHandler = async (config, ctx) => {
  const oppId = resolveOppId(config, ctx);
  if (!oppId) return { ok: false, error: "opportunity_id required" };
  const { data, error } = await db.from("opp_notes").insert({
    organization_id: ctx.organizationId,
    opportunity_id: oppId,
    body: String(config.body ?? ""),
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, output: { note_id: data.id } };
};

export function register() {
  registerAction("crm.lead.update_fields", leadUpdateFields);
  registerAction("crm.opportunity.move_stage", oppMoveStage);
  registerAction("crm.task.create", taskCreate);
  registerAction("crm.note.add", noteAdd);
}
