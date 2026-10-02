import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

const EntityType = z.enum(["lead", "opportunity", "contact"]);

export const listTags = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  const { data, error } = await db
    .from("crm_tag_defs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const upsertTag = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(50),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#64748b"),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    if (data.id) {
      const { error } = await db
        .from("crm_tag_defs")
        .update({ name: data.name, color: data.color })
        .eq("id", data.id)
        .eq("organization_id", organizationId);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await db
      .from("crm_tag_defs")
      .insert({ organization_id: organizationId, name: data.name, color: data.color })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const deleteTag = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ tagId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { error } = await db
      .from("crm_tag_defs")
      .delete()
      .eq("id", data.tagId)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listEntityTags = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ entityType: EntityType, entityId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { data: links } = await db
      .from("crm_tag_links")
      .select("tag_id")
      .eq("organization_id", organizationId)
      .eq("entity_type", data.entityType)
      .eq("entity_id", data.entityId);
    const ids = (links ?? []).map((l: any) => l.tag_id);
    if (!ids.length) return [];
    const { data: tags } = await db.from("crm_tag_defs").select("*").in("id", ids);
    return tags ?? [];
  });

export const attachTag = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      tagId: z.string().uuid(),
      entityType: EntityType,
      entityId: z.string().uuid(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { error } = await db.from("crm_tag_links").upsert(
      {
        organization_id: organizationId,
        tag_id: data.tagId,
        entity_type: data.entityType,
        entity_id: data.entityId,
      },
      { onConflict: "tag_id,entity_type,entity_id" }
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const detachTag = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      tagId: z.string().uuid(),
      entityType: EntityType,
      entityId: z.string().uuid(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { error } = await db
      .from("crm_tag_links")
      .delete()
      .eq("organization_id", organizationId)
      .eq("tag_id", data.tagId)
      .eq("entity_type", data.entityType)
      .eq("entity_id", data.entityId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
