import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CreateUploadInput = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ]),
});

function extensionFromMime(
  mime: string,
) {
  switch (mime) {
    case "image/png":
      return "png";

    case "image/webp":
      return "webp";

    case "image/gif":
      return "gif";

    case "image/jpeg":
    default:
      return "jpg";
  }
}

export const createProductImageUpload =
  createServerFn({
    method: "POST",
  })
    .validator((input: unknown) =>
      CreateUploadInput.parse(input),
    )
    .handler(async ({ data }) => {
      const {
        requirePermission,
      } = await import(
        "@/platform/rbac/rbac.server"
      );

      const {
        supabaseAdmin,
      } = await import(
        "@/integrations/supabase/client.server"
      );

      const {
        organizationId,
      } =
        await requirePermission(
          "products.manage",
        );

      const extension =
        extensionFromMime(
          data.contentType,
        );

      const fileId =
        crypto.randomUUID();

      const path =
        `${organizationId}/${fileId}.${extension}`;

      const {
        data: signed,
        error,
      } =
        await supabaseAdmin.storage
          .from(
            "product-images",
          )
          .createSignedUploadUrl(
            path,
            {
              upsert: false,
            },
          );

      if (
        error ||
        !signed?.token
      ) {
        throw new Error(
          error?.message ??
            "تعذر إنشاء رابط رفع الصورة",
        );
      }

      return {
        bucket:
          "product-images",

        path,

        token:
          signed.token,
      };
    });