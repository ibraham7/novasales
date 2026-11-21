import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { ALERTS_OFF_REASON, PROMO_FOOTER, createMessageActions } from "../src/modules/workflow/send/message-actions.ts";
import { validateMessageStep, validateMessageSteps } from "../src/modules/workflow/send/message-config.ts";

const ORG = "org-a";
const DAY = new Date("2026-11-21T12:00:00Z"); // Saturday 15:00 in Istanbul
const SETTINGS = { organization_id: ORG, sending_enabled: true, alerts_enabled: true, timezone: "Europe/Istanbul", send_window_start: "09:00", send_window_end: "20:00", daily_limit: 100, gap_min_seconds: 45, gap_max_seconds: 180, defer_ttl_minutes: 720 };
const ctx = (extra: any = {}) => ({ organizationId: ORG, runId: "run-1", workflowId: "wf-1", stepId: "step-1", triggerPayload: { opportunity_id: "o1", to_stage_name: "عرض سعر" }, runContext: {}, ...extra });

function setup(opts: { settings?: any | null; extra?: Record<string, any[]>; notify?: any } = {}) {
  const db: any = fakeDb({
    wf_settings: opts.settings === null ? [] : [{ ...SETTINGS, ...(opts.settings ?? {}) }],
    organizations: [{ id: ORG, name: "نوفا" }],
    crm_contacts: [{ id: "c1", organization_id: ORG, display_name: "أحمد علي", custom_fields: {} }],
    crm_contact_points: [{ organization_id: ORG, contact_id: "c1", channel_type: "whatsapp", identifier: "905321112233", is_primary: true }, { organization_id: ORG, contact_id: "c1", channel_type: "email", identifier: "ahmad@example.com", is_primary: true }],
    opp_opportunities: [{ id: "o1", organization_id: ORG, contact_id: "c1", owner_agent_id: "u1", source: "whatsapp" }],
    profiles: [{ id: "u1", full_name: "مياسة" }],
    crm_opportunity_sessions: [{ organization_id: ORG, opportunity_id: "o1", session_ref: "s1" }],
    msg_sessions: [{ id: "s1", organization_id: ORG, channel_account_id: "acc-1", last_message_at: "2026-11-20T00:00:00Z" }],
    msg_channel_accounts: [{ id: "acc-1", organization_id: ORG, status: "connected", owner_user_id: "u2" }],
    msg_messages: [{ id: "m1", organization_id: ORG, session_id: "s1", direction: "inbound" }],
    ...(opts.extra ?? {}),
  });
  const sent: any[] = [];
  const notified: any[] = [];
  const senders = { whatsapp: async (m: any) => { sent.push(["whatsapp", m]); return { ok: true }; }, email: async (m: any) => { sent.push(["email", m]); return { ok: true }; } };
  const notify = opts.notify ?? (async (i: any) => { notified.push(i); return { targeted: i.userIds.length, accepted: 1, noDevice: 0, duplicates: 0 }; });
  const actions = createMessageActions({ db, senders, notify, managers: async () => ["boss-1", "boss-2"], random: () => 0, now: () => DAY });
  return { db, sent, notified, actions };
}

test("a WhatsApp step fills the variables, picks the ticket's chat number, and reports «sent»", async () => {
  const t = setup();
  const r = await t.actions["message.whatsapp"]({ body: "{مرحباً|أهلاً} {first_name}، معك {assignee} من {org}. وصلنا طلبك ({stage})." }, ctx());
  assert.equal(r.ok, true);
  assert.deepEqual([r.output?.outcome, r.output?.channel, r.output?.kind], ["sent", "whatsapp", "service"]);
  assert.deepEqual([t.sent[0][1].to, t.sent[0][1].accountId, t.sent[0][1].text], ["905321112233", "acc-1", "مرحباً أحمد، معك مياسة من نوفا. وصلنا طلبك (عرض سعر)."]);
  const row = t.db.tables.wf_message_log[0];
  assert.deepEqual([row.status, row.workflow_id, row.step_id, row.run_id, row.dedupe_key], ["sent", "wf-1", "step-1", "run-1", "wf-1:step-1:run-1"]);
});

test("with sending switched off (the default) nothing is sent and the step says «skipped», not «done»", async () => {
  const t = setup({ settings: null });
  const r = await t.actions["message.whatsapp"]({ body: "مرحباً {name}" }, ctx());
  assert.equal(r.ok, true);
  assert.deepEqual([r.output?.outcome, r.output?.code], ["skipped", "sending_off"]);
  assert.match(String(r.output?.reason), /مطفأ/);
  assert.equal(t.sent.length, 0);
});

test("running the same step again for the same run never sends twice", async () => {
  const t = setup();
  await t.actions["message.whatsapp"]({ body: "مرحباً" }, ctx());
  const again = await t.actions["message.whatsapp"]({ body: "مرحباً" }, ctx());
  assert.deepEqual([again.output?.outcome, again.output?.code], ["skipped", "duplicate"]);
  assert.equal(t.sent.length, 1);
});

test("a promotional step adds the stop sentence and needs the customer's explicit consent", async () => {
  const noConsent = setup();
  const refused = await noConsent.actions["message.whatsapp"]({ kind: "promo", body: "عرض خاص" }, ctx());
  assert.deepEqual([refused.output?.outcome, refused.output?.code], ["skipped", "no_promo_consent"]);
  const ok = setup({ extra: { crm_contacts: [{ id: "c1", organization_id: ORG, display_name: "أحمد", custom_fields: { promo_consent: true } }] } });
  const r = await ok.actions["message.whatsapp"]({ kind: "promo", body: "عرض خاص" }, ctx());
  assert.equal(r.output?.outcome, "sent");
  assert.equal(ok.sent[0][1].text, `عرض خاص${PROMO_FOOTER}`);
});

test("outside the sending hours the step reports «deferred» with the time, and the run is not failed", async () => {
  const t = setup();
  const actions = createMessageActions({ db: t.db, senders: { whatsapp: async () => ({ ok: true }), email: async () => ({ ok: true }) }, notify: async () => ({ targeted: 0, accepted: 0, noDevice: 0, duplicates: 0 }), managers: async () => [], now: () => new Date("2026-11-21T00:30:00Z") });
  const r = await actions["message.whatsapp"]({ body: "مرحباً" }, ctx());
  assert.equal(r.ok, true);
  assert.deepEqual([r.output?.outcome, r.output?.code, r.output?.not_before], ["deferred", "outside_hours", "2026-11-21T06:00:00.000Z"]);
});

test("a customer without a number, or a ticket without a WhatsApp number to send from, is skipped with the reason", async () => {
  const noPhone = setup({ extra: { crm_contact_points: [] } });
  assert.equal((await noPhone.actions["message.whatsapp"]({ body: "مرحباً" }, ctx())).output?.code, "no_address");
  const noAccount = setup({ extra: { msg_channel_accounts: [], crm_opportunity_sessions: [] } });
  assert.equal((await noAccount.actions["message.whatsapp"]({ body: "مرحباً" }, ctx())).output?.code, "no_account");
  const empty = setup();
  assert.equal((await empty.actions["message.whatsapp"]({ body: "{phone_x}" }, ctx())).output?.code, "no_body");
});

test("a failing sender stops the run with the reason (the only case that does)", async () => {
  const t = setup();
  const actions = createMessageActions({ db: t.db, senders: { whatsapp: async () => ({ ok: false, error: "الرقم غير متصل" }), email: async () => ({ ok: true }) }, notify: async () => ({ targeted: 0, accepted: 0, noDevice: 0, duplicates: 0 }), managers: async () => [], now: () => DAY });
  const r = await actions["message.whatsapp"]({ body: "مرحباً" }, ctx());
  assert.equal(r.ok, false);
  assert.match(String(r.error), /الرقم غير متصل/);
  assert.equal(r.output?.outcome, "failed");
});

test("an email step uses the subject and the customer's address", async () => {
  const t = setup();
  const r = await t.actions["message.email"]({ subject: "عرض سعر لـ {first_name}", body: "أهلاً {name}" }, ctx());
  assert.equal(r.output?.outcome, "sent");
  assert.deepEqual([t.sent[0][0], t.sent[0][1].to, t.sent[0][1].subject, t.sent[0][1].text], ["email", "ahmad@example.com", "عرض سعر لـ أحمد", "أهلاً أحمد علي"]);
  const none = setup({ extra: { crm_contact_points: [{ organization_id: ORG, contact_id: "c1", channel_type: "whatsapp", identifier: "905321112233", is_primary: true }] } });
  assert.equal((await none.actions["message.email"]({ subject: "x", body: "y" }, ctx())).output?.code, "no_address");
});

test("staff alerts are OFF by default; when on they reach the assignee or the managers, once per run", async () => {
  const off = setup({ settings: { alerts_enabled: false } });
  const skipped = await off.actions["notify.staff"]({ title: "عميل جديد", to: "assignee" }, ctx());
  assert.deepEqual([skipped.output?.outcome, skipped.output?.code, skipped.output?.reason], ["skipped", "alerts_off", ALERTS_OFF_REASON]);
  assert.equal(off.notified.length, 0);

  const on = setup();
  const r = await on.actions["notify.staff"]({ title: "تذكرة {name} انتقلت إلى {stage}", body: "المندوب {assignee}", to: "assignee" }, ctx());
  assert.equal(r.output?.outcome, "sent");
  assert.deepEqual([on.notified[0].userIds, on.notified[0].title, on.notified[0].body, on.notified[0].url, on.notified[0].type], [["u1"], "تذكرة أحمد علي انتقلت إلى عرض سعر", "المندوب مياسة", "/pipeline/o1", "automation"]);
  assert.equal(on.notified[0].dedupeKey, "wf:wf-1:step-1:run-1");
  const managers = await on.actions["notify.staff"]({ title: "تنبيه", to: "managers" }, ctx({ runId: "run-2" }));
  assert.deepEqual(on.notified[1].userIds, ["boss-1", "boss-2"]);
  assert.equal(managers.output?.outcome, "sent");
  const nobody = setup({ extra: { opp_opportunities: [{ id: "o1", organization_id: ORG, contact_id: "c1", owner_agent_id: null }] } });
  assert.equal((await nobody.actions["notify.staff"]({ title: "تنبيه", to: "assignee" }, ctx())).output?.code, "no_recipient");
});

test("step settings are checked when saving: texts, unknown variables, kinds, recipients", () => {
  assert.equal(validateMessageStep("message.whatsapp", { body: "مرحباً {name}" }), null);
  assert.match(validateMessageStep("message.whatsapp", { body: "  " })!, /نص الرسالة/);
  assert.match(validateMessageStep("message.whatsapp", { body: "مرحباً {nmae}" })!, /\{nmae\}/);
  assert.match(validateMessageStep("message.whatsapp", { body: "x".repeat(1001) })!, /أطول/);
  assert.match(validateMessageStep("message.whatsapp", { body: "x", kind: "ads" })!, /خدمة أو ترويج/);
  assert.match(validateMessageStep("message.whatsapp", { body: "x", account: "random" })!, /الواتساب المرسِل/);
  assert.match(validateMessageStep("message.email", { body: "x" })!, /موضوع/);
  assert.equal(validateMessageStep("message.email", { subject: "s", body: "x", kind: "promo" }), null);
  assert.match(validateMessageStep("notify.staff", { title: "", to: "assignee" })!, /عنوان/);
  assert.match(validateMessageStep("notify.staff", { title: "x", to: "users" })!, /موظفاً/);
  assert.match(validateMessageStep("notify.staff", { title: "x", to: "everyone" })!, /من يصله/);
  assert.equal(validateMessageStep("notify.staff", { title: "x {name}", to: "users", user_ids: ["00000000-0000-0000-0000-000000000001"] }), null);
  assert.equal(validateMessageStep("crm.task.create", {}), null);
  const steps = [{ type: "delay" }, { type: "action", action: "message.whatsapp", label: "ترحيب", config: { body: "{bad}" } }];
  assert.match(validateMessageSteps(steps)!, /الخطوة 2 \(«ترحيب»\).*\{bad\}/);
  assert.equal(validateMessageSteps([{ type: "action", action: "crm.task.create", config: {} }]), null);
});
