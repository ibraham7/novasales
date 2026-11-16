import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { enqueueSends, messageProblem, renderTemplate, runDueSends, type SendDeps } from "../src/modules/assignments/redistribute-send-core.ts";
import type { SendSchedule } from "../src/modules/campaigns/send-schedule.ts";

const ORG = "org-1";
const schedule: SendSchedule = { dailyLimit: 20, windowStart: "10:00", windowEnd: "17:00", timezone: "UTC", ramp: null };
const at = (hhmm: string) => new Date(`2026-11-16T${hhmm}:00Z`);

test("the message and its hours are checked before anything is queued", () => {
  assert.equal(messageProblem({ body: "  ", schedule }), "اكتب نص الرسالة");
  assert.match(messageProblem({ body: "x".repeat(901), schedule })!, /أطول/);
  assert.match(messageProblem({ body: "hi", schedule: { ...schedule, windowStart: "10:00", windowEnd: "10:30" } })!, /ساعة/);
  assert.equal(messageProblem({ body: "hi", schedule }), null);
});

test("the template is filled with the agent and customer names; {a|b} picks one wording", () => {
  const text = renderTemplate("{مرحباً|أهلاً} {{contact_name}}، معك {{agent_name}} من {{department_name}}", { contact_name: "علي", agent_name: "مياسة", department_name: "المبيعات" }, () => 0);
  assert.equal(text, "مرحباً علي، معك مياسة من المبيعات");
});

test("queueing: one row per ticket that has a customer, nothing for tickets without a contact", async () => {
  const db = fakeDb();
  const r = await enqueueSends(db, { organizationId: ORG, actorId: "boss", moves: [{ ticketId: "t1", contactId: "c1", to: "sara" }, { ticketId: "t2", contactId: null, to: "sara" }], plan: { body: "hi {{contact_name}}", schedule }, now: at("03:00") });
  assert.equal(r.queued, 1);
  const rows = await (db as any).from("crm_redistribution_sends").select("*");
  assert.equal(rows.data.length, 1);
  assert.equal(rows.data[0].status, "pending");
  assert.equal(rows.data[0].organization_id, ORG);
  await assert.rejects(enqueueSends(db, { organizationId: ORG, actorId: "boss", moves: [], plan: { body: "", schedule } }), /اكتب نص/);
});

function setup(now: Date, extra: any[] = []) {
  const rows = [
    { id: "s1", organization_id: ORG, opportunity_id: "t1", contact_id: "c1", to_user_id: "sara", body: "مرحباً {{contact_name}} معك {{agent_name}}", schedule, status: "pending", run_after: "2026-11-16T00:00:00.000Z", created_at: "2026-11-16T00:00:01Z" },
    { id: "s2", organization_id: ORG, opportunity_id: "t2", contact_id: "c2", to_user_id: "sara", body: "hi", schedule, status: "pending", run_after: "2026-11-16T00:00:00.000Z", created_at: "2026-11-16T00:00:02Z" },
    ...extra,
  ];
  const db = fakeDb({ crm_redistribution_sends: rows, opp_opportunities: [{ id: "t1", organization_id: ORG, owner_agent_id: "sara", deleted_at: null }, { id: "t2", organization_id: ORG, owner_agent_id: "sara", deleted_at: null }] });
  const sentTexts: string[] = [];
  const deps: SendDeps = {
    now,
    random: () => 0.5,
    agent: async () => ({ name: "سارة", departmentName: "المبيعات", orgName: "نوفا", accountId: "acc-1" }),
    contactName: async (_o, c) => (c === "c1" ? "علي" : "ليلى"),
    send: async ({ text }) => { sentTexts.push(text); return { sent: true }; },
  };
  return { db, deps, sentTexts };
}
const statusOf = async (db: any, id: string) => (await db.from("crm_redistribution_sends").select("*").eq("id", id)).data[0];

test("working hours: pressed at 03:00 nothing is sent; inside the window one message goes, the next waits a gap", async () => {
  const night = setup(at("03:00"));
  assert.deepEqual(await runDueSends(night.db, night.deps), { processed: 0 });
  assert.equal(night.sentTexts.length, 0);
  // everything waits until the window opens at 10:00
  assert.equal((await statusOf(night.db, "s1")).run_after, "2026-11-16T10:00:00.000Z");

  const day = setup(at("11:00"));
  assert.deepEqual(await runDueSends(day.db, day.deps), { processed: 1 });
  assert.deepEqual(day.sentTexts, ["مرحباً علي معك سارة"]);
  assert.equal((await statusOf(day.db, "s1")).status, "sent");
  const second = await statusOf(day.db, "s2");
  assert.equal(second.status, "pending");
  assert.ok(new Date(second.run_after).getTime() >= at("11:00").getTime() + 45_000, "the next message waits at least the minimum gap");
});

test("a ticket that changed hands, or an agent without a connected number, is skipped and nothing is sent", async () => {
  const moved = setup(at("11:00"));
  await moved.db.from("opp_opportunities").update({ owner_agent_id: "other" }).eq("id", "t1");
  await runDueSends(moved.db, moved.deps);
  assert.equal((await statusOf(moved.db, "s1")).status, "skipped");
  assert.equal(moved.sentTexts.length, 0);

  const noAccount = setup(at("11:00"));
  noAccount.deps.agent = async () => ({ name: "سارة", departmentName: "", orgName: "", accountId: null });
  await runDueSends(noAccount.db, noAccount.deps);
  assert.equal((await statusOf(noAccount.db, "s1")).status, "skipped");
});

test("the daily limit stops an agent for the day; a failed send is recorded, not retried", async () => {
  const limited = setup(at("11:00"), [{ id: "old", organization_id: ORG, opportunity_id: "t9", contact_id: "c9", to_user_id: "sara", body: "x", schedule: { ...schedule, dailyLimit: 1 }, status: "sent", sent_at: "2026-11-16T10:30:00.000Z", run_after: "2026-11-16T00:00:00.000Z", created_at: "2026-11-16T00:00:00Z" }]);
  await (limited.db as any).from("crm_redistribution_sends").update({ schedule: { ...schedule, dailyLimit: 1 } }).eq("to_user_id", "sara");
  assert.deepEqual(await runDueSends(limited.db, limited.deps), { processed: 0 });
  assert.equal((await statusOf(limited.db, "s1")).status, "pending");

  const failing = setup(at("11:00"));
  failing.deps.send = async () => ({ sent: false, reason: "no_phone" });
  assert.deepEqual(await runDueSends(failing.db, failing.deps), { processed: 0 });
  const row = await statusOf(failing.db, "s1");
  assert.equal(row.status, "failed");
  assert.equal(row.reason, "no_phone");
});
