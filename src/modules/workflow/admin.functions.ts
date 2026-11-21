import { workflowAccess } from "./access.server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const MISSING = new Set(["42P01", "PGRST205"]);
const NEEDS_SQL = "شغّل ملفات SQL الخاصة بإعدادات الأتمتة في Supabase أولاً";

/** What the organization's send settings are (the OFF defaults when none were saved), and whether the SQL is installed. */
export const getAutomationSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db, canManage } = await workflowAccess(false);
  const { DEFAULT_SETTINGS } = await import("./send/gate");
  const { data, error } = await db.from("wf_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (error && !MISSING.has(error.code)) throw new Error(error.message);
  const installed = !error;
  const row = data ?? {};
  return {
    canManage,
    installed,
    settings: {
      sending_enabled: row.sending_enabled === true,
      alerts_enabled: row.alerts_enabled === true,
      timezone: row.timezone ?? DEFAULT_SETTINGS.timezone,
      send_window_start: row.send_window_start ?? DEFAULT_SETTINGS.send_window_start,
      send_window_end: row.send_window_end ?? DEFAULT_SETTINGS.send_window_end,
      daily_limit: row.daily_limit ?? DEFAULT_SETTINGS.daily_limit,
      gap_min_seconds: row.gap_min_seconds ?? DEFAULT_SETTINGS.gap_min_seconds,
      gap_max_seconds: row.gap_max_seconds ?? DEFAULT_SETTINGS.gap_max_seconds,
      defer_ttl_minutes: row.defer_ttl_minutes ?? DEFAULT_SETTINGS.defer_ttl_minutes,
      test_recipients: Array.isArray(row.test_recipients) ? (row.test_recipients as string[]) : [],
    },
  };
});

export const saveAutomationSettings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sending_enabled: z.boolean(),
        alerts_enabled: z.boolean(),
        timezone: z.string().trim().min(3).max(64),
        send_window_start: z.string().regex(HHMM, "ساعة البدء غير صحيحة"),
        send_window_end: z.string().regex(HHMM, "ساعة الانتهاء غير صحيحة"),
        daily_limit: z.number().int().min(1).max(2000),
        gap_min_seconds: z.number().int().min(0).max(3600),
        gap_max_seconds: z.number().int().min(0).max(3600),
        defer_ttl_minutes: z.number().int().min(5).max(10080),
        test_recipients: z.array(z.string().trim().min(5).max(120)).max(20).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { organizationId, db, access } = await workflowAccess(true);
    if (data.gap_min_seconds > data.gap_max_seconds) throw new Error("أقل فاصل بين الرسائل يجب ألا يزيد عن أطول فاصل");
    const { scheduleProblem } = await import("../campaigns/send-schedule");
    const problem = scheduleProblem({ dailyLimit: data.daily_limit, windowStart: data.send_window_start, windowEnd: data.send_window_end, timezone: data.timezone, ramp: null });
    if (problem) throw new Error(problem);
    const { error } = await db.from("wf_settings").upsert({ organization_id: organizationId, ...data, updated_by: access.userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
    if (error) throw new Error(MISSING.has(error.code) || error.code === "42703" || error.code === "PGRST204" ? NEEDS_SQL : error.message);
    return { ok: true };
  });

/** The latest automatic messages of the organization with their result and the reason. */
export const listMessageLog = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(1).max(200).default(50), status: z.enum(["sent", "skipped", "deferred", "failed", "sending"]).optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { organizationId, db } = await workflowAccess(false);
    let q = db.from("wf_message_log").select("id,workflow_id,opportunity_id,contact_id,channel,kind,to_address,status,reason_code,reason,body,not_before,created_at,sent_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) {
      if (MISSING.has(error.code)) return { installed: false, messages: [] as any[] };
      throw new Error(error.message);
    }
    const contactIds = [...new Set((rows ?? []).map((r: any) => r.contact_id).filter(Boolean))] as string[];
    const workflowIds = [...new Set((rows ?? []).map((r: any) => r.workflow_id).filter(Boolean))] as string[];
    const [contacts, workflows] = await Promise.all([
      contactIds.length ? db.from("crm_contacts").select("id,display_name,full_name").eq("organization_id", organizationId).in("id", contactIds) : { data: [] },
      workflowIds.length ? db.from("wf_workflows").select("id,name").eq("organization_id", organizationId).in("id", workflowIds) : { data: [] },
    ]);
    const nameOf = new Map<string, string>((contacts.data ?? []).map((c: any) => [c.id, c.display_name || c.full_name || ""]));
    const workflowName = new Map<string, string>((workflows.data ?? []).map((w: any) => [w.id, w.name]));
    return {
      installed: true,
      messages: (rows ?? []).map((r: any) => ({ ...r, contact_name: nameOf.get(r.contact_id) ?? null, workflow_name: workflowName.get(r.workflow_id) ?? null })) as any[],
    };
  });

/** Creates a workflow from a ready-made recipe. It is created SWITCHED OFF. */
export const createWorkflowFromRecipe = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ recipeId: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { organizationId, db, access } = await workflowAccess(true);
    const { RECIPES, recipeDefinition } = await import("./recipes");
    const recipe = RECIPES.find((r) => r.id === data.recipeId);
    if (!recipe) throw new Error("القالب غير موجود");
    const definition = recipeDefinition(recipe);
    const { validateWorkflowDefinition } = await import("./definition");
    const { validateMessageSteps } = await import("./send/message-config");
    const { validateTriggerConfig } = await import("./trigger-config");
    validateWorkflowDefinition(definition, false);
    const problem = validateMessageSteps(definition.steps) ?? validateTriggerConfig(recipe.trigger.type, recipe.trigger.config);
    if (problem) throw new Error(problem);
    const { ensureActionsRegistered, getAction } = await import("./actions/registry.server");
    await ensureActionsRegistered();
    for (const s of definition.steps) if (s.type === "action" && !getAction(s.action)) throw new Error("الإجراء غير مدعوم");
    const { data: created, error } = await db
      .from("wf_workflows")
      .insert({ organization_id: organizationId, name: recipe.title, description: recipe.description, is_active: false, trigger_type: recipe.trigger.type, trigger_config: recipe.trigger.config, definition, created_by: access.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });
