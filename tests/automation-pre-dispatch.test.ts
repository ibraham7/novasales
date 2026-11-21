import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { cancelRunsOnEvent, handleReplyIntent, preDispatch } from "../src/modules/workflow/pre-dispatch.ts";

const ORG = "org-a";
function world(extra: Record<string, any[]> = {}) {
  return fakeDb({
    wf_workflows: [
      { id: "wf-stop-reply", organization_id: ORG, trigger_config: { event: "crm.lead.created", stop_on: ["customer_reply"] } },
      { id: "wf-stop-move", organization_id: ORG, trigger_config: { event: "crm.lead.created", stop_on: ["stage_change"] } },
      { id: "wf-both", organization_id: ORG, trigger_config: { event: "x", stop_on: ["customer_reply", "stage_change"] } },
      { id: "wf-plain", organization_id: ORG, trigger_config: { event: "x" } },
    ],
    wf_runs: [
      { id: "r1", organization_id: ORG, workflow_id: "wf-stop-reply", status: "waiting", context: { trigger: { opportunity_id: "o1" } } },
      { id: "r2", organization_id: ORG, workflow_id: "wf-stop-move", status: "waiting", context: { trigger: { opportunity_id: "o1" } } },
      { id: "r3", organization_id: ORG, workflow_id: "wf-both", status: "running", context: { trigger: { opportunity_id: "o1" } } },
      { id: "r4", organization_id: ORG, workflow_id: "wf-plain", status: "waiting", context: { trigger: { opportunity_id: "o1" } } },
      { id: "r5", organization_id: ORG, workflow_id: "wf-both", status: "waiting", context: { trigger: { opportunity_id: "o2" } } },
      { id: "r6", organization_id: ORG, workflow_id: "wf-both", status: "completed", context: { trigger: { opportunity_id: "o1" } } },
      { id: "r7", organization_id: "org-b", workflow_id: "wf-both", status: "waiting", context: { trigger: { opportunity_id: "o1" } } },
      { id: "r8", organization_id: ORG, workflow_id: "wf-both", status: "waiting", trigger_event_id: "evt-now", context: { trigger: { opportunity_id: "o1" } } },
    ],
    wf_jobs: [{ id: "j1", organization_id: ORG, run_id: "r1", status: "pending" }, { id: "j4", organization_id: ORG, run_id: "r4", status: "pending" }],
    crm_opportunity_sessions: [{ organization_id: ORG, opportunity_id: "o1", session_ref: "s1" }],
    opp_opportunities: [{ id: "o1", organization_id: ORG, contact_id: "c1" }],
    crm_contact_points: [{ organization_id: ORG, contact_id: "c1", channel_type: "whatsapp", identifier: "905321112233" }],
    domain_events: [],
    ...extra,
  });
}
const status = (db: any) => Object.fromEntries(db.tables.wf_runs.map((r: any) => [r.id, r.status]));

test("a customer reply cancels the waiting runs that asked to stop on a reply, for that ticket only", async () => {
  const db: any = world();
  const n = await cancelRunsOnEvent(db, { id: "evt-now", organizationId: ORG, type: "messaging.message.received", payload: { session_id: "s1" } });
  assert.equal(n, 2);
  assert.deepEqual(status(db), { r1: "cancelled", r2: "waiting", r3: "cancelled", r4: "waiting", r5: "waiting", r6: "completed", r7: "waiting", r8: "waiting" });
  const r1 = db.tables.wf_runs.find((r: any) => r.id === "r1");
  assert.equal(r1.error, "أُوقف: ردّ العميل");
  assert.equal(db.tables.wf_jobs.find((j: any) => j.id === "j1").status, "done");
  assert.equal(db.tables.wf_jobs.find((j: any) => j.id === "j4").status, "pending");
});

test("a ticket move cancels the runs that asked to stop on a move, but never the run this very event started", async () => {
  const db: any = world();
  const n = await cancelRunsOnEvent(db, { id: "evt-now", organizationId: ORG, type: "crm.opportunity.stage_changed", payload: { opportunity_id: "o1" } });
  assert.equal(n, 2);
  assert.deepEqual(status(db), { r1: "waiting", r2: "cancelled", r3: "cancelled", r4: "waiting", r5: "waiting", r6: "completed", r7: "waiting", r8: "waiting" });
  assert.equal(db.tables.wf_runs.find((r: any) => r.id === "r2").error, "أُوقف: انتقلت التذكرة لمرحلة أخرى");
});

test("other events and chats without a ticket cancel nothing", async () => {
  const db: any = world();
  assert.equal(await cancelRunsOnEvent(db, { organizationId: ORG, type: "crm.lead.created", payload: { opportunity_id: "o1" } }), 0);
  assert.equal(await cancelRunsOnEvent(db, { organizationId: ORG, type: "messaging.message.received", payload: { session_id: "unknown-chat" } }), 0);
  assert.equal(await cancelRunsOnEvent(db, { organizationId: ORG, type: "messaging.message.received", payload: {} }), 0);
  assert.equal(await cancelRunsOnEvent(db, { organizationId: "org-b", type: "crm.opportunity.stage_changed", payload: { opportunity_id: "o2" } }), 0);
  assert.deepEqual(status(db).r1, "waiting");
});

test("an exact «stop» puts the customer's number on the do-not-send list, from the chat's number or the ticket's customer", async () => {
  const suppressed: any[] = [];
  const deps = (db: any) => ({ db, suppress: async (o: string, p: string, r: string) => { suppressed.push([o, p, r]); } });
  const real = await handleReplyIntent(deps(world()), { organizationId: ORG, type: "messaging.message.received", payload: { session_id: "s1", peer: "905559998877@s.whatsapp.net", text: "إيقاف" } });
  assert.deepEqual([real.intent, real.applied], ["stop", true]);
  assert.deepEqual(suppressed[0], [ORG, "905559998877", "ردّ بكلمة إيقاف"]);
  // a hidden internal id: the ticket's customer number is used instead
  await handleReplyIntent(deps(world()), { organizationId: ORG, type: "messaging.message.received", payload: { session_id: "s1", peer: "27635511223344@lid", text: "STOP" } });
  assert.equal(suppressed[1][1], "905321112233");
  // no way to know the number: nothing is guessed
  const none = await handleReplyIntent(deps(world({ crm_contact_points: [] })), { organizationId: ORG, type: "messaging.message.received", payload: { session_id: "s1", peer: "x@lid", text: "stop" } });
  assert.equal(none.applied, false);
  assert.equal(suppressed.length, 2);
});

test("an exact yes or no becomes an event workflows can wait for; unclear or long answers do nothing", async () => {
  const db: any = world();
  const deps = { db, suppress: async () => { throw new Error("must not be called"); } };
  const yes = await handleReplyIntent(deps, { organizationId: ORG, type: "messaging.message.received", payload: { session_id: "s1", peer: "905321112233@s.whatsapp.net", text: "نعم!" } });
  assert.deepEqual([yes.intent, yes.applied], ["yes", true]);
  await handleReplyIntent(deps, { organizationId: ORG, type: "messaging.message.received", payload: { session_id: "s1", text: "لا" } });
  const events = db.tables.domain_events;
  assert.deepEqual(events.map((e: any) => e.event_type), ["messaging.reply.yes", "messaging.reply.no"]);
  assert.deepEqual([events[0].organization_id, events[0].aggregate_id, events[0].payload.opportunity_id, events[0].payload.phone], [ORG, "s1", "o1", "905321112233"]);
  for (const text of ["نعم بس بدي أسأل", "لا أريد إيقاف الخدمة", "ممكن تفاصيل؟", ""]) {
    const r = await handleReplyIntent(deps, { organizationId: ORG, type: "messaging.message.received", payload: { session_id: "s1", text } });
    assert.equal(r.applied, false, text);
  }
  assert.equal(events.length, 2);
  const other = await handleReplyIntent(deps, { organizationId: ORG, type: "crm.lead.created", payload: { text: "نعم", session_id: "s1" } });
  assert.equal(other.applied, false);
});

test("pre-dispatch does both: stops the runs and reads the reply", async () => {
  const db: any = world();
  const r = await preDispatch({ db, suppress: async () => {} }, { id: "evt-now", organizationId: ORG, type: "messaging.message.received", payload: { session_id: "s1", text: "نعم" } });
  assert.deepEqual([r.cancelled, r.reply], [2, "yes"]);
});
