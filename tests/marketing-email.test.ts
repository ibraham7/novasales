import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fakeDb } from "./helpers/fake-db.ts";
import {
  controlEmailCampaign, createEmailCampaign, deleteEmailCampaign, emailAudience, handleEmailStop, handleProviderEvent, normalizeEmail, renderEmail, runEmailTick, verifyWebhookSignature, type EmailCampaignInput, type SendResult,
} from "../src/modules/marketing/email-core.ts";

const ORG = "org-1";
const NOW = new Date("2026-11-10T12:00:00Z");
const UNIQUE = { ob_suppressions: ["organization_id", "channel", "identifier"] };
const prospect = (id: string, extra: any = {}) => ({ id, organization_id: ORG, name: `عيادة ${id}`, status: "approved", emails: [`info@clinic${id}.com`], ...extra });
const input = (extra: Partial<EmailCampaignInput> = {}): EmailCampaignInput => ({ organizationId: ORG, userId: "user-1", name: "عرض", subject: "مرحباً {{name}}", body: "عندنا عرض لكم", throttlePerMinute: 5, acknowledgments: { b2b: true, optOut: true, review: true }, ...extra });
const deps = (extra: any = {}) => ({ configured: true, stopBaseUrl: "https://sales.example.com", now: () => NOW, from: "NovaSales <hello@example.com>", ...extra });

test("emails are normalized and junk is rejected", () => {
  assert.equal(normalizeEmail("  Info@Clinic.COM "), "info@clinic.com");
  for (const bad of ["", "no-at", "a@b", "a b@c.com", "x@y.c", "<a@b.com>", 5, null]) assert.equal(normalizeEmail(bad), null);
});

test("the audience keeps approved businesses with a usable email and counts the rest by reason", async () => {
  const db = fakeDb({
    ob_prospects: [
      prospect("1"), prospect("2", { emails: [] }), prospect("3", { emails: ["bad", "ok@three.com"] }), prospect("4"), prospect("5", { status: "new" }), prospect("6", { emails: ["INFO@clinic1.com"] }), prospect("7"),
    ],
    ob_suppressions: [{ organization_id: ORG, channel: "email", identifier: "info@clinic4.com" }, { organization_id: ORG, channel: "whatsapp", identifier: "info@clinic7.com" }],
    ob_email_messages: [],
  });
  const a = await emailAudience(db, ORG);
  assert.deepEqual(a.eligible.map((e) => e.email), ["info@clinic1.com", "ok@three.com", "info@clinic7.com"]);
  assert.deepEqual(a.excluded, { noEmail: 1, suppressed: 1, inOtherCampaign: 0, duplicateEmail: 1 });
  assert.equal(a.approved, 6);
});

test("the final approval needs every safeguard, then creates a scheduled campaign with a private token per recipient", async () => {
  const seed = () => ({ ob_prospects: [prospect("1"), prospect("2")], ob_suppressions: [], ob_events: [] });
  const refuse = (message: RegExp, extra: Partial<EmailCampaignInput> = {}, d: any = deps(), custom: any = seed()) => assert.rejects(() => createEmailCampaign(fakeDb(custom, UNIQUE), d, input(extra)), message);
  await refuse(/أكّد كل بنود/, { acknowledgments: { b2b: true, optOut: true, review: false } });
  await refuse(/غير مُعدّ/, {}, deps({ configured: false }));
  await refuse(/PUBLIC_APP_URL/, {}, deps({ stopBaseUrl: undefined }));
  await refuse(/اكتب عنوان/, { subject: " " });
  await refuse(/اكتب نص/, { body: " " });
  await refuse(/\{\{name\}\} فقط/, { body: "مرحباً {{city}}" });
  await refuse(/موعداً صحيحاً/, { scheduledAt: "2026-11-01T00:00:00Z" });
  await refuse(/بريد صالح/, {}, deps(), { ob_prospects: [prospect("1", { emails: [] })], ob_suppressions: [] });
  await refuse(/الحد الأقصى 1 /, {}, deps({ maxRecipients: 1 }));

  const db = fakeDb(seed(), UNIQUE);
  const r = await createEmailCampaign(db, deps(), input({ throttlePerMinute: 999 }));
  assert.equal(r.recipients, 2);
  const [c] = db.tables.ob_email_campaigns;
  assert.deepEqual([c.status, c.throttle_per_minute, c.approved_by, c.scheduled_at], ["scheduled", 30, "user-1", NOW.toISOString()]);
  const [a, b] = db.tables.ob_email_messages;
  assert.deepEqual([a.status, a.email, a.stop_token.length >= 20, a.stop_token !== b.stop_token], ["queued", "info@clinic1.com", true, true]);
  assert.equal(db.tables.ob_events.at(-1).event_type, "email_campaign_approved");
});

test("a message is rendered safely: names are escaped, the subject stays one line and the unsubscribe link is always there", () => {
  const mail = renderEmail({ subject: "مرحباً {{name}}", body: "نص\n\nفقرة <b>ثانية</b> {{name}}", name: "Clinic\r\nBcc: x@y.com <script>", sender: "شركة نوفا", stopUrl: "https://s.example/stop/abc" });
  assert.equal(mail.subject.includes("\n"), false);
  assert.match(mail.text, /https:\/\/s\.example\/stop\/abc/);
  assert.match(mail.html, /&lt;b&gt;ثانية&lt;\/b&gt;/);
  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.html, /href="https:\/\/s\.example\/stop\/abc"/);
});

const ready = (messages = 3, campaign: any = {}) => ({
  ob_email_campaigns: [{ id: "c1", organization_id: ORG, subject: "مرحباً {{name}}", body: "نص", throttle_per_minute: 2, status: "scheduled", scheduled_at: NOW.toISOString(), created_at: "2026-11-10T11:00:00Z", ...campaign }],
  ob_email_messages: Array.from({ length: messages }, (_, i) => ({ id: `m${i + 1}`, organization_id: ORG, campaign_id: "c1", ob_prospect_id: `p${i + 1}`, email: `a${i + 1}@x.com`, name: `جهة ${i + 1}`, status: "queued", stop_token: `token-${i + 1}-`.padEnd(24, "x"), created_at: `2026-11-10T11:00:0${i}Z` })),
  ob_prospects: Array.from({ length: messages }, (_, i) => ({ id: `p${i + 1}`, organization_id: ORG, status: "approved" })),
  ob_suppressions: [],
  ob_events: [],
});
const tickDeps = (send: (mail: any) => Promise<SendResult>, extra: any = {}) => ({ send, stopBaseUrl: "https://s.example", orgName: async () => "شركة نوفا", now: () => NOW, ...extra });

test("a run starts a due campaign and sends only its per-minute limit, then finishes it", async () => {
  const db = fakeDb(ready());
  const sent: any[] = [];
  const send = async (mail: any): Promise<SendResult> => (sent.push(mail), { ok: true, id: `prov-${sent.length}` });
  assert.deepEqual(await runEmailTick(db, tickDeps(send)), { processed: 2 });
  assert.equal(db.tables.ob_email_campaigns[0].status, "running");
  assert.deepEqual(db.tables.ob_email_messages.map((m: any) => m.status), ["sent", "sent", "queued"]);
  assert.match(sent[0].stopUrl, /^https:\/\/s\.example\/stop\/token-1-/);
  assert.equal(db.tables.ob_prospects[0].status, "contacted");
  assert.deepEqual(await runEmailTick(db, tickDeps(send)), { processed: 1 });
  assert.equal(db.tables.ob_email_campaigns[0].status, "completed");
});

test("the organization's daily cap stops sending for the day", async () => {
  const db = fakeDb(ready(3, { throttle_per_minute: 10 }));
  const send = async (): Promise<SendResult> => ({ ok: true, id: "x" });
  assert.deepEqual(await runEmailTick(db, tickDeps(send, { dailyCap: 2 })), { processed: 2 });
  assert.deepEqual(db.tables.ob_email_messages.map((m: any) => m.status), ["sent", "sent", "queued"]);
  assert.deepEqual(await runEmailTick(db, tickDeps(send, { dailyCap: 2 })), { processed: 0 });
  assert.equal(db.tables.ob_email_campaigns[0].status, "running");
});

test("a blocked address is skipped, a rejected one fails, and a busy provider makes the batch wait", async () => {
  const db = fakeDb({ ...ready(3, { throttle_per_minute: 10 }), ob_suppressions: [{ organization_id: ORG, channel: "email", identifier: "a1@x.com" }] });
  const send = async (mail: any): Promise<SendResult> => (mail.to === "a2@x.com" ? { ok: false, error: "invalid address" } : { ok: true, id: "ok" });
  await runEmailTick(db, tickDeps(send));
  assert.deepEqual(db.tables.ob_email_messages.map((m: any) => m.status), ["skipped", "failed", "sent"]);
  assert.equal(db.tables.ob_email_campaigns[0].status, "completed");

  const busy = fakeDb(ready(3, { throttle_per_minute: 10 }));
  let calls = 0;
  await runEmailTick(busy, tickDeps(async () => (++calls, { ok: false, error: "rate limited", retry: true })));
  assert.equal(calls, 1);
  assert.deepEqual(busy.tables.ob_email_messages.map((m: any) => m.status), ["queued", "queued", "queued"]);
  assert.equal(busy.tables.ob_email_campaigns[0].status, "running");
});

test("a paused or cancelled campaign sends nothing, and a campaign is deleted only when finished", async () => {
  const db = fakeDb(ready(2, { status: "paused" }));
  assert.deepEqual(await runEmailTick(db, tickDeps(async () => ({ ok: true, id: "x" }))), { processed: 0 });
  await controlEmailCampaign(db, ORG, "c1", "resume");
  assert.equal(db.tables.ob_email_campaigns[0].status, "running");
  await assert.rejects(() => deleteEmailCampaign(db, ORG, "c1"), /ألغِ الحملة أولاً/);
  await controlEmailCampaign(db, ORG, "c1", "cancel");
  assert.deepEqual(db.tables.ob_email_messages.map((m: any) => m.status), ["skipped", "skipped"]);
  await assert.rejects(() => controlEmailCampaign(db, ORG, "c1", "pause"), /حالة الحملة/);
  await deleteEmailCampaign(db, ORG, "c1");
  assert.equal(db.tables.ob_email_campaigns.length, 0);
});

test("the unsubscribe link blocks that address and stops the business; an unknown token does nothing", async () => {
  const db = fakeDb({ ...ready(1), ob_prospects: [{ id: "p1", organization_id: ORG, status: "contacted" }] }, UNIQUE);
  assert.deepEqual(await handleEmailStop(db, "nope"), { ok: false });
  assert.deepEqual(await handleEmailStop(db, db.tables.ob_email_messages[0].stop_token), { ok: true });
  assert.deepEqual(db.tables.ob_suppressions.map((s: any) => [s.channel, s.identifier, s.source]), [["email", "a1@x.com", "link"]]);
  assert.equal(db.tables.ob_prospects[0].status, "opted_out");
  assert.equal(db.tables.ob_events.at(-1).detail.via, "email_link");
});

test("delivery, bounce and complaint reports update the message; bounces and complaints block the address", async () => {
  const mk = () => fakeDb({ ...ready(1), ob_email_messages: [{ ...ready(1).ob_email_messages[0], status: "sent", provider_message_id: "prov-1" }], ob_prospects: [{ id: "p1", organization_id: ORG, status: "contacted" }] }, UNIQUE);
  let db = mk();
  assert.deepEqual(await handleProviderEvent(db, { type: "email.delivered", providerMessageId: "prov-1" }), { handled: true });
  assert.equal(db.tables.ob_email_messages[0].status, "delivered");
  assert.deepEqual(await handleProviderEvent(db, { type: "email.delivered", providerMessageId: "unknown" }), { handled: false });
  assert.deepEqual(await handleProviderEvent(db, { type: "email.opened", providerMessageId: "prov-1" }), { handled: false });
  db = mk();
  await handleProviderEvent(db, { type: "email.bounced", providerMessageId: "prov-1" });
  assert.deepEqual([db.tables.ob_email_messages[0].status, db.tables.ob_suppressions[0].identifier, db.tables.ob_prospects[0].status], ["bounced", "a1@x.com", "contacted"]);
  db = mk();
  await handleProviderEvent(db, { type: "email.complained", providerMessageId: "prov-1" });
  assert.deepEqual([db.tables.ob_email_messages[0].status, db.tables.ob_prospects[0].status], ["complained", "opted_out"]);
});

test("webhook signatures: valid, tampered, stale and missing", () => {
  const secret = "whsec_" + Buffer.from("super-secret-key").toString("base64");
  const body = JSON.stringify({ type: "email.delivered" });
  const ts = String(Math.floor(NOW.getTime() / 1000));
  const sig = "v1," + createHmac("sha256", Buffer.from("super-secret-key")).update(`msg_1.${ts}.${body}`).digest("base64");
  const base = { secret, id: "msg_1", timestamp: ts, signature: sig, body, now: NOW };
  assert.equal(verifyWebhookSignature(base), true);
  assert.equal(verifyWebhookSignature({ ...base, signature: `v1,bogus ${sig}` }), true);
  assert.equal(verifyWebhookSignature({ ...base, body: body + " " }), false);
  assert.equal(verifyWebhookSignature({ ...base, now: new Date(NOW.getTime() + 600_000) }), false);
  assert.equal(verifyWebhookSignature({ ...base, signature: null }), false);
  assert.equal(verifyWebhookSignature({ ...base, secret: "" }), false);
});
