import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { findCandidates, leadText, meetingReminderCandidates } from "../src/modules/workflow/time-triggers.ts";
import { validateTriggerConfig } from "../src/modules/workflow/trigger-config.ts";
import { meetingStillValid } from "../src/modules/workflow/send/meeting-guard.ts";
import { createMessageActions } from "../src/modules/workflow/send/message-actions.ts";
import { RECIPES } from "../src/modules/workflow/recipes.ts";
import { renderMessage } from "../src/modules/workflow/send/template.ts";

const MIN = 60_000;
const NOW = new Date("2026-11-25T08:00:00Z"); // 11:00 in Istanbul
const at = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * MIN).toISOString();
const meeting = (id: string, startsIn: number, extra: any = {}) => ({ id, status: "booked", starts_at: at(startsIn), created_at: at(startsIn - 5000), contact_id: "c1", opportunity_id: "o1", lead_id: null, owner_user_id: "u1", meeting_type_id: "t1", ...extra });

test("lead text reads naturally for days, hours and minutes", () => {
  assert.equal(leadText(1440), "خلال يوم");
  assert.equal(leadText(2880), "خلال يومين");
  assert.equal(leadText(60), "خلال ساعة");
  assert.equal(leadText(180), "خلال 3 ساعات");
  assert.equal(leadText(15), "خلال 15 دقيقة");
});

test("a reminder is due from X minutes before; earlier is too soon, later than the tolerance or after the start is too late", () => {
  const rows = [meeting("due", 60), meeting("soon", 90), meeting("little-late", 50), meeting("too-late", 30), meeting("started", -5)];
  assert.deepEqual(meetingReminderCandidates(rows, NOW, 60, "Europe/Istanbul").map((c) => c.payload.meeting_id), ["due", "little-late"]);
});

test("any length works: a day before tolerates a late scan of up to 6 hours", () => {
  const rows = [meeting("d", 1440), meeting("d-late", 1440 - 300), meeting("d-too-late", 1440 - 400)];
  assert.deepEqual(meetingReminderCandidates(rows, NOW, 1440, "Europe/Istanbul").map((c) => c.payload.meeting_id), ["d", "d-late"]);
});

test("a meeting booked too close to its start gets no reminder for that length; cancelled, finished and ownerless ones are skipped", () => {
  const rows = [
    meeting("booked-late", 60, { created_at: at(30) }),
    meeting("cancelled", 60, { status: "cancelled" }),
    meeting("done", 60, { status: "completed" }),
    meeting("confirmed", 60, { status: "confirmed" }),
    meeting("nobody", 60, { contact_id: null, opportunity_id: null, lead_id: null }),
  ];
  assert.deepEqual(meetingReminderCandidates(rows, NOW, 60, "Europe/Istanbul").map((c) => c.payload.meeting_id), ["confirmed"]);
});

test("the payload carries the words for the message in the organization's time zone; a moved meeting gets a new key", () => {
  const [c] = meetingReminderCandidates([meeting("m1", 60)], NOW, 60, "Europe/Istanbul", new Map([["t1", "عرض توضيحي"]]));
  assert.equal(c!.payload.meeting_time, "12:00");
  assert.equal(c!.payload.meeting_type, "عرض توضيحي");
  assert.equal(c!.payload.meeting_in, "خلال ساعة");
  assert.equal(c!.payload.contact_id, "c1");
  const [moved] = meetingReminderCandidates([meeting("m1", 60, { starts_at: at(55) })], NOW, 60, "Europe/Istanbul");
  assert.notEqual(moved!.key, c!.key);
  const [same] = meetingReminderCandidates([meeting("m1", 60)], NOW, 60, "Europe/Istanbul");
  assert.equal(same!.key, c!.key, "the same finding keeps the same key, so it is sent once");
});

test("the database scan finds due meetings of this organization only", async () => {
  const db: any = fakeDb({
    cal_meetings: [{ ...meeting("mine", 60), organization_id: "org-a" }, { ...meeting("theirs", 60), organization_id: "org-b" }, { ...meeting("far", 600), organization_id: "org-a" }],
    cal_settings: [{ organization_id: "org-a", timezone: "Europe/Istanbul" }],
    cal_meeting_types: [{ id: "t1", organization_id: "org-a", name: "عرض توضيحي" }],
  });
  const found = await findCandidates(db, "org-a", "time.meeting_reminder", { after_minutes: 60 }, NOW);
  assert.deepEqual(found.map((c) => c.payload.meeting_id), ["mine"]);
});

test("saving the trigger asks for the length, any value from 5 minutes", () => {
  assert.equal(validateTriggerConfig("event", { event: "time.meeting_reminder", after_minutes: 60 }), null);
  assert.equal(validateTriggerConfig("event", { event: "time.meeting_reminder", after_minutes: 2880 }), null);
  assert.match(validateTriggerConfig("event", { event: "time.meeting_reminder" }) ?? "", /الدقائق/);
  assert.match(validateTriggerConfig("event", { event: "time.meeting_reminder", after_minutes: 2 }) ?? "", /الدقائق/);
});

test("the ready recipes are starting points with the meeting words; they render a full sentence", () => {
  const day = RECIPES.find((r) => r.id === "meeting-reminder-day")!, hour = RECIPES.find((r) => r.id === "meeting-reminder-hour")!;
  assert.equal(day.trigger.config.after_minutes, 1440);
  assert.equal(hour.trigger.config.after_minutes, 60);
  const text = renderMessage(String(day.steps[0]!.config.body), { first_name: "بشر", meeting_in: "خلال يوم", meeting_day: "الخميس 26 نوفمبر", meeting_time: "12:00", assignee: "مياسة" }, () => 0);
  assert.ok(text.includes("12:00") && text.includes("خلال يوم") && !text.includes("{"));
});

const GUARD_DB = (status: string, startsIn = 60) => fakeDb({ cal_meetings: [{ id: "m1", organization_id: "org-a", status, starts_at: at(startsIn) }] });
const trigger = (startsIn = 60) => ({ time_event: "time.meeting_reminder", meeting_id: "m1", meeting_starts_at: at(startsIn) });

test("the guard lets a reminder through only while the same meeting is still booked or confirmed and ahead", async () => {
  assert.equal(await meetingStillValid(GUARD_DB("booked") as any, "org-a", trigger(), NOW), true);
  assert.equal(await meetingStillValid(GUARD_DB("confirmed") as any, "org-a", trigger(), NOW), true);
  assert.equal(await meetingStillValid(GUARD_DB("cancelled") as any, "org-a", trigger(), NOW), false);
  assert.equal(await meetingStillValid(GUARD_DB("booked", 120) as any, "org-a", trigger(60), NOW), false, "moved");
  assert.equal(await meetingStillValid(GUARD_DB("booked", -5) as any, "org-a", trigger(-5), NOW), false, "already started");
  assert.equal(await meetingStillValid(GUARD_DB("booked") as any, "org-b", trigger(), NOW), false, "another organization");
  assert.equal(await meetingStillValid(GUARD_DB("cancelled") as any, "org-a", { opportunity_id: "o1" }, NOW), true, "not a reminder");
});

function setup(status: string, sendingEnabled: boolean, nowIso = NOW.toISOString(), startsIn = 60) {
  const db: any = fakeDb({
    wf_settings: [{ organization_id: "org-a", sending_enabled: sendingEnabled, timezone: "Europe/Istanbul", send_window_start: "09:00", send_window_end: "20:00", daily_limit: 100, gap_min_seconds: 0, gap_max_seconds: 0, defer_ttl_minutes: 720, test_recipients: [] }],
    organizations: [{ id: "org-a", name: "نوفا" }],
    crm_contacts: [{ id: "c1", organization_id: "org-a", display_name: "بشر قشقوش", custom_fields: {} }],
    crm_contact_points: [{ organization_id: "org-a", contact_id: "c1", channel_type: "whatsapp", identifier: "905000000001", is_primary: true }],
    opp_opportunities: [{ id: "o1", organization_id: "org-a", contact_id: "c1", owner_agent_id: "u1" }],
    profiles: [{ id: "u1", full_name: "مياسة" }],
    crm_opportunity_sessions: [{ organization_id: "org-a", opportunity_id: "o1", session_ref: "s1" }],
    msg_sessions: [{ id: "s1", organization_id: "org-a", channel_account_id: "acc-1", last_message_at: "2026-11-20T00:00:00Z" }],
    msg_channel_accounts: [{ id: "acc-1", organization_id: "org-a", status: "connected", owner_user_id: "u2" }],
    msg_messages: [{ id: "m0", organization_id: "org-a", session_id: "s1", direction: "inbound" }],
    cal_meetings: [{ id: "m1", organization_id: "org-a", status, starts_at: new Date(new Date(nowIso).getTime() + startsIn * MIN).toISOString() }],
  });
  const sent: any[] = [];
  const senders = { whatsapp: async (m: any) => { sent.push(m); return { ok: true }; }, email: async () => ({ ok: true }) };
  const actions = createMessageActions({ db, senders, notify: async () => ({ targeted: 0, accepted: 0, noDevice: 0, duplicates: 0 }), managers: async () => [], random: () => 0, now: () => new Date(nowIso) });
  return { db, sent, actions };
}
const run = (payload: any) => ({ organizationId: "org-a", runId: "run-1", workflowId: "wf-1", stepId: "s", triggerPayload: payload, runContext: {} }) as any;
const STEP = { kind: "service", account: "ticket", body: "{first_name}، موعدنا {meeting_in} الساعة {meeting_time}" };
const payloadFor = (now: Date) => ({ ...meetingReminderCandidates([{ ...meeting("m1", 60), starts_at: new Date(now.getTime() + 60 * MIN).toISOString(), created_at: "2026-11-20T00:00:00Z" }], now, 60, "Europe/Istanbul")[0]!.payload, time_event: "time.meeting_reminder" });

test("a reminder for a still-valid meeting is sent with the meeting words filled in", async () => {
  const { actions, sent } = setup("booked", true);
  const r = await actions["message.whatsapp"](STEP, run(payloadFor(NOW)));
  assert.equal(r.output?.outcome, "sent");
  assert.equal(sent[0].text, "بشر، موعدنا خلال ساعة الساعة 12:00");
});

test("a reminder for a cancelled meeting is skipped and nothing is sent", async () => {
  const { actions, sent } = setup("cancelled", true);
  const r = await actions["message.whatsapp"](STEP, run(payloadFor(NOW)));
  assert.equal(r.output?.outcome, "skipped");
  assert.equal(r.output?.code, "meeting_changed");
  assert.equal(sent.length, 0);
});

test("with automatic sending off nothing is sent, as for every automatic message", async () => {
  const { actions, sent } = setup("booked", false);
  const r = await actions["message.whatsapp"](STEP, run(payloadFor(NOW)));
  assert.equal(r.output?.outcome, "skipped");
  assert.equal(sent.length, 0);
});

test("a reminder held for the sending hours is dropped at the meeting start, not kept for 12 hours", async () => {
  const late = new Date("2026-11-25T20:00:00Z"); // 23:00 in Istanbul: outside the sending hours
  const { actions, db } = setup("booked", true, late.toISOString());
  const payload = payloadFor(late);
  const r = await actions["message.whatsapp"](STEP, run(payload));
  assert.equal(r.output?.outcome, "deferred");
  const row = (await db.from("wf_message_log").select("*")).data.find((x: any) => x.status === "deferred");
  assert.equal(new Date(row.expires_at).toISOString(), payload.meeting_starts_at);
});
