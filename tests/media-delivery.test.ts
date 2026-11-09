import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { deliverMedia, RAW_BASE64_LIMIT, type MediaDeliveryInput } from "../src/modules/messaging/media-delivery.ts";

const silent = { warn() {}, error() {} };

function setup(over: Partial<MediaDeliveryInput> = {}) {
  const db = fakeDb({ msg_messages: [{ id: "m1", organization_id: "org-1", status: "sending", external_id: null }] });
  const sent: { via: string; media: string }[] = [];
  const health: any[] = [];
  let outbound = 0;
  const input: MediaDeliveryInput = {
    db, organizationId: "org-1", accountId: "acc", messageId: "m1", kind: "image", fileName: "a.jpg", mimeType: "image/jpeg", caption: "صورة",
    base64: "RAW64", fileBytes: 1000, mediaUrl: "https://signed/x", number: "905320000001",
    ops: {
      opSendAudioNote: async (_a, _n, audio) => (sent.push({ via: "audio", media: audio }), { key: { id: "audio-1" } }),
      opSendMedia: async (_a, _n, p) => (sent.push({ via: p.mediatype, media: p.media }), { key: { id: "media-1" } }),
      sentExternalId: (r: any) => r?.key?.id ?? null,
    },
    risk: { recordOutbound: async () => { outbound++; }, recordHealthEvent: async (e: any) => { health.push(e); } },
    log: silent, ...over,
  };
  return { db, input, sent, health, count: () => outbound };
}

test("a small file goes as the file itself, and the waiting message becomes sent with the WhatsApp id", async () => {
  const { db, input, sent, count } = setup();
  assert.deepEqual(await deliverMedia(input), { sent: true, error: null });
  assert.deepEqual(sent, [{ via: "image", media: "RAW64" }]);
  assert.deepEqual([db.tables.msg_messages[0].status, db.tables.msg_messages[0].external_id], ["sent", "media-1"]);
  assert.equal(count(), 1);
});

test("a large file goes as its link first (WhatsApp refuses big bodies)", async () => {
  const { input, sent } = setup({ fileBytes: RAW_BASE64_LIMIT + 1 });
  await deliverMedia(input);
  assert.deepEqual(sent, [{ via: "image", media: "https://signed/x" }]);
});

test("when the first way fails the other way is tried once", async () => {
  let calls = 0;
  const { db, input, sent } = setup();
  input.ops.opSendMedia = async (_a, _n, p) => { calls++; if (calls === 1) throw new Error("413"); sent.push({ via: p.mediatype, media: p.media }); return { key: { id: "second" } }; };
  assert.equal((await deliverMedia(input)).sent, true);
  assert.deepEqual(sent, [{ via: "image", media: "https://signed/x" }]);
  assert.equal(db.tables.msg_messages[0].external_id, "second");
});

test("voice notes use the audio call", async () => {
  const { input, sent } = setup({ kind: "audio", caption: null });
  await deliverMedia(input);
  assert.deepEqual(sent, [{ via: "audio", media: "RAW64" }]);
});

test("when both ways fail the message is marked failed and the number's health is told", async () => {
  const { db, input, health, count } = setup();
  input.ops.opSendMedia = async () => { throw new Error("session closed"); };
  const r = await deliverMedia(input);
  assert.deepEqual([r.sent, r.error], [false, "session closed"]);
  assert.equal(db.tables.msg_messages[0].status, "failed");
  assert.deepEqual([health.length, health[0].eventType, count()], [1, "send_failed", 0]);
});
