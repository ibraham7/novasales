/**
 * What the calendar screen shows, as plain functions: which days a view covers, which UTC range to ask the server for,
 * how meetings group into days, and where a click on the grid lands. Pure, so it is tested without a screen.
 */
import { addDays, fromMinutes, localParts, zonedToUtc } from "./time.ts";

export type CalendarView = "day" | "week" | "month";
export const WEEK_START = 0; // Sunday

export function startOfWeek(date: string, weekStart = WEEK_START): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday - weekStart + 7) % 7));
}
export const startOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, "0")}`;
}

/** The first day shown and how many days (1, 7 or the 42 cells of a month grid). */
export function rangeFor(view: CalendarView, anchor: string): { from: string; days: number } {
  if (view === "day") return { from: anchor, days: 1 };
  if (view === "week") return { from: startOfWeek(anchor), days: 7 };
  return { from: startOfWeek(startOfMonth(anchor)), days: 42 };
}
export function moveAnchor(view: CalendarView, anchor: string, n: number): string {
  return view === "month" ? addMonths(anchor, n) : addDays(anchor, view === "week" ? 7 * n : n);
}

/** The UTC range to ask the server for: from the start of the first local day to the start of the day after the last. */
export function fetchRange(view: CalendarView, anchor: string, timezone: string): { from: string; to: string } {
  const { from, days } = rangeFor(view, anchor);
  const start = zonedToUtc(from, "00:00", timezone) ?? Date.parse(`${from}T00:00:00Z`);
  const end = zonedToUtc(addDays(from, days), "00:00", timezone) ?? Date.parse(`${addDays(from, days)}T00:00:00Z`);
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

export function groupByDay<T extends { starts_at: string }>(meetings: T[], timezone: string): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const m of meetings) {
    const day = localParts(new Date(m.starts_at).getTime(), timezone).date;
    byDay.set(day, [...(byDay.get(day) ?? []), m]);
  }
  return byDay;
}

/** The visible hours of a day column: the organization's hours widened to whole hours, and widened further to include any meeting outside them. */
export function dayWindow(workStart: string, workEnd: string, meetings: { startMin: number; endMin: number }[] = []): { first: number; last: number } {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let first = Math.floor(toMin(workStart) / 60) * 60;
  let last = toMin(workEnd) === 0 ? 1440 : Math.ceil(toMin(workEnd) / 60) * 60;
  for (const m of meetings) { first = Math.min(first, Math.floor(m.startMin / 60) * 60); last = Math.max(last, Math.ceil(m.endMin / 60) * 60); }
  return { first: Math.max(0, first), last: Math.min(1440, Math.max(last, first + 60)) };
}

/** A click on a day column at `offsetPx` from its top: the local time, snapped to 15 minutes and kept inside the window. */
export function clickToTime(offsetPx: number, firstMin: number, lastMin: number, pxPerHour: number): string {
  const minutes = firstMin + Math.floor((Math.max(0, offsetPx) / pxPerHour) * 4) * 15;
  return fromMinutes(Math.min(minutes, lastMin - 15));
}

/** Minutes since local midnight of a UTC moment (end at midnight counts as 24:00). */
export function minutesOfDay(iso: string, timezone: string, asEnd = false): number {
  const m = Math.round(localParts(new Date(iso).getTime(), timezone).minutes);
  return asEnd && m === 0 ? 1440 : m;
}
