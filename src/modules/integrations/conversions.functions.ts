import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { PRIMARY_GOALS, validateConversionRules } from "./conversion-model";
async function context() {
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const access = await requireAnyPermission(["crm.pipelines.manage", "org.manage"]);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { organizationId: access.organizationId, db: supabaseAdmin as any };
}
export const getConversionConfiguration = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db } = await context();
  const results = await Promise.all([
    db
      .from("crm_conversion_settings")
      .select("primary_goal,recording_enabled")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    db
      .from("crm_conversion_stage_rules")
      .select("stage_id,classification")
      .eq("organization_id", organizationId),
    db
      .from("crm_pipelines")
      .select("id,name,crm_pipeline_stages(id,name,is_won,is_lost,ord)")
      .eq("organization_id", organizationId)
      .order("created_at"),
  ]);
  for (const result of results) if (result.error) throw new Error(result.error.message);
  return {
    configured: !!results[0].data,
    settings: results[0].data ?? { primary_goal: "qualified_lead", recording_enabled: true },
    rules: results[1].data ?? [],
    pipelines: results[2].data ?? [],
  };
});
export const saveConversionConfiguration = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        primaryGoal: z.enum(PRIMARY_GOALS),
        recordingEnabled: z.boolean(),
        rules: z
          .array(
            z.object({
              stageId: z.string().uuid(),
              classification: z.enum([
                "none",
                "new_lead",
                "qualified_lead",
                "booking",
                "purchase",
                "lost",
              ]),
            }),
          )
          .max(500),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { organizationId, db } = await context();
    validateConversionRules(data.rules);
    const { error } = await db.rpc("save_crm_conversion_configuration", {
      _organization_id: organizationId,
      _goal: data.primaryGoal,
      _enabled: data.recordingEnabled,
      _rules: data.rules,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const listConversionEvents = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z
      .object({
        page: z.number().int().min(1).default(1),
        kind: z
          .enum(["all", "none", "new_lead", "qualified_lead", "booking", "purchase", "lost"])
          .default("all"),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data }) => {
    const { organizationId, db } = await context();
    let query = db
      .from("crm_conversion_events")
      .select(
        "id,opportunity_id,stage_name,event_kind,primary_goal,is_first_for_goal,value,currency,delivery_state,occurred_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId);
    if (data.kind !== "all") query = query.eq("event_kind", data.kind);
    const {
      data: rows,
      error,
      count,
    } = await query
      .order("occurred_at", { ascending: false })
      .order("id")
      .range((data.page - 1) * 25, data.page * 25 - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });
