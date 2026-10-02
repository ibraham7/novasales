import { test } from "node:test";
import assert from "node:assert/strict";
import {
  linkWorkflowSteps,
  validateWorkflowDefinition,
  validTickToken,
} from "../src/modules/workflow/definition.ts";
const def = (steps: any[]) => ({ engine: "v1", version: 1, steps });
test("reordering rebuilds linear links; deletion removes stale branches and last step never retains old next", () => {
  const rows = linkWorkflowSteps([
    { id: "b", type: "condition", next: "a", onFalse: "gone" },
    { id: "a", type: "action", next: "b" },
  ]);
  assert.equal(rows[0].next, "a");
  assert.equal(rows[0].onFalse, undefined);
  assert.equal(rows[1].next, undefined);
});
test("workflow validation accepts draft and rejects empty activation, duplicate IDs, missing references and invalid timing", () => {
  validateWorkflowDefinition(def([]));
  assert.throws(() => validateWorkflowDefinition(def([]), true));
  assert.throws(() =>
    validateWorkflowDefinition(
      def([
        { id: "a", type: "end" },
        { id: "a", type: "end" },
      ]),
    ),
  );
  assert.throws(() => validateWorkflowDefinition(def([{ id: "a", type: "end", next: "missing" }])));
  assert.throws(() =>
    validateWorkflowDefinition(def([{ id: "a", type: "delay", duration_minutes: 0 }])),
  );
  assert.throws(() =>
    validateWorkflowDefinition(def([{ id: "a", type: "condition", expr: { unsupported: true } }])),
  );
  validateWorkflowDefinition(
    def([
      { id: "a", type: "condition", expr: { eq: ["{{trigger.id}}", "x"] }, next: "b" },
      { id: "b", type: "end" },
    ]),
    true,
  );
});
test("workflow scheduler is disabled without a strong configured token and rejects unknown credentials", () => {
  assert.equal(validTickToken(null, undefined), false);
  assert.equal(validTickToken("Bearer short", "short"), false);
  const token = "x".repeat(32);
  assert.equal(validTickToken(`Bearer ${token}`, token), true);
  assert.equal(validTickToken("Bearer other", token), false);
});
