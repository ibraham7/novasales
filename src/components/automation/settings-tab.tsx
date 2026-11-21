import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getAutomationSettings, saveAutomationSettings } from "@/modules/workflow";

/** Send settings: the two master switches (OFF by default), the sending window, the daily limit and the gap between messages. */
export function SettingsTab() {
  const qc = useQueryClient();
  const load = useServerFn(getAutomationSettings);
  const save = useServerFn(saveAutomationSettings);
  const q = useQuery({ queryKey: ["automation-settings"], queryFn: () => load() });
  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    if (q.data?.settings) setForm(q.data.settings);
  }, [q.data]);
  const mut = useMutation({
    mutationFn: (value: any) => save({ data: value }),
    onSuccess: () => {
      toast.success("تم حفظ الإعدادات");
      qc.invalidateQueries({ queryKey: ["automation-settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  if (q.isLoading || !form) return <Card className="p-6 text-center">جارِ التحميل...</Card>;
  if (q.isError) return <Card role="alert" className="p-6 text-center">تعذر تحميل الإعدادات.</Card>;
  const canManage = !!q.data?.canManage;
  const set = (patch: Record<string, unknown>) => setForm((f: any) => ({ ...f, ...patch }));
  const toggleSending = (on: boolean) => {
    if (on && !confirm("عند التفعيل سترسل الأتمتة رسائل حقيقية لعملاء حقيقيين عبر واتساب. هل أنت متأكد؟")) return;
    set({ sending_enabled: on });
  };
  return (
    <div className="space-y-4">
      {!q.data?.installed && <Card role="alert" className="p-4 text-sm">شغّل ملفات SQL الخاصة بإعدادات الأتمتة في Supabase أولاً قبل الحفظ.</Card>}
      <Card className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold">إرسال الرسائل للعملاء تلقائياً</div>
            <p className="text-xs text-muted-foreground">مطفأ افتراضياً. وهو مفتاح عام: ما دام مطفأً لا تُرسل أي أتمتة رسالة لأي عميل، حتى لو كانت الأتمتة نفسها مفعّلة.</p>
          </div>
          <Switch aria-label="إرسال الرسائل للعملاء تلقائياً" checked={form.sending_enabled} disabled={!canManage} onCheckedChange={toggleSending} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold">تنبيهات الفريق</div>
            <p className="text-xs text-muted-foreground">مطفأة افتراضياً. تتحكم بتنبيهات الموظفين الداخلية فقط (لا تصل للعملاء).</p>
          </div>
          <Switch aria-label="تنبيهات الفريق" checked={form.alerts_enabled} disabled={!canManage} onCheckedChange={(on) => set({ alerts_enabled: on })} />
        </div>
      </Card>
      <Card className="p-4 grid gap-3 sm:grid-cols-2">
        <div><Label>المنطقة الزمنية</Label><Input dir="ltr" value={form.timezone} disabled={!canManage} onChange={(e) => set({ timezone: e.target.value })} /></div>
        <div><Label>الحد اليومي للرسائل</Label><Input type="number" min={1} value={form.daily_limit} disabled={!canManage} onChange={(e) => set({ daily_limit: Number(e.target.value) })} /></div>
        <div><Label>بداية ساعات الإرسال</Label><Input type="time" value={form.send_window_start} disabled={!canManage} onChange={(e) => set({ send_window_start: e.target.value })} /></div>
        <div><Label>نهاية ساعات الإرسال</Label><Input type="time" value={form.send_window_end} disabled={!canManage} onChange={(e) => set({ send_window_end: e.target.value })} /></div>
        <div><Label>أقل فاصل بين رسالتين (ثانية)</Label><Input type="number" min={0} value={form.gap_min_seconds} disabled={!canManage} onChange={(e) => set({ gap_min_seconds: Number(e.target.value) })} /></div>
        <div><Label>أطول فاصل بين رسالتين (ثانية)</Label><Input type="number" min={0} value={form.gap_max_seconds} disabled={!canManage} onChange={(e) => set({ gap_max_seconds: Number(e.target.value) })} /></div>
        <div className="sm:col-span-2"><Label>إلغاء الرسالة المؤجلة بعد (دقيقة)</Label><Input type="number" min={5} value={form.defer_ttl_minutes} disabled={!canManage} onChange={(e) => set({ defer_ttl_minutes: Number(e.target.value) })} />
          <p className="text-xs text-muted-foreground mt-1">رسالة أُجّلت خارج ساعات الإرسال أو بسبب الحد اليومي تُلغى إن لم تُرسل خلال هذه المدة.</p></div>
      </Card>
      <Button disabled={!canManage || mut.isPending} onClick={() => mut.mutate(form)}>حفظ الإعدادات</Button>
    </div>
  );
}
