import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { isOptOutMessage, normalizeOptOutText } from "../src/modules/marketing/optout.ts";
import {
  addManualProspect, addSuppression, blockedPhones, deleteOutboundCampaign, removeSuppression, createOutboundCampaign, handleInboundReply, previewAudience, type AccountInfo, type CampaignInput,
} from "../src/modules/marketing/outbound-core.ts";

const UNIQUE = { ob_prospects: ["organization_id", "provider", "external_id"], ob_suppressions: ["organization_id", "channel", "identifier"] };
const ORG = "org-1";
const NOW = new Date("2026-11-04T10:00:00Z");
const prospect = (id: string, extra: any = {}) => ({ id, organization_id: ORG, name: `عيادة ${id}`, status: "approved", phone_e164: `90532000${id.padStart(4, "0")}`, phone_kind: "mobile", ...extra });
const account = (extra: Partial<NonNullable<AccountInfo>> = {}): AccountInfo => ({ organizationId: ORG, connected: true, isOfficial: false, label: "رقم الفريق", ...extra });
const input = (extra: Partial<CampaignInput> = {}): CampaignInput => ({
  organizationId: ORG, userId: "user-1", name: "عرض نهاية السنة", body: "مرحباً {{name}}، عندنا خصم 30%", accountId: "acc-1", throttlePerMinute: 5,
  acknowledgments: { b2b: true, optOut: true, review: true }, ...extra,
});
const settings = (allow = true) => ({ ob_org_settings: [{ organization_id: ORG, allow_unofficial: allow, optout_footer: "للإيقاف أرسل: إيقاف" }] });
const deps = (acc: AccountInfo = account()) => ({ account: async () => acc, now: () => NOW });

test("a request to stop is recognised in Arabic, English and Turkish, but a conversation is not", () => {
  for (const yes of ["إيقاف", "ايقاف", "  إِيقَاف! ", "STOP", "Stop please", "unsubscribe", "dur", "Iptal", "لا ترسل", "توقف", "إلغاء الاشتراك", "cikar"]) assert.equal(isOptOutMessage(yes), true, yes);
  for (const no of ["مرحبا", "ما هي الأسعار؟", "stopwatch price?", "نعم أريد التفاصيل", "", "أريد إيقاف الخدمة القديمة وتفعيل خدمة جديدة بسعر أقل لو سمحتم"]) assert.equal(isOptOutMessage(no), false, no);
  assert.equal(normalizeOptOutText("İPTAL!"), "iptal");
});

test("the preview counts who is left out and why", async () => {
  const db = fakeDb({
    ob_prospects: [prospect("1"), prospect("2", { phone_e164: null }), prospect("3", { phone_kind: "landline" }), prospect("4"), prospect("5"), prospect("6", { phone_e164: "905320000001" }), prospect("7", { status: "new" }), prospect("9", { organization_id: "org-2" })],
    ob_suppressions: [{ organization_id: ORG, channel: "whatsapp", identifier: prospect("4").phone_e164 }],
    cmp_recipients: [{ organization_id: ORG, ob_prospect_id: "5", status: "queued" }],
  }, UNIQUE);
  const preview = await previewAudience(db, ORG);
  assert.deepEqual(preview.eligible.map((p) => p.id), ["1"]);
  assert.deepEqual(preview.excluded, { noPhone: 1, landline: 1, suppressed: 1, inOtherCampaign: 1, duplicatePhone: 1 });
  assert.equal(preview.approved, 6, "only this organization's approved businesses");
});

test("the final approval creates the template with the opt-out line, the scheduled campaign and its recipients", async () => {
  const db = fakeDb({ ob_prospects: [prospect("1"), prospect("2")], ...settings() }, UNIQUE);
  const result = await createOutboundCampaign(db, deps(), input());
  assert.equal(result.recipients, 2);
  const [template] = db.tables.cmp_templates;
  assert.equal(template.body, "مرحباً {{name}}، عندنا خصم 30%\n\nللإيقاف أرسل: إيقاف");
  const [campaign] = db.tables.cmp_campaigns;
  assert.deepEqual([campaign.kind, campaign.status, campaign.audience_ready, campaign.throttle_per_minute], ["outbound", "scheduled", true, 5]);
  assert.equal(campaign.scheduled_at, NOW.toISOString());
  assert.deepEqual([campaign.approved_by, campaign.compliance_snapshot.recipients, campaign.compliance_snapshot.account.official], ["user-1", 2, false]);
  const recipients = db.tables.cmp_recipients;
  assert.deepEqual(recipients.map((r) => [r.ob_prospect_id, r.contact_id, r.status, r.variables.name]), [["1", null, "queued", "عيادة 1"], ["2", null, "queued", "عيادة 2"]]);
  assert.equal(db.tables.ob_events[0].event_type, "campaign_approved");
});

test("sending is refused until every safeguard is in place", async () => {
  const seed = { ob_prospects: [prospect("1")], ...settings() };
  const refuse = (message: RegExp, extra: Partial<CampaignInput> = {}, acc: AccountInfo = account(), custom: any = seed) => assert.rejects(() => createOutboundCampaign(fakeDb(custom, UNIQUE), deps(acc), input(extra)), message);
  await refuse(/أكّد كل بنود/, { acknowledgments: { b2b: true, optOut: false, review: true } });
  await refuse(/اكتب نص/, { body: "  " });
  await refuse(/\{\{name\}\} فقط/, { body: "مرحبا {{city}}" });
  await refuse(/موعداً صحيحاً/, { scheduledAt: "2026-11-01T00:00:00Z" });
  await refuse(/تابعاً لمؤسستك/, {}, null);
  await refuse(/تابعاً لمؤسستك/, {}, account({ organizationId: "org-2" }));
  await refuse(/غير متصل/, {}, account({ connected: false }));
  await refuse(/قوالب معتمدة/, {}, account({ isOfficial: true }));
  await refuse(/معطّل/, {}, account(), { ob_prospects: [prospect("1")], ...settings(false) });
  await refuse(/معطّل/, {}, account(), { ob_prospects: [prospect("1")] });
  await refuse(/لا توجد جهات معتمدة/, {}, account(), { ob_prospects: [prospect("1", { status: "new" })], ...settings() });
});

test("a refused or failed approval leaves nothing behind", async () => {
  const db = fakeDb({ ob_prospects: [prospect("1")], ...settings(false) }, UNIQUE);
  await assert.rejects(() => createOutboundCampaign(db, deps(), input()));
  assert.equal((db.tables.cmp_templates?.length ?? 0) + (db.tables.cmp_campaigns?.length ?? 0) + (db.tables.cmp_recipients?.length ?? 0), 0);
});

test("a campaign is limited in size and speed", async () => {
  const many = Array.from({ length: 5 }, (_, i) => prospect(String(i + 1)));
  const db = fakeDb({ ob_prospects: many, ...settings() }, UNIQUE);
  await assert.rejects(() => createOutboundCampaign(db, { ...deps(), maxRecipients: 4 }, input()), /الحد الأقصى 4/);
  await createOutboundCampaign(db, { ...deps(), maxThrottle: 10 }, input({ throttlePerMinute: 500 }));
  assert.equal(db.tables.cmp_campaigns[0].throttle_per_minute, 10);
});

test("only the chosen businesses are sent to, and one already waiting in another campaign is not repeated", async () => {
  const db = fakeDb({ ob_prospects: [prospect("1"), prospect("2"), prospect("3")], ...settings() }, UNIQUE);
  await createOutboundCampaign(db, deps(), input({ prospectIds: ["1", "2"] }));
  assert.deepEqual(db.tables.cmp_recipients.map((r) => r.ob_prospect_id), ["1", "2"]);
  const again = await previewAudience(db, ORG);
  assert.deepEqual(again.eligible.map((p) => p.id), ["3"]);
  assert.equal(again.excluded.inOtherCampaign, 2);
});

test("the do-not-send list blocks numbers, and adding one also retires the matching business", async () => {
  const db = fakeDb({ ob_prospects: [prospect("1")] }, UNIQUE);
  await addSuppression(db, ORG, "+90 532 000 0001", { source: "manual", reason: "طلب العميل", userId: "u" });
  assert.deepEqual([...(await blockedPhones(db, ORG, ["905320000001", "905329999999"]))], ["905320000001"]);
  assert.equal(db.tables.ob_prospects[0].status, "opted_out");
  await assert.rejects(() => addSuppression(db, ORG, "abc", { source: "manual" }), /غير صالح/);
  assert.deepEqual([...(await blockedPhones(fakeDb({}, UNIQUE), "org-2", ["905320000001"]))], []);
});

test("a business added by hand is found by the same number only once", async () => {
  const db = fakeDb({}, UNIQUE);
  const first = await addManualProspect(db, ORG, { name: "رقم الفريق", phone: "0532 000 00 01", dial: "90", countryCode: "TR" });
  const second = await addManualProspect(db, ORG, { name: "اسم مختلف", phone: "+90 532 000 00 01", dial: "90", countryCode: "TR" });
  assert.deepEqual([first.created, second.created, db.tables.ob_prospects.length], [true, false, 1]);
  assert.equal(db.tables.ob_prospects[0].provider, "manual");
  await assert.rejects(() => addManualProspect(db, ORG, { name: "x", phone: "123", dial: "90", countryCode: "TR" }), /غير صالح/);
});

const sentTo = (extra: any = {}) => ({ id: "r1", organization_id: ORG, campaign_id: "c1", ob_prospect_id: "p1", phone: "905320000001", status: "sent", sent_at: "2026-11-03T10:00:00Z", replied_at: null, ...extra });

test("a reply to an outbound message is recorded and the business becomes «replied»", async () => {
  const db = fakeDb({ cmp_recipients: [sentTo()], ob_prospects: [prospect("p1", { status: "contacted" })], crm_contact_points: [{ organization_id: ORG, identifier: "905320000001", contact_id: "contact-9" }] }, UNIQUE);
  const result = await handleInboundReply(db, { organizationId: ORG, phone: "905320000001", text: "نعم أرسلوا التفاصيل", now: NOW });
  assert.deepEqual(result, { matched: true, optOut: false });
  assert.equal(db.tables.cmp_recipients[0].replied_at, NOW.toISOString());
  assert.deepEqual([db.tables.ob_prospects[0].status, db.tables.ob_prospects[0].promoted_contact_id], ["replied", "contact-9"]);
});

test("«stop» puts the number on the do-not-send list and does not count as interest", async () => {
  const db = fakeDb({ cmp_recipients: [sentTo()], ob_prospects: [prospect("p1", { status: "contacted", phone_e164: "905320000001" })] }, UNIQUE);
  const result = await handleInboundReply(db, { organizationId: ORG, phone: "905320000001", text: "إيقاف", now: NOW });
  assert.deepEqual(result, { matched: true, optOut: true });
  assert.deepEqual([...(await blockedPhones(db, ORG, ["905320000001"]))], ["905320000001"]);
  assert.equal(db.tables.ob_prospects[0].status, "opted_out");
  assert.equal(db.tables.ob_events.at(-1).event_type, "opt_out");
});

test("messages from anyone else, or long after the campaign, are ignored", async () => {
  const db = fakeDb({ cmp_recipients: [sentTo({ sent_at: "2026-10-01T10:00:00Z" }), sentTo({ id: "r2", organization_id: "org-2", phone: "905320000002" }), sentTo({ id: "r3", ob_prospect_id: null, phone: "905320000003" })], ob_prospects: [prospect("p1")] }, UNIQUE);
  for (const phone of ["905320000001", "905320000002", "905320000003", "905329999999"]) assert.deepEqual(await handleInboundReply(db, { organizationId: ORG, phone, text: "stop", now: NOW }), { matched: false });
  assert.equal(db.tables.ob_suppressions?.length ?? 0, 0);
});

test("a business that already moved on is not pulled back to «replied»", async () => {
  const db = fakeDb({ cmp_recipients: [sentTo()], ob_prospects: [prospect("p1", { status: "interested" })] }, UNIQUE);
  await handleInboundReply(db, { organizationId: ORG, phone: "905320000001", text: "شكراً", now: NOW });
  assert.equal(db.tables.ob_prospects[0].status, "interested");
});

test("a reply from a hidden WhatsApp id is matched to the one business waiting for an answer, and «stop» blocks its real number", async () => {
  const db = fakeDb({ cmp_recipients: [sentTo()], ob_prospects: [prospect("p1", { status: "contacted", phone_e164: "905320000001" })] }, UNIQUE);
  const hello = await handleInboundReply(db, { organizationId: ORG, phone: "7615211896949", jid: "7615211896949", text: "مرحبا", now: NOW });
  assert.deepEqual(hello, { matched: true, optOut: false });
  assert.equal(db.tables.cmp_recipients[0].reply_jid, "7615211896949");
  const stop = await handleInboundReply(db, { organizationId: ORG, phone: "7615211896949", jid: "7615211896949", text: "إيقاف", now: NOW });
  assert.deepEqual(stop, { matched: true, optOut: true });
  assert.deepEqual([...(await blockedPhones(db, ORG, ["905320000001"]))], ["905320000001"]);
});

test("a hidden id is never guessed when several businesses are waiting", async () => {
  const db = fakeDb({ cmp_recipients: [sentTo(), sentTo({ id: "r2", ob_prospect_id: "p2", phone: "905320000002" })], ob_prospects: [prospect("p1"), prospect("p2")] }, UNIQUE);
  assert.deepEqual(await handleInboundReply(db, { organizationId: ORG, phone: "7615211896949", jid: "7615211896949", text: "إيقاف", now: NOW }), { matched: false });
  assert.equal(db.tables.ob_suppressions?.length ?? 0, 0);
  assert.equal(db.tables.ob_events.at(-1).event_type, "reply_unmatched");
});

test("a business messaged by two campaigns is still one candidate for a hidden id", async () => {
  const db = fakeDb({ cmp_recipients: [sentTo(), sentTo({ id: "r2", campaign_id: "c2", sent_at: "2026-11-04T10:00:00Z" })], ob_prospects: [prospect("p1", { status: "contacted" })] }, UNIQUE);
  assert.deepEqual(await handleInboundReply(db, { organizationId: ORG, phone: "7615211896949", jid: "7615211896949", text: "مرحبا", now: NOW }), { matched: true, optOut: false });
});

test("removing a number from the list lets its business be approved again", async () => {
  const db = fakeDb({ ob_prospects: [prospect("p1", { status: "contacted", phone_e164: "905320000001" })] }, UNIQUE);
  await addSuppression(db, ORG, "905320000001", { source: "keyword" });
  assert.equal(db.tables.ob_prospects[0].status, "opted_out");
  await removeSuppression(db, ORG, db.tables.ob_suppressions[0].id);
  assert.equal(db.tables.ob_suppressions.length, 0);
  assert.equal(db.tables.ob_prospects[0].status, "review");
});

test("a finished outbound campaign can be deleted; a running or regular one cannot", async () => {
  const camp = (id: string, status: string, kind = "outbound") => ({ id, organization_id: ORG, status, kind, template_id: `t-${id}` });
  const db = fakeDb({ cmp_campaigns: [camp("done", "completed"), camp("live", "running"), camp("reg", "completed", "retention")], cmp_templates: [{ id: "t-done", organization_id: ORG }] }, UNIQUE);
  await assert.rejects(() => deleteOutboundCampaign(db, ORG, "live"), /ألغِ الحملة أولاً/);
  await assert.rejects(() => deleteOutboundCampaign(db, ORG, "reg"), /غير موجودة/);
  await deleteOutboundCampaign(db, ORG, "done");
  assert.deepEqual(db.tables.cmp_campaigns.map((c: any) => c.id), ["live", "reg"]);
  assert.equal(db.tables.cmp_templates.length, 0);
});
