import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, Send } from "lucide-react";
import { approveOutboundCampaign, getOutboundSettings, previewOutbound } from "@/modules/marketing/outbound.functions";
import { allowanceFor, scheduleProblem, toMinutes, type SendSchedule } from "@/modules/campaigns/send-schedule";
import { toast } from "@/lib/toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const selectClass = "w-full rounded-md border bg-background p-2 text-sm";
const EXCLUDED_LABEL: Record<string, string> = {
  noPhone: "بلا رقم هاتف",
  landline: "رقم ثابت (لا يستقبل واتساب)",
  suppressed: "ضمن قائمة «لا ترسل»",
  inOtherCampaign: "ينتظر في حملة أخرى",
  duplicatePhone: "رقم مكرر",
};

/** Three steps: who receives it, what is sent and how fast, then the final approval. Nothing is sent until the last button. */
export function CampaignWizard({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const qc = useQueryClient();
  const previewFn = useServerFn(previewOutbound);
  const settingsFn = useServerFn(getOutboundSettings);
  const approveFn = useServerFn(approveOutboundCampaign);

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [accountId, setAccountId] = useState("");
  const [throttle, setThrottle] = useState(5);
  // Slow sending over the hours of each day is the default; «fast» keeps the per-minute speed.
  const [paced, setPaced] = useState(true);
  const [daily, setDaily] = useState(30);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("17:00");
  const [timezone, setTimezone] = useState("Europe/Istanbul");
  const [ramp, setRamp] = useState(true);
  const [rampStart, setRampStart] = useState(10);
  const [rampStep, setRampStep] = useState(5);
  const [later, setLater] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [ack, setAck] = useState({ review: false, b2b: false, optOut: false });

  const preview = useQuery({ queryKey: ["outbound-preview"], queryFn: () => previewFn({ data: {} }), enabled: open, staleTime: 0 });
  const settings = useQuery({ queryKey: ["outbound-settings"], queryFn: () => settingsFn(), enabled: open });
  useEffect(() => {
    if (open) {
      setStep(1);
      setAck({ review: false, b2b: false, optOut: false });
    }
  }, [open]);

  const accounts = settings.data?.accounts ?? [];
  const usable = accounts.filter((a: any) => a.connected && !a.official);
  const account = accounts.find((a: any) => a.id === accountId);
  const maxThrottle = settings.data?.maxThrottle ?? 10;
  const speeds = [1, 3, 5, 10].filter((v) => v <= maxThrottle);
  const eligible = preview.data?.eligibleCount ?? 0;
  const tooMany = eligible > (preview.data?.maxRecipients ?? 200);
  const sample = preview.data?.sample[0]?.name ?? "اسم الجهة";
  const footer = settings.data?.optout_footer ?? "";
  const shown = useMemo(() => `${body.replace(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g, (_m, options: string) => options.split("|")[0]!.trim()).replace(/\{\{\s*name\s*\}\}/g, sample)}${body ? `\n\n${footer}` : ""}`, [body, sample, footer]);
  const minutes = Math.max(1, Math.ceil(eligible / Math.max(1, throttle)));
  const blocked = settings.data && !settings.data.allow_unofficial;
  const schedule: SendSchedule | null = paced ? { dailyLimit: daily, windowStart: from, windowEnd: to, timezone, ramp: ramp ? { start: Math.min(rampStart, daily), step: rampStep } : null } : null;
  const scheduleError = schedule ? scheduleProblem(schedule) : null;
  // How the day's messages are spread, and how many days the whole list takes.
  const everyMinutes = schedule ? Math.round(((toMinutes(schedule.windowEnd) - toMinutes(schedule.windowStart)) / Math.max(1, Math.min(daily, schedule.ramp ? allowanceFor(schedule, 99) : daily))) * 10) / 10 : 0;
  const days = (() => {
    if (!schedule || !eligible) return 0;
    let total = 0;
    for (let d = 0; d < 365; d++) {
      total += allowanceFor(schedule, d);
      if (total >= eligible) return d + 1;
    }
    return 365;
  })();
  const step2Ok = name.trim().length >= 2 && body.trim().length > 0 && !!account && !blocked && (!later || !!scheduledAt) && !scheduleError;
  const allAck = ack.review && ack.b2b && ack.optOut;

  const approve = useMutation({
    mutationFn: () =>
      approveFn({
        data: { name, body, accountId, throttlePerMinute: throttle, schedule, scheduledAt: later && scheduledAt ? new Date(scheduledAt).toISOString() : null, acknowledgments: ack },
      }),
    onSuccess: (r) => {
      toast.success(`اعتُمدت الحملة لـ ${r.recipients} جهة. ستبدأ بالإرسال ببطء`);
      qc.invalidateQueries({ queryKey: ["outbound-campaigns"] });
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
      setName("");
      setBody("");
      onDone();
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={(value) => !approve.isPending && onOpenChange(value)}>
      <DialogContent dir="rtl" className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>حملة جديدة للجهات المعتمدة ({step}/3)</DialogTitle>
          <DialogDescription>{step === 1 ? "راجع من سيصله الإرسال." : step === 2 ? "اكتب الرسالة واختر الرقم والسرعة." : "اعتماد نهائي. لا يُرسل شيء قبل هذه الخطوة."}</DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            {preview.isPending ? (
              <p className="text-sm">جارٍ الحساب...</p>
            ) : preview.isError ? (
              <p className="text-sm text-destructive">{(preview.error as Error).message}</p>
            ) : (
              <>
                <p className="text-sm">
                  <b>{eligible}</b> جهة صالحة للإرسال من أصل <b>{preview.data.approved}</b> معتمدة.
                </p>
                {Object.entries(preview.data.excluded).some(([, n]) => n > 0) && (
                  <ul className="space-y-1 rounded-md bg-muted p-3 text-sm">
                    {Object.entries(preview.data.excluded)
                      .filter(([, n]) => n > 0)
                      .map(([key, n]) => (
                        <li key={key}>
                          {n} · {EXCLUDED_LABEL[key]}
                        </li>
                      ))}
                  </ul>
                )}
                {eligible === 0 && <p className="text-sm text-muted-foreground">اعتمد جهات من القائمة أولاً (تحديد ثم «اعتماد للتواصل»).</p>}
                {tooMany && (
                  <Alert variant="destructive">
                    <AlertTitle>عدد كبير</AlertTitle>
                    <AlertDescription>الحد الأقصى {preview.data.maxRecipients} جهة للحملة الواحدة. قلّل عدد المعتمدين.</AlertDescription>
                  </Alert>
                )}
                {preview.data.sample.length > 0 && (
                  <div className="rounded-md border">
                    {preview.data.sample.map((p) => (
                      <div key={p.id} className="flex justify-between gap-2 border-b p-2 text-sm last:border-b-0">
                        <span>{p.name}</span>
                        <span dir="ltr" className="text-muted-foreground">
                          +{p.phone}
                        </span>
                      </div>
                    ))}
                    {eligible > preview.data.sample.length && <p className="p-2 text-xs text-muted-foreground">و{eligible - preview.data.sample.length} جهة أخرى...</p>}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            {blocked && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>الإرسال غير مفعّل</AlertTitle>
                <AlertDescription>الإرسال عبر أرقام غير رسمية معطّل. فعّله من تبويب «الإعدادات» (يحتاج صلاحية مالك المؤسسة) بعد قراءة المخاطر.</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1">
              <Label htmlFor="cw-name">اسم الحملة</Label>
              <Input id="cw-name" maxLength={200} placeholder="مثال: عرض نهاية السنة - عيادات إسطنبول" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cw-account">رقم واتساب المرسِل</Label>
              <select id="cw-account" className={selectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">اختر رقماً</option>
                {accounts.map((a: any) => (
                  <option key={a.id} value={a.id} disabled={!a.connected || a.official}>
                    {a.name} · {a.providerLabel}
                    {a.official ? " (رسمي: يحتاج قوالب، غير مدعوم بعد)" : !a.connected ? " (غير متصل)" : ""}
                  </option>
                ))}
              </select>
              {usable.length === 0 && settings.isSuccess && <p className="text-xs text-destructive">لا يوجد رقم متصل غير رسمي.</p>}
              <p className="text-xs text-muted-foreground">يُنصح برقم مخصص لهذا الغرض، لا برقم المبيعات أو الدعم.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cw-body">نص الرسالة</Label>
              <Textarea id="cw-body" rows={5} maxLength={900} placeholder={"مرحباً {{name}}،\nعندنا عرض خاص لنهاية السنة..."} value={body} onChange={(e) => setBody(e.target.value)} />
              <p className="text-xs text-muted-foreground">{"{{name}}"} يُستبدل باسم كل جهة. تُضاف جملة الإيقاف تلقائياً.</p>
            </div>
            {body.trim() && (
              <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
                <p className="mb-1 text-xs text-muted-foreground">معاينة (باسم «{sample}»)</p>
                <p className="whitespace-pre-wrap">{shown}</p>
              </div>
            )}
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">طريقة الإرسال</p>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="cw-mode" className="mt-1" checked={paced} onChange={() => setPaced(true)} />
                <span>
                  <b>موزّع على ساعات اليوم (موصى به)</b>
                  <span className="block text-xs text-muted-foreground">رسالة كل بضع دقائق بفاصل عشوائي، ضمن ساعات محددة وحد يومي، وتكمل في اليوم التالي. أخف على الرقم وأقل خطراً للحظر.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="cw-mode" className="mt-1" checked={!paced} onChange={() => setPaced(false)} />
                <span>
                  <b>سريع</b>
                  <span className="block text-xs text-muted-foreground">عدة رسائل بالدقيقة بدون حد يومي. أخطر على الرقم.</span>
                </span>
              </label>
              {paced ? (
                <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
                  <div className="space-y-1">
                    <Label htmlFor="cw-daily">رسائل باليوم</Label>
                    <Input id="cw-daily" type="number" min={1} max={500} value={daily} onChange={(e) => setDaily(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cw-from">من الساعة</Label>
                    <Input id="cw-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cw-to">إلى الساعة</Label>
                    <Input id="cw-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cw-tz">التوقيت</Label>
                    <select id="cw-tz" className={selectClass} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                      <option value="Europe/Istanbul">تركيا</option>
                      <option value="Asia/Riyadh">السعودية</option>
                      <option value="Asia/Dubai">الإمارات</option>
                      <option value="Asia/Damascus">سوريا</option>
                      <option value="Africa/Cairo">مصر</option>
                    </select>
                  </div>
                  <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-4">
                    <Checkbox checked={ramp} onCheckedChange={(v) => setRamp(v === true)} /> تسخين تدريجي: يبدأ بعدد صغير ويزيد كل يوم حتى الحد اليومي
                  </label>
                  {ramp && (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor="cw-rs">يبدأ بـ</Label>
                        <Input id="cw-rs" type="number" min={1} max={500} value={rampStart} onChange={(e) => setRampStart(Number(e.target.value))} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="cw-rp">ويزيد كل يوم</Label>
                        <Input id="cw-rp" type="number" min={0} max={100} value={rampStep} onChange={(e) => setRampStep(Number(e.target.value))} />
                      </div>
                    </>
                  )}
                  {scheduleError ? <p className="col-span-2 text-xs text-destructive sm:col-span-4">{scheduleError}</p> : <p className="col-span-2 text-xs text-muted-foreground sm:col-span-4">{"تقريباً رسالة كل " + everyMinutes + " دقيقة في أيام الحد الكامل. لتنويع الصياغة اكتب {أ|ب|ج}، مثل: {مرحباً|أهلاً}."}</p>}
                </div>
              ) : (
                <div className="space-y-1 pt-1">
                  <Label htmlFor="cw-speed">السرعة</Label>
                  <select id="cw-speed" className={selectClass} value={throttle} onChange={(e) => setThrottle(Number(e.target.value))}>
                    {speeds.map((v) => (
                      <option key={v} value={v}>
                        {v} رسالة بالدقيقة
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="cw-when">الموعد</Label>
              <select id="cw-when" className={selectClass} value={later ? "later" : "now"} onChange={(e) => setLater(e.target.value === "later")}>
                <option value="now">ابدأ بعد الاعتماد</option>
                <option value="later">في موعد محدد</option>
              </select>
            </div>
            {later && <Input type="datetime-local" aria-label="موعد الإرسال" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
              <p>
                <b>{name}</b>
              </p>
              <p>{eligible} جهة · من الرقم: {account?.name} · {schedule ? `${daily} رسالة باليوم من ${from} إلى ${to}${ramp ? ` (تسخين: ${rampStart} ثم +${rampStep} كل يوم)` : ""}، تنتهي خلال حوالي ${days} ${days === 1 ? "يوم" : "أيام"}` : `${throttle} رسالة بالدقيقة (حوالي ${minutes} دقيقة)`}</p>
              <p>{later && scheduledAt ? `الموعد: ${new Date(scheduledAt).toLocaleString("ar")}` : "تبدأ بعد الاعتماد مباشرة"}</p>
            </div>
            <div className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">{shown}</div>
            {(
              [
                ["review", "راجعت قائمة المستلمين والرسالة، وأعتمد الإرسال بنفسي."],
                ["b2b", "المستلمون جهات تجارية، ولمؤسستي أساس نظامي للتواصل معهم بحسب قوانين بلدهم وسياسة واتساب."],
                ["optOut", "أفهم أن جملة الإيقاف تُضاف تلقائياً، وأن من يطلب الإيقاف يُحظر من كل الحملات."],
              ] as const
            ).map(([key, text]) => (
              <label key={key} className="flex items-start gap-2 text-sm">
                <Checkbox checked={ack[key]} onCheckedChange={(v) => setAck({ ...ack, [key]: v === true })} className="mt-0.5" />
                {text}
              </label>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" disabled={approve.isPending} onClick={() => (step === 1 ? onOpenChange(false) : setStep(step - 1))}>
            {step === 1 ? "إلغاء" : (<><ArrowRight className="ml-1 h-4 w-4" /> السابق</>)}
          </Button>
          {step < 3 ? (
            <Button disabled={step === 1 ? eligible === 0 || tooMany || preview.isPending : !step2Ok} onClick={() => setStep(step + 1)}>
              التالي <ArrowLeft className="mr-1 h-4 w-4" />
            </Button>
          ) : (
            <Button disabled={!allAck || approve.isPending} onClick={() => approve.mutate()}>
              {approve.isPending ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Send className="ml-1 h-4 w-4" />}
              اعتماد وجدولة الإرسال
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
