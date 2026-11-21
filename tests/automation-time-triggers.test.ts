import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { eventUuid, findCandidates, lastBySession, noReplyCandidates, overdueTaskCandidates, scanTimeTriggers, staleCandidates, stageTimeoutCandidates } from "../src/modules/workflow/time-triggers.ts";

const NOW = new Date("2026-11-21T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const opp = (id: string, extra: any = {}) => ({ id, organization_id: "org-a", contact_id: `c-${id}`, owner_agent_id: "u1", stage_id: "st1", source: "whatsapp", outcome: null, deleted_at: null, stage_entered_at: ago(100), updated_at: ago(10), ...extra });

test("the same text always gives the same id, in UUID shape; different texts differ", () => {
  const a = eventUuid("wf|stage_timeout:o1:st1:x");
  assert.equal(a, eventUuid("wf|stage_timeout:o1:st1:x"));
  assert.notEqual(a, eventUuid("wf|stage_timeout:o2:st1:x"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("stage timeout: only open tickets that stayed long enough, in the chosen stage, each keyed by its stage entry", () => {
  const rows = [opp("old"), opp("new", { stage_entered_at: ago(5) }), opp("won", { outcome: "won" }), opp("gone", { deleted_at: ago(1) }), opp("other", { stage_id: "st2" }), opp("legacy", { stage_entered_at: null, updated_at: ago(200) })];
  const found = stageTimeoutCandidates(rows, NOW, 60);
  assert.deepEqual(found.map((c) => c.payload.opportunity_id).sort(), ["legacy", "old", "other"]);
  assert.deepEqual(stageTimeoutCandidates(rows, NOW, 60, "st1").map((c) => c.payload.opportunity_id).sort(), ["legacy", "old"]);
  const c = found.find((x) => x.payload.opportunity_id === "old")!;
  assert.deepEqual([c.payload.minutes_in_stage, c.payload.owner_user_id, c.payload.contact_id], [100, "u1", "c-old"]);
  assert.ok(c.key.includes(ago(100)), "a new stage entry gives a new key, so the trigger can fire again");
});

test("no reply: the chat's newest message must be ours and old enough; a customer reply after it cancels it", () => {
  const msgs = [
    { id: "m1", session_id: "s1", direction: "outbound", created_at: ago(300) },
    { id: "m2", session_id: "s2", direction: "outbound", created_at: ago(300) }, { id: "m3", session_id: "s2", direction: "inbound", created_at: ago(100) },
    { id: "m4", session_id: "s3", direction: "outbound", created_at: ago(10) },
  ];
  const links = [{ opportunity_id: "o1", session_ref: "s1" }, { opportunity_id: "o2", session_ref: "s2" }, { opportunity_id: "o3", session_ref: "s3" }, { opportunity_id: "o4", session_ref: "none" }];
  const found = noReplyCandidates([opp("o1"), opp("o2"), opp("o3"), opp("o4"), opp("o5", { outcome: "lost" })], links, lastBySession(msgs), NOW, 120);
  assert.deepEqual(found.map((c) => c.payload.opportunity_id), ["o1"]);
  assert.equal(found[0]!.key, "no_reply:o1:m1");
  assert.equal(found[0]!.payload.minutes_without_reply, 300);
});

test("stale: no stage move, update or message for the wait; a recent message keeps the ticket alive", () => {
  const rows = [opp("a", { stage_entered_at: ago(20000), updated_at: ago(20000) }), opp("b", { stage_entered_at: ago(20000), updated_at: ago(20000) }), opp("c", { stage_entered_at: ago(100), updated_at: ago(100) })];
  const found = staleCandidates(rows, new Map([["b", ago(60)]]), NOW, 7 * 1440);
  assert.deepEqual(found.map((c) => [c.payload.opportunity_id, c.payload.days_without_activity]), [["a", 13]]);
});

test("overdue tasks: open and past their time (plus grace); done ones and not-yet-due ones are left alone", () => {
  const tasks = [
    { id: "t1", status: "open", due_at: ago(120), assignee_user_id: "u1", entity_type: "opportunity", entity_id: "o1", title: "اتصل" },
    { id: "t2", status: "done", due_at: ago(120) }, { id: "t3", status: "open", due_at: ago(-60) }, { id: "t4", status: "open", due_at: ago(10) }, { id: "t5", status: "open", due_at: null },
  ];
  assert.deepEqual(overdueTaskCandidates(tasks, NOW, 0).map((c) => c.payload.task_id), ["t1", "t4"]);
  const [t1] = overdueTaskCandidates(tasks, NOW, 60);
  assert.deepEqual([t1!.payload.task_id, t1!.payload.opportunity_id, t1!.payload.assignee_user_id], ["t1", "o1", "u1"]);
  assert.equal(overdueTaskCandidates(tasks, NOW, 60).length, 1);
});

test("reading the database: stage timeout finds tickets by stage entry and by last update for older ones, in this organization only", async () => {
  const db: any = fakeDb({ opp_opportunities: [opp("a"), opp("b", { stage_entered_at: null, updated_at: ago(500) }), opp("c", { organization_id: "org-b" }), opp("d", { stage_entered_at: ago(5) })] });
  const found = await findCandidates(db, "org-a", "time.stage_timeout", { after_minutes: 60 }, NOW);
  assert.deepEqual(found.map((c) => c.payload.opportunity_id).sort(), ["a", "b"]);
});

test("reading the database: no reply uses the chat's newest message and the ticket linked to it", async () => {
  const db: any = fakeDb({
    msg_sessions: [{ id: "s1", organization_id: "org-a", last_message_at: ago(300) }, { id: "s2", organization_id: "org-a", last_message_at: ago(5) }],
    msg_messages: [{ id: "m1", organization_id: "org-a", session_id: "s1", direction: "inbound", created_at: ago(400) }, { id: "m2", organization_id: "org-a", session_id: "s1", direction: "outbound", created_at: ago(300) }],
    crm_opportunity_sessions: [{ organization_id: "org-a", opportunity_id: "o1", session_ref: "s1" }],
    opp_opportunities: [opp("o1")],
  });
  const found = await findCandidates(db, "org-a", "time.no_reply", { after_minutes: 120 }, NOW);
  assert.deepEqual(found.map((c) => c.key), ["no_reply:o1:m2"]);
});

test("a scan starts each active time workflow once per finding, never twice, and ignores inactive and other-event workflows", async () => {
  const db: any = fakeDb({
    wf_workflows: [
      { id: "wf1", organization_id: "org-a", is_active: true, trigger_type: "event", trigger_config: { event: "time.stage_timeout", after_minutes: 60 } },
      { id: "wf2", organization_id: "org-a", is_active: false, trigger_type: "event", trigger_config: { event: "time.stage_timeout", after_minutes: 60 } },
      { id: "wf3", organization_id: "org-a", is_active: true, trigger_type: "event", trigger_config: { event: "crm.lead.created" } },
    ],
    opp_opportunities: [opp("a"), opp("b", { stage_entered_at: ago(5) })],
    wf_runs: [],
  });
  const started: any[] = [];
  const startRun = async (i: any) => { started.push(i); db.tables.wf_runs.push({ id: `run${started.length}`, workflow_id: i.workflowId, organization_id: i.organizationId, trigger_event_id: i.triggerEventId }); return `run${started.length}`; };
  const first = await scanTimeTriggers({ db, startRun, now: NOW });
  assert.deepEqual([first.workflows, first.found, first.started, first.failed], [1, 1, 1, 0]);
  assert.deepEqual([started[0].workflowId, started[0].organizationId, started[0].triggerPayload.opportunity_id, started[0].triggerPayload.time_event], ["wf1", "org-a", "a", "time.stage_timeout"]);
  const second = await scanTimeTriggers({ db, startRun, now: new Date(NOW.getTime() + 10 * 60_000) });
  assert.deepEqual([second.found, second.started], [1, 0]);
  assert.equal(started.length, 1);
  // a failing start is counted, and does not stop the scan
  const failing = await scanTimeTriggers({ db: fakeDb({ wf_workflows: db.tables.wf_workflows, opp_opportunities: db.tables.opp_opportunities, wf_runs: [] }) as any, startRun: async () => { throw new Error("x"); }, now: NOW });
  assert.deepEqual([failing.started, failing.failed], [0, 1]);
  // one organization only
  const other = await scanTimeTriggers({ db, startRun, now: NOW }, "org-b");
  assert.equal(other.workflows, 0);
});
