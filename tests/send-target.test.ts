import { test } from "node:test";
import assert from "node:assert/strict";
import { sendTarget } from "../src/modules/channels/whatsapp/recipient.ts";

test("a hidden-id chat is answered at its full id, a normal chat at its phone number", () => {
  assert.equal(sendTarget("7615211896949@lid"), "7615211896949@lid");
  assert.equal(sendTarget("905320000001@s.whatsapp.net"), "905320000001");
  assert.equal(sendTarget("905320000001"), "905320000001");
  assert.equal(sendTarget(null), "");
});
