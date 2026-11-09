/**
 * A campaign that sends slowly like a person: a limited number of messages per day, only inside a daily
 * window of hours (in a chosen time zone), with a random gap between them that spreads the day's messages
 * over the whole window, and an optional gentle ramp-up (a few more each day). Pure functions: the
 * dispatcher asks «may I send now, and when is the next one?».
 */
export type Ramp = { start: number; step: number };
export type SendSchedule = {
  dailyLimit: number;
  /** "HH:MM", 24 hours, in `timezone`. */
  windowStart: string;
  windowEnd: string;
  timezone: string;
  ramp: Ramp | null;
};

export const DEFAULT_SCHEDULE: SendSchedule = { dailyLimit: 30, windowStart: "10:00", windowEnd: "17:00", timezone: "Europe/Istanbul", ramp: { start: 10, step: 5 } };
/** Never faster than this, however large the limit or short the window. */
export const MIN_GAP_MS = 45_000;
export const MAX_GAP_MS = 30 * 60_000;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const toMinutes = (time: string) => {
  const m = TIME.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Checks a schedule; returns a message in Arabic for the first problem, or null. */
export function scheduleProblem(s: SendSchedule): string | null {
  if (!Number.isInteger(s.dailyLimit) || s.dailyLimit < 1 || s.dailyLimit > 500) return "الحد اليومي يجب أن يكون بين 1 و500";
  const from = toMinutes(s.windowStart);
  const to = toMinutes(s.windowEnd);
  if (Number.isNaN(from) || Number.isNaN(to)) return "ساعات الإرسال غير صحيحة";
  if (to - from < 60) return "نافذة الإرسال يجب أن تكون ساعة على الأقل";
  if (!isValidTimezone(s.timezone)) return "المنطقة الزمنية غير صحيحة";
  const capacity = Math.floor(((to - from) * 60_000) / MIN_GAP_MS);
  if (s.dailyLimit > capacity) return `النافذة قصيرة لهذا العدد؛ أقصى ${capacity} رسالة باليوم بهذه الساعات`;
  if (s.ramp && (!Number.isInteger(s.ramp.start) || s.ramp.start < 1 || !Number.isInteger(s.ramp.step) || s.ramp.step < 0 || s.ramp.start > s.dailyLimit)) return "التسخين التدريجي غير صحيح";
  return null;
}

/** The parts of an instant on the clock of a time zone. */
function zoned(at: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const [y, mo, d, h, mi, s] = [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].map(Number) as [number, number, number, number, number, number];
  return { y, mo, d, minutes: h * 60 + mi, seconds: s };
}

/** The UTC instant at which the given local clock time occurs on the local date of `at` (plus `addDays`). */
function localInstant(at: Date, timezone: string, minutes: number, addDays = 0): Date {
  const z = zoned(at, timezone);
  const guess = Date.UTC(z.y, z.mo - 1, z.d + addDays, 0, minutes, 0);
  // The zone's offset at that moment: how far its clock is ahead of UTC.
  const offset = (instant: number) => {
    const p = zoned(new Date(instant), timezone);
    return Date.UTC(p.y, p.mo - 1, p.d, 0, p.minutes, p.seconds) - instant;
  };
  let result = guess - offset(guess);
  result = guess - offset(result);
  return new Date(result);
}

export const dayStart = (at: Date, timezone: string) => localInstant(at, timezone, 0);

/** How many days after the campaign began it is on the local calendar (0 on the first day). */
export function daysSince(start: Date, now: Date, timezone: string): number {
  return Math.max(0, Math.round((dayStart(now, timezone).getTime() - dayStart(start, timezone).getTime()) / 86_400_000));
}

/** Messages allowed on a day: the limit, or the ramp (start + step per day, up to the limit). */
export function allowanceFor(s: SendSchedule, dayIndex: number): number {
  if (!s.ramp) return s.dailyLimit;
  return Math.min(s.dailyLimit, s.ramp.start + s.ramp.step * dayIndex);
}

export type Decision = { action: "send"; gapMs: number } | { action: "wait"; until: Date; reason: "before_window" | "after_window" | "daily_limit" };

/**
 * May a message go now? `sentToday` is how many went since local midnight, `dayIndex` the campaign's day
 * number. When it may, `gapMs` is the random wait until the next one: the rest of the window divided by
 * what is left of the day's allowance, varied by about ±40 %.
 */
export function decideNext(s: SendSchedule, now: Date, sentToday: number, dayIndex: number, random: () => number = Math.random): Decision {
  const local = zoned(now, s.timezone);
  const from = toMinutes(s.windowStart);
  const to = toMinutes(s.windowEnd);
  const nowMinutes = local.minutes + local.seconds / 60;
  if (nowMinutes < from) return { action: "wait", until: localInstant(now, s.timezone, from), reason: "before_window" };
  if (nowMinutes >= to) return { action: "wait", until: localInstant(now, s.timezone, from, 1), reason: "after_window" };
  const allowance = allowanceFor(s, dayIndex);
  if (sentToday >= allowance) return { action: "wait", until: localInstant(now, s.timezone, from, 1), reason: "daily_limit" };
  const remainingMs = (to - nowMinutes) * 60_000;
  const average = remainingMs / Math.max(1, allowance - sentToday);
  const gap = average * (0.6 + random() * 0.8);
  return { action: "send", gapMs: Math.round(Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, gap))) };
}

/** A schedule read from stored JSON; null when absent or not usable (the campaign then sends the old way). */
export function parseSchedule(value: unknown): SendSchedule | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, any>;
  const schedule: SendSchedule = {
    dailyLimit: Number(v.dailyLimit),
    windowStart: String(v.windowStart ?? ""),
    windowEnd: String(v.windowEnd ?? ""),
    timezone: String(v.timezone ?? ""),
    ramp: v.ramp && typeof v.ramp === "object" ? { start: Number(v.ramp.start), step: Number(v.ramp.step) } : null,
  };
  return scheduleProblem(schedule) ? null : schedule;
}

/* ----------------------- wording variations: {hello|hi|welcome} ----------------------- */

const VARIANT = /\{([^{}|]+(?:\|[^{}|]+)+)\}/g;

/**
 * Turns «{مرحباً|أهلاً} {{name}}» into «{{spin_1}} {{name}}» plus the option lists, so each recipient can
 * get a different wording (identical messages to many numbers are what WhatsApp flags).
 */
export function extractVariants(body: string): { body: string; options: string[][] } {
  const options: string[][] = [];
  const replaced = body.replace(VARIANT, (_m, inner: string) => {
    options.push(inner.split("|").map((x) => x.trim()).filter(Boolean));
    return `{{spin_${options.length}}}`;
  });
  return { body: replaced, options };
}

export const pickVariants = (options: string[][], random: () => number = Math.random) =>
  Object.fromEntries(options.map((list, i) => [`spin_${i + 1}`, list[Math.floor(random() * list.length)] ?? ""]));
