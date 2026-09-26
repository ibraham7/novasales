import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const EntityType = z.enum(["lead", "opportunity", "contact", "activity", "task"]);

export const listFiles = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ entityType: EntityType, entityId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { data: rows, error } = await db
      .from("crm_files")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("entity_type", data.entityType)
      .eq("entity_id", data.entityId)
      .order("created_at", { ascending: false });
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
      fileName: z.string().min(1).max(255),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
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
      fileName: z.string().min(1).max(255),
      mimeType: z.string().max(100).optional(),
      sizeBytes: z.number().int().min(0).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
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
      .select("storage_bucket, storage_path")
      .eq("id", data.fileId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (file) await db.storage.from(file.storage_bucket).remove([file.storage_path]);
    const { error } = await db.from("crm_files").delete().eq("id", data.fileId).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
