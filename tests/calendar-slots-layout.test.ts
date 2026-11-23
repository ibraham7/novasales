import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestSlots } from "../src/modules/calendar/slots.ts";
import { blockGeometry, layoutDay } from "../src/modules/calendar/layout.ts";
import { ACTIONS, STATUSES, canMove, canSetOutcome, isFinal } from "../src/modules/calendar/status.ts";
import { calendarError, ruleMessage } from "../src/modules/calendar/errors.ts";
import { validateMeetingTime, type CalendarContext } from "../src/modules/calendar/rules.ts";
import { zonedToUtc } from "../src/modules/calendar/time.ts";

const ctx: CalendarContext = { timezone: "Europe/Istanbul", workingDays: [1, 2, 3, 4, 5], workStart: "09:00", workEnd: "18:00", availability: [], breaks: [{ weekday: 1, start: "12:00", end: "13:00" }], timeOff: [] };
const at = (date: string, time: string, tz = "Europe/Istanbul") => zonedToUtc(date, time, tz)!;
const NOW = at("2026-11-23", "08:00"); // Monday morning

test("slots: nearest free times, after the lead time, inside hours, skipping breaks and busy time", () => {
  const busy = [{ starts_at: at("2026-11-23", "09:00"), ends_at: at("2026-11-23", "10:30"), status: "booked" }];
  const slots = suggestSlots({ agents: [{ ownerId: "u1", ctx, busy }], durationMin: 30, now: NOW, count: 4 });
  assert.deepEqual(slots.map((s) => `${s.date} ${s.start}`), ["2026-11-23 10:30", "2026-11-23 11:00", "2026-11-23 11:30", "2026-11-23 13:00"], "lead 60 min from 08:00 and the 12-13 break skipped");
  for (const s of slots) assert.equal(validateMeetingTime(ctx, Date.parse(s.startsAt), Date.parse(s.endsAt), busy), null, "every suggestion passes the booking rules");
});

test("slots: a long meeting does not fit before a break; weekends are skipped; nothing suggested when nothing fits", () => {
  const fri = at("2026-11-27", "16:30");
  const s = suggestSlots({ agents: [{ ownerId: "u1", ctx, busy: [] }], durationMin: 120, now: fri, count: 2, leadMin: 0 });
  assert.deepEqual(s.map((x) => `${x.date} ${x.start}`), ["2026-11-30 09:00", "2026-11-30 09:30"], "two hours no longer fit on Friday; Saturday and Sunday are closed");
  const earlier = suggestSlots({ agents: [{ ownerId: "u1", ctx, busy: [] }], durationMin: 120, now: at("2026-11-27", "15:00"), count: 1, leadMin: 0 });
  assert.equal(`${earlier[0]!.date} ${earlier[0]!.start}`, "2026-11-27 15:00");
  assert.deepEqual(suggestSlots({ agents: [{ ownerId: "u1", ctx: { ...ctx, workingDays: [] }, busy: [] }], durationMin: 30, now: NOW }), []);
});

test("slots: several agents give different times, earliest first, each time with one agent", () => {
  const a = { ownerId: "a", ctx, busy: [{ starts_at: at("2026-11-23", "09:00"), ends_at: at("2026-11-23", "11:00"), status: "booked" }] };
  const b = { ownerId: "b", ctx: { ...ctx, agentTimezone: "Asia/Tokyo" }, busy: [] };
  const out = suggestSlots({ agents: [a, b], durationMin: 30, now: NOW, count: 3 });
  assert.equal(new Set(out.map((s) => s.startsAt)).size, out.length);
  assert.deepEqual([...out].sort((x, y) => x.startsAt.localeCompare(y.startsAt)).map((s) => s.startsAt), out.map((s) => s.startsAt), "sorted");
});

test("layout: overlapping meetings take columns, chains share a group, separate ones stay full width", () => {
  const m = (id: string, s: number, e: number) => ({ id, startMs: s * 60_000, endMs: e * 60_000 });
  const placed = layoutDay([m("a", 540, 600), m("b", 570, 630), m("c", 600, 660), m("d", 700, 760)]);
  assert.deepEqual(placed.get("a"), { col: 0, cols: 2 });
  assert.deepEqual(placed.get("b"), { col: 1, cols: 2 });
  assert.deepEqual(placed.get("c"), { col: 0, cols: 2 }, "reuses the first free column");
  assert.deepEqual(placed.get("d"), { col: 0, cols: 1 });
  const same = layoutDay([m("x", 540, 600), m("y", 540, 600), m("z", 540, 600)]);
  assert.deepEqual([...same.values()].map((p) => p.cols), [3, 3, 3]);
});

test("block geometry: position from the first visible minute with a minimum height", () => {
  assert.deepEqual(blockGeometry(570, 600, 540, 72), { top: 36, height: 36 });
  assert.equal(blockGeometry(540, 545, 540, 72).height, 22);
});

test("statuses: allowed moves match the database guard; final ones cannot move; outcome only after completed", () => {
  assert.equal(canMove("booked", "confirmed"), true);
  assert.equal(canMove("in_progress", "confirmed"), false);
  assert.equal(canMove("cancelled", "completed"), false);
  assert.equal(canMove("completed", "cancelled"), false);
  assert.equal(canMove("completed", "completed"), true, "same status is not a move");
  for (const s of STATUSES) for (const a of ACTIONS[s]) assert.ok(canMove(s, a.to), `${s} -> ${a.to}`);
  assert.deepEqual(["completed", "cancelled", "no_show"].map(isFinal), [true, true, true]);
  assert.deepEqual(["booked", "completed"].map(canSetOutcome), [false, true]);
});

test("error messages: codes and constraint names become plain Arabic and never show database details", () => {
  assert.equal(calendarError({ message: "CAL_OWNER_BUSY" }), "المندوب مشغول بهذا الوقت");
  assert.equal(calendarError({ message: 'conflicting key value violates exclusion constraint "cal_meetings_owner_no_overlap" DETAIL: Key (owner_user_id, tstzrange)=(…)' }), "المندوب مشغول بهذا الوقت");
  assert.equal(calendarError({ message: 'violates check constraint "cal_meetings_outcome_after_completed"' }), "تُسجَّل نتيجة الاجتماع بعد انتهائه فقط");
  const unknown = calendarError({ message: "relation cal_meetings uuid 1234 failed" });
  assert.equal(unknown, "تعذر حفظ الاجتماع، حاول مرة أخرى");
  assert.ok(!/cal_meetings|1234/.test(unknown));
  assert.equal(ruleMessage(null), null);
  assert.equal(ruleMessage("CAL_ON_BREAK"), "الاجتماع يتعارض مع استراحة المندوب");
});
