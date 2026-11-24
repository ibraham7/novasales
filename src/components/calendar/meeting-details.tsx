import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getMeeting, recordMeetingOutcome, setMeetingStatus } from "@/modules/calendar";
import { ACTIONS, CHANNEL_LABELS, OUTCOMES, OUTCOME_LABELS, STATUS_LABELS, canSetOutcome, type MeetingStatus } from "@/modules/calendar/status";
import { fromMinutes } from "@/modules/calendar/time";
import { minutesOfDay } from "@/modules/calendar/view";
import { localParts } from "@/modules/calendar/time";

/** The details of one meeting with the buttons that are allowed for its status. Cancelling asks for an optional reason. */
export function MeetingDetails(props: { id: string | null; tz: string; canBook: boolean; onClose: () => void; onEdit: (meeting: any) => void }) {
  const qc = useQueryClient();
  const load = useServerFn(getMeeting);
  const setStatus = useServerFn(setMeetingStatus);
  const outcome = useServerFn(recordMeetingOutcome);
  const q = useQuery({ queryKey: ["cal-meeting", props.id], queryFn: () => load({ data: { id: props.id! } }), enabled: !!props.id });
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState("");
  const done = () => { qc.invalidateQueries({ queryKey: ["cal-meetings"] }); qc.invalidateQueries({ queryKey: ["cal-meeting", props.id] }); };
  const move = useMutation({
    mutationFn: (v: { to: MeetingStatus; reason?: string }) => setStatus({ data: { id: props.id!, status: v.to, reason: v.reason ?? null } }),
    onSuccess: () => { done(); setCancelling(false); setReason(""); toast.success("تم تحديث الموعد"); },
    onError: (e: any) => toast.error(e.message || "تعذر تحديث الموعد"),
  });
  const saveOutcome = useMutation({
    mutationFn: (value: (typeof OUTCOMES)[number]) => outcome({ data: { id: props.id!, outcome: value, note: note || null } }),
    onSuccess: () => { done(); toast.success("سُجّلت النتيجة"); },
    onError: (e: any) => toast.error(e.message || "تعذر تسجيل النتيجة"),
  });
  const m: any = q.data;
  const day = m ? new Intl.DateTimeFormat("ar", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${localParts(new Date(m.starts_at).getTime(), props.tz).date}T00:00:00Z`)) : "";
  return (
    <Dialog open={!!props.id} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>تفاصيل الموعد</DialogTitle></DialogHeader>
        {q.isLoading && <p className="text-sm text-muted-foreground">جارِ التحميل...</p>}
        {q.isError && <p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p>}
        {m && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-base">{m.contact_name || m.title || m.type_name || "موعد"}</strong>
              <Badge variant="secondary">{STATUS_LABELS[m.status as MeetingStatus] ?? m.status}</Badge>
              {m.type_name && <Badge variant="outline">{m.type_name}</Badge>}
            </div>
            <div className="space-y-1 text-muted-foreground">
              <div>{day} · {fromMinutes(minutesOfDay(m.starts_at, props.tz))} – {fromMinutes(minutesOfDay(m.ends_at, props.tz, true) % 1440)}</div>
              {m.owner_name && <div>المندوب: {m.owner_name}</div>}
              {(m.attendees ?? []).length > 0 && <div>المشاركون: {(m.attendees as { name: string | null }[]).map((a) => a.name || "عضو").join("، ")}</div>}
              <div>القناة: {CHANNEL_LABELS[m.channel as keyof typeof CHANNEL_LABELS] ?? m.channel}{m.location ? ` · ${m.location}` : ""}</div>
              {m.internal_notes && <div className="whitespace-pre-wrap">ملاحظات: {m.internal_notes}</div>}
              {m.cancellation_reason && <div>سبب الإلغاء: {m.cancellation_reason}</div>}
              {m.outcome && <div>النتيجة: {OUTCOME_LABELS[m.outcome as keyof typeof OUTCOME_LABELS]}{m.outcome_note ? ` — ${m.outcome_note}` : ""}</div>}
              {m.opportunity_id && <div><Link to="/pipeline/$oppId" params={{ oppId: m.opportunity_id }} className="text-primary underline">فتح الفرصة</Link></div>}
            </div>
            {props.canBook && ACTIONS[m.status as MeetingStatus]?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {ACTIONS[m.status as MeetingStatus].map((a) => (
                  <Button key={a.to} size="sm" variant={a.to === "cancelled" || a.to === "no_show" ? "outline" : "default"} disabled={move.isPending}
                    onClick={() => (a.to === "cancelled" ? setCancelling(true) : move.mutate({ to: a.to }))}>{a.label}</Button>
                ))}
                <Button size="sm" variant="outline" onClick={() => props.onEdit(m)}>إعادة جدولة / تعديل</Button>
              </div>
            )}
            {cancelling && (
              <div className="space-y-2 rounded-md border p-3">
                <Textarea rows={2} placeholder="سبب الإلغاء (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" disabled={move.isPending} onClick={() => move.mutate({ to: "cancelled", reason })}>تأكيد الإلغاء</Button>
                  <Button size="sm" variant="outline" onClick={() => setCancelling(false)}>رجوع</Button>
                </div>
              </div>
            )}
            {props.canBook && canSetOutcome(m.status) && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="font-medium">نتيجة الموعد</div>
                <Textarea rows={2} placeholder="ملاحظة النتيجة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                <div className="flex flex-wrap gap-2">
                  {OUTCOMES.map((o) => <Button key={o} size="sm" variant={m.outcome === o ? "default" : "outline"} disabled={saveOutcome.isPending} onClick={() => saveOutcome.mutate(o)}>{OUTCOME_LABELS[o]}</Button>)}
                </div>
                <p className="text-xs text-muted-foreground">تسجيل النتيجة لا ينقل مرحلة الفرصة تلقائياً.</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
