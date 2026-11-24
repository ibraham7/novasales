import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { addDays, fromMinutes, localParts } from "@/modules/calendar/time";
import { blockGeometry, layoutDay } from "@/modules/calendar/layout";
import { STATUS_LABELS } from "@/modules/calendar/status";
import { clickToTime, dayWindow, groupByDay, minutesOfDay, nowMarker, rangeFor, type CalendarView } from "@/modules/calendar/view";

export type MeetingRow = {
  id: string; owner_user_id: string; starts_at: string; ends_at: string; status: string; title: string | null;
  contact_name: string | null; type_name: string | null; type_color: string | null; owner_name: string | null;
};
const HOUR = 64;
const INACTIVE = new Set(["cancelled", "no_show"]);
const tone: Record<string, string> = {
  booked: "bg-muted text-foreground", confirmed: "bg-primary/15 text-foreground", in_progress: "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-50",
  completed: "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-50", cancelled: "bg-red-50 text-red-900 line-through", no_show: "bg-red-100 text-red-900",
};
const label = (m: MeetingRow) => m.contact_name || m.title || m.type_name || "موعد";
const time = (iso: string, tz: string) => fromMinutes(minutesOfDay(iso, tz));
const dayName = (date: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ar", { timeZone: "UTC", ...opts }).format(new Date(`${date}T00:00:00Z`));

/** The current time, refreshed every 30 seconds. Null on the server and on the first paint, so the page matches what the server drew. */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function CalendarGrid(props: {
  view: CalendarView; anchor: string; today: string; tz: string; workStart: string; workEnd: string; meetings: MeetingRow[];
  showOwner: boolean; onPick: (m: MeetingRow) => void; onSlot: (date: string, start: string) => void; onDay: (date: string) => void;
}) {
  const { view, anchor, today, tz, meetings } = props;
  const range = rangeFor(view, anchor);
  const byDay = useMemo(() => groupByDay(meetings, tz), [meetings, tz]);
  const now = useNow();

  if (view === "month") {
    return (
      <div className="grid grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => <div key={i} className="border-b bg-muted/50 px-1 py-2 text-center text-xs font-semibold text-muted-foreground">{dayName(addDays(range.from, i), { weekday: "short" })}</div>)}
        {Array.from({ length: 42 }, (_, i) => {
          const date = addDays(range.from, i);
          const list = byDay.get(date) ?? [];
          return (
            <div key={date} role="button" tabIndex={0} onClick={() => props.onDay(date)} onKeyDown={(e) => e.key === "Enter" && props.onDay(date)}
              className={cn("min-h-24 cursor-pointer border-b border-e p-1 hover:bg-muted/40", date.slice(0, 7) !== anchor.slice(0, 7) && "bg-muted/20 text-muted-foreground")}>
              <span className={cn("inline-grid size-6 place-items-center rounded-full text-xs font-semibold", date === today && "bg-primary text-primary-foreground")}>{Number(date.slice(8))}</span>
              <div className="mt-1 space-y-1">
                {list.slice(0, 3).map((m) => (
                  <button key={m.id} type="button" onClick={(e) => { e.stopPropagation(); props.onPick(m); }} className={cn("block w-full truncate rounded px-1 py-0.5 text-start text-[11px]", tone[m.status], INACTIVE.has(m.status) && "opacity-60")}>
                    {time(m.starts_at, tz)} {label(m)}
                  </button>
                ))}
                {list.length > 3 && <span className="block text-[11px] text-muted-foreground">+{list.length - 3} أخرى</span>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const blocks = meetings.map((m) => ({ m, startMin: minutesOfDay(m.starts_at, tz), endMin: minutesOfDay(m.ends_at, tz, true) }));
  const { first, last } = dayWindow(props.workStart, props.workEnd, blocks);
  const height = ((last - first) / 60) * HOUR;
  const days = Array.from({ length: range.days }, (_, i) => addDays(range.from, i));
  const marker = now === null ? null : nowMarker(now, tz, first, last, HOUR);
  const markerShown = marker !== null && days.includes(marker.date);
  return (
    <div className="overflow-x-auto">
      <div className={view === "week" ? "min-w-[760px]" : "min-w-[280px]"}>
        <div className="grid border-b bg-muted/50" style={{ gridTemplateColumns: `48px repeat(${days.length}, 1fr)` }}>
          <div />
          {days.map((d) => (
            <button key={d} type="button" onClick={() => props.onDay(d)} className={cn("py-2 text-center text-xs font-semibold", d === today && "text-primary")}>
              {dayName(d, { weekday: "short", day: "numeric" })}
            </button>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, 1fr)` }}>
          <div className="relative" style={{ height }}>
            {Array.from({ length: Math.ceil((last - first) / 60) }, (_, h) => <span key={h} className="absolute start-1 text-[11px] text-muted-foreground" style={{ top: h * HOUR }}>{fromMinutes(first + h * 60)}</span>)}
            {markerShown && <span className="pointer-events-none absolute start-0.5 z-20 -translate-y-1/2 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white" style={{ top: marker.top }}>{marker.label}</span>}
          </div>
          {days.map((date) => {
            const list = (byDay.get(date) ?? []).filter((m) => localParts(new Date(m.starts_at).getTime(), tz).date === date);
            const placed = layoutDay(list.map((m) => ({ id: m.id, startMs: new Date(m.starts_at).getTime(), endMs: new Date(m.ends_at).getTime() })));
            return (
              <div key={date} className={cn("relative border-e", date === today && "bg-primary/5")} style={{ height }}
                onClick={(e) => props.onSlot(date, clickToTime(e.nativeEvent.offsetY, first, last, HOUR))}>
                {Array.from({ length: Math.ceil((last - first) / 60) }, (_, h) => <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: h * HOUR }} />)}
                {markerShown && marker.date === date && <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 h-0.5 -translate-y-1/2 bg-red-500" style={{ top: marker.top }}><span className="absolute start-0 top-1/2 size-2 -translate-y-1/2 rounded-full bg-red-500" /></div>}
                {list.map((m) => {
                  const s = minutesOfDay(m.starts_at, tz), e = minutesOfDay(m.ends_at, tz, true);
                  const { top, height: h } = blockGeometry(s, e, first, HOUR);
                  const p = placed.get(m.id) ?? { col: 0, cols: 1 };
                  return (
                    <button key={m.id} type="button" onClick={(ev) => { ev.stopPropagation(); props.onPick(m); }} title={`${time(m.starts_at, tz)} · ${label(m)} · ${STATUS_LABELS[m.status as keyof typeof STATUS_LABELS] ?? m.status}`}
                      className={cn("absolute overflow-hidden rounded-md border-s-4 px-1.5 py-0.5 text-start text-[11px] leading-4 shadow-sm hover:z-10", tone[m.status], INACTIVE.has(m.status) && "opacity-60")}
                      style={{ top, height: h - 2, insetInlineStart: `${(p.col / p.cols) * 100}%`, width: `calc(${100 / p.cols}% - 3px)`, borderColor: m.type_color ?? undefined }}>
                      <strong className="block truncate">{label(m)}</strong>
                      <span className="block truncate opacity-80">{time(m.starts_at, tz)}{m.type_name ? ` · ${m.type_name}` : ""}</span>
                      {props.showOwner && h >= 56 && <span className="block truncate opacity-70">{m.owner_name}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
