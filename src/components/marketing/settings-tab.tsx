import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldAlert } from "lucide-react";
import { getOutboundSettings, saveOutboundSettings } from "@/modules/marketing/outbound.functions";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** Safety settings of outbound sending: who may send from which numbers, and the opt-out line. */
export function SettingsTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getOutboundSettings);
  const saveFn = useServerFn(saveOutboundSettings);
  const q = useQuery({ queryKey: ["outbound-settings"], queryFn: () => getFn() });
  const [allow, setAllow] = useState(false);
  const [accept, setAccept] = useState(false);
  const [footer, setFooter] = useState("");
  useEffect(() => {
    if (q.data) {
      setAllow(q.data.allow_unofficial);
      setFooter(q.data.optout_footer);
      setAccept(false);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => saveFn({ data: { allowUnofficial: allow, acceptRisk: accept, optoutFooter: footer } }),
    onSuccess: () => {
      toast.success("تم حفظ الإعدادات");
      qc.invalidateQueries({ queryKey: ["outbound-settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (q.isPending) return <p className="text-sm">جارٍ التحميل...</p>;
  if (q.isError) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const s = q.data;
  const turningOn = allow && !s.allow_unofficial;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4 sm:p-5">
        <h3 className="font-semibold">أرقام واتساب</h3>
        <div className="space-y-2">
          {s.accounts.length === 0 && <p className="text-sm text-muted-foreground">لا توجد أرقام مربوطة.</p>}
          {s.accounts.map((a: any) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
              <span className="font-medium">{a.name}</span>
              <span dir="ltr" className="text-muted-foreground">
                {a.identifier}
              </span>
              <Badge variant={a.official ? "default" : "secondary"}>{a.official ? "رسمي (Meta)" : "غير رسمي"}</Badge>
              <Badge variant="outline">{a.providerLabel}</Badge>
              <span className={a.connected ? "text-emerald-600" : "text-muted-foreground"}>{a.connected ? "متصل" : "غير متصل"}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">الإرسال لجهات لم تتواصل معك عبر الرقم الرسمي يحتاج قوالب معتمدة من Meta، وهذا لم يُبنَ بعد.</p>
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">الإرسال عبر أرقام غير رسمية</h3>
            <p className="text-xs text-muted-foreground">أرقام الربط بـQR (Evolution وWAHA). معطّل افتراضياً.</p>
          </div>
          <Switch checked={allow} onCheckedChange={setAllow} aria-label="السماح بالإرسال عبر أرقام غير رسمية" />
        </div>
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>خطر حظر الرقم</AlertTitle>
          <AlertDescription>
            واتساب لا يسمح بالرسائل الجماعية لجهات لم توافق على استلامها. الأرقام غير الرسمية قد تُحظر حتى مع التباطؤ، وحظر رقم تعتمد عليه خسارة لا تُعوَّض. استعمل رقماً مخصصاً لهذا الغرض، وبأعداد صغيرة.
          </AlertDescription>
        </Alert>
        {turningOn && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={accept} onCheckedChange={(v) => setAccept(v === true)} className="mt-0.5" />
            فهمت المخاطر وأتحمّل مسؤولية القرار باسم المؤسسة.
          </label>
        )}
        {s.allow_unofficial && s.acceptedAt && (
          <p className="text-xs text-muted-foreground">
            فُعّل بواسطة {s.acceptedByName ?? "مدير المؤسسة"} في {formatDateTime(s.acceptedAt)}.
          </p>
        )}
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <h3 className="font-semibold">جملة الإيقاف</h3>
        <p className="text-xs text-muted-foreground">تُضاف تلقائياً في آخر كل رسالة Outbound. من يردّ بكلمة إيقاف يُضاف لقائمة «لا ترسل» ولا يُراسَل من أي حملة.</p>
        <div className="space-y-1">
          <Label htmlFor="ob-footer">النص</Label>
          <Textarea id="ob-footer" rows={2} maxLength={200} value={footer} onChange={(e) => setFooter(e.target.value)} />
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="mb-2 font-semibold">حدود الحماية (من إعدادات الخادم)</h3>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>أقصى مستلمين للحملة الواحدة: {s.maxRecipients}</li>
          <li>أقصى سرعة: {s.maxThrottle} رسالة بالدقيقة</li>
        </ul>
      </Card>

      <Button onClick={() => save.mutate()} disabled={save.isPending || (turningOn && !accept)}>
        {save.isPending && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
        حفظ الإعدادات
      </Button>
    </div>
  );
}
