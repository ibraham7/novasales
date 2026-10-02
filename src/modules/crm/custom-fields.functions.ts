import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

const FieldType = z.enum([
  "text",
  "number",
  "date",
  "select",
  "multiselect",
  "boolean",
  "phone",
  "email",
]);
const Visibility = z.enum(["everyone", "agent", "supervisor", "admin", "owner"]);
const OptionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
});

export const listFieldDefs = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ entityType: z.string().trim().min(1).max(50) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { data: rows, error } = await db
      .from("crm_field_defs")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("entity_type", data.entityType)
      .order("ord", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const { getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
    const access = await getWorkspaceAccess();
    const { filterVisibleFields } = await import("./custom-fields.server");
    const role =
      access.isSuperAdmin ||
      access.roleKeys.some((r) => ["owner", "org_owner", "admin"].includes(r))
        ? "owner"
        : access.roleKeys.some((r) => ["supervisor", "department_supervisor"].includes(r))
          ? "supervisor"
          : "agent";
    return filterVisibleFields(rows ?? [], role) as any[];
  });

export const listAllFieldDefs = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  await requireAnyPermission(["org.manage", "rbac.manage"]);
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  const { data, error } = await db
    .from("crm_field_defs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("entity_type", { ascending: true })
    .order("ord", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const upsertFieldDef = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        entityType: z.string().trim().min(1).max(50),
        key: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(/^[a-z][a-z0-9_]*$/, "المفتاح: أحرف صغيرة وأرقام و _"),
        label: z.string().trim().min(1).max(200),
        fieldType: FieldType,
        fieldGroup: z.string().trim().min(1).max(60).default("General"),
        options: z.array(OptionSchema).default([]),
        defaultValue: z.any().optional(),
        validation: z
          .object({
            min: z.number().optional(),
            max: z.number().optional(),
            minLength: z.number().int().optional(),
            maxLength: z.number().int().optional(),
            regex: z.string().max(500).optional(),
          })
          .default({}),
        visibility: Visibility.default("everyone"),
        isRequired: z.boolean().default(false),
        readOnly: z.boolean().default(false),
        isSearchable: z.boolean().default(false),
        isFilterable: z.boolean().default(false),
        isActive: z.boolean().default(true),
        ord: z.number().int().default(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    await requireAnyPermission(["org.manage", "rbac.manage"]);
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
    const patch = {
      organization_id: organizationId,
      entity_type: data.entityType,
      key: data.key,
      label: data.label,
      field_type: data.fieldType,
      field_group: data.fieldGroup,
      options: data.options,
      default_value: data.defaultValue ?? null,
      validation: data.validation,
      visibility: data.visibility,
      is_required: data.isRequired,
      read_only: data.readOnly,
      is_searchable: data.isSearchable,
      is_filterable: data.isFilterable,
      is_active: data.isActive,
      ord: data.ord,
      created_by: userId,
    };
    if (data.id) {
      // Don't allow entity_type / key change on system fields
      const { data: existing } = await db
        .from("crm_field_defs")
        .select("system_field, entity_type, key")
        .eq("id", data.id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!existing) throw new Error("الحقل غير موجود في هذه المؤسسة");
      if (existing.system_field) {
        // Allow only label/options/validation/visibility/is_required/ord to change
        const safe: any = {
          label: patch.label,
          options: patch.options,
          validation: patch.validation,
          visibility: patch.visibility,
          is_required: patch.is_required,
          read_only: patch.read_only,
          ord: patch.ord,
          is_active: patch.is_active,
          default_value: patch.default_value,
          field_group: patch.field_group,
          is_searchable: patch.is_searchable,
          is_filterable: patch.is_filterable,
        };
        const { error } = await db
          .from("crm_field_defs")
          .update(safe)
          .eq("id", data.id)
          .eq("organization_id", organizationId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await db
          .from("crm_field_defs")
          .update(patch)
          .eq("id", data.id)
          .eq("organization_id", organizationId);
        if (error) throw new Error(error.message);
      }
      return { ok: true, id: data.id };
    }
    const { data: inserted, error } = await db
      .from("crm_field_defs")
      .insert(patch)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id };
  });

export const deleteFieldDef = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    await requireAnyPermission(["org.manage", "rbac.manage"]);
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { data: existing } = await db
      .from("crm_field_defs")
      .select("system_field")
      .eq("id", data.id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!existing) throw new Error("الحقل غير موجود");
    if (existing.system_field) throw new Error("لا يمكن حذف حقل نظامي");
    const { error } = await db
      .from("crm_field_defs")
      .delete()
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderFieldDefs = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        items: z.array(z.object({ id: z.string().uuid(), ord: z.number().int() })).min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    await requireAnyPermission(["org.manage", "rbac.manage"]);
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    for (const item of data.items) {
      await db
        .from("crm_field_defs")
        .update({ ord: item.ord })
        .eq("id", item.id)
        .eq("organization_id", organizationId);
    }
    return { ok: true };
  });
