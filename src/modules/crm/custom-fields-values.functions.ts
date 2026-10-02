import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

const ENTITY_TABLES: Record<string, string> = {
  lead: "crm_leads",
  opportunity: "opp_opportunities",
  contact: "crm_contacts",
};

export const updateEntityCustomFields = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      entityType: z.string().trim().min(1).max(50),
      entityId: z.string().uuid(),
      customFields: z.record(z.any()),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const table = ENTITY_TABLES[data.entityType];
    if (!table) throw new Error(`الكيان "${data.entityType}" غير مدعوم`);
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { validateAndApplyCustomFields } = await import("./custom-fields.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { data: existing } = await db
      .from(table)
      .select("custom_fields")
      .eq("id", data.entityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!existing) throw new Error("العنصر غير موجود");
    const merged = await validateAndApplyCustomFields(
      organizationId,
      data.entityType,
      data.customFields,
      { existing: existing.custom_fields ?? {} },
    );
    const { error } = await db
      .from(table)
      .update({ custom_fields: merged })
      .eq("id", data.entityId)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true, customFields: merged as Record<string, any> };
  });

export const getEntityCustomFields = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({
      entityType: z.string().trim().min(1).max(50),
      entityId: z.string().uuid(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const table = ENTITY_TABLES[data.entityType];
    if (!table) throw new Error(`الكيان "${data.entityType}" غير مدعوم`);
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { data: row } = await db
      .from(table)
      .select("custom_fields")
      .eq("id", data.entityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    return (row?.custom_fields ?? {}) as Record<string, any>;
  });
