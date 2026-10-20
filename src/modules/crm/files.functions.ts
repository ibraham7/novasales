import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

const EntityType = z.enum(["lead", "opportunity", "contact", "activity", "task"]);

/** Files follow their record: a member reaches an opportunity's or contact's files only within their scope. */
async function assertEntityAccess(db: any, entityType: string, entityId: string) {
  const { getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
  const access = await getWorkspaceAccess();
  if (entityType === "opportunity") {
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const { data: opp, error } = await db
      .from("opp_opportunities")
      .select("id, owner_agent_id, department_id")
      .eq("id", entityId)
      .eq("organization_id", access.organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!opp || !canAccessOpportunityRow(access, opp)) throw new Error("الفرصة غير موجودة أو غير مسموح بالوصول إليها");
  } else if (entityType === "contact") {
    const { assertContactVisible } = await import("./contacts.server");
    await assertContactVisible(db, access, entityId);
  }
  return access;
}

export const listFiles = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ entityType: EntityType, entityId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    // The access check and the file list are independent reads: one parallel round.
    const [, { data: rows, error }] = await Promise.all([
      assertEntityAccess(db, data.entityType, data.entityId),
      db
        .from("crm_files")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("entity_type", data.entityType)
        .eq("entity_id", data.entityId)
        .order("created_at", { ascending: false }),
    ]);
    if (error) throw new Error(error.message);
    // Sign short-lived URLs
    const withUrls = await Promise.all(
      (rows ?? []).map(async (f: any) => {
        const { data: signed } = await db.storage.from(f.storage_bucket).createSignedUrl(f.storage_path, 3600);
        return { ...f, signed_url: signed?.signedUrl ?? null };
      })
    );
    return withUrls;
  });

export const createUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      entityType: EntityType,
      entityId: z.string().uuid(),
      fileName: z.string().trim().min(1).max(255),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    await assertEntityAccess(db, data.entityType, data.entityId);
    // Supabase Storage keys must be ASCII-safe. Sanitize filename while keeping the extension.
    const dot = data.fileName.lastIndexOf(".");
    const rawBase = dot > 0 ? data.fileName.slice(0, dot) : data.fileName;
    const rawExt = dot > 0 ? data.fileName.slice(dot + 1) : "";
    const safeBase =
      rawBase
        .normalize("NFKD")
        .replace(/[^\w.\-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60) || "file";
    const safeExt = rawExt.replace(/[^A-Za-z0-9]+/g, "").slice(0, 10).toLowerCase();
    const safeName = safeExt ? `${safeBase}.${safeExt}` : safeBase;
    const path = `${organizationId}/${data.entityType}/${data.entityId}/${crypto.randomUUID()}-${safeName}`;
    const { data: signed, error } = await db.storage.from("crm-files").createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: signed?.token, signedUrl: signed?.signedUrl };
  });

export const registerFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      entityType: EntityType,
      entityId: z.string().uuid(),
      storagePath: z.string(),
      fileName: z.string().trim().min(1).max(255),
      mimeType: z.string().max(100).optional(),
      sizeBytes: z.number().int().min(0).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
    await assertEntityAccess(db, data.entityType, data.entityId);
    // Only a path issued by createUploadUrl for this same record can be registered.
    if (!data.storagePath.startsWith(`${organizationId}/${data.entityType}/${data.entityId}/`))
      throw new Error("مسار الملف غير صالح");
    const { data: row, error } = await db
      .from("crm_files")
      .insert({
        organization_id: organizationId,
        entity_type: data.entityType,
        entity_id: data.entityId,
        storage_bucket: "crm-files",
        storage_path: data.storagePath,
        file_name: data.fileName,
        mime_type: data.mimeType,
        size_bytes: data.sizeBytes,
        uploaded_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ fileId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { data: file } = await db
      .from("crm_files")
      .select("storage_bucket, storage_path, entity_type, entity_id")
      .eq("id", data.fileId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!file) throw new Error("الملف غير موجود");
    await assertEntityAccess(db, file.entity_type, file.entity_id);
    if (file) await db.storage.from(file.storage_bucket).remove([file.storage_path]);
    const { error } = await db.from("crm_files").delete().eq("id", data.fileId).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
