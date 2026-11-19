import { test } from "node:test";
import assert from "node:assert/strict";
import { sharePercent } from "../src/lib/share-percent.ts";

test("a column's share of all tickets", () => {
  assert.equal(sharePercent(4, 16), "25%");
  assert.equal(sharePercent(1, 3), "33%");
  assert.equal(sharePercent(16, 16), "100%");
});

test("empty column, empty board and tiny shares", () => {
  assert.equal(sharePercent(0, 16), "0%");
  assert.equal(sharePercent(0, 0), "0%");
  assert.equal(sharePercent(1, 500), "<1%");
});

test("never shows more than 100% while counts are still loading", () => {
  assert.equal(sharePercent(10, 4), "100%");
});
