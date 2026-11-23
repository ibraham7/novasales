/**
 * Time-zone helpers for the calendar. Meetings are stored in UTC and judged in the agent's (or the organization's)
 * time zone, exactly like the database rules do. Pure: no clock, no database. Daylight saving is handled by the
 * time-zone database (Intl), never by a fixed offset.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timeZone, f);
  }
  return f;
}

export type LocalParts = { date: string; minutes: number; weekday: number };

/** The local day (YYYY-MM-DD), the minutes since local midnight (with seconds as a fraction) and the weekday (0 = Sunday). */
export function localParts(ms: number, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const [y, mo, d] = [get("year"), get("month"), get("day")];
  return {
    date: `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    minutes: get("hour") * 60 + get("minute") + get("second") / 60,
    weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(),
  };
}

export const isValidTimeZone = (timeZone: string) => {
  try { formatter(timeZone); return true; } catch { return false; }
};

/** "HH:MM" (or "HH:MM:SS") to minutes. "24:00" is 1440. */
export function toMinutes(time: string): number {
  const [h, m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}
export function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The UTC moment of a local day and time ("YYYY-MM-DD", "HH:MM"). Null when that local time does not exist (the hour skipped by daylight saving). */
export function zonedToUtc(date: string, time: string, timeZone: string): number | null {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const minutes = toMinutes(time);
  const asUtc = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = asUtc;
  for (let i = 0; i < 3; i++) {
    const local = localParts(guess, timeZone);
    const [ly, lm, ld] = local.date.split("-").map(Number) as [number, number, number];
    const shown = Date.UTC(ly, lm - 1, ld, 0, 0) + Math.round(local.minutes) * 60_000;
    if (shown === asUtc) return guess;
    guess += asUtc - shown;
  }
  const check = localParts(guess, timeZone);
  return check.date === date && Math.round(check.minutes) === minutes ? guess : null;
}

/** Start of the local day in UTC (for range queries on the calendar). */
export const dayStartUtc = (date: string, timeZone: string): number => zonedToUtc(date, "00:00", timeZone) ?? Date.parse(`${date}T00:00:00Z`);
