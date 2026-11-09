import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { deliverProduct, type DeliveryInput } from "../src/modules/commerce/product-delivery.ts";

const ORG = "org-1";
const silent = { warn() {}, error() {} };

function setup(over: Partial<DeliveryInput> = {}, sendMedia?: DeliveryInput["sendMedia"]) {
  const db = fakeDb({
    msg_messages: [{ id: "placeholder", organization_id: ORG, session_id: "chat", status: "sending", message_type: "image", media_url: "https://x/cover.jpg" }],
    sales_product_interactions: [],
  });
  const calls: string[] = [];
  const health: any[] = [];
  let outbound = 0;
  const input: DeliveryInput = {
    db, organizationId: ORG, userId: "u1", chatId: "chat", accountId: "acc", placeholderId: "placeholder", startedAt: 1_000_000,
    media: [{ url: "https://x/2.jpg", kind: "image" }, { url: "https://x/v.mp4", kind: "video" }],
    coverUrl: "https://x/cover.jpg", caption: "تفاصيل", product: { id: "p1", name: "قميص", sku: "S1", price: 10, currency: "USD" },
    opportunity: { id: "o1", contact_id: "c1" },
    ops: { opSendText: async () => (calls.push("text"), { key: { id: "text-1" } }), sentExternalId: (r: any) => r?.key?.id ?? null },
    number: "905320000001",
    sendMedia: sendMedia ?? (async (item, caption) => (calls.push(`${item.kind}${caption ? "+caption" : ""}`), { key: { id: `m-${calls.length}` } })),
    risk: { recordOutbound: async () => { outbound++; }, recordHealthEvent: async (e: any) => { health.push(e); } },
    pauseMs: 0, sleep: async () => {}, log: silent, ...over,
  };
  return { db, input, calls, health, count: () => outbound };
}

test("the other media go first and appear in the chat as sent, then the main photo completes the waiting message", async () => {
  const { db, input, calls, count } = setup();
  const r = await deliverProduct(input);
  assert.deepEqual(calls, ["image", "video", "image+caption"]);
  assert.deepEqual([r.sent, r.imagesSent, r.videosSent, r.mediaFailed], [true, 2, 1, 0]);
  const rows = db.tables.msg_messages;
  assert.deepEqual(rows.map((m: any) => [m.message_type, m.status]), [["image", "sent"], ["image", "sent"], ["video", "sent"]]);
  assert.ok(rows[1].created_at < rows[2].created_at);
  assert.equal(rows[0].external_id, "m-3");
  assert.equal(db.tables.sales_product_interactions.length, 1);
  assert.equal(count(), 3);
});

test("when the main photo cannot go, the details go as text and the waiting message becomes text", async () => {
  const { db, input, calls } = setup({ media: [] }, async (_item, caption) => { if (caption) throw new Error("fetch failed"); return {}; });
  const r = await deliverProduct(input);
  assert.deepEqual(calls, ["text"]);
  assert.deepEqual([r.sent, r.coverSent], [true, false]);
  const m = db.tables.msg_messages[0];
  assert.deepEqual([m.status, m.message_type, m.media_url, m.external_id], ["sent", "text", null, "text-1"]);
});

test("a photo that fails is counted, the rest still goes", async () => {
  let n = 0;
  const { input, db } = setup({}, async () => { if (++n === 1) throw new Error("no"); return { key: { id: `m${n}` } }; });
  const r = await deliverProduct(input);
  assert.deepEqual([r.sent, r.mediaFailed, r.imagesSent, r.videosSent], [true, 1, 1, 1]);
  assert.equal(db.tables.msg_messages.length, 2);
});

test("when nothing can be sent the message is marked failed, the number's health is told and no interaction is recorded", async () => {
  const { db, input, health } = setup({ media: [], ops: { opSendText: async () => { throw new Error("session closed"); }, sentExternalId: () => null } }, async () => { throw new Error("no"); });
  const r = await deliverProduct(input);
  assert.deepEqual([r.sent, r.error], [false, "session closed"]);
  assert.equal(db.tables.msg_messages[0].status, "failed");
  assert.equal(db.tables.sales_product_interactions.length, 0);
  assert.deepEqual([health.length, health[0].eventType], [1, "send_failed"]);
});
