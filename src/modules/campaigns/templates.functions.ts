import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { campaignAccess } from "./access.server";

export const listTemplates = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db, canManage } = await campaignAccess();
  const { data, error } = await db
    .from("cmp_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("تعذر حفظ أو تحميل القوالب؛ قد يكون القالب مستخدمًا في حملة");
  return { templates: (data ?? []) as any[], canManage };
});

export const saveTemplate = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1),
        media_url: z.string().url().optional().nullable(),
        variables: z.array(z.string()).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { organizationId, db, access } = await campaignAccess("manage");
    const userId = access.userId;
    const row: Record<string, any> = {
      organization_id: organizationId,
      name: data.name,
      body: data.body,
      media_url: data.media_url ?? null,
      variables: data.variables,
    };
    if (data.id) {
      const { error } = await db
        .from("cmp_templates")
        .update(row)
        .eq("id", data.id)
        .eq("organization_id", organizationId)
        .select("id")
        .single();
      if (error) throw new Error("تعذر حفظ أو تحميل القوالب؛ قد يكون القالب مستخدمًا في حملة");
      return { id: data.id };
    }
    row.created_by = userId;
    const { data: created, error } = await db
      .from("cmp_templates")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error("تعذر حفظ أو تحميل القوالب؛ قد يكون القالب مستخدمًا في حملة");
    return { id: created.id };
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { organizationId, db } = await campaignAccess("manage");
    const { error } = await db
      .from("cmp_templates")
      .delete()
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error("تعذر حفظ أو تحميل القوالب؛ قد يكون القالب مستخدمًا في حملة");
    return { ok: true };
  });

export const listTemplateVersions = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ templateId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { organizationId, db } = await campaignAccess();
    const { data: rows, error } = await db
      .from("cmp_template_versions")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("template_id", data.templateId)
      .order("version", { ascending: false });
    if (error) throw new Error("تعذر حفظ أو تحميل القوالب؛ قد يكون القالب مستخدمًا في حملة");
    return { versions: (rows ?? []) as any[] };
  });
