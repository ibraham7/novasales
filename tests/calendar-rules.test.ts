import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMeetingTime, type CalendarContext } from "../src/modules/calendar/rules.ts";
import { addDays, localParts, zonedToUtc } from "../src/modules/calendar/time.ts";

const base: CalendarContext = { timezone: "Europe/Istanbul", workingDays: [1, 2, 3, 4, 5], workStart: "09:00", workEnd: "18:00", availability: [], breaks: [], timeOff: [] };
const at = (date: string, time: string, tz = "Europe/Istanbul") => zonedToUtc(date, time, tz)!;
const check = (ctx: CalendarContext, date: string, from: string, to: string, tz = ctx.agentTimezone || ctx.timezone, busy: any[] = []) => validateMeetingTime(ctx, at(date, from, tz), at(date, to === "24:00" ? "00:00" : to, tz) + (to === "24:00" ? 86_400_000 : 0), busy);

test("time helpers: local parts, round trip and the next day", () => {
  assert.deepEqual(localParts(Date.parse("2026-11-23T07:00:00Z"), "Europe/Istanbul"), { date: "2026-11-23", minutes: 600, weekday: 1 });
  assert.equal(new Date(at("2026-11-23", "10:00")).toISOString(), "2026-11-23T07:00:00.000Z");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("daylight saving: 09:00 New York is 13:00Z in summer time and 14:00Z in winter time; the skipped hour does not exist", () => {
  assert.equal(new Date(at("2026-03-08", "09:00", "America/New_York")).toISOString(), "2026-03-08T13:00:00.000Z");
  assert.equal(new Date(at("2026-11-01", "09:00", "America/New_York")).toISOString(), "2026-11-01T14:00:00.000Z");
  assert.equal(zonedToUtc("2026-03-08", "02:30", "America/New_York"), null);
});

test("the organization's default hours: inside, before opening, after closing, closed day", () => {
  assert.equal(check(base, "2026-11-23", "10:00", "11:00"), null);
  assert.equal(check(base, "2026-11-23", "07:00", "08:00"), "CAL_OUTSIDE_HOURS");
  assert.equal(check(base, "2026-11-23", "17:00", "19:00"), "CAL_OUTSIDE_HOURS");
  assert.equal(check(base, "2026-11-28", "10:00", "11:00"), "CAL_CLOSED_DAY");
});

test("the agent's own schedule replaces the organization's, and a day without a row is off", () => {
  const own = { ...base, availability: [{ weekday: 1, start: "13:00", end: "16:00" }, { weekday: 3, start: "09:00", end: "18:00" }] };
  assert.equal(check(own, "2026-11-23", "09:00", "10:00"), "CAL_OUTSIDE_HOURS");
  assert.equal(check(own, "2026-11-23", "14:00", "15:00"), null);
  assert.equal(check(own, "2026-11-24", "10:00", "11:00"), "CAL_OFF_DAY");
});

test("breaks and days off", () => {
  const c = { ...base, breaks: [{ weekday: 1, start: "15:00", end: "15:30" }], timeOff: [{ from: "2026-11-25", to: "2026-11-26" }] };
  assert.equal(check(c, "2026-11-23", "15:10", "15:40"), "CAL_ON_BREAK");
  assert.equal(check(c, "2026-11-23", "15:30", "16:00"), null, "ends where the break starts / starts where it ends");
  assert.equal(check(c, "2026-11-23", "14:30", "15:00"), null);
  assert.equal(check(c, "2026-11-25", "10:00", "11:00"), "CAL_TIME_OFF");
  assert.equal(check(c, "2026-11-27", "10:00", "11:00"), null);
});

test("busy: overlap is refused, back-to-back and cancelled ones are fine", () => {
  const busy = [{ id: "a", starts_at: at("2026-11-23", "10:00"), ends_at: at("2026-11-23", "11:00"), status: "confirmed" }, { id: "b", starts_at: at("2026-11-23", "13:00"), ends_at: at("2026-11-23", "14:00"), status: "cancelled" }];
  assert.equal(check(base, "2026-11-23", "10:30", "11:30", undefined, busy), "CAL_OWNER_BUSY");
  assert.equal(check(base, "2026-11-23", "11:00", "12:00", undefined, busy), null);
  assert.equal(check(base, "2026-11-23", "13:00", "14:00", undefined, busy), null, "cancelled frees the time");
  assert.equal(validateMeetingTime(base, at("2026-11-23", "10:00"), at("2026-11-23", "11:00"), busy, "a"), null, "editing a meeting does not clash with itself");
});

test("bad range: end before start, or longer than a day", () => {
  assert.equal(validateMeetingTime(base, at("2026-11-23", "11:00"), at("2026-11-23", "10:00")), "CAL_BAD_RANGE");
  assert.equal(validateMeetingTime(base, at("2026-11-23", "10:00"), at("2026-11-23", "10:00")), "CAL_BAD_RANGE");
  assert.equal(validateMeetingTime(base, at("2026-11-23", "10:00"), at("2026-11-24", "11:00")), "CAL_BAD_RANGE");
});

test("the same cases as the database test: New York daylight saving days", () => {
  const ny = { ...base, timezone: "America/New_York", workingDays: [0, 1, 2, 3, 4, 5, 6] };
  assert.equal(validateMeetingTime(ny, Date.parse("2026-03-08T13:00Z"), Date.parse("2026-03-08T14:00Z")), null);
  assert.equal(validateMeetingTime(ny, Date.parse("2026-03-08T12:30Z"), Date.parse("2026-03-08T13:00Z")), "CAL_OUTSIDE_HOURS");
  assert.equal(validateMeetingTime(ny, Date.parse("2026-11-01T14:00Z"), Date.parse("2026-11-01T15:00Z")), null);
  assert.equal(validateMeetingTime(ny, Date.parse("2026-11-01T13:00Z"), Date.parse("2026-11-01T14:00Z")), "CAL_OUTSIDE_HOURS");
});

test("midnight: a day to 24:00 may end exactly at midnight, a meeting may not cross it; the agent's own zone wins", () => {
  const late = { ...base, workingDays: [0, 1, 2, 3, 4, 5, 6], workEnd: "00:00" };
  assert.equal(validateMeetingTime(late, Date.parse("2026-12-02T20:00Z"), Date.parse("2026-12-02T21:00Z")), null, "23:00-00:00 Istanbul");
  assert.equal(validateMeetingTime(late, Date.parse("2026-12-03T20:30Z"), Date.parse("2026-12-03T21:30Z")), "CAL_OUTSIDE_HOURS", "23:30-00:30");
  const tokyo = { ...late, agentTimezone: "Asia/Tokyo" };
  assert.equal(validateMeetingTime(tokyo, Date.parse("2026-12-03T00:00Z"), Date.parse("2026-12-03T01:00Z")), null, "09:00 Tokyo");
  assert.equal(validateMeetingTime(tokyo, Date.parse("2026-12-03T20:00Z"), Date.parse("2026-12-03T21:00Z")), "CAL_OUTSIDE_HOURS", "05:00 Tokyo");
});
