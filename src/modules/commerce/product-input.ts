import { z } from "@/lib/validation";
import { CURRENCY_CODES } from "./currencies";
const mediaUrl = z
  .string()
  .url("رابط الوسائط غير صالح")
  .refine((v) => /^https?:\/\//i.test(v), "استخدم رابط HTTP أو HTTPS مباشرًا");
export const ProductInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "اسم المنتج مطلوب").max(160),
  sku: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  price: z.number().finite().nonnegative(),
  attributes: z
    .record(
      z.string().uuid(),
      z.union([
        z.string().trim().max(500),
        z.number().finite(),
        z.boolean(),
        z.array(z.string().trim().max(100)).max(100),
      ]),
    )
    .optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      (v) => CURRENCY_CODES.includes(v),
      "اختر العملة من القائمة، مثل الليرة التركية TRY أو الدولار USD",
    )
    .default("USD"),
  images: z.array(mediaUrl).max(12, "الحد الأقصى 12 صورة").default([]),
  videos: z.array(mediaUrl).max(4, "الحد الأقصى 4 فيديوهات").default([]),
  isActive: z.boolean().default(true),
});
export const PRODUCT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
] as const;
export const ProductUploadInput = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    contentType: z.enum(PRODUCT_MEDIA_TYPES),
    size: z.number().int().positive().optional(),
  })
  .superRefine((v, ctx) => {
    const limit = v.contentType.startsWith("video/") ? 25 * 1024 * 1024 : 5 * 1024 * 1024;
    if (v.size && v.size > limit)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "الحد الأقصى للصورة 5MB وللفيديو 25MB",
        path: ["size"],
      });
  });
