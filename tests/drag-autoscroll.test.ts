import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeSpeed } from "../src/lib/drag-autoscroll.ts";

test("no scrolling in the middle; up near the top, down near the bottom", () => {
  assert.equal(edgeSpeed(300, 100, 500), 0);
  assert.ok(edgeSpeed(110, 100, 500) < 0);
  assert.ok(edgeSpeed(490, 100, 500) > 0);
});

test("the closer to the edge, the faster; past the edge it is at the top speed; never above the maximum", () => {
  const far = edgeSpeed(160, 100, 500);   // 60 px in
  const near = edgeSpeed(120, 100, 500);  // 20 px in
  const past = edgeSpeed(50, 100, 500);   // above the list
  assert.ok(Math.abs(near) > Math.abs(far));
  assert.equal(past, -22);
  assert.ok(Math.abs(edgeSpeed(-1000, 100, 500)) <= 22);
  assert.ok(edgeSpeed(2000, 100, 500) <= 22);
});

test("a very small box is left alone, and the edge zone size is respected", () => {
  assert.equal(edgeSpeed(105, 100, 200), 0);
  assert.equal(edgeSpeed(100 + 71, 100, 500), 0);
  assert.ok(edgeSpeed(100 + 69, 100, 500) < 0);
});
