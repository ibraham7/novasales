import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { applyRedistribution, buildAgents, eligibleAgents, planRedistribution, type Agents, type Ticket } from "../src/modules/assignments/redistribute-core.ts";

const ORG = "org-1";
const seeded = (seed: number) => {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
};

test("only active sales members can receive tickets; a department with no sales role falls back to its active members", () => {
  const agents = buildAgents({
    members: [
      { user_id: "sara", department_id: "d1" }, { user_id: "yaser", department_id: "d1" }, { user_id: "boss", department_id: "d1" },
      { user_id: "huda", department_id: "d2" }, { user_id: "off", department_id: "d2" },
    ],
    activeUsers: new Set(["sara", "yaser", "boss", "huda"]),
    salesUsers: new Set(["sara", "yaser", "off"]),
  });
  assert.deepEqual(agents.byDepartment.get("d1"), ["sara", "yaser"]);
  assert.deepEqual(agents.byDepartment.get("d2"), ["huda"]);
  assert.deepEqual(agents.all, ["sara", "yaser"]);
});

test("a customer visits every agent before anyone has them twice, and never goes straight back to the current owner", () => {
  const team = ["a", "b", "c", "d"];
  assert.deepEqual(eligibleAgents(team, [], "a"), ["b", "c", "d"]);
  assert.deepEqual(eligibleAgents(team, ["a", "b"], "b"), ["c", "d"]);
  assert.deepEqual(eligibleAgents(team, ["a", "b", "c"], "c"), ["d"]);
  // everyone had it: a new round starts, without the agent who has it now
  assert.deepEqual(eligibleAgents(team, ["a", "b", "c", "d"], "d"), ["a", "b", "c"]);
  // the owner counts even when the history lacks them (the customer came straight to that agent)
  assert.deepEqual(eligibleAgents(team, [], null), team);
  assert.deepEqual(eligibleAgents(team, ["a"], "b"), ["c", "d"]);
  // agents who left the team are ignored; a lone agent still gets it
  assert.deepEqual(eligibleAgents(["a", "b"], ["x", "a"], "a"), ["b"]);
  assert.deepEqual(eligibleAgents(["a"], ["a"], "a"), ["a"]);
  assert.deepEqual(eligibleAgents([], ["a"], "a"), []);
});

const agents = (): Agents => ({ all: ["sara", "yaser", "huda"], byDepartment: new Map([["d1", ["sara", "yaser"]]]) });
const ticket = (id: string, extra: Partial<Ticket> = {}): Ticket => ({ id, lead_id: `lead-${id}`, owner_agent_id: null, department_id: null, ...extra });

test("the plan follows each ticket's history, stays inside its department and spreads evenly", () => {
  const tickets = [
    ticket("t1", { owner_agent_id: "sara" }),
    ticket("t2", { owner_agent_id: "yaser" }),
    ...Array.from({ length: 9 }, (_, i) => ticket(`n${i}`)),
    ticket("dept", { department_id: "d1", owner_agent_id: "sara" }),
  ];
  const history = new Map([["lead-t1", ["yaser", "sara"]], ["lead-t2", ["sara", "yaser"]]]);
  const { moves, unassignable, perAgent } = planRedistribution({ tickets, history, agents: agents(), random: seeded(7) });
  assert.equal(unassignable.length, 0);
  const to = Object.fromEntries(moves.map((m) => [m.ticketId, m.to]));
  assert.equal(to.t1, "huda");
  assert.equal(to.t2, "huda");
  assert.equal(to.dept, "yaser");
  assert.equal(moves.length, 12);
  const counts = Object.values(perAgent);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 2, JSON.stringify(perAgent));
  assert.ok(moves.every((m) => m.from !== m.to));
});

test("tickets nobody can take are reported, not forced", () => {
  const empty: Agents = { all: [], byDepartment: new Map() };
  const plan = planRedistribution({ tickets: [ticket("t1")], history: new Map(), agents: empty });
  assert.deepEqual([plan.moves.length, plan.unassignable.length], [0, 1]);
});

test("applying moves each ticket to the first stage with its new owner, records the history, and is safe to repeat", async () => {
  const lost = "stage-lost";
  const db = fakeDb({
    opp_opportunities: [
      { id: "t1", organization_id: ORG, stage_id: lost, stage: "lost", outcome: "lost", closed_at: "2026-11-01", owner_agent_id: "sara", deleted_at: null },
      { id: "t2", organization_id: ORG, stage_id: lost, stage: "lost", outcome: "lost", closed_at: "2026-11-01", owner_agent_id: "yaser", deleted_at: null },
      { id: "t3", organization_id: ORG, stage_id: "other", stage: "new", owner_agent_id: "sara", deleted_at: null },
    ],
    crm_leads: [{ id: "l1", organization_id: ORG, owner_user_id: "sara" }, { id: "l2", organization_id: ORG, owner_user_id: "yaser" }],
    crm_lead_assignments: [],
    crm_timeline: [],
    domain_events: [],
    msg_messages: [],
  });
  const moves = [
    { ticketId: "t1", leadId: "l1", from: "sara", to: "huda", departmentId: null },
    { ticketId: "t2", leadId: "l2", from: "yaser", to: "huda", departmentId: "d1" },
    { ticketId: "t3", leadId: null, from: "sara", to: "huda", departmentId: null },
  ];
  const first = { id: "stage-new", pipeline_id: "p1", probability: 10 };
  const result = await applyRedistribution(db, { organizationId: ORG, actorId: "boss", lostStageId: lost, first, moves });
  assert.equal(result.moved, 2);
  const [t1, t2, t3] = db.tables.opp_opportunities;
  assert.deepEqual([t1.stage_id, t1.stage, t1.outcome, t1.closed_at, t1.owner_agent_id], ["stage-new", "new", null, null, "huda"]);
  assert.equal(t2.owner_agent_id, "huda");
  assert.deepEqual([t3.stage_id, t3.owner_agent_id], ["other", "sara"]);
  assert.deepEqual(db.tables.crm_leads.map((l: any) => l.owner_user_id), ["huda", "huda"]);
  assert.deepEqual(db.tables.crm_lead_assignments.map((h: any) => [h.lead_id, h.from_user_id, h.to_user_id, h.action, h.assigned_by]), [["l1", "sara", "huda", "reassign", "boss"], ["l2", "yaser", "huda", "reassign", "boss"]]);
  assert.equal(db.tables.crm_timeline.length, 2);
  assert.equal(db.tables.domain_events.length, 0);
  assert.equal(db.tables.msg_messages.length, 0);
  assert.equal((await applyRedistribution(db, { organizationId: ORG, actorId: "boss", lostStageId: lost, first, moves })).moved, 0);
  assert.equal(db.tables.crm_lead_assignments.length, 2);
});
