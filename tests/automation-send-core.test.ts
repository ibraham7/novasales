import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { retryDeferred, sendThroughGate, type SendRequest } from "../src/modules/workflow/send/send-core.ts";

// Saturday 15:00 in Istanbul (UTC+3): inside the 09:00–20:00 hours.
const DAY = new Date("2026-11-21T12:00:00Z");
const ORG = "org-a";
const SETTINGS = { organization_id: ORG, sending_enabled: true, timezone: "Europe/Istanbul", send_window_start: "09:00", send_window_end: "20:00", daily_limit: 100, gap_min_seconds: 45, gap_max_seconds: 180, defer_ttl_minutes: 720 };

function setup(extra: Record<string, any[]> = {}, opts: { enabled?: boolean } = {}) {
  const db: any = fakeDb({
    wf_settings: opts.enabled === false ? [] : [SETTINGS],
    opp_opportunities: [{ id: "opp-1", organization_id: ORG, contact_id: "c1" }],
    crm_opportunity_sessions: [{ organization_id: ORG, opportunity_id: "opp-1", session_ref: "s1" }],
    msg_messages: [{ id: "m1", organization_id: ORG, session_id: "s1", direction: "inbound" }],
    crm_contacts: [{ id: "c1", organization_id: ORG, custom_fields: {} }],
    ...extra,
  });
  const calls: any[] = [];
  const senders = {
    whatsapp: async (m: any) => { calls.push(["whatsapp", m]); return calls.fail ? { ok: false, error: "الرقم غير متصل" } : { ok: true }; },
    email: async (m: any) => { calls.push(["email", m]); return { ok: true }; },
  };
  return { db, calls: calls as any, senders, deps: (now = DAY) => ({ db, senders, now }) };
}
const req = (extra: Partial<SendRequest> = {}): SendRequest => ({ organizationId: ORG, workflowId: "wf1", runId: "run1", stepId: "s1", opportunityId: "opp-1", contactId: "c1", channel: "whatsapp", kind: "service", to: "+90 532 111 22 33", accountId: "acc-1", body: "مرحباً", dedupeKey: "wf1:s1:evt1", ...extra });
const log = (db: any) => db.tables.wf_message_log as any[];

test("without saved settings nothing is sent: the message is logged as skipped with the reason", async () => {
  const t = setup({}, { enabled: false });
  const r = await sendThroughGate(t.deps(), req());
  assert.deepEqual([r.status, r.code], ["skipped", "sending_off"]);
  assert.equal(t.calls.length, 0);
  assert.equal(log(t.db).length, 1);
  assert.match(log(t.db)[0].reason, /مطفأ/);
});

test("a service message to someone who wrote to us is sent once, and the log row records it", async () => {
  const t = setup();
  const r = await sendThroughGate(t.deps(), req());
  assert.equal(r.status, "sent");
  assert.equal(t.calls.length, 1);
  assert.deepEqual([t.calls[0][0], t.calls[0][1].to, t.calls[0][1].accountId, t.calls[0][1].text], ["whatsapp", "905321112233", "acc-1", "مرحباً"]);
  const row = log(t.db)[0];
  assert.deepEqual([row.status, row.kind, row.channel, row.dedupe_key], ["sent", "service", "whatsapp", "wf1:s1:evt1"]);
  assert.equal(row.sent_at, DAY.toISOString());
});

test("the same message for the same event is never sent twice", async () => {
  const t = setup();
  await sendThroughGate(t.deps(), req());
  const again = await sendThroughGate(t.deps(new Date(DAY.getTime() + 600_000)), req());
  assert.deepEqual([again.status, again.code], ["skipped", "duplicate"]);
  assert.equal(t.calls.length, 1);
  assert.equal(log(t.db).length, 1);
  // another organization's identical key is a different message
  const other = setup({ wf_message_log: [{ id: "x", organization_id: "org-b", dedupe_key: "wf1:s1:evt1", status: "sent", channel: "whatsapp", sent_at: DAY.toISOString() }] });
  assert.equal((await sendThroughGate(other.deps(), req())).status, "sent");
});

test("a number on the stop list is not messaged, written with or without the +", async () => {
  for (const identifier of ["+905321112233", "905321112233"]) {
    const t = setup({ ob_suppressions: [{ organization_id: ORG, channel: "whatsapp", identifier }] });
    const r = await sendThroughGate(t.deps(), req());
    assert.deepEqual([r.status, r.code], ["skipped", "opted_out"]);
    assert.equal(t.calls.length, 0);
  }
  const mail = setup({ ob_suppressions: [{ organization_id: ORG, channel: "email", identifier: "a@b.com" }] });
  assert.equal((await sendThroughGate(mail.deps(), req({ channel: "email", to: "A@B.com", subject: "s" }))).code, "opted_out");
});

test("promo needs explicit consent on the contact; a customer who never wrote to us gets no service message", async () => {
  const noConsent = setup();
  assert.equal((await sendThroughGate(noConsent.deps(), req({ kind: "promo" }))).code, "no_promo_consent");
  const consent = setup({ crm_contacts: [{ id: "c1", organization_id: ORG, custom_fields: { promo_consent: true } }] });
  assert.equal((await sendThroughGate(consent.deps(), req({ kind: "promo" }))).status, "sent");
  const stranger = setup({ msg_messages: [] });
  assert.equal((await sendThroughGate(stranger.deps(), req())).code, "no_prior_contact");
  assert.equal((await sendThroughGate(setup({ msg_messages: [] }).deps(), req({ allowFirstContact: true }))).status, "sent");
});

test("outside the hours the message is held until the opening, then sent by the retry; before that the retry leaves it alone", async () => {
  const night = new Date("2026-11-21T00:30:00Z"); // 03:30 Istanbul
  const t = setup();
  const held = await sendThroughGate(t.deps(night), req({ allowFirstContact: true }));
  assert.deepEqual([held.status, held.code], ["deferred", "outside_hours"]);
  assert.equal(held.notBefore, "2026-11-21T06:00:00.000Z");
  assert.equal(t.calls.length, 0);
  const row = log(t.db)[0];
  assert.deepEqual([row.status, row.allow_first_contact], ["deferred", true]);
  assert.equal(row.expires_at, new Date(night.getTime() + 720 * 60_000).toISOString());

  assert.deepEqual(await retryDeferred(t.deps(new Date("2026-11-21T05:00:00Z"))), { sent: 0, deferred: 0, skipped: 0, failed: 0 });
  assert.equal(log(t.db)[0].status, "deferred");
  const done = await retryDeferred(t.deps(new Date("2026-11-21T06:05:00Z")));
  assert.deepEqual([done.sent, done.skipped], [1, 0]);
  assert.equal(t.calls.length, 1);
  assert.equal(log(t.db)[0].status, "sent");
});

test("a held message is dropped when it has waited too long, and re-checked when it finally goes out (a stop in between wins)", async () => {
  const night = new Date("2026-11-21T00:30:00Z");
  const expired = setup();
  await sendThroughGate(expired.deps(night), req());
  await retryDeferred(expired.deps(new Date("2026-11-22T20:00:00Z")));
  assert.deepEqual([log(expired.db)[0].status, log(expired.db)[0].reason_code], ["skipped", "expired"]);
  assert.equal(expired.calls.length, 0);

  const stopped = setup();
  await sendThroughGate(stopped.deps(night), req());
  stopped.db.tables.ob_suppressions.push({ organization_id: ORG, channel: "whatsapp", identifier: "+905321112233" });
  await retryDeferred(stopped.deps(new Date("2026-11-21T06:05:00Z")));
  assert.deepEqual([log(stopped.db)[0].status, log(stopped.db)[0].reason_code], ["skipped", "opted_out"]);
  assert.equal(stopped.calls.length, 0);
});

test("the day's limit holds the message; another organization's sends do not count", async () => {
  const sentToday = (org: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${org}${i}`, organization_id: org, channel: "whatsapp", account_id: "acc-1", status: "sent", sent_at: "2026-11-21T07:00:00.000Z" }));
  const full = setup({ wf_message_log: sentToday(ORG, 100) });
  const r = await sendThroughGate(full.deps(), req());
  assert.deepEqual([r.status, r.code], ["deferred", "daily_limit"]);
  const foreign = setup({ wf_message_log: sentToday("org-b", 100) });
  assert.equal((await sendThroughGate(foreign.deps(), req())).status, "sent");
});

test("WhatsApp waits a few seconds after the sender's previous message; another sender is not held; email is never held", async () => {
  const recent = [{ id: "p", organization_id: ORG, channel: "whatsapp", account_id: "acc-1", status: "sent", sent_at: new Date(DAY.getTime() - 5_000).toISOString() }];
  assert.equal((await sendThroughGate(setup({ wf_message_log: recent }).deps(), req())).code, "gap");
  assert.equal((await sendThroughGate(setup({ wf_message_log: recent }).deps(), req({ accountId: "acc-2", dedupeKey: "k2" }))).status, "sent");
  const mail = setup({ wf_message_log: recent });
  assert.equal((await sendThroughGate(mail.deps(), req({ channel: "email", to: "a@b.com", subject: "موضوع", dedupeKey: "k3" }))).status, "sent");
  assert.deepEqual([mail.calls[0][0], mail.calls[0][1].to, mail.calls[0][1].subject], ["email", "a@b.com", "موضوع"]);
});

test("a failed send is logged with its reason and frees the key, so a later attempt can go out", async () => {
  const t = setup();
  t.calls.fail = true;
  const r = await sendThroughGate(t.deps(), req());
  assert.deepEqual([r.status, r.code], ["failed", "send_failed"]);
  assert.match(log(t.db)[0].reason, /الرقم غير متصل/);
  t.calls.fail = false;
  const second = await sendThroughGate(t.deps(new Date(DAY.getTime() + 600_000)), req());
  assert.equal(second.status, "sent");
  assert.deepEqual(log(t.db).map((l: any) => l.status), ["failed", "sent"]);
});

test("a request without an address, an account or a text is skipped with the reason and sends nothing", async () => {
  const t = setup();
  assert.equal((await sendThroughGate(t.deps(), req({ to: null }))).code, "no_address");
  assert.equal((await sendThroughGate(t.deps(), req({ accountId: null }))).code, "no_account");
  assert.equal((await sendThroughGate(t.deps(), req({ body: "  " }))).code, "no_body");
  assert.equal(t.calls.length, 0);
  assert.equal(log(t.db).length, 3);
});

test("a message stuck in «sending» is closed as interrupted and is never sent again", async () => {
  const stuck = { id: "stuck", organization_id: ORG, channel: "whatsapp", kind: "service", status: "sending", dedupe_key: "k", updated_at: new Date(DAY.getTime() - 20 * 60_000).toISOString() };
  const t = setup({ wf_message_log: [stuck] });
  await retryDeferred(t.deps());
  assert.deepEqual([log(t.db)[0].status, log(t.db)[0].reason_code], ["failed", "interrupted"]);
  assert.equal(t.calls.length, 0);
});
