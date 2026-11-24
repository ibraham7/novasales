import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CalendarGrid, type MeetingRow } from "@/components/calendar/calendar-grid";
import { MeetingDialog, type MeetingDraft } from "@/components/calendar/meeting-dialog";
import { MeetingDetails } from "@/components/calendar/meeting-details";
import { disableCalendar, enableCalendar, exportMeetingsIcs, getCalendarState, listCalendarOwners, listMeetings } from "@/modules/calendar";
import { fetchRange, moveAnchor, rangeFor, type CalendarView } from "@/modules/calendar/view";
import { localParts, addDays } from "@/modules/calendar/time";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "التقويم - NovaSales" }, { name: "description", content: "مواعيد وعروض ومكالمات ومتابعات مع العملاء." }] }),
  component: CalendarPage,
});

const VIEWS: { value: CalendarView; label: string }[] = [{ value: "day", label: "يوم" }, { value: "week", label: "أسبوع" }, { value: "month", label: "شهر" }];

function CalendarPage() {
  const qc = useQueryClient();
  const stateFn = useServerFn(getCalendarState);
  const listFn = useServerFn(listMeetings);
  const ownersFn = useServerFn(listCalendarOwners);
  const enableFn = useServerFn(enableCalendar);
  const disableFn = useServerFn(disableCalendar);
  const icsFn = useServerFn(exportMeetingsIcs);
  const state = useQuery({ queryKey: ["cal-state"], queryFn: () => stateFn(), retry: false });
  const tz = state.data?.viewerTimezone ?? "UTC";
  const today = useMemo(() => localParts(Date.now(), tz).date, [tz]);

  const [view, setView] = useState<CalendarView>(() => (typeof window !== "undefined" && window.innerWidth < 640 ? "day" : "week"));
  const [anchor, setAnchor] = useState<string | null>(null);
  const [owner, setOwner] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; meeting?: any; draft?: MeetingDraft }>({ open: false });
  const [selected, setSelected] = useState<string | null>(null);
  const cur = anchor ?? today;

  const range = useMemo(() => (state.data?.enabled ? fetchRange(view, cur, tz) : null), [view, cur, tz, state.data?.enabled]);
  const meetings = useQuery({
    queryKey: ["cal-meetings", range?.from, range?.to, owner, showInactive],
    enabled: !!range,
    queryFn: () => listFn({ data: { from: range!.from, to: range!.to, ownerId: owner || null, includeInactive: showInactive } }),
  });
  const owners = useQuery({ queryKey: ["cal-owners"], queryFn: () => ownersFn(), enabled: !!state.data?.canViewAll && !!state.data?.enabled });
  const toggle = useMutation({
    mutationFn: (on: boolean) => (on ? enableFn() : disableFn()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cal-state"] }); toast.success("تم تحديث حالة التقويم"); },
    onError: (e: any) => toast.error(e.message),
  });

  // Download the visible range (the person's own meetings, or the chosen agent's for a manager) as an ICS file.
  const download = useMutation({
    mutationFn: () => icsFn({ data: { from: range!.from, to: range!.to, ownerId: owner || null } }),
    onSuccess: ({ ics }) => {
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = "meetings.ics"; a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e: any) => toast.error(e.message || "تعذر التصدير"),
  });

  if (state.isLoading) return <div className="p-6 text-center">جارِ التحميل...</div>;
  if (state.isError) return <div role="alert" className="p-6 text-center">{(state.error as Error).message || "تعذر تحميل التقويم"}</div>;
  const s = state.data!;

  if (!s.enabled) {
    return (
      <div className="p-3 sm:p-6 lg:p-8 space-y-4" dir="rtl">
        <div className="flex items-center gap-3"><CalendarDays className="h-7 w-7 text-primary" /><h1 className="text-2xl font-bold">التقويم</h1></div>
        <Card className="space-y-3 p-6">
          <p>التقويم غير مفعّل لهذه المؤسسة.</p>
          {s.canManage ? (
            <>
              <p className="text-sm text-muted-foreground">عند التفعيل تُنشأ أنواع مواعيد افتراضية (مكالمة تعريفية، عرض توضيحي، اجتماع متابعة، زيارة ميدانية) ويظهر التقويم للفريق.</p>
              <Button disabled={toggle.isPending} onClick={() => toggle.mutate(true)}>تفعيل التقويم</Button>
            </>
          ) : <p className="text-sm text-muted-foreground">اطلب من مدير المؤسسة تفعيله.</p>}
        </Card>
      </div>
    );
  }

  const rangeInfo = rangeFor(view, cur);
  const title = view === "month"
    ? new Intl.DateTimeFormat("ar", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${cur}T00:00:00Z`))
    : view === "day"
      ? new Intl.DateTimeFormat("ar", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${cur}T00:00:00Z`))
      : `${new Intl.DateTimeFormat("ar", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${rangeInfo.from}T00:00:00Z`))} – ${new Intl.DateTimeFormat("ar", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${addDays(rangeInfo.from, 6)}T00:00:00Z`))}`;
  const rows = (meetings.data ?? []) as MeetingRow[];

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-4 min-w-0" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-7 w-7 text-primary" />
          <div><h1 className="text-2xl font-bold">التقويم</h1><p className="text-xs text-muted-foreground">بتوقيت {tz}</p></div>
        </div>
        {s.canBook && <Button onClick={() => setDialog({ open: true, draft: { ownerId: owner || undefined } })}><Plus className="ml-1 h-4 w-4" />موعد جديد</Button>}
      </div>
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="السابق" onClick={() => setAnchor(moveAnchor(view, cur, -1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(null)}>اليوم</Button>
          <Button size="icon" variant="ghost" aria-label="التالي" onClick={() => setAnchor(moveAnchor(view, cur, 1))}><ChevronLeft className="h-4 w-4" /></Button>
        </div>
        <strong>{title}</strong>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {s.canViewAll && (
            <select aria-label="المندوب" value={owner} onChange={(e) => setOwner(e.target.value)} className="h-9 rounded-md border bg-transparent px-2 text-sm">
              <option value="">كل المندوبين</option>
              {(owners.data ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <div className="flex rounded-md border p-0.5">
            {VIEWS.map((v) => <button key={v.value} type="button" onClick={() => setView(v.value)} className={`rounded px-3 py-1 text-sm ${view === v.value ? "bg-primary text-primary-foreground" : ""}`}>{v.label}</button>)}
          </div>
        </div>
      </Card>
      {meetings.isError ? (
        <Card role="alert" className="space-y-2 p-6 text-center"><p>{(meetings.error as Error).message || "تعذر تحميل المواعيد"}</p><Button onClick={() => meetings.refetch()}>إعادة المحاولة</Button></Card>
      ) : (
        <Card className="relative overflow-hidden p-0">
          {meetings.isFetching && <div className="absolute inset-x-0 top-0 z-20 h-0.5 animate-pulse bg-primary" />}
          <CalendarGrid view={view} anchor={cur} today={today} tz={tz} workStart={s.workStart} workEnd={s.workEnd} meetings={rows} showOwner={s.canViewAll}
            onPick={(m) => setSelected(m.id)} onDay={(d) => { setAnchor(d); setView("day"); }}
            onSlot={(date, start) => s.canBook && setDialog({ open: true, draft: { date, start, ownerId: owner || undefined } })} />
          {!meetings.isLoading && rows.length === 0 && <p className="border-t p-4 text-center text-sm text-muted-foreground">لا توجد مواعيد في هذه الفترة. اضغط على أي وقت في التقويم أو «موعد جديد».</p>}
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setShowInactive((v) => !v)} className="rounded-full border px-3 py-0.5 text-xs font-semibold text-muted-foreground">{showInactive ? "إخفاء الملغاة" : "إظهار الملغاة"}</button>
        <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={download.isPending} onClick={() => download.mutate()}>تصدير ICS</Button>
        {s.canManage && <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={toggle.isPending} onClick={() => { if (confirm("إيقاف التقويم لهذه المؤسسة؟ لن يستطيع أحد حجز مواعيد جديدة. المواعيد الحالية تبقى محفوظة.")) toggle.mutate(false); }}>إيقاف التقويم</Button>}
      </div>
      <MeetingDialog open={dialog.open} onOpenChange={(o) => setDialog((p) => ({ ...p, open: o }))} tz={tz} today={today} canViewAll={s.canViewAll} meeting={dialog.meeting} draft={dialog.draft} />
      <MeetingDetails id={selected} tz={tz} canBook={s.canBook} onClose={() => setSelected(null)} onEdit={(m) => { setSelected(null); setDialog({ open: true, meeting: m }); }} />
    </div>
  );
}
