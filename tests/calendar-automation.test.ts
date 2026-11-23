import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { RECIPES, recipeDefinition } from "../src/modules/workflow/recipes.ts";
import { validateWorkflowDefinition } from "../src/modules/workflow/definition.ts";
import { validateMessageSteps } from "../src/modules/workflow/send/message-config.ts";
import { validateTriggerConfig } from "../src/modules/workflow/trigger-config.ts";
import { findCandidates, meetingStartsCandidates, meetingsDigestCandidates } from "../src/modules/workflow/time-triggers.ts";
import { formatMeeting, loadMessageContext } from "../src/modules/workflow/send/context.ts";
import { createCalendarActions } from "../src/modules/workflow/actions/calendar.actions.ts";
import { renderMessage } from "../src/modules/workflow/send/template.ts";

const NOW = new Date("2026-11-23T06:00:00.000Z");
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();
const meeting = (id: string, startsInMin: number, extra: any = {}) => ({ id, owner_user_id: "u1", contact_id: "c1", opportunity_id: "o1", status: "confirmed", starts_at: at(startsInMin), ends_at: at(startsInMin + 30), created_at: at(-3 * 24 * 60), channel: "call", location: "+905066903027", type_name: "عرض توضيحي", ...extra });

test("meeting reminders: once per meeting time, only booked/confirmed, only inside the wait, never for a meeting booked after the reminder moment", () => {
  const rows = [meeting("a", 50), meeting("b", 200), meeting("c", 30, { status: "cancelled" }), meeting("d", -10), meeting("e", 40, { status: "in_progress" }), meeting("f", 45, { created_at: at(-10) })];
  const found = meetingStartsCandidates(rows, NOW, 60);
  assert.deepEqual(found.map((c) => c.payload.meeting_id), ["a"], "f was booked 10 minutes ago, after its 60-minute reminder moment (15 minutes ago)");
  assert.ok(found[0]!.key.includes(at(50)) && found[0]!.key.endsWith(":60"), "a new time or a different wait is a different reminder");
  assert.equal(found[0]!.payload.location, null, "a call's place (a phone number) is not carried");
  assert.equal(meetingStartsCandidates([meeting("z", 50, { channel: "link", location: "https://meet.example.com/x" })], NOW, 60)[0]!.payload.location, "https://meet.example.com/x");
});

test("morning digest of meetings: after the hour, one per agent per local day, only today's open meetings", () => {
  const rows = [meeting("a", 60), meeting("b", 120, { owner_user_id: "u1" }), meeting("c", 90, { owner_user_id: "u2", status: "cancelled" }), meeting("d", 24 * 60 + 60, { owner_user_id: "u3" })];
  assert.deepEqual(meetingsDigestCandidates(rows, NOW, "UTC", 8), [], "06:00 is before 08:00");
  const found = meetingsDigestCandidates(rows, new Date("2026-11-23T08:30:00Z"), "UTC", 8);
  assert.deepEqual(found.map((c) => [c.key, c.payload.meetings_today]), [["meetings_digest:u1:2026-11-23", 2]]);
});

test("scan reads the organization's meetings and fills the type name", async () => {
  const db: any = fakeDb({ cal_meetings: [{ ...meeting("a", 50), organization_id: "o", meeting_type_id: "t1" }, { ...meeting("x", 50), organization_id: "other", meeting_type_id: "t1" }], cal_meeting_types: [{ id: "t1", organization_id: "o", name: "عرض توضيحي" }] });
  const found = await findCandidates(db, "o", "time.meeting_starts_in", { before_minutes: 60 }, NOW);
  assert.deepEqual(found.map((c) => [c.payload.meeting_id, c.payload.meeting_type]), [["a", "عرض توضيحي"]]);
  assert.ok(db.calls.filter((c: any) => c.table === "cal_meetings").every((c: any) => c.filters.some(([, col, v]: any) => col === "organization_id" && v === "o")));
});

test("trigger settings: reminders need a wait of 5 minutes to 30 days; the digest needs an hour", () => {
  assert.equal(validateTriggerConfig("event", { event: "time.meeting_starts_in", before_minutes: 60 }), null);
  assert.match(validateTriggerConfig("event", { event: "time.meeting_starts_in" })!, /قبل الاجتماع/);
  assert.match(validateTriggerConfig("event", { event: "time.meeting_starts_in", before_minutes: 2 })!, /قبل الاجتماع/);
  assert.equal(validateTriggerConfig("event", { event: "time.meetings_digest", hour: 8 }), null);
  assert.match(validateTriggerConfig("event", { event: "time.meetings_digest", hour: 30 })!, /ساعة/);
});

test("message variables for a meeting: date and time in the agent's zone with Latin digits, type, and the place only when given", async () => {
  assert.deepEqual(formatMeeting("2026-11-23T07:00:00.000Z", "Europe/Istanbul").meeting_time, "10:00");
  assert.match(formatMeeting("2026-11-23T07:00:00.000Z", "Europe/Istanbul").meeting_date, /23/);
  assert.ok(!/[٠-٩]/.test(formatMeeting("2026-11-23T07:00:00.000Z", "Europe/Istanbul").meeting_date), "Latin digits");
  const db: any = fakeDb({ cal_settings: [{ organization_id: "o", timezone: "Europe/Istanbul" }], cal_agent_prefs: [{ organization_id: "o", user_id: "u1", timezone: "Asia/Tokyo" }], crm_contacts: [{ id: "c1", organization_id: "o", display_name: "أحمد علي" }], profiles: [{ id: "u1", full_name: "مندوب" }], organizations: [{ id: "o", name: "نوفا" }] });
  const ctx = await loadMessageContext(db, "o", { contact_id: "c1", owner_user_id: "u1", starts_at: "2026-11-23T07:00:00.000Z", meeting_type: "عرض توضيحي", location: null }, {});
  assert.equal(ctx.vars.meeting_time, "16:00", "the agent's own zone (Tokyo) wins");
  assert.equal(ctx.vars.meeting_type, "عرض توضيحي");
  assert.equal(ctx.vars.meeting_place, "");
  assert.equal(renderMessage("موعدنا الساعة {meeting_time} · {meeting_type}", ctx.vars), "موعدنا الساعة 16:00 · عرض توضيحي");
  const none = await loadMessageContext(db, "o", { contact_id: "c1" }, {});
  assert.equal(none.vars.meeting_time, "", "no meeting in the trigger = empty");
});

test("actions: confirm and cancel use the meeting of the run, follow the allowed moves, stay inside the organization and never fail the run", async () => {
  const db: any = fakeDb({ cal_meetings: [{ id: "m1", organization_id: "o", status: "booked" }, { id: "m2", organization_id: "o", status: "completed" }, { id: "m3", organization_id: "other", status: "booked" }] });
  const actions = createCalendarActions({ db });
  const ctx = (payload: any) => ({ organizationId: "o", runId: "r", workflowId: "w", triggerPayload: payload, runContext: {} });
  const run = async (name: "calendar.meeting.confirm" | "calendar.meeting.cancel", payload: any, config: any = {}) => (await actions[name](config, ctx(payload))).output as any;
  assert.deepEqual([await run("calendar.meeting.confirm", { meeting_id: "m1" })].map((o) => [o.outcome, o.status]), [["done", "confirmed"]]);
  assert.equal(db.tables.cal_meetings.find((m: any) => m.id === "m1").status, "confirmed");
  assert.equal((await run("calendar.meeting.confirm", { meeting_id: "m1" })).outcome, "skipped", "already confirmed");
  assert.equal((await run("calendar.meeting.confirm", { meeting_id: "m2" })).outcome, "skipped", "a finished meeting cannot be confirmed");
  assert.equal((await run("calendar.meeting.confirm", { meeting_id: "m3" })).outcome, "skipped", "another organization's meeting is not found");
  assert.equal(db.tables.cal_meetings.find((m: any) => m.id === "m3").status, "booked");
  assert.equal((await run("calendar.meeting.confirm", {})).outcome, "skipped", "no meeting in the run");
  await run("calendar.meeting.cancel", { meeting_id: "m1" }, { reason: "العميل اعتذر" });
  const m1 = db.tables.cal_meetings.find((m: any) => m.id === "m1");
  assert.deepEqual([m1.status, m1.cancellation_reason], ["cancelled", "العميل اعتذر"]);
});

test("every meeting recipe is valid, switched-off by being a recipe, and the confirmation one waits for «نعم» of the same ticket", () => {
  const meetingRecipes = RECIPES.filter((r) => r.category === "الاجتماعات");
  assert.equal(meetingRecipes.length, 9);
  for (const r of meetingRecipes) {
    const def = recipeDefinition(r);
    validateWorkflowDefinition(def, false);
    assert.equal(validateMessageSteps(def.steps), null, r.id);
    assert.equal(validateTriggerConfig(r.trigger.type, r.trigger.config), null, r.id);
    if (r.audience === "داخلي") assert.ok(def.steps.every((s: any) => s.type !== "action" || !String(s.action).startsWith("message.")), r.id);
  }
  const confirm = recipeDefinition(RECIPES.find((r) => r.id === "meeting-confirm-reply")!);
  const wait = confirm.steps.find((s: any) => s.type === "wait_for_event")!;
  assert.deepEqual([wait.event, wait.match, wait.onEvent, wait.onTimeout], ["messaging.reply.yes", { opportunity_id: "{{trigger.opportunity_id}}" }, "confirm", "noanswer"]);
  const confirmStep = confirm.steps.find((s: any) => s.id === "confirm")!;
  assert.equal(confirm.steps.find((s: any) => s.id === confirmStep.next)!.type, "end", "after confirming the run ends (it does not fall into the no-answer alert)");
});
