import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_LABELS, EVENT_OPTIONS, actionLabel, describeStep, durationText, eventLabel, joinDuration, splitDuration } from "../src/modules/workflow/labels.ts";
import { TIME_EVENTS } from "../src/modules/workflow/trigger-config.ts";

test("every event and action the screens offer has an Arabic name; unknown ones show their code, never a blank", () => {
  assert.equal(eventLabel("crm.opportunity.stage_changed"), "تغيّر مرحلة التذكرة");
  for (const key of Object.keys(TIME_EVENTS)) assert.ok(EVENT_OPTIONS.some((e) => e.value === key && e.group === "زمنية"), key);
  for (const a of ["message.whatsapp", "message.email", "notify.staff", "crm.task.create", "crm.opportunity.move_stage"]) assert.match(actionLabel(a), /[؀-ۿ]/);
  assert.equal(actionLabel("future.action"), "future.action");
  assert.equal(eventLabel(null), "—");
  assert.equal(new Set(EVENT_OPTIONS.map((e) => e.value)).size, EVENT_OPTIONS.length);
  assert.ok(Object.values(ACTION_LABELS).every((l) => /[؀-ۿ]/.test(l)));
});

test("a skipped message is never shown as done: it says «تُخطّيت» and gives the reason", () => {
  const skipped = describeStep({ status: "ok", step_type: "action", action: "message.whatsapp", output: { outcome: "skipped", code: "opted_out", reason: "العميل طلب عدم المراسلة" } });
  assert.deepEqual([skipped.tone, skipped.badge, skipped.detail], ["skipped", "تُخطّيت", "العميل طلب عدم المراسلة"]);
  const sent = describeStep({ status: "ok", action: "message.whatsapp", output: { outcome: "sent" } });
  assert.deepEqual([sent.tone, sent.badge], ["ok", "أُرسلت"]);
  const alert = describeStep({ status: "ok", action: "notify.staff", output: { outcome: "sent" } });
  assert.equal(alert.badge, "أُرسل التنبيه");
});

test("a held message says why and when; a failure shows its error; a waiting step is waiting; an ordinary step is simply done", () => {
  const held = describeStep({ status: "ok", output: { outcome: "deferred", reason: "خارج ساعات الإرسال", not_before: "2026-11-21T06:00:00.000Z" } });
  assert.equal(held.tone, "deferred");
  assert.match(held.detail!, /خارج ساعات الإرسال/);
  assert.match(held.detail!, /الموعد/);
  const failed = describeStep({ status: "failed", error: "الرقم غير متصل", output: {} });
  assert.deepEqual([failed.tone, failed.detail], ["failed", "الرقم غير متصل"]);
  assert.equal(describeStep({ status: "waiting" }).tone, "waiting");
  assert.deepEqual(describeStep({ status: "ok", action: "crm.task.create", output: { task_id: "x" } }), { tone: "ok", badge: "تمّت", detail: null });
  assert.equal(describeStep({ status: "ok", output: null as any }).tone, "ok");
});

test("durations go to the biggest whole unit and back", () => {
  assert.deepEqual(splitDuration(90), { amount: 90, unit: "minutes" });
  assert.deepEqual(splitDuration(120), { amount: 2, unit: "hours" });
  assert.deepEqual(splitDuration(4320), { amount: 3, unit: "days" });
  assert.deepEqual(splitDuration(0), { amount: 0, unit: "minutes" });
  assert.equal(joinDuration(3, "days"), 4320);
  assert.equal(joinDuration(1.5, "hours"), 90);
  assert.equal(durationText(10080), "7 يوم");
  assert.equal(durationText(60), "1 ساعة");
  for (const m of [5, 60, 1440, 2880, 7 * 1440, 100]) {
    const { amount, unit } = splitDuration(m);
    assert.equal(joinDuration(amount, unit), m);
  }
});
