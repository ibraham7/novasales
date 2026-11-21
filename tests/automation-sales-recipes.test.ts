import { test } from "node:test";
import assert from "node:assert/strict";
import { RECIPES, recipeDefinition } from "../src/modules/workflow/recipes.ts";
import { validateWorkflowDefinition } from "../src/modules/workflow/definition.ts";
import { validateMessageSteps } from "../src/modules/workflow/send/message-config.ts";
import { validateTriggerConfig } from "../src/modules/workflow/trigger-config.ts";
import { digestCandidates, disconnectedCandidates, localParts, unassignedCandidates } from "../src/modules/workflow/time-triggers.ts";
import { renderMessage, unknownVariables } from "../src/modules/workflow/send/template.ts";

const NOW = new Date("2026-11-21T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

test("every recipe is a valid workflow with valid messages and trigger, and ids are unique", () => {
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
  for (const r of RECIPES) {
    const def = recipeDefinition(r);
    validateWorkflowDefinition(def, false);
    assert.equal(validateMessageSteps(def.steps), null, r.id);
    assert.equal(validateTriggerConfig(r.trigger.type, r.trigger.config), null, r.id);
    for (const step of def.steps) if (step.type === "action") assert.deepEqual(unknownVariables(`${step.config.title ?? ""} ${step.config.body ?? ""}`), [], r.id);
  }
});

test("the sales recipes the manager asked for exist; internal ones never send to customers", () => {
  const ids = RECIPES.map((r) => r.id);
  for (const id of ["welcome-new-ticket", "no-reply-followups", "after-quote-followup", "thanks-on-win", "recontact-lost", "review-request", "alert-unassigned", "alert-stale", "alert-followup-due", "morning-digest", "alert-channel-disconnected"]) assert.ok(ids.includes(id), id);
  for (const r of RECIPES.filter((x) => x.audience === "داخلي")) assert.ok(recipeDefinition(r).steps.every((s: any) => s.type !== "action" || !String(s.action).startsWith("message.")), r.id);
});

test("the no-reply recipe waits 1h, 1d, 3d, 7d and stops when the customer replies", () => {
  const r = RECIPES.find((x) => x.id === "no-reply-followups")!;
  assert.deepEqual(r.trigger.config.stop_on, ["customer_reply", "stage_change"]);
  let at = r.trigger.config.after_minutes as number;
  const marks = [at];
  for (const s of r.steps) if (s.type === "delay") { at += s.duration_minutes; marks.push(at); }
  assert.deepEqual(marks, [60, 1440, 4320, 10080]);
});

test("promotional recipe is marked promo (consent and stop phrase are enforced by the send gate)", () => {
  const r = RECIPES.find((x) => x.id === "recontact-lost")!;
  assert.equal(r.audience, "ترويج");
  assert.ok(r.steps.some((s) => s.config?.kind === "promo"));
});

test("unassigned: only open tickets without an owner for long enough", () => {
  const o = (id: string, x: any = {}) => ({ id, owner_agent_id: null, outcome: null, deleted_at: null, opened_at: ago(60), ...x });
  const found = unassignedCandidates([o("a"), o("b", { owner_agent_id: "u1" }), o("c", { opened_at: ago(5) }), o("d", { outcome: "won" })], NOW, 30);
  assert.deepEqual(found.map((c) => c.payload.opportunity_id), ["a"]);
});

test("digest: after the hour, one per agent per local day, only for agents with tasks", () => {
  const tasks = [
    { status: "open", due_at: ago(-60), assignee_user_id: "u1" },
    { status: "open", due_at: ago(60 * 30), assignee_user_id: "u1" },
    { status: "open", due_at: ago(-30), assignee_user_id: "u2" },
    { status: "done", due_at: ago(-30), assignee_user_id: "u3" },
  ];
  assert.deepEqual(digestCandidates(tasks, NOW, "UTC", 13), [], "before the chosen hour");
  const found = digestCandidates(tasks, NOW, "UTC", 9);
  assert.deepEqual(found.map((c) => c.key).sort(), ["digest:u1:2026-11-21", "digest:u2:2026-11-21"]);
  assert.deepEqual([found[0]!.payload.tasks_due_today, found[0]!.payload.tasks_overdue], [1, 1]);
  assert.equal(localParts(NOW, "Europe/Istanbul").hour, 15);
});

test("disconnected: once per disconnection, not for connected accounts or fresh ones", () => {
  const found = disconnectedCandidates([{ id: "a", status: "disconnected", updated_at: ago(30) }, { id: "b", status: "connected", updated_at: ago(30) }, { id: "c", status: "disconnected", updated_at: ago(2) }], NOW, 10);
  assert.deepEqual(found.map((c) => c.payload.account_id), ["a"]);
  assert.ok(found[0]!.key.includes(ago(30)));
});

test("digest and alert variables render", () => {
  assert.equal(renderMessage("{due_today} / {overdue} / {account}", { due_today: "3", overdue: "1", account: "خط 1" }), "3 / 1 / خط 1");
});
