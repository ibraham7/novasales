import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvolutionWebhook } from "../src/modules/channels/whatsapp/evolution.webhook.ts";

test("delivery and read receipts from Evolution v2 (keyId) and v1 (key.id)", () => {
  const v2 = normalizeEvolutionWebhook({
    event: "messages.update",
    instance: "slora",
    data: { keyId: "3EB0ABC", remoteJid: "905551112233@s.whatsapp.net", fromMe: true, status: "DELIVERY_ACK" },
  });
  assert.deepEqual(v2.events, [{ kind: "message.status", externalId: "3EB0ABC", status: "delivered", inboundRead: false }]);
  const v1 = normalizeEvolutionWebhook({
    event: "MESSAGES_UPDATE",
    instance: "slora",
    data: [{ key: { id: "3EB0DEF" }, update: { status: "READ" } }],
  });
  assert.deepEqual(v1.events, [{ kind: "message.status", externalId: "3EB0DEF", status: "read", inboundRead: true }]);
});
