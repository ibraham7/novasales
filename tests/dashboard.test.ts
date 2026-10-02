import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateDashboard,
  visibleOpportunity,
  visibleLead,
  scopedRelatedRecords,
  type DashboardScope,
} from "../src/modules/dashboard/dashboard-model.ts";
import { dashboardRows } from "../src/modules/dashboard/dashboard-query.ts";
const f = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z", currency: "USD" };
const opp = (patch: any = {}) => ({
  id: "o1",
  contact_id: "c1",
  lead_id: "l1",
  owner_agent_id: "u1",
  department_id: "d1",
  pipeline_id: "p1",
  opened_at: "2026-08-01T00:00:00.000Z",
  closed_at: "2026-09-10T00:00:00.000Z",
  outcome: "won",
  value: 100,
  currency: "USD",
  ...patch,
});
const lead = (patch: any = {}) => ({
  id: "l1",
  contact_id: "c1",
  owner_user_id: "u1",
  department_id: "d1",
  opened_at: "2026-09-02T00:00:00.000Z",
  converted_at: "2026-09-03T00:00:00.000Z",
  ...patch,
});
const all: DashboardScope = { kind: "all", userId: "u1", departmentIds: [] };
test("money remains in the selected currency; old opportunities closed in the range count in agent/department results", () => {
  const r = calculateDashboard(
    [
      opp(),
      opp({ id: "o2", currency: "TRY", value: 900 }),
      opp({ id: "open", closed_at: null, value: 50, probability: 200 }),
    ],
    [lead()],
    [],
    [],
    f,
  );
  assert.equal(r.kpis.revenue.value, 100);
  assert.equal(r.kpis.wonDeals.value, 2);
  assert.equal(r.kpis.avgDealSize.value, 100);
  assert.equal(r.kpis.pipelineValue.value, 50);
  assert.equal(r.kpis.forecastRevenue.value, 50);
  assert.equal(r.agents[0].revenue, 100);
  assert.equal(r.agents[0].won, 2);
  assert.equal(r.departments[0].revenue, 100);
  assert.equal(r.kpis.revenue.delta, null);
  assert.equal(r.revenueTrend.length, 30);
  assert.equal(r.revenueTrend.find((d) => d.date === "2026-09-10")?.revenue, 100);
  assert.equal(r.stageDist[0].count, 1);
});
test("converted lead cohort cannot exceed 100% when a lead has multiple opportunities", () => {
  const r = calculateDashboard(
    [opp(), opp({ id: "o2" }), opp({ id: "o3" })],
    [lead(), lead({ id: "l2", converted_at: null })],
    [],
    [],
    f,
  );
  assert.equal(r.kpis.conversionRate.value, 50);
});
test("adjacent periods exclude the shared boundary and zero baselines do not invent growth percentages", () => {
  const r = calculateDashboard(
    [
      opp({ closed_at: f.from, value: 10 }),
      opp({ id: "prior", closed_at: "2026-08-31T23:59:59.000Z", value: 5 }),
      opp({ id: "after", closed_at: f.to, value: 500 }),
    ],
    [],
    [],
    [],
    f,
  );
  assert.equal(r.kpis.revenue.value, 10);
  assert.equal(r.kpis.revenue.delta, 100);
  assert.equal(r.kpis.wonDeals.value, 1);
});
test("response uses first outbound activity after opening, ignores earlier interactions and absence remains unavailable", () => {
  const acts = [
    {
      entity_type: "contact",
      entity_id: "c1",
      direction: "outbound",
      occurred_at: "2026-09-01T12:00:00.000Z",
    },
    {
      entity_type: "contact",
      entity_id: "c1",
      direction: "outbound",
      occurred_at: "2026-09-02T00:05:00.000Z",
    },
    {
      entity_type: "lead",
      entity_id: "l1",
      direction: "outbound",
      occurred_at: "2026-09-02T00:08:00.000Z",
    },
  ];
  assert.equal(calculateDashboard([], [lead()], acts, [], f).kpis.leadResponseMinutes.value, 5);
  assert.equal(calculateDashboard([], [lead()], [], [], f).kpis.leadResponseMinutes.value, null);
});
test("departments are fail-closed and all authorized departments count; deleted and outside-owner/pipeline opportunities never count", () => {
  const dept: DashboardScope = { ...all, kind: "department", departmentIds: ["d1", "d2"] };
  assert.equal(visibleOpportunity(opp(), dept, f), true);
  assert.equal(visibleOpportunity(opp({ department_id: "d2" }), dept, f), true);
  assert.equal(visibleOpportunity(opp({ department_id: "d3" }), dept, f), false);
  assert.equal(visibleOpportunity(opp(), { ...dept, departmentIds: [] }, f), false);
  assert.equal(visibleOpportunity(opp({ deleted_at: "2026-09-01" }), all, f), false);
  assert.equal(
    visibleOpportunity(opp({ owner_agent_id: "u2" }), { ...all, kind: "own" }, f),
    false,
  );
  assert.equal(visibleOpportunity(opp(), all, { ...f, pipelineId: "p2" }), false);
  assert.equal(visibleLead(lead(), all, { ...f, pipelineId: "p1" }, []), false);
  assert.equal(visibleLead(lead(), all, { ...f, pipelineId: "p1" }, [opp()]), true);
});
test("related records respect entity visibility, actor/assignee and filters, including unlinked tasks", () => {
  const rows = [
    {
      id: "mine",
      entity_type: "opportunity",
      entity_id: "o1",
      actor_user_id: "u1",
      assignee_user_id: "u1",
    },
    {
      id: "outside",
      entity_type: "opportunity",
      entity_id: "o2",
      actor_user_id: "u2",
      assignee_user_id: "u2",
    },
    {
      id: "other",
      entity_type: "opportunity",
      entity_id: "o1",
      actor_user_id: "u2",
      assignee_user_id: "u2",
    },
  ];
  const unlinked = { id: "personal", entity_id: null, assignee_user_id: "u1" };
  const own = scopedRelatedRecords(
    rows,
    [...rows, unlinked],
    rows,
    [opp()],
    [lead()],
    { ...all, kind: "own" },
    f,
  );
  assert.deepEqual(
    own.activities.map((a) => a.id),
    ["mine"],
  );
  assert.deepEqual(
    own.tasks.map((t) => t.id),
    ["mine", "personal"],
  );
  assert.deepEqual(
    own.timeline.map((t) => t.id),
    ["mine"],
  );
  const dept = scopedRelatedRecords(
    rows,
    [...rows, unlinked],
    rows,
    [opp()],
    [lead()],
    { ...all, kind: "department", departmentIds: ["d1"] },
    { ...f, departmentId: "d1" },
  );
  assert.deepEqual(
    dept.tasks.map((t) => t.id),
    ["mine", "other"],
  );
  const pipeline = scopedRelatedRecords(
    [],
    [unlinked],
    [],
    [opp()],
    [lead()],
    { ...all, kind: "own" },
    { ...f, pipelineId: "p1" },
  );
  assert.equal(pipeline.tasks.length, 0);
});
test("all pages are read even when the API cap is lower than the requested page size", async () => {
  const input = Array.from({ length: 1207 }, (_, id) => ({ id }));
  const rows = await dashboardRows(() => ({
    range: async (start: number, end: number) => ({
      data: input.slice(start, Math.min(start + 137, end + 1)),
      error: null,
    }),
  }));
  assert.equal(rows.length, 1207);
  assert.deepEqual(rows, input);
});
test("a failing later page rejects the complete snapshot rather than showing partial totals", async () => {
  await assert.rejects(
    dashboardRows(() => ({
      range: async (start: number) =>
        start ? { data: null, error: { message: "failure" } } : { data: [{ id: 1 }], error: null },
    })),
    /تعذر تحميل بيانات لوحة التحكم/,
  );
});
test("shared contacts cannot pull another department actor into filtered activity/task results; personal tasks follow department membership", () => {
  const scope: DashboardScope = {
    ...all,
    kind: "department",
    departmentIds: ["d1"],
    departmentUserIds: ["u1"],
  };
  const contactRows = [
    {
      id: "mine",
      entity_type: "contact",
      entity_id: "c1",
      actor_user_id: "u1",
      assignee_user_id: "u1",
    },
    {
      id: "foreign",
      entity_type: "contact",
      entity_id: "c1",
      actor_user_id: "u2",
      assignee_user_id: "u2",
    },
  ];
  const personal = { id: "personal", entity_id: null, assignee_user_id: "u1" };
  const r = scopedRelatedRecords(
    contactRows,
    [...contactRows, personal],
    contactRows,
    [opp()],
    [lead()],
    scope,
    { ...f, departmentId: "d1" },
  );
  assert.deepEqual(
    r.activities.map((a) => a.id),
    ["mine"],
  );
  assert.deepEqual(
    r.timeline.map((a) => a.id),
    ["mine"],
  );
  assert.deepEqual(
    r.tasks.map((a) => a.id),
    ["mine", "personal"],
  );
});
test("monetary metrics keep cents", () => {
  const r = calculateDashboard(
    [opp({ value: 19.99 }), opp({ id: "open", closed_at: null, value: 12.35, probability: 50 })],
    [],
    [],
    [],
    f,
  );
  assert.equal(r.kpis.revenue.value, 19.99);
  assert.equal(r.kpis.avgDealSize.value, 19.99);
  assert.equal(r.kpis.pipelineValue.value, 12.35);
  assert.equal(r.kpis.forecastRevenue.value, 6.18);
});
