import { supabaseAdmin } from "@/integrations/supabase/client.server";
const db = supabaseAdmin as any;
export async function guardActionTenant(config: Record<string, any>, ctx: any) {
  const refs: Record<string, string> = {
    lead_id: "crm_leads",
    opportunity_id: "opp_opportunities",
    contact_id: "crm_contacts",
    channel_account_id: "msg_channel_accounts",
    template_id: "cmp_templates",
    department_id: "org_departments",
  };
  const all = { ...ctx.triggerPayload, ...config };
  for (const [key, table] of Object.entries(refs)) {
    const id = all[key];
    if (!id) continue;
    const { data, error } = await db
      .from(table)
      .select("id")
      .eq("id", id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (error || !data) throw new Error("إحدى بيانات الإجراء لا تتبع هذه المؤسسة أو لم تعد متاحة");
  }
  for (const key of ["owner_user_id", "assignee_user_id"])
    if (config[key]) {
      const { data, error } = await db
        .from("org_memberships")
        .select("user_id")
        .eq("user_id", config[key])
        .eq("organization_id", ctx.organizationId)
        .eq("is_active", true)
        .maybeSingle();
      if (error || !data) throw new Error("المستخدم ليس عضوًا فعالًا في المؤسسة");
    }
  if (config.entity_id) {
    const tables: Record<string, string> = {
      lead: "crm_leads",
      opportunity: "opp_opportunities",
      contact: "crm_contacts",
    };
    const table = tables[String(config.entity_type)];
    if (!table) throw new Error("نوع السجل غير صحيح");
    const { data, error } = await db
      .from(table)
      .select("id")
      .eq("id", config.entity_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (error || !data) throw new Error("السجل لا يتبع المؤسسة");
  }
  if (config.stage_id) {
    const { data: stage, error } = await db
      .from("crm_pipeline_stages")
      .select("pipeline_id")
      .eq("id", config.stage_id)
      .maybeSingle();
    if (error || !stage) throw new Error("المرحلة غير موجودة");
    const { data: pipeline, error: pipelineError } = await db
      .from("crm_pipelines")
      .select("id")
      .eq("id", stage.pipeline_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (pipelineError || !pipeline) throw new Error("المرحلة لا تتبع هذه المؤسسة");
  }
  if (config.stage_id && all.opportunity_id) {
    const { data: opp } = await db
      .from("opp_opportunities")
      .select("pipeline_id")
      .eq("id", all.opportunity_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const { data: stage } = await db
      .from("crm_pipeline_stages")
      .select("pipeline_id")
      .eq("id", config.stage_id)
      .maybeSingle();
    if (!opp || !stage || opp.pipeline_id !== stage.pipeline_id)
      throw new Error("المرحلة لا تتبع مسار الفرصة");
  }
}
