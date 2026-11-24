import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCalendarState, listEntityMeetings, suggestMeetingTimes } from "@/modules/calendar";
import { STATUS_LABELS, type MeetingStatus } from "@/modules/calendar/status";
import { fromMinutes, localParts } from "@/modules/calendar/time";
import { minutesOfDay } from "@/modules/calendar/view";
import { MeetingDialog } from "./meeting-dialog";
import { MeetingDetails } from "./meeting-details";

/**
 * «حجز موعد» next to a customer, an opportunity or a chat. It appears only when the calendar is switched on for the
 * organization and the person may book. In a chat it can also offer free times and put one into the message box
 * (the person reads and sends it; nothing is sent from here).
 */
export function BookMeetingButton(props: { contactId?: string | null; contactName?: string | null; opportunityId?: string | null; leadId?: string | null; ownerId?: string | null; onInsertText?: (text: string) => void; className?: string }) {
  const stateFn = useServerFn(getCalendarState);
  const listFn = useServerFn(listEntityMeetings);
  const suggestFn = useServerFn(suggestMeetingTimes);
  const state = useQuery({ queryKey: ["cal-state"], queryFn: () => stateFn(), staleTime: 5 * 60_000, retry: false });
  const hasEntity = !!(props.opportunityId || props.leadId || props.contactId);
  const mine = useQuery({ queryKey: ["cal-entity", props.opportunityId, props.leadId, props.contactId], enabled: !!state.data?.enabled && hasEntity, queryFn: () => listFn({ data: { opportunityId: props.opportunityId ?? null, leadId: props.leadId ?? null, contactId: props.contactId ?? null } }) });
  const [open, setOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const offers = useQuery({ queryKey: ["cal-offers", offerOpen], enabled: offerOpen, queryFn: () => suggestFn({ data: { durationMin: 30, count: 5 } }) });

  if (!state.data?.enabled || !state.data.canBook) return null;
  const tz = state.data.viewerTimezone;
  const today = localParts(Date.now(), tz).date;
  const count = (mine.data ?? []).length;
  const dayLabel = (date: string) => new Intl.DateTimeFormat("ar", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T00:00:00Z`));
  return (
    <>
      <div className={props.className ?? "flex flex-wrap items-center gap-2"}>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}><CalendarPlus className="h-4 w-4" />حجز موعد</Button>
        {count > 0 && <Button size="sm" variant="ghost" onClick={() => setListOpen(true)}>مواعيده ({count})</Button>}
        {props.onInsertText && <Button size="sm" variant="ghost" onClick={() => setOfferOpen(true)}>اقترح أوقاتاً</Button>}
      </div>
      <MeetingDialog open={open} onOpenChange={setOpen} tz={tz} today={today} canViewAll={state.data.canViewAll} draft={{ ownerId: state.data.canViewAll ? (props.ownerId ?? undefined) : undefined, contactId: props.contactId ?? null, contactName: props.contactName ?? null, opportunityId: props.opportunityId ?? null, leadId: props.leadId ?? null }} />
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader><DialogTitle>المواعيد</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {(mine.data ?? []).map((m: any) => (
              <button key={m.id} type="button" onClick={() => { setListOpen(false); setSelected(m.id); }} className="flex w-full items-center justify-between rounded border px-3 py-2 text-start text-sm hover:bg-muted">
                <span>{dayLabel(localParts(new Date(m.starts_at).getTime(), tz).date)} · {fromMinutes(minutesOfDay(m.starts_at, tz))}{m.type_name ? ` · ${m.type_name}` : ""}</span>
                <span className="text-xs text-muted-foreground">{STATUS_LABELS[m.status as MeetingStatus] ?? m.status}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={offerOpen} onOpenChange={setOfferOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader><DialogTitle>أوقات متاحة</DialogTitle></DialogHeader>
          {offers.isLoading && <p className="text-sm text-muted-foreground">جارِ البحث...</p>}
          {offers.isError && <p role="alert" className="text-sm text-destructive">{(offers.error as Error).message}</p>}
          {offers.data?.length === 0 && <p className="text-sm text-muted-foreground">لا توجد أوقات متاحة قريباً.</p>}
          <div className="space-y-2">
            {(offers.data ?? []).map((s: any) => (
              <Button key={s.startsAt} variant="outline" className="w-full justify-start" onClick={() => { props.onInsertText?.(`هل يناسبك ${dayLabel(s.date)} الساعة ${s.start}؟`); setOfferOpen(false); }}>{dayLabel(s.date)} · {s.start}</Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">يوضع الاقتراح في مربع الرسالة لتراجعه وترسله أنت، ولا يُرسل شيء تلقائياً.</p>
        </DialogContent>
      </Dialog>
      <MeetingDetails id={selected} tz={tz} canBook={state.data.canBook} onClose={() => setSelected(null)} onEdit={() => setSelected(null)} />
    </>
  );
}
