import { test } from "node:test";
import assert from "node:assert/strict";
import { lastDays, messageWord } from "../src/lib/plural-ar.ts";

test("«رسالة» agrees with its number", () => {
  assert.equal(messageWord(1), "رسالة");
  assert.equal(messageWord(2), "رسالتان");
  assert.equal(messageWord(3), "رسائل");
  assert.equal(messageWord(10), "رسائل");
  assert.equal(messageWord(11), "رسالة");
  assert.equal(messageWord(200), "رسالة");
});

test("«آخر N يوماً» agrees with its number", () => {
  assert.equal(lastDays(7), "آخر 7 أيام");
  assert.equal(lastDays(30), "آخر 30 يوماً");
  assert.equal(lastDays(90), "آخر 90 يوماً");
  assert.equal(lastDays(2), "آخر يومين");
});
