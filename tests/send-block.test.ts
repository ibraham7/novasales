import { test } from "node:test";
import assert from "node:assert/strict";
import { observationLeftHours, sendBlockReason } from "../src/modules/risk/send-block.ts";

const NOW = Date.parse("2026-11-26T15:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

test("a number that cannot send says why; a good one says nothing", () => {
  assert.equal(sendBlockReason({ status: "connected" }, NOW), null);
  assert.equal(sendBlockReason({ status: "disconnected" }, NOW), "الرقم غير متصل");
  assert.equal(sendBlockReason({ status: "connected", send_paused_at: hoursAgo(1) }, NOW), "الإرسال موقوف لهذا الرقم");
  assert.equal(sendBlockReason(null, NOW), "الرقم المرسِل غير موجود");
});

test("a freshly linked number is under observation for 48 hours by default", () => {
  const fresh = { status: "connected", observation_started_at: hoursAgo(1) };
  assert.equal(observationLeftHours(fresh, NOW), 47);
  assert.match(sendBlockReason(fresh, NOW) ?? "", /تحت المراقبة \(يتبقى نحو 47 ساعة\)/);
  assert.equal(sendBlockReason({ status: "connected", observation_started_at: hoursAgo(48) }, NOW), null, "observation is over");
  assert.equal(sendBlockReason({ status: "connected", observation_started_at: hoursAgo(5), observation_hours: 4 }, NOW), null, "a shorter window set for the number");
});
