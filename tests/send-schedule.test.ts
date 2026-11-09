import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCHEDULE, MIN_GAP_MS, allowanceFor, dayStart, daysSince, decideNext, extractVariants, parseSchedule, pickVariants, scheduleProblem, type SendSchedule } from "../src/modules/campaigns/send-schedule.ts";

// Turkey has no daylight saving time: its clock is always UTC+3.
const S: SendSchedule = { dailyLimit: 30, windowStart: "10:00", windowEnd: "17:00", timezone: "Europe/Istanbul", ramp: null };
const at = (iso: string) => new Date(iso);
const mid = () => 0.5;

test("a schedule is checked: limit, window length, time zone, capacity and ramp", () => {
  assert.equal(scheduleProblem(DEFAULT_SCHEDULE), null);
  assert.match(scheduleProblem({ ...S, dailyLimit: 0 })!, /الحد اليومي/);
  assert.match(scheduleProblem({ ...S, windowStart: "25:00" })!, /غير صحيحة/);
  assert.match(scheduleProblem({ ...S, windowStart: "10:00", windowEnd: "10:30" })!, /ساعة على الأقل/);
  assert.match(scheduleProblem({ ...S, timezone: "Mars/Base" })!, /المنطقة الزمنية/);
  assert.match(scheduleProblem({ ...S, windowStart: "10:00", windowEnd: "11:00", dailyLimit: 100 })!, /أقصى 80/);
  assert.match(scheduleProblem({ ...S, ramp: { start: 40, step: 5 } })!, /التسخين/);
});

test("inside the window a message may go, with a gap that spreads the rest of the day", () => {
  // 10:00 Istanbul = 07:00 UTC; the window has 7 hours for 30 messages: about 14 minutes each
  const d = decideNext(S, at("2026-11-10T07:00:00Z"), 0, 0, mid);
  assert.equal(d.action, "send");
  assert.ok(d.action === "send" && Math.abs(d.gapMs - 14 * 60_000) < 60_000, String((d as any).gapMs));
  // later in the day with fewer left the gap adapts: 1 hour left, 4 messages left = 15 minutes
  const late = decideNext(S, at("2026-11-10T13:00:00Z"), 26, 0, mid);
  assert.ok(late.action === "send" && Math.abs(late.gapMs - 15 * 60_000) < 60_000);
  // never faster than the minimum gap, and the random part stays within ±40 %
  const dense = decideNext({ ...S, windowEnd: "11:00", dailyLimit: 80 }, at("2026-11-10T07:00:00Z"), 0, 0, () => 0);
  assert.equal(dense.action === "send" && dense.gapMs, MIN_GAP_MS);
  const lo = decideNext(S, at("2026-11-10T07:00:00Z"), 0, 0, () => 0);
  const hi = decideNext(S, at("2026-11-10T07:00:00Z"), 0, 0, () => 1);
  assert.ok(lo.action === "send" && hi.action === "send" && lo.gapMs < hi.gapMs);
});

test("outside the window or past the day's limit it waits for the next opening, on the local clock", () => {
  const before = decideNext(S, at("2026-11-10T05:00:00Z"), 0, 0, mid); // 08:00 Istanbul
  assert.deepEqual([before.action, (before as any).until.toISOString(), (before as any).reason], ["wait", "2026-11-10T07:00:00.000Z", "before_window"]);
  const after = decideNext(S, at("2026-11-10T15:00:00Z"), 5, 0, mid); // 18:00 Istanbul
  assert.deepEqual([after.action, (after as any).until.toISOString(), (after as any).reason], ["wait", "2026-11-11T07:00:00.000Z", "after_window"]);
  const done = decideNext(S, at("2026-11-10T09:00:00Z"), 30, 0, mid);
  assert.deepEqual([done.action, (done as any).until.toISOString(), (done as any).reason], ["wait", "2026-11-11T07:00:00.000Z", "daily_limit"]);
  // 23:30 UTC is already the next day in Istanbul (02:30): the same local day logic applies
  const night = decideNext(S, at("2026-11-10T23:30:00Z"), 0, 0, mid);
  assert.equal((night as any).until.toISOString(), "2026-11-11T07:00:00.000Z");
});

test("the local day starts at local midnight, and the ramp grows by day up to the limit", () => {
  assert.equal(dayStart(at("2026-11-10T10:00:00Z"), "Europe/Istanbul").toISOString(), "2026-11-09T21:00:00.000Z");
  assert.equal(daysSince(at("2026-11-08T08:00:00Z"), at("2026-11-10T20:59:00Z"), "Europe/Istanbul"), 2);
  assert.equal(daysSince(at("2026-11-08T08:00:00Z"), at("2026-11-10T21:01:00Z"), "Europe/Istanbul"), 3);
  const ramp = { ...S, ramp: { start: 10, step: 5 } };
  assert.deepEqual([0, 1, 2, 3, 4, 10].map((d) => allowanceFor(ramp, d)), [10, 15, 20, 25, 30, 30]);
  assert.equal(allowanceFor(S, 7), 30);
  assert.equal(decideNext(ramp, at("2026-11-10T09:00:00Z"), 10, 0, mid).action, "wait");
  assert.equal(decideNext(ramp, at("2026-11-10T09:00:00Z"), 10, 1, mid).action, "send");
});

test("stored schedules are read back, and anything unusable means the old way of sending", () => {
  assert.deepEqual(parseSchedule(S), S);
  assert.equal(parseSchedule(null), null);
  assert.equal(parseSchedule({ dailyLimit: 5 }), null);
  assert.equal(parseSchedule({ ...S, windowEnd: "10:10" }), null);
});

test("wording variations become per-recipient choices, single braces only", () => {
  const { body, options } = extractVariants("{مرحباً|أهلاً|السلام عليكم} {{name}}، عندنا {عرض|خصم} خاص");
  assert.equal(body, "{{spin_1}} {{name}}، عندنا {{spin_2}} خاص");
  assert.deepEqual(options, [["مرحباً", "أهلاً", "السلام عليكم"], ["عرض", "خصم"]]);
  assert.deepEqual(pickVariants(options, () => 0), { spin_1: "مرحباً", spin_2: "عرض" });
  assert.deepEqual(pickVariants(options, () => 0.99), { spin_1: "السلام عليكم", spin_2: "خصم" });
  assert.deepEqual(extractVariants("بدون خيارات {{name}} و{واحد}"), { body: "بدون خيارات {{name}} و{واحد}", options: [] });
});
