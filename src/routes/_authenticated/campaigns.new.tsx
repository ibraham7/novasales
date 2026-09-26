import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Users, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveCampaign, previewCampaignAudience, listTemplates } from "@/modules/campaigns";
import { listInstances } from "@/modules/channels";

export const Route = createFileRoute("/_authenticated/campaigns/new")({
  head: () => ({ meta: [{ title: "حملة جديدة - NovaSales" }] }),
  component: NewPage,
});

function NewPage() {
  const nav = useNavigate();
  const save = useServerFn(saveCampaign);
  const preview = useServerFn(previewCampaignAudience);
  const tplFn = useServerFn(listTemplates);
  const instFn = useServerFn(listInstances);
  const tplQ = useQuery({ queryKey: ["templates"], queryFn: () => tplFn() });
  const instQ = useQuery({ queryKey: ["instances"], queryFn: () => instFn() });

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [lifecycle, setLifecycle] = useState<string>("lead");
  const [throttle, setThrottle] = useState(20);
  const [scheduledAt, setScheduledAt] = useState<string>("");

  const audience_filter: any = { lifecycle_stage: lifecycle };
  const previewMut = useMutation({
    mutationFn: () => preview({ data: { audience_filter, throttle_per_minute: throttle } }),
  });

  const saveMut = useMutation({
    mutationFn: () => save({
      data: {
        name, channel_account_id: accountId, template_id: templateId,
        audience_filter, throttle_per_minute: throttle,
        scheduled_at: scheduledAt || null,
      },
    }),
    onSuccess: (r) => { toast.success("تم الحفظ كمسودة"); nav({ to: "/campaigns/$id", params: { id: r.id } }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <Link to="/campaigns"><Button size="sm" variant="ghost"><ArrowRight className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-bold">حملة جديدة</h1>
        <div className="flex gap-1 mr-auto">
          {[1, 2, 3, 4].map((n) => <Badge key={n} variant={step >= n ? "default" : "outline"}>{n}</Badge>)}
        </div>
      </div>

      <Card className="p-6 space-y-4">
        {step === 1 && (
          <>
            <h2 className="text-lg font-semibold">1. المعلومات والقناة</h2>
            <div><Label>اسم الحملة</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div>
              <Label>حساب واتساب المُرسل</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(instQ.data ?? []).filter((i: any) => i.status === "connected").map((i: any) => (
                    <SelectItem key={i.id} value={i.id}>{i.display_name} ({i.phone_number ?? "-"})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end"><Button disabled={!name || !accountId} onClick={() => setStep(2)}>التالي</Button></div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-lg font-semibold">2. القالب</h2>
            <div>
              <Label>القالب</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {(tplQ.data?.templates ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name} (v{t.version})</SelectItem>)}
                </SelectContent>
              </Select>
              {(tplQ.data?.templates ?? []).length === 0 && (
                <div className="text-xs text-muted-foreground mt-1">لا توجد قوالب — <Link to="/campaigns/templates" className="underline">أنشئ قالباً</Link></div>
              )}
            </div>
            {templateId && (
              <Card className="p-3 bg-muted/50">
                <pre className="text-xs whitespace-pre-wrap">{tplQ.data?.templates.find((t: any) => t.id === templateId)?.body}</pre>
              </Card>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>السابق</Button>
              <Button disabled={!templateId} onClick={() => setStep(3)}>التالي</Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-lg font-semibold">3. الجمهور والإيقاع</h2>
            <div>
              <Label>مرحلة العميل</Label>
              <Select value={lifecycle} onValueChange={setLifecycle}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="qualified">مؤهل</SelectItem>
                  <SelectItem value="customer">عميل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>عدد الرسائل في الدقيقة</Label>
              <Input type="number" value={throttle} onChange={(e) => setThrottle(Math.max(1, Number(e.target.value)))} min={1} max={1000} />
            </div>
            <Button variant="outline" onClick={() => previewMut.mutate()} disabled={previewMut.isPending}>
              <Users className="h-4 w-4 ml-1" /> معاينة الجمهور
            </Button>
            {previewMut.data && (
              <Card className="p-3 bg-muted/50 space-y-1">
                <div className="flex items-center gap-2"><Users className="h-4 w-4" /> <b>{previewMut.data.count}</b> مستلم</div>
                <div className="flex items-center gap-2"><Clock className="h-4 w-4" /> الوقت المتوقع: <b>{previewMut.data.eta.label}</b></div>
                {previewMut.data.sample.length > 0 && (
                  <div className="text-xs text-muted-foreground pt-1">أمثلة: {previewMut.data.sample.slice(0, 3).map((r: any) => r.display_name || r.phone).join("، ")}...</div>
                )}
              </Card>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>السابق</Button>
              <Button onClick={() => setStep(4)}>التالي</Button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-lg font-semibold">4. الجدولة</h2>
            <div><Label>وقت الإطلاق (اترك فارغاً للإطلاق يدوياً لاحقاً)</Label>
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value ? new Date(e.target.value).toISOString() : "")} />
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(3)}>السابق</Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>حفظ كمسودة</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
