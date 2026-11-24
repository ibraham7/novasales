import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, clickToTime, dayWindow, fetchRange, groupByDay, minutesOfDay, moveAnchor, rangeFor, startOfWeek } from "../src/modules/calendar/view.ts";

test("weeks start on Sunday; a month grid is 42 cells starting at the week of the 1st", () => {
  assert.equal(startOfWeek("2026-11-23"), "2026-11-22");
  assert.equal(startOfWeek("2026-11-22"), "2026-11-22");
  assert.deepEqual(rangeFor("week", "2026-11-25"), { from: "2026-11-22", days: 7 });
  assert.deepEqual(rangeFor("day", "2026-11-25"), { from: "2026-11-25", days: 1 });
  assert.deepEqual(rangeFor("month", "2026-11-25"), { from: "2026-11-01", days: 42 });
  assert.deepEqual(rangeFor("month", "2026-12-10"), { from: "2026-11-29", days: 42 });
});

test("moving: a day, a week, a month (end of month is kept valid)", () => {
  assert.equal(moveAnchor("day", "2026-12-31", 1), "2027-01-01");
  assert.equal(moveAnchor("week", "2026-11-23", -1), "2026-11-16");
  assert.equal(moveAnchor("month", "2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-15");
});

test("the range asked from the server is the organization's local days, in UTC (daylight saving included)", () => {
  assert.deepEqual(fetchRange("day", "2026-11-23", "Europe/Istanbul"), { from: "2026-11-22T21:00:00.000Z", to: "2026-11-23T21:00:00.000Z" });
  const spring = fetchRange("day", "2026-03-08", "America/New_York");
  assert.equal(new Date(spring.to).getTime() - new Date(spring.from).getTime(), 23 * 3_600_000, "the day the clocks go forward has 23 hours");
});

test("grouping puts a meeting on its local day, not its UTC day", () => {
  const groups = groupByDay([{ starts_at: "2026-11-23T22:30:00Z" }, { starts_at: "2026-11-23T10:00:00Z" }], "Europe/Istanbul");
  assert.deepEqual([...groups.keys()].sort(), ["2026-11-23", "2026-11-24"], "22:30Z is 01:30 the next day in Istanbul");
});

test("the visible hours follow the organization's hours and grow for meetings outside them", () => {
  assert.deepEqual(dayWindow("09:00", "18:00"), { first: 540, last: 1080 });
  assert.deepEqual(dayWindow("09:30", "17:15"), { first: 540, last: 1080 });
  assert.deepEqual(dayWindow("09:00", "00:00"), { first: 540, last: 1440 });
  assert.deepEqual(dayWindow("09:00", "18:00", [{ startMin: 450, endMin: 500 }, { startMin: 1100, endMin: 1150 }]), { first: 420, last: 1200 });
});

test("a click becomes a 15-minute-snapped time inside the window", () => {
  assert.equal(clickToTime(0, 540, 1080, 72), "09:00");
  assert.equal(clickToTime(72, 540, 1080, 72), "10:00");
  assert.equal(clickToTime(90, 540, 1080, 72), "10:15");
  assert.equal(clickToTime(9999, 540, 1080, 72), "17:45");
  assert.equal(clickToTime(-20, 540, 1080, 72), "09:00");
});

test("minutes of the day, with an end exactly at midnight counted as 24:00", () => {
  assert.equal(minutesOfDay("2026-11-23T07:00:00Z", "Europe/Istanbul"), 600);
  assert.equal(minutesOfDay("2026-11-23T21:00:00Z", "Europe/Istanbul"), 0);
  assert.equal(minutesOfDay("2026-11-23T21:00:00Z", "Europe/Istanbul", true), 1440);
});

test("the now line: local date, HH:mm label and distance from the top; none outside the shown hours", async () => {
  const { nowMarker } = await import("../src/modules/calendar/view.ts");
  // 08:20Z is 11:20 in Istanbul (UTC+3); the grid shows 09:00 to 18:00 at 64px per hour.
  const at = Date.parse("2026-11-23T08:20:30Z");
  const m = nowMarker(at, "Europe/Istanbul", 540, 1080, 64)!;
  assert.deepEqual([m.date, m.label], ["2026-11-23", "11:20"]);
  assert.ok(Math.abs(m.top - (140 / 60) * 64) < 1e-9);
  assert.equal(nowMarker(Date.parse("2026-11-23T05:00:00Z"), "Europe/Istanbul", 540, 1080, 64), null, "08:00 is before the grid");
  assert.equal(nowMarker(Date.parse("2026-11-23T15:00:00Z"), "Europe/Istanbul", 540, 1080, 64), null, "18:00 is after the grid");
  assert.equal(nowMarker(Date.parse("2026-11-23T21:30:00Z"), "Europe/Istanbul", 0, 1440, 64)!.date, "2026-11-24", "the local day, not the UTC one");
});

test("the customer box is a search box: typed text with nothing picked is refused, not dropped silently", async () => {
  const { customerChoiceProblem } = await import("../src/modules/calendar/view.ts");
  assert.equal(customerChoiceProblem("c1", "أسيل"), null, "a customer is picked");
  assert.equal(customerChoiceProblem(null, ""), null, "nothing typed, nothing picked: an appointment without a customer is fine");
  assert.equal(customerChoiceProblem(null, "   "), null);
  assert.match(customerChoiceProblem(null, " أسيل ") ?? "", /«أسيل»/);
});
