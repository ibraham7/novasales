import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addCalendarTimeOff, deleteCalendarTimeOff, getCalendarConfig, getCalendarState, listCalendarOwners, saveCalendarMeetingType, saveCalendarOrgSettings, saveCalendarSchedule } from "@/modules/calendar";

export const Route = createFileRoute("/_authenticated/settings/calendar")({
  head: () => ({ meta: [{ title: "إعدادات التقويم - NovaSales" }] }),
  component: CalendarSettings,
});

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const ZONES = ["Europe/Istanbul", "Asia/Riyadh", "Asia/Dubai", "Asia/Baghdad", "Asia/Amman", "Asia/Beirut", "Africa/Cairo", "Europe/London", "UTC"];

function CalendarSettings() {
  const qc = useQueryClient();
  const stateFn = useServerFn(getCalendarState);
  const cfgFn = useServerFn(getCalendarConfig);
  const ownersFn = useServerFn(listCalendarOwners);
  const state = useQuery({ queryKey: ["cal-state"], queryFn: () => stateFn(), retry: false });
  const [userId, setUserId] = useState<string>("");
  const cfg = useQuery({ queryKey: ["cal-config", userId], queryFn: () => cfgFn({ data: { userId: userId || null } }), enabled: !!state.data });
  const owners = useQuery({ queryKey: ["cal-owners"], queryFn: () => ownersFn(), enabled: !!state.data?.canManage });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["cal-config"] }); qc.invalidateQueries({ queryKey: ["cal-state"] }); };
  const onError = (e: any) => toast.error(e.message || "تعذر الحفظ");

  const saveOrg = useServerFn(saveCalendarOrgSettings);
  const saveSchedule = useServerFn(saveCalendarSchedule);
  const saveType = useServerFn(saveCalendarMeetingType);
  const addOff = useServerFn(addCalendarTimeOff);
  const delOff = useServerFn(deleteCalendarTimeOff);

  const [org, setOrg] = useState<any>(null);
  const [week, setWeek] = useState<Record<number, { on: boolean; start: string; end: string }>>({});
  const [breaks, setBreaks] = useState<{ weekday: number; start: string; end: string }[]>([]);
  const [agentTz, setAgentTz] = useState("");
  const [off, setOff] = useState({ from: "", to: "", reason: "" });
  const [newType, setNewType] = useState({ name: "", durationMinutes: 30, color: "#3b82f6" });

  useEffect(() => {
    if (!cfg.data) return;
    setOrg(cfg.data.org);
    setWeek(Object.fromEntries(DAYS.map((_, d) => { const row = cfg.data.availability.find((a: any) => a.weekday === d); return [d, { on: !!row, start: row?.start ?? cfg.data.org.workStart, end: row?.end ?? cfg.data.org.workEnd }]; })));
    setBreaks(cfg.data.breaks.map((b: any) => ({ weekday: b.weekday, start: b.start, end: b.end })));
    setAgentTz(cfg.data.agentTimezone ?? "");
  }, [cfg.data]);

  const orgMut = useMutation({ mutationFn: () => saveOrg({ data: { timezone: org.timezone, workingDays: org.workingDays, workStart: org.workStart, workEnd: org.workEnd } }), onSuccess: () => { toast.success("تم حفظ دوام المؤسسة"); refresh(); }, onError });
  const weekMut = useMutation({
    mutationFn: () => saveSchedule({ data: { userId: userId || null, availability: DAYS.flatMap((_, d) => (week[d]?.on ? [{ weekday: d, start: week[d]!.start, end: week[d]!.end }] : [])), breaks, agentTimezone: agentTz || null } }),
    onSuccess: () => { toast.success("تم حفظ الجدول"); refresh(); }, onError,
  });
  const typeMut = useMutation({ mutationFn: (v: any) => saveType({ data: v }), onSuccess: () => { toast.success("تم حفظ النوع"); setNewType({ name: "", durationMinutes: 30, color: "#3b82f6" }); refresh(); }, onError });
  const addOffMut = useMutation({ mutationFn: () => addOff({ data: { userId: userId || null, from: off.from, to: off.to || off.from, reason: off.reason || null } }), onSuccess: () => { toast.success("أُضيفت الإجازة"); setOff({ from: "", to: "", reason: "" }); refresh(); }, onError });
  const delOffMut = useMutation({ mutationFn: (id: string) => delOff({ data: { id } }), onSuccess: refresh, onError });

  if (state.isLoading || cfg.isLoading) return <p className="p-4 text-sm">جارِ التحميل...</p>;
  if (state.isError || cfg.isError) return <p role="alert" className="p-4 text-sm">{((state.error ?? cfg.error) as Error)?.message || "تعذر تحميل الإعدادات"}</p>;
  if (!state.data?.enabled) return <Card className="p-6 text-sm">التقويم غير مفعّل لهذه المؤسسة. فعّله من صفحة «التقويم» أولاً.</Card>;
  const manage = state.data.canManage;
  return (
    <div className="space-y-6" dir="rtl">
      <h2 className="text-xl font-bold">إعدادات التقويم</h2>

      {manage && org && (
        <Card className="space-y-3 p-4">
          <h3 className="font-semibold">دوام المؤسسة (الافتراضي لكل المندوبين)</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><Label>المنطقة الزمنية</Label><Input list="cal-zones" dir="ltr" value={org.timezone} onChange={(e) => setOrg({ ...org, timezone: e.target.value })} /><datalist id="cal-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist></div>
            <div><Label>من</Label><Input type="time" value={org.workStart} onChange={(e) => setOrg({ ...org, workStart: e.target.value })} /></div>
            <div><Label>إلى</Label><Input type="time" value={org.workEnd} onChange={(e) => setOrg({ ...org, workEnd: e.target.value })} /></div>
          </div>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((d, i) => <label key={i} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={org.workingDays.includes(i)} onChange={(e) => setOrg({ ...org, workingDays: e.target.checked ? [...org.workingDays, i] : org.workingDays.filter((x: number) => x !== i) })} />{d}</label>)}
          </div>
          <Button disabled={orgMut.isPending} onClick={() => orgMut.mutate()}>حفظ دوام المؤسسة</Button>
        </Card>
      )}

      {manage && (
        <Card className="space-y-3 p-4">
          <h3 className="font-semibold">أنواع الاجتماعات</h3>
          {(cfg.data?.types ?? []).map((t: any) => <TypeRow key={t.id} t={t} onSave={(v) => typeMut.mutate({ id: t.id, ...v })} />)}
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-5">
            <div className="sm:col-span-2"><Label>نوع جديد</Label><Input value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} maxLength={80} /></div>
            <div><Label>المدة (د)</Label><Input type="number" min={5} max={600} value={newType.durationMinutes} onChange={(e) => setNewType({ ...newType, durationMinutes: Number(e.target.value) })} /></div>
            <div><Label>اللون</Label><Input type="color" value={newType.color} onChange={(e) => setNewType({ ...newType, color: e.target.value })} /></div>
            <Button disabled={typeMut.isPending || !newType.name.trim()} onClick={() => typeMut.mutate(newType)}>إضافة</Button>
          </div>
        </Card>
      )}

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{userId ? "جدول المندوب" : "جدولي"}</h3>
          {manage && (
            <select aria-label="المندوب" value={userId} onChange={(e) => setUserId(e.target.value)} className="h-9 rounded-md border bg-transparent px-2 text-sm">
              <option value="">أنا</option>
              {(owners.data ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>
        <p className="text-xs text-muted-foreground">بدون أي يوم محدّد هنا يُستعمل دوام المؤسسة. حدّد أياماً لتخصيص دوامك.</p>
        {DAYS.map((d, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <label className="flex w-24 items-center gap-1 text-sm"><input type="checkbox" checked={!!week[i]?.on} onChange={(e) => setWeek({ ...week, [i]: { ...week[i]!, on: e.target.checked } })} />{d}</label>
            <Input type="time" className="w-32" disabled={!week[i]?.on} value={week[i]?.start ?? ""} onChange={(e) => setWeek({ ...week, [i]: { ...week[i]!, start: e.target.value } })} />
            <span>–</span>
            <Input type="time" className="w-32" disabled={!week[i]?.on} value={week[i]?.end ?? ""} onChange={(e) => setWeek({ ...week, [i]: { ...week[i]!, end: e.target.value } })} />
          </div>
        ))}
        <div className="space-y-2">
          <Label>الاستراحات</Label>
          {breaks.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select aria-label="يوم الاستراحة" value={b.weekday} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))} className="h-9 rounded-md border bg-transparent px-2 text-sm">{DAYS.map((d, k) => <option key={k} value={k}>{d}</option>)}</select>
              <Input type="time" className="w-32" value={b.start} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <span>–</span>
              <Input type="time" className="w-32" value={b.end} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
              <Button size="icon" variant="ghost" aria-label="حذف الاستراحة" onClick={() => setBreaks(breaks.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setBreaks([...breaks, { weekday: 1, start: "12:00", end: "13:00" }])}>إضافة استراحة</Button>
        </div>
        <div className="max-w-xs"><Label>منطقتي الزمنية (اختياري)</Label><Input list="cal-zones" dir="ltr" placeholder="مثل منطقة المؤسسة" value={agentTz} onChange={(e) => setAgentTz(e.target.value)} /></div>
        <Button disabled={weekMut.isPending} onClick={() => weekMut.mutate()}>حفظ الجدول</Button>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">الإجازات</h3>
        {(cfg.data?.timeOff ?? []).map((t: any) => (
          <div key={t.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
            <span>{t.from === t.to ? t.from : `${t.from} → ${t.to}`}{t.reason ? ` · ${t.reason}` : ""}</span>
            <Button size="icon" variant="ghost" aria-label="حذف الإجازة" onClick={() => delOffMut.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-4">
          <div><Label>من</Label><Input type="date" value={off.from} onChange={(e) => setOff({ ...off, from: e.target.value })} /></div>
          <div><Label>إلى</Label><Input type="date" value={off.to} onChange={(e) => setOff({ ...off, to: e.target.value })} /></div>
          <div><Label>السبب</Label><Input value={off.reason} maxLength={200} onChange={(e) => setOff({ ...off, reason: e.target.value })} /></div>
          <Button disabled={!off.from || addOffMut.isPending} onClick={() => addOffMut.mutate()}>إضافة إجازة</Button>
        </div>
      </Card>
    </div>
  );
}

function TypeRow({ t, onSave }: { t: any; onSave: (v: { name: string; durationMinutes: number; color: string; isActive: boolean }) => void }) {
  const [v, setV] = useState({ name: t.name as string, durationMinutes: t.duration_minutes as number, color: t.color as string, isActive: t.is_active as boolean });
  return (
    <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-6">
      <Input className="col-span-2" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <Input type="number" min={5} max={600} value={v.durationMinutes} onChange={(e) => setV({ ...v, durationMinutes: Number(e.target.value) })} />
      <Input type="color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} />
      <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />فعّال</label>
      <Button size="sm" variant="outline" onClick={() => onSave(v)}>حفظ</Button>
    </div>
  );
}
