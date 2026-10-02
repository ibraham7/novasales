import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { getAllSettings, updateSetting } from "@/modules/superadmin";
import { platformSettingsSchema, type PlatformSettings } from "@/modules/superadmin/platform-settings";
import { CURRENCY_CODES, currencyName } from "@/modules/commerce/currencies";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";
import { useState } from "react";
export const Route = createFileRoute("/_authenticated/admin/settings")({ component: SettingsPage });
function SettingsPage() {
  const qc = useQueryClient();
  const load = useServerFn(getAllSettings);
  const save = useServerFn(updateSetting);
  const q = useQuery({ queryKey: ["sa-settings"], queryFn: () => load() });
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const mutation = useMutation({ mutationFn: (settings: PlatformSettings) => save({ data: settings }), onSuccess: (result) => {
    qc.setQueryData(["sa-settings"], result);
    qc.setQueryData(["public-platform-settings"], result.settings);
    setDraft(null);
    toast.success("تم حفظ إعدادات المنصة بنجاح");
  }, onError: (error) => toast.error(error instanceof Error ? error.message : "تعذر حفظ الإعدادات") });
  if (q.isPending) return <p className="text-muted-foreground p-4">جارٍ تحميل الإعدادات…</p>;
  if (q.isError || !q.data) return <Card><CardContent className="p-6 space-y-3"><p role="alert">{q.error instanceof Error ? q.error.message : "تعذر تحميل الإعدادات"}</p><Button onClick={() => q.refetch()}>إعادة المحاولة</Button></CardContent></Card>;
  const values = draft ?? q.data.settings;
  const dirty = JSON.stringify(values) !== JSON.stringify(q.data.settings);
  const change = (key: keyof PlatformSettings, value: string) => setDraft({ ...values, [key]: value });
  return <form className="space-y-5 max-w-4xl" dir="rtl" noValidate onSubmit={(event) => {
    event.preventDefault();
    const parsed = platformSettingsSchema.safeParse(values);
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    mutation.mutate(parsed.data);
  }}>
    <div><h2 className="text-xl font-semibold">الإعدادات العامة</h2><p className="text-sm text-muted-foreground mt-1">إعدادات مشتركة لجميع المؤسسات. الحقول المعلّمة بإلزامي مطلوبة للحفظ.</p></div>
    <fieldset disabled={mutation.isPending} className="space-y-5 min-w-0">
      <Card><CardHeader><CardTitle className="text-base">هوية المنصة والدعم</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="space-y-2"><Label htmlFor="platform-name">اسم المنصة (إلزامي)</Label><Input id="platform-name" value={values.platform_name} required maxLength={64} onChange={e => change("platform_name",e.target.value)}/><p className="text-xs text-muted-foreground">يظهر في صفحة الدخول والقائمة الجانبية.</p></div>
        <div className="space-y-2"><Label htmlFor="login-description">وصف صفحة الدخول (إلزامي)</Label><Input id="login-description" required maxLength={160} value={values.login_description} onChange={e => change("login_description",e.target.value)}/></div>
        <div className="space-y-2"><Label htmlFor="support-email">بريد الدعم (اختياري)</Label><Input id="support-email" type="email" dir="ltr" placeholder="support@example.com" value={values.support_email} onChange={e => change("support_email",e.target.value)}/><p className="text-xs text-muted-foreground">يظهر رابط التواصل في صفحة الدخول عند إدخال البريد.</p></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">المنتجات والعملات</CardTitle></CardHeader><CardContent className="space-y-2">
        <Label htmlFor="default-currency">العملة الافتراضية (إلزامي)</Label>
        <select id="default-currency" required className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={values.default_currency} onChange={e => change("default_currency",e.target.value)}>{CURRENCY_CODES.map(code => <option key={code} value={code}>{currencyName(code)}</option>)}</select>
        <p className="text-xs text-muted-foreground">تُختار تلقائيًا عند إنشاء منتج جديد، ويمكن تغييرها داخل المنتج. لا تحوّل أسعار المنتجات الحالية أو عملاتها.</p>
      </CardContent></Card>
    </fieldset>
    <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={!dirty || mutation.isPending}>{mutation.isPending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}</Button><Button type="button" variant="outline" disabled={!dirty || mutation.isPending} onClick={() => setDraft(null)}>إلغاء التعديلات</Button><span className="text-xs text-muted-foreground" aria-live="polite">{dirty ? "توجد تعديلات غير محفوظة" : "الإعدادات محفوظة"}</span></div>
    {q.data.updated_at && <p className="text-xs text-muted-foreground">آخر تحديث: {new Date(q.data.updated_at).toLocaleString("ar")}</p>}
  </form>;
}
