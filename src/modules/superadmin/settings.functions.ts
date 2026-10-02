import { createServerFn } from "@tanstack/react-start";
import { DEFAULT_PLATFORM_SETTINGS, platformSettingsSchema } from "./platform-settings";

async function readSettings() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any).from("platform_settings").select("value,updated_at").eq("key", "general").maybeSingle();
  if (error) { console.error("platform_settings.read", error); throw new Error("تعذر تحميل إعدادات المنصة؛ أعد المحاولة"); }
  const settings = platformSettingsSchema.safeParse({ ...DEFAULT_PLATFORM_SETTINGS, ...data?.value });
  if (!settings.success) throw new Error("إعدادات المنصة المحفوظة غير صالحة؛ تواصل مع الإدارة");
  return { settings: settings.data, updated_at: data?.updated_at ?? null };
}
export const getPublicPlatformSettings = createServerFn({ method: "GET" }).handler(async () => (await readSettings()).settings);
export const getAllSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { requireBillingAdmin } = await import("@/modules/billing/admin.server");
  await requireBillingAdmin();
  return readSettings();
});
export const updateSetting = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => platformSettingsSchema.parse(data))
  .handler(async ({ data }) => {
    const { requireBillingAdmin } = await import("@/modules/billing/admin.server");
    await requireBillingAdmin();
    const { getRequest } = await import("@tanstack/react-start/server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const token = getRequest().headers.get("authorization")!.replace(/^Bearer\s+/i, "");
    const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !auth.user) throw new Error("انتهت جلسة الدخول؛ سجل الدخول مجددًا");
    const { error } = await (supabaseAdmin as any).rpc("platform_save_general_settings", { _value: data, _actor: auth.user.id });
    if (error) { console.error("platform_settings.save", error); throw new Error("تعذر حفظ الإعدادات؛ أعد المحاولة"); }
    return readSettings();
  });
