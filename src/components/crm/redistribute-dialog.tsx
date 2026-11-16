import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { decideNext, scheduleProblem, type SendSchedule } from "@/modules/campaigns/send-schedule";
import { DEFAULT_REDISTRIBUTE_TEMPLATE, MAX_BODY } from "@/modules/assignments/redistribute-send-core";

export type RedistributePlan = {
  stageName: string;
  firstStageName: string;
  willMove: number;
  agents: number;
  unassignable: number;
  hasMore: boolean;
  perAgent: { id: string; name: string; count: number }[];
};
export type RedistributeMessage = { body: string; schedule: SendSchedule & { ramp: null } };

const DEFAULT_WINDOW = { windowStart: "10:00", windowEnd: "17:00", timezone: "Europe/Istanbul" };

/** The manager's choice when pressing «إعادة توزيع العملاء»: move only, or also have each agent greet their new customers. */
export function RedistributeDialog({ plan, pending, onCancel, onConfirm }: {
  plan: RedistributePlan;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (message: RedistributeMessage | null) => void;
}) {
  const [send, setSend] = useState(false);
  const [body, setBody] = useState(DEFAULT_REDISTRIBUTE_TEMPLATE);
  const [from, setFrom] = useState(DEFAULT_WINDOW.windowStart);
  const [to, setTo] = useState(DEFAULT_WINDOW.windowEnd);
  const [tz, setTz] = useState(DEFAULT_WINDOW.timezone);
  const [daily, setDaily] = useState(30);

  const schedule: SendSchedule & { ramp: null } = { dailyLimit: daily, windowStart: from, windowEnd: to, timezone: tz, ramp: null };
  const problem = send ? (body.trim() ? body.length > MAX_BODY ? `الرسالة أطول من ${MAX_BODY} حرفاً` : scheduleProblem(schedule) : "اكتب نص الرسالة") : null;
  const preview = useMemo(
    () => body.replace(/\{\{\s*contact_name\s*\}\}/g, "أحمد").replace(/\{\{\s*agent_name\s*\}\}/g, plan.perAgent[0]?.name ?? "مياسة").replace(/\{\{\s*department_name\s*\}\}/g, "فريق المبيعات").replace(/\{([^{}|]+)\|[^{}]+\}/g, "$1"),
    [body, plan.perAgent],
  );
  const timing = useMemo(() => {
    if (!send || scheduleProblem(schedule)) return null;
    const d = decideNext(schedule, new Date(), 0, 0);
    if (d.action === "send") return { ok: true, text: "الآن داخل ساعات الإرسال: ستبدأ الرسائل خلال دقائق وتتوزع ببطء حتى نهاية الساعات." };
    return { ok: false, text: `الآن خارج ساعات الإرسال: ستنتظر الرسائل حتى الساعة ${from} (بتوقيت ${tz}) ثم تبدأ ببطء. لن يصل أي عميل رسالة والمندوبون غير متواجدين.` };
  }, [send, from, to, tz, daily]); // eslint-disable-line react-hooks/exhaustive-deps

  const spread = plan.perAgent.slice(0, 6).map((a) => `${a.name}: ${a.count}`).join(" · ");
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pending) onCancel(); }}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إعادة توزيع {plan.willMove} تذكرة؟</DialogTitle>
          <DialogDescription className="whitespace-pre-line">
            {`ستنتقل التذاكر من «${plan.stageName}» إلى «${plan.firstStageName}» وتُوزَّع على ${plan.agents} مندوب بالتساوي.\n${spread}`}
            {plan.unassignable ? `\n(${plan.unassignable} تذكرة لا مندوب لها وستبقى مكانها)` : ""}
            {plan.hasMore ? "\n(الحد الأقصى 1000 تذكرة بالمرة؛ كرّر الخطوة للباقي)" : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>هل تُرسل رسالة للعملاء من المندوبين الجدد؟</Label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setSend(false)} className={cn("rounded-lg border p-3 text-start text-sm", !send ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted")}>
              <div className="font-medium">لا ترسل شيئاً</div>
              <div className="text-xs text-muted-foreground">نوزّع فقط، والمندوب يبدأ المحادثة بنفسه.</div>
            </button>
            <button type="button" onClick={() => setSend(true)} className={cn("rounded-lg border p-3 text-start text-sm", send ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted")}>
              <div className="font-medium">أرسل رسالة من كل مندوب</div>
              <div className="text-xs text-muted-foreground">كأن المندوب هو من كلّم العميل، من رقمه.</div>
            </button>
          </div>
        </div>

        {send && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rd-body">نص الرسالة</Label>
              <Textarea id="rd-body" rows={4} maxLength={MAX_BODY} value={body} onChange={(e) => setBody(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                يُستبدل تلقائياً: <code dir="ltr">{"{{agent_name}}"}</code> اسم المندوب، <code dir="ltr">{"{{contact_name}}"}</code> اسم العميل، <code dir="ltr">{"{{department_name}}"}</code> القسم. وصيغة <code dir="ltr">{"{مرحباً|أهلاً}"}</code> تختار كلمة مختلفة لكل عميل.
              </p>
              <div className="rounded-md bg-muted p-2 text-sm whitespace-pre-line">{preview}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="space-y-1"><Label htmlFor="rd-from">من الساعة</Label><Input id="rd-from" type="time" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="rd-to">إلى الساعة</Label><Input id="rd-to" type="time" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="rd-tz">التوقيت</Label><Input id="rd-tz" dir="ltr" value={tz} onChange={(e) => setTz(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="rd-daily">لكل مندوب باليوم</Label><Input id="rd-daily" type="number" min={1} max={500} dir="ltr" value={daily} onChange={(e) => setDaily(Number(e.target.value) || 0)} /></div>
            </div>
            <p className="text-xs text-muted-foreground">تُرسل الرسائل ببطء وبفاصل عشوائي، فقط داخل هذه الساعات، حتى يكون المندوبون متواجدين عندما يرد العميل.</p>
            {timing && <p className={cn("rounded-md p-2 text-xs", timing.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}>{timing.text}</p>}
            {problem && <p className="text-xs text-destructive">{problem}</p>}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button disabled={pending || !!problem} onClick={() => onConfirm(send ? { body: body.trim(), schedule } : null)}>
            {pending ? "جارٍ التوزيع..." : send ? "وزّع وأرسل الرسائل" : "وزّع بدون رسائل"}
          </Button>
          <Button variant="outline" disabled={pending} onClick={onCancel}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
