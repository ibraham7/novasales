import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { STALE_EVENT_MS, STALE_EVENT_NOTE, tickWorkflowsCore } from "../src/modules/workflow/tick-core.ts";
import { skipTriggerEvents } from "../src/modules/workflow/skip-events.ts";
import { workflowTickEnabled } from "../src/modules/workflow/auto-tick.server.ts";

const NOW = new Date("2026-11-21T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 3_600_000;

function setup(events: any[] = [], jobs: any[] = []) {
  const db: any = fakeDb({ domain_events: events, wf_jobs: jobs });
  const dispatched: any[] = [];
  const resumed: any[] = [];
  const deps = {
    db,
    now: NOW,
    dispatch: async (e: any) => { dispatched.push(e); if (e.type === "boom") throw new Error("فشل التوزيع"); },
    resume: async (runId: string, stepId: string | null) => { resumed.push([runId, stepId]); if (runId === "bad") throw new Error("فشل الاستئناف"); },
  };
  return { db, deps, dispatched, resumed };
}
const ev = (id: string, extra: any = {}) => ({ id, organization_id: "org-a", event_type: "crm.opportunity.stage_changed", aggregate_type: "opportunity", aggregate_id: "opp-1", payload: { to_stage_name: "عرض سعر" }, workflow_status: "pending", created_at: ago(HOUR), ...extra });

test("a fresh event is dispatched with its payload and the aggregate id, then marked done", async () => {
  const { db, deps, dispatched } = setup([ev("e1")]);
  const r = await tickWorkflowsCore(deps);
  assert.deepEqual([r.processed, r.failed, r.skipped], [1, 0, 0]);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, "crm.opportunity.stage_changed");
  assert.equal(dispatched[0].payload.opportunity_id, "opp-1");
  assert.equal(dispatched[0].payload.to_stage_name, "عرض سعر");
  assert.equal(db.tables.domain_events[0].workflow_status, "done");
});

test("an event older than six hours is never run: it is marked skipped with a note", async () => {
  const { db, deps, dispatched } = setup([ev("old", { created_at: ago(STALE_EVENT_MS + 60_000) }), ev("edge", { created_at: ago(STALE_EVENT_MS - 60_000) })]);
  const r = await tickWorkflowsCore(deps);
  assert.equal(r.skipped, 1);
  assert.deepEqual(dispatched.map((d) => d.id), ["edge"]);
  const old = db.tables.domain_events.find((e: any) => e.id === "old");
  assert.deepEqual([old.workflow_status, old.workflow_error], ["done", STALE_EVENT_NOTE]);
});

test("a failing event is marked failed with its reason and does not stop the others", async () => {
  const { db, deps, dispatched } = setup([ev("a", { event_type: "boom" }), ev("b")]);
  const r = await tickWorkflowsCore(deps);
  assert.deepEqual([r.processed, r.failed], [1, 1]);
  assert.equal(dispatched.length, 2);
  const a = db.tables.domain_events.find((e: any) => e.id === "a");
  assert.deepEqual([a.workflow_status, a.workflow_error], ["failed", "فشل التوزيع"]);
});

test("one organization's round touches only that organization's events", async () => {
  const { db, deps, dispatched } = setup([ev("a"), ev("b", { organization_id: "org-b" }), ev("c", { organization_id: "org-b", created_at: ago(STALE_EVENT_MS + HOUR) })]);
  const r = await tickWorkflowsCore(deps, "org-a");
  assert.deepEqual(dispatched.map((d) => d.id), ["a"]);
  assert.equal(r.skipped, 0);
  assert.deepEqual(db.tables.domain_events.filter((e: any) => e.organization_id === "org-b").map((e: any) => e.workflow_status), ["pending", "pending"]);
});

test("due jobs resume (a delay at its next step, a wait for an event at its timeout step); jobs not due wait", async () => {
  const job = (id: string, extra: any) => ({ id, organization_id: "org-a", status: "pending", run_id: `run-${id}`, resume_at: ago(HOUR), ...extra });
  const { db, deps, resumed } = setup([], [
    job("d", { wait_kind: "delay", resume_step_id: "s2", timeout_step_id: null }),
    job("w", { wait_kind: "event", resume_step_id: "s9", timeout_step_id: "s5" }),
    job("later", { wait_kind: "delay", resume_step_id: "s3", resume_at: new Date(NOW.getTime() + HOUR).toISOString() }),
    job("x", { wait_kind: "delay", resume_step_id: "s4", run_id: "bad" }),
  ]);
  const r = await tickWorkflowsCore(deps);
  assert.deepEqual([r.processed, r.failed], [2, 1]);
  assert.deepEqual(resumed.map((x) => x.join(":")).sort(), ["bad:s4", "run-d:s2", "run-w:s5"]);
  const status = Object.fromEntries(db.tables.wf_jobs.map((j: any) => [j.id, j.status]));
  assert.deepEqual(status, { d: "done", w: "done", later: "pending", x: "failed" });
});

test("the in-process worker is off unless WORKFLOW_AUTO_TICK is exactly 1", () => {
  assert.equal(workflowTickEnabled({}), false);
  assert.equal(workflowTickEnabled({ WORKFLOW_AUTO_TICK: "off" }), false);
  assert.equal(workflowTickEnabled({ WORKFLOW_AUTO_TICK: "true" }), false);
  assert.equal(workflowTickEnabled({ WORKFLOW_AUTO_TICK: "1" }), true);
});

test("skipping trigger events touches only the named tickets, types, pending and recent events", async () => {
  const db: any = fakeDb({ domain_events: [
    { id: "keep-other-ticket", organization_id: "org-a", aggregate_type: "opportunity", aggregate_id: "opp-2", event_type: "crm.opportunity.assigned", workflow_status: "pending", created_at: "2026-11-21T11:59:30Z" },
    { id: "keep-other-type", organization_id: "org-a", aggregate_type: "opportunity", aggregate_id: "opp-1", event_type: "crm.opportunity.created", workflow_status: "pending", created_at: "2026-11-21T11:59:30Z" },
    { id: "keep-old", organization_id: "org-a", aggregate_type: "opportunity", aggregate_id: "opp-1", event_type: "crm.opportunity.assigned", workflow_status: "pending", created_at: "2026-11-21T09:00:00Z" },
    { id: "keep-org", organization_id: "org-b", aggregate_type: "opportunity", aggregate_id: "opp-1", event_type: "crm.opportunity.assigned", workflow_status: "pending", created_at: "2026-11-21T11:59:30Z" },
    { id: "skip", organization_id: "org-a", aggregate_type: "opportunity", aggregate_id: "opp-1", event_type: "crm.opportunity.assigned", workflow_status: "pending", created_at: "2026-11-21T11:59:30Z" },
  ] });
  await skipTriggerEvents(db, { organizationId: "org-a", opportunityIds: ["opp-1"], types: ["crm.opportunity.assigned", "crm.opportunity.stage_changed"], since: "2026-11-21T11:59:00Z" });
  const status = Object.fromEntries(db.tables.domain_events.map((e: any) => [e.id, e.workflow_status]));
  assert.deepEqual(status, { "keep-other-ticket": "pending", "keep-other-type": "pending", "keep-old": "pending", "keep-org": "pending", skip: "done" });
});
