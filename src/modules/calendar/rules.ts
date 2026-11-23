/**
 * Is this time acceptable for this agent? The same rules, in the same order, as the database trigger
 * (cal_meetings_before_write), so the form can answer instantly and the database stays the last word:
 *   busy elsewhere → crosses midnight → time off → no working day → outside hours → on a break.
 * The agent's own schedule replaces the organization's hours when it has any rows. Pure.
 */
import { BUSY_STATUSES } from "./status.ts";
import { addDays, localParts, toMinutes } from "./time.ts";

export type CalendarContext = {
  /** The organization's zone, and the agent's own zone if they set one. */
  timezone: string;
  agentTimezone?: string | null;
  /** The organization's default week: weekdays (0 = Sunday) and hours. */
  workingDays: number[];
  workStart: string;
  workEnd: string;
  /** The agent's own schedule: one row per working weekday. Empty = use the organization's. */
  availability: { weekday: number; start: string; end: string }[];
  breaks: { weekday: number; start: string; end: string }[];
  /** Whole days off (inclusive local dates, YYYY-MM-DD). */
  timeOff: { from: string; to: string }[];
};

export type RuleCode = "CAL_BAD_RANGE" | "CAL_OWNER_BUSY" | "CAL_OUTSIDE_HOURS" | "CAL_TIME_OFF" | "CAL_OFF_DAY" | "CAL_CLOSED_DAY" | "CAL_ON_BREAK";
export type Busy = { id?: string; starts_at: string | number | Date; ends_at: string | number | Date; status?: string };

export const effectiveTimezone = (ctx: Pick<CalendarContext, "timezone" | "agentTimezone">) => ctx.agentTimezone || ctx.timezone || "Europe/Istanbul";
const DAY_MS = 86_400_000;
const endOfDay = (end: string) => (toMinutes(end) === 0 ? 1440 : toMinutes(end));
const ms = (v: string | number | Date) => new Date(v).getTime();

/** Does [from, to) overlap one of the agent's busy meetings? Cancelled and no-show meetings do not count. */
export function overlapsBusy(busy: Busy[], from: number, to: number, ignoreId?: string): boolean {
  return busy.some((b) => (!b.status || (BUSY_STATUSES as readonly string[]).includes(b.status)) && (ignoreId === undefined || b.id !== ignoreId) && ms(b.starts_at) < to && ms(b.ends_at) > from);
}

export function validateMeetingTime(ctx: CalendarContext, startsAt: number, endsAt: number, busy: Busy[] = [], ignoreId?: string): RuleCode | null {
  if (!(endsAt > startsAt) || endsAt - startsAt > DAY_MS) return "CAL_BAD_RANGE";
  if (overlapsBusy(busy, startsAt, endsAt, ignoreId)) return "CAL_OWNER_BUSY";
  const tz = effectiveTimezone(ctx);
  const s = localParts(startsAt, tz);
  const e = localParts(endsAt, tz);
  const nextDay = e.date > s.date;
  const endsAtMidnight = e.date === addDays(s.date, 1) && e.minutes === 0;
  if (nextDay && !endsAtMidnight) return "CAL_OUTSIDE_HOURS";
  const endMinutes = nextDay ? 1440 : e.minutes;
  if (ctx.timeOff.some((t) => s.date >= t.from && s.date <= t.to)) return "CAL_TIME_OFF";
  let from: number, to: number;
  if (ctx.availability.length) {
    const day = ctx.availability.find((a) => a.weekday === s.weekday);
    if (!day) return "CAL_OFF_DAY";
    from = toMinutes(day.start); to = endOfDay(day.end);
  } else {
    if (!ctx.workingDays.includes(s.weekday)) return "CAL_CLOSED_DAY";
    from = toMinutes(ctx.workStart); to = endOfDay(ctx.workEnd);
  }
  if (s.minutes < from || endMinutes > to) return "CAL_OUTSIDE_HOURS";
  if (ctx.breaks.some((b) => b.weekday === s.weekday && toMinutes(b.start) < endMinutes && toMinutes(b.end) > s.minutes)) return "CAL_ON_BREAK";
  return null;
}
