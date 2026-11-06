import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Mail, Pause, Play, Plus, Send, Trash2, XCircle } from "lucide-react";
import { approveEmailCampaign, controlEmailCampaignFn, deleteEmailCampaignFn, getEmailStatus, listEmailCampaigns, previewEmailAudience } from "@/modules/marketing/outbound.functions";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STATUS: Record<string, string> = { scheduled: "مجدولة", running: "قيد الإرسال", paused: "موقوفة", completed: "مكتملة", cancelled: "ملغاة", failed: "فشلت" };
const EXCLUDED: Record<string, string> = { noEmail: "بلا بريد صالح", suppressed: "ضمن قائمة «لا ترسل»", inOtherCampaign: "ينتظر في حملة إيميل أخرى", duplicateEmail: "بريد مكرر" };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-2 py-1 text-center">
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** One screen: who receives it, the email, and the final approval. Nothing is sent until the last button. */
function EmailCampaignDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const previewFn = useServerFn(previewEmailAudience);
  const approveFn = useServerFn(approveEmailCampaign);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [throttle, setThrottle] = useState(5);
  const [later, setLater] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [ack, setAck] = useState({ review: false, b2b: false, optOut: false });

  const preview = useQuery({ queryKey: ["email-preview"], queryFn: () => previewFn({ data: {} }), enabled: open, staleTime: 0 });
  useEffect(() => {
    if (open) setAck({ review: false, b2b: false, optOut: false });
  }, [open]);

  const total = preview.data?.total ?? 0;
  const sample = preview.data?.sample[0]?.name ?? "اسم الجهة";
  const shown = useMemo(() => body.replace(/\{\{\s*name\s*\}\}/g, sample), [body, sample]);
  const ready = name.trim().length >= 2 && subject.trim().length > 0 && body.trim().length > 0 && total > 0 && (!later || !!scheduledAt);
  const allAck = ack.review && ack.b2b && ack.optOut;

  const approve = useMutation({
    mutationFn: () => approveFn({ data: { name, subject, body, throttlePerMinute: throttle, scheduledAt: later && scheduledAt ? new Date(scheduledAt).toISOString() : null, acknowledgments: ack } }),
    onSuccess: (r) => {
      toast.success(`اعتُمدت الحملة لـ ${r.recipients} جهة. ستبدأ بالإرسال تدريجياً`);
      qc.invalidateQueries({ queryKey: ["email-campaigns"] });
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
      setName("");
      setSubject("");
      setBody("");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={(value) => !approve.isPending && onOpenChange(value)}>
      <DialogContent dir="rtl" className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>حملة إيميل جديدة للجهات المعتمدة</DialogTitle>
          <DialogDescription>اكتب الرسالة وراجعها ثم اعتمدها. لا يُرسل شيء قبل الاعتماد النهائي.</DialogDescription>
        </DialogHeader>

        {preview.isPending ? (
          <p className="text-sm">جارٍ الحساب...</p>
        ) : preview.isError ? (
          <p className="text-sm text-destructive">{(preview.error as Error).message}</p>
        ) : (
          <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
            <p>
              <b>{total}</b> جهة لها بريد صالح من أصل <b>{preview.data.approved}</b> معتمدة.
            </p>
            {Object.entries(preview.data.excluded).filter(([, n]) => n > 0).map(([key, n]) => (
              <p key={key} className="text-xs text-muted-foreground">
                {n} · {EXCLUDED[key] ?? key}
              </p>
            ))}
            {total === 0 && <p className="text-xs text-destructive">اعتمد جهات لها بريد (بعد «إثراء من المواقع») ثم عُد.</p>}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="em-name">اسم الحملة (لك فقط)</Label>
            <Input id="em-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="em-subject">عنوان الرسالة</Label>
            <Input id="em-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder="مثال: عرض خاص لـ {{name}}" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="em-body">نص الرسالة</Label>
            <Textarea id="em-body" rows={7} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} placeholder="اكتب {{name}} ليحلّ مكانه اسم الجهة" />
            <p className="text-xs text-muted-foreground">يُضاف تلقائياً اسم مؤسستك ورابط إلغاء الاشتراك في آخر كل رسالة.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="em-speed">السرعة</Label>
              <select id="em-speed" className="w-full rounded-md border bg-background p-2 text-sm" value={throttle} onChange={(e) => setThrottle(Number(e.target.value))}>
                {[1, 5, 10, 20, 30].map((v) => (
                  <option key={v} value={v}>{v} إيميل بالدقيقة</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={later} onCheckedChange={(v) => setLater(v === true)} /> جدولة لوقت لاحق
              </label>
              {later && <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />}
            </div>
          </div>
          {body && (
            <div className="rounded-lg border p-3 text-sm">
              <p className="mb-1 text-xs text-muted-foreground">معاينة (باسم «{sample}»)</p>
              <p className="font-medium">{subject.replace(/\{\{\s*name\s*\}\}/g, sample)}</p>
              <p className="mt-2 whitespace-pre-wrap">{shown}</p>
            </div>
          )}
          {(
            [
              ["review", "راجعت المستلمين والرسالة، وأعتمد الإرسال بنفسي."],
              ["b2b", "المستلمون جهات تجارية، ولمؤسستي أساس نظامي للتواصل معهم بحسب قوانين بلدهم."],
              ["optOut", "أفهم أن رابط إلغاء الاشتراك يُضاف تلقائياً، وأن من يلغي اشتراكه أو يشتكي يُحظر من كل الحملات."],
            ] as const
          ).map(([key, text]) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <Checkbox checked={ack[key]} onCheckedChange={(v) => setAck({ ...ack, [key]: v === true })} className="mt-0.5" />
              {text}
            </label>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" disabled={approve.isPending} onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button disabled={!ready || !allAck || approve.isPending} onClick={() => approve.mutate()}>
            {approve.isPending ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Send className="ml-1 h-4 w-4" />}
            اعتماد وجدولة الإرسال
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Email campaigns: how far each is, and what came back. Sending is slow on purpose. */
export function EmailTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const statusFn = useServerFn(getEmailStatus);
  const listFn = useServerFn(listEmailCampaigns);
  const controlFn = useServerFn(controlEmailCampaignFn);
  const deleteFn = useServerFn(deleteEmailCampaignFn);
  const status = useQuery({ queryKey: ["email-status"], queryFn: () => statusFn() });
  const q = useQuery({ queryKey: ["email-campaigns"], queryFn: () => listFn(), refetchInterval: 20_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["email-campaigns"] });
  const control = useMutation({
    mutationFn: (v: { id: string; action: "pause" | "resume" | "cancel" }) => controlFn({ data: v }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("حُذفت الحملة");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const configured = status.data?.configured === true;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">حملات الإيميل المعتمدة وحالة رسائلها. الإرسال بطيء ومحدود يومياً ({status.data?.dailyCap ?? 100} إيميل كحد أقصى).</p>
        <Button onClick={() => setOpen(true)} disabled={!configured}>
          <Plus className="ml-1 h-4 w-4" /> حملة إيميل جديدة
        </Button>
      </div>
      {status.data && !configured && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>الإيميل غير مُعدّ بعد</AlertTitle>
          <AlertDescription>لم يُضبط مزوّد الإرسال (RESEND_API_KEY) أو عنوان المرسل (EMAIL_FROM) أو عنوان الموقع (PUBLIC_APP_URL) على الخادم. تواصل مع مدير النظام لإكمال الإعداد.</AlertDescription>
        </Alert>
      )}
      {status.data?.from && <p className="text-xs text-muted-foreground">يُرسل من: <span dir="ltr">{status.data.from}</span></p>}

      {q.isPending ? (
        <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (q.data ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
          <Mail className="h-8 w-8" />
          <p className="text-sm">لا توجد حملات إيميل بعد.</p>
        </div>
      ) : (
        q.data!.map((c: any) => {
          const s = c.stats;
          const done = s.total - s.queued;
          return (
            <Card key={c.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <Badge variant="secondary">{STATUS[c.status] ?? c.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.subject}</p>
                </div>
                <span className="text-xs text-muted-foreground">اعتُمدت {c.approved_at ? formatDateTime(c.approved_at) : ""}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${s.total ? Math.round((done / s.total) * 100) : 0}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Stat label="مستلمون" value={s.total} />
                <Stat label="أُرسلت" value={s.sent + s.delivered} />
                <Stat label="سُلّمت" value={s.delivered} />
                <Stat label="ارتدّت" value={s.bounced} />
                <Stat label="ألغوا الاشتراك" value={s.unsubscribed} />
                <Stat label="فشلت" value={s.failed} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {["scheduled", "running"].includes(c.status) && (
                  <Button size="sm" variant="outline" disabled={control.isPending} onClick={() => control.mutate({ id: c.id, action: "pause" })}>
                    <Pause className="ml-1 h-3.5 w-3.5" /> إيقاف مؤقت
                  </Button>
                )}
                {c.status === "paused" && (
                  <Button size="sm" variant="outline" disabled={control.isPending} onClick={() => control.mutate({ id: c.id, action: "resume" })}>
                    <Play className="ml-1 h-3.5 w-3.5" /> استئناف
                  </Button>
                )}
                {["scheduled", "running", "paused"].includes(c.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={control.isPending}
                    onClick={async () => {
                      if (await askConfirm({ title: "إلغاء الحملة؟", description: "لن تُرسل الإيميلات المتبقية. ما أُرسل لا يمكن سحبه.", confirmLabel: "إلغاء الحملة", destructive: true })) control.mutate({ id: c.id, action: "cancel" });
                    }}
                  >
                    <XCircle className="ml-1 h-3.5 w-3.5" /> إلغاء
                  </Button>
                )}
                {["completed", "cancelled", "failed"].includes(c.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={remove.isPending}
                    onClick={async () => {
                      if (await askConfirm({ title: "حذف الحملة نهائياً؟", description: "تُحذف الحملة وسجل رسائلها. أرقام وعناوين «لا ترسل» تبقى. لا يمكن التراجع.", confirmLabel: "حذف", destructive: true })) remove.mutate(c.id);
                    }}
                  >
                    <Trash2 className="ml-1 h-3.5 w-3.5" /> حذف
                  </Button>
                )}
              </div>
            </Card>
          );
        })
      )}
      <EmailCampaignDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
