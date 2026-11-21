import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyReply } from "../src/modules/workflow/reply-intent.ts";
import { validateTriggerConfig } from "../src/modules/workflow/trigger-config.ts";

test("exact short answers are understood: yes, no, stop, in Arabic and English, with punctuation and hamza variants", () => {
  for (const t of ["نعم", "نعم!", "  أكيد ", "تمام.", "موافق", "ok", "Yes", "اي", "اوكي"]) assert.equal(classifyReply(t), "yes", t);
  for (const t of ["لا", "لا.", "No", "كلا", "لا شكراً", "غير موافق"]) assert.equal(classifyReply(t), "no", t);
  for (const t of ["إيقاف", "ايقاف", "STOP", "stop!", "توقف", "إلغاء الاشتراك", "Unsubscribe"]) assert.equal(classifyReply(t), "stop", t);
});

test("anything longer or with other words is unknown: an unclear answer changes nothing", () => {
  for (const t of ["نعم بس بدي أسأل عن السعر", "لا أريد إيقاف الخدمة", "ممكن أعرف شو العرض؟", "stop sending me the big offers please", "", "   ", null, undefined, "اوكي تمام بعدين نحكي", "؟", "👍"]) assert.equal(classifyReply(t as any), "unknown", String(t));
});

test("trigger settings: time events need their duration; the duration and the stop choices must be sensible", () => {
  assert.equal(validateTriggerConfig("event", { event: "crm.opportunity.stage_changed" }), null);
  assert.match(validateTriggerConfig("event", { event: "time.stage_timeout" })!, /المدة/);
  assert.match(validateTriggerConfig("event", { event: "time.no_reply", after_minutes: 2 })!, /المدة/);
  assert.match(validateTriggerConfig("event", { event: "time.stale", after_minutes: "60" })!, /المدة/);
  assert.equal(validateTriggerConfig("event", { event: "time.no_reply", after_minutes: 60 }), null);
  assert.equal(validateTriggerConfig("event", { event: "time.stale", after_minutes: 7 * 1440 }), null);
  assert.match(validateTriggerConfig("event", { event: "time.stale", after_minutes: 600000 })!, /المدة/);
  assert.equal(validateTriggerConfig("event", { event: "time.task_overdue" }), null);
  assert.equal(validateTriggerConfig("event", { event: "time.task_overdue", after_minutes: 0 }), null);
  assert.match(validateTriggerConfig("event", { event: "time.task_overdue", after_minutes: -1 })!, /مهلة/);
  assert.match(validateTriggerConfig("event", { event: "time.stage_timeout", after_minutes: 60, stage_id: "x" })!, /المرحلة/);
  assert.equal(validateTriggerConfig("event", { event: "time.stage_timeout", after_minutes: 60, stage_id: "00000000-0000-0000-0000-000000000001" }), null);
  assert.equal(validateTriggerConfig("event", { event: "crm.lead.created", stop_on: ["customer_reply", "stage_change"] }), null);
  assert.match(validateTriggerConfig("event", { event: "crm.lead.created", stop_on: ["anything"] })!, /الإيقاف/);
  assert.match(validateTriggerConfig("event", { event: "crm.lead.created", stop_on: "customer_reply" })!, /الإيقاف/);
  assert.equal(validateTriggerConfig("manual", {}), null);
});
