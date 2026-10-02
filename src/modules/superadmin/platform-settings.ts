import { z } from "@/lib/validation";
import { CURRENCY_CODES } from "@/modules/commerce/currencies";
export const platformSettingsSchema = z.object({
  platform_name: z.string().trim().min(1, "اسم المنصة إلزامي").max(64, "اسم المنصة يجب ألا يتجاوز 64 حرفًا"),
  login_description: z.string().trim().min(1, "وصف صفحة الدخول إلزامي").max(160, "الوصف يجب ألا يتجاوز 160 حرفًا"),
  support_email: z.union([z.literal(""), z.string().trim().email("أدخل بريد الدعم بصيغة صحيحة")]),
  default_currency: z.string().refine(value => CURRENCY_CODES.includes(value), "اختر عملة صحيحة من القائمة"),
}).strict();
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  platform_name: "NovaSales", login_description: "منصة إدارة عمليات المبيعات", support_email: "", default_currency: "USD",
};
