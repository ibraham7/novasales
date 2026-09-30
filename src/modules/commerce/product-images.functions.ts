import { createServerFn } from "@tanstack/react-start";
import { ProductUploadInput } from "./product-input";
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};
// Keep the existing export for callers; signed uploads now support product videos too.
export const createProductImageUpload = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ProductUploadInput.parse(input))
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId } = await requirePermission("products.manage");
    const bucket = data.contentType.startsWith("video/") ? "product-videos" : "product-images";
    const path = `${organizationId}/${crypto.randomUUID()}.${extensions[data.contentType]}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !signed?.token) throw new Error(error?.message ?? "تعذر إنشاء رابط رفع الوسائط");
    return { bucket, path, token: signed.token };
  });
