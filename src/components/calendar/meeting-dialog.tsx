import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createMeeting, getCalendarState, listCalendarOwners, listMeetingTypes, suggestMeetingTimes, updateMeeting } from "@/modules/calendar";
import { listContacts } from "@/modules/crm";
import { CHANNELS, CHANNEL_LABELS } from "@/modules/calendar/status";
import { fromMinutes, zonedToUtc } from "@/modules/calendar/time";
import { customerChoiceProblem, minutesOfDay } from "@/modules/calendar/view";
import { localParts } from "@/modules/calendar/time";
import type { MeetingRow } from "./calendar-grid";

export type MeetingDraft = { date?: string; start?: string; ownerId?: string; contactId?: string | null; contactName?: string | null; opportunityId?: string | null; leadId?: string | null };
type Editing = (MeetingRow & { contact_id?: string | null; opportunity_id?: string | null; lead_id?: string | null; meeting_type_id?: string | null; channel?: string; location?: string | null; internal_notes?: string | null }) | null;

/** Book or change a meeting. The server and the database check hours, breaks and overlap; the suggested times use the same rules. */
export function MeetingDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; tz: string; today: string; canViewAll: boolean; meeting?: Editing; draft?: MeetingDraft }) {
  const qc = useQueryClient();
  const create = useServerFn(createMeeting);
  const update = useServerFn(updateMeeting);
  const owners = useServerFn(listCalendarOwners);
  const types = useServerFn(listMeetingTypes);
  const suggest = useServerFn(suggestMeetingTimes);
  const contacts = useServerFn(listContacts);
  const stateFn = useServerFn(getCalendarState);
  const { meeting, draft, tz } = props;

  const [ownerId, setOwnerId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [date, setDate] = useState(props.today);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("10:30");
  const [channel, setChannel] = useState("call");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);

  // Same cached query the page already uses; only needed to know who «أنا» is.
  const stateQ = useQuery({ queryKey: ["cal-state"], queryFn: () => stateFn(), staleTime: 5 * 60_000, enabled: props.open });
  const ownersQ = useQuery({ queryKey: ["cal-owners"], queryFn: () => owners(), enabled: props.open });
  const typesQ = useQuery({ queryKey: ["cal-types"], queryFn: () => types(), enabled: props.open });
  const contactsQ = useQuery({ queryKey: ["cal-contact-search", search], queryFn: () => contacts({ data: { search } }), enabled: props.open && search.trim().length >= 2 && !contactId });

  useEffect(() => {
    if (!props.open) return;
    if (meeting) {
      const s = minutesOfDay(meeting.starts_at, tz), e = minutesOfDay(meeting.ends_at, tz, true);
      setOwnerId(meeting.owner_user_id); setTypeId(meeting.meeting_type_id ?? ""); setDate(localParts(new Date(meeting.starts_at).getTime(), tz).date);
      setStart(fromMinutes(s)); setEnd(fromMinutes(e === 1440 ? 1439 : e)); setChannel(meeting.channel ?? "call"); setLocation(meeting.location ?? ""); setNotes(meeting.internal_notes ?? "");
      setContactId(meeting.contact_id ?? null); setContactName(meeting.contact_name ?? "");
      setTitle((meeting as any).title ?? ""); setAttendeeIds((meeting.attendees ?? []).map((a) => a.id));
    } else {
      setOwnerId(draft?.ownerId ?? ""); setTypeId(""); setDate(draft?.date ?? props.today); setStart(draft?.start ?? "10:00");
      const [h, m] = (draft?.start ?? "10:00").split(":").map(Number) as [number, number];
      setEnd(fromMinutes(Math.min(1439, h * 60 + m + 30))); setChannel("call"); setLocation(""); setNotes("");
      setContactId(draft?.contactId ?? null); setContactName(draft?.contactName ?? "");
      setTitle(""); setAttendeeIds([]);
    }
    setSearch("");
  }, [props.open, meeting?.id]);

  const pickType = (id: string) => {
    setTypeId(id);
    const t = (typesQ.data ?? []).find((x: any) => x.id === id);
    if (t) { const [h, m] = start.split(":").map(Number) as [number, number]; setEnd(fromMinutes(Math.min(1439, h * 60 + m + t.duration_minutes))); }
  };
  const iso = (time: string) => { const ms = zonedToUtc(date, time, tz); return ms === null ? null : new Date(ms).toISOString(); };

  const save = useMutation({
    mutationFn: async () => {
      const typedProblem = customerChoiceProblem(contactId, search);
      if (typedProblem) throw new Error(typedProblem);
      const startsAt = iso(start), endsAt = iso(end);
      if (!startsAt || !endsAt) throw new Error("هذا الوقت غير موجود في هذا اليوم (تغيير الساعة الصيفية)");
      const body = { startsAt, endsAt, title: title.trim() || null, ...(props.canViewAll ? { attendeeIds } : {}), meetingTypeId: typeId || null, channel: channel as any, location: location || null, internalNotes: notes || null, contactId, opportunityId: meeting ? undefined : (draft?.opportunityId ?? null), leadId: meeting ? undefined : (draft?.leadId ?? null) };
      if (meeting) return update({ data: { id: meeting.id, patch: { ...body, ...(props.canViewAll && ownerId ? { ownerId } : {}) } } });
      return create({ data: { ...body, ...(ownerId ? { ownerId } : {}) } });
    },
    onSuccess: () => { toast.success(meeting ? "تم تعديل الموعد" : "تم حجز الموعد"); qc.invalidateQueries({ queryKey: ["cal-meetings"] }); props.onOpenChange(false); },
    onError: (e: any) => toast.error(e.message || "تعذر حفظ الموعد"),
  });

  const slots = useMutation({
    mutationFn: () => suggest({ data: { meetingTypeId: typeId || null, durationMin: typeId ? undefined : Math.max(5, (Number(end.slice(0, 2)) * 60 + Number(end.slice(3))) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)))), ownerIds: ownerId ? [ownerId] : undefined, count: 5 } }),
    onError: (e: any) => toast.error(e.message || "تعذر اقتراح أوقات"),
  });
  const useSlot = (s: { startsAt: string; endsAt: string }) => {
    const a = new Date(s.startsAt).getTime(), b = new Date(s.endsAt).getTime();
    setDate(localParts(a, tz).date); setStart(fromMinutes(minutesOfDay(s.startsAt, tz))); setEnd(fromMinutes(minutesOfDay(s.endsAt, tz, true) % 1440));
    void b;
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" dir="rtl">
        <DialogHeader><DialogTitle>{meeting ? "تعديل الموعد" : "موعد جديد"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>العميل</Label>
            {contactId ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{contactName || "عميل"}</span>
                <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setContactId(null); setContactName(""); }}>تغيير</button>
              </div>
            ) : (
              <>
                <Input placeholder="ابحث بالاسم أو الرقم (حرفان على الأقل)" value={search} onChange={(e) => setSearch(e.target.value)} />
                {(contactsQ.data ?? []).slice(0, 6).map((c: any) => (
                  <button key={c.id} type="button" onClick={() => { setContactId(c.id); setContactName(c.name ?? ""); }} className="mt-1 block w-full rounded border px-3 py-1.5 text-start text-sm hover:bg-muted">{c.name || c.phone}</button>
                ))}
                {search.trim().length >= 2 && contactsQ.isFetched && !contactsQ.isFetching && (contactsQ.data ?? []).length === 0 && (
                  <div className="mt-1 space-y-1 rounded border border-dashed p-2 text-sm">
                    <p className="text-muted-foreground">لا يوجد عميل بهذا الاسم أو الرقم.</p>
                    <Button type="button" size="sm" variant="outline" onClick={() => { setTitle(search.trim()); setSearch(""); }}>استعمل «{search.trim()}» كعنوان للموعد</Button>
                  </div>
                )}
                {search.trim().length === 1 && <p className="mt-1 text-xs text-muted-foreground">اكتب حرفين على الأقل ثم اختر العميل من النتائج.</p>}
                {title.trim() && !search.trim() && (
                  <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                    <span>
                      سيظهر الموعد باسم «<strong>{title.trim()}</strong>» <span className="text-muted-foreground">(غير مربوط بعميل)</span>
                    </span>
                    <button type="button" className="shrink-0 text-xs text-muted-foreground underline" onClick={() => { setSearch(title.trim()); setTitle(""); }}>تغيير</button>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>المندوب</Label>
              <Select value={ownerId || stateQ.data?.viewerId || ""} onValueChange={setOwnerId} disabled={!props.canViewAll}>
                <SelectTrigger><SelectValue placeholder="أنا" /></SelectTrigger>
                <SelectContent>{(ownersQ.data ?? []).map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>النوع</Label>
              <Select value={typeId} onValueChange={pickType}>
                <SelectTrigger><SelectValue placeholder="اختر النوع" /></SelectTrigger>
                <SelectContent>{(typesQ.data ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.duration_minutes} د)</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>عنوان الموعد (اختياري)</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="مثال: اجتماع مع الإدارة" /></div>
          {props.canViewAll && (
            <div>
              <Label>مشاركون من الفريق (اختياري)</Label>
              <p className="mb-1 text-xs text-muted-foreground">يظهر الموعد في تقويمهم ولا يستطيع أحدهم حجز موعد آخر بنفس الوقت.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border p-2">
                {(ownersQ.data ?? []).filter((o: any) => o.id !== (ownerId || stateQ.data?.viewerId)).map((o: any) => (
                  <label key={o.id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={attendeeIds.includes(o.id)} onChange={(e) => setAttendeeIds((cur) => (e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id)))} />
                    {o.name}
                  </label>
                ))}
                {(ownersQ.data ?? []).length <= 1 && <span className="text-xs text-muted-foreground">لا يوجد أعضاء آخرون</span>}
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3 sm:col-span-1"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><Label>من</Label><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><Label>إلى</Label><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">الأوقات بتوقيت {tz}</p>
          <div>
            <Button type="button" size="sm" variant="outline" disabled={slots.isPending} onClick={() => slots.mutate()}>اقترح أوقاتاً متاحة</Button>
            <div className="mt-2 flex flex-wrap gap-2">
              {(slots.data ?? []).map((s: any) => (
                <button key={s.startsAt} type="button" onClick={() => useSlot(s)} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">{s.date} · {s.start}</button>
              ))}
              {slots.data && slots.data.length === 0 && <span className="text-xs text-muted-foreground">لا توجد أوقات متاحة قريباً</span>}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>القناة</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>{channel === "link" ? "رابط الاجتماع" : "المكان أو التفاصيل"}</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={500} /></div>
          </div>
          <div><Label>ملاحظات داخلية</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>إلغاء</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? (meeting ? "جارٍ الحفظ..." : "جارٍ الحجز...") : meeting ? "حفظ" : "حجز"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
