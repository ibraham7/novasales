import { test } from "node:test";
import assert from "node:assert/strict";
import { providerReason } from "../src/modules/channels/whatsapp/evolution-http.ts";

test("the reason is found wherever Evolution puts it", () => {
  assert.equal(providerReason({ message: "Connection Closed" }), "Connection Closed");
  assert.equal(providerReason({ status: 500, error: "Internal Server Error", response: { message: "Connection Closed" } }), "Connection Closed");
  assert.equal(providerReason({ response: { message: ["number does not exist", "check it"] } }), "number does not exist؛ check it");
  assert.equal(providerReason({ data: null, isBoom: true, output: { statusCode: 428, payload: { error: "Precondition Required", message: "Connection Closed" } } }), "Connection Closed");
  assert.equal(providerReason({ error: "Bad Request" }), "Bad Request");
  assert.equal(providerReason("plain text"), "plain text");
  assert.equal(providerReason(null), null);
  assert.equal(providerReason({}), null);
});
