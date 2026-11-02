import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  encryptPayload,
  isAllowedPushEndpoint,
  sendWebPush,
  vapidAuthorization,
} from "../src/modules/notifications/webpush.ts";

/** A browser's side of RFC 8291: opens a message with the subscription's private key. */
function browser() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const keys = { p256dh: bytesToBase64Url(ecdh.getPublicKey()), auth: bytesToBase64Url(auth) };
  const open = (body: Uint8Array) => {
    const data = Buffer.from(body);
    const salt = data.subarray(0, 16);
    const idLength = data[20];
    const senderPublic = data.subarray(21, 21 + idLength);
    const cipher = data.subarray(21 + idLength);
    const derive = (s: Buffer, ikm: Buffer, info: Buffer, n: number) => Buffer.from(crypto.hkdfSync("sha256", ikm, s, info, n));
    const ikm = derive(auth, ecdh.computeSecret(senderPublic), Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), senderPublic]), 32);
    const key = derive(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
    const nonce = derive(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
    const decipher = crypto.createDecipheriv("aes-128-gcm", key, nonce);
    decipher.setAuthTag(cipher.subarray(-16));
    const plain = Buffer.concat([decipher.update(cipher.subarray(0, -16)), decipher.final()]);
    return plain.subarray(0, plain.lastIndexOf(2)).toString("utf8");
  };
  return { keys, open };
}

function vapidKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: bytesToBase64Url(ecdh.getPublicKey()), privateKey: bytesToBase64Url(ecdh.getPrivateKey()), subject: "mailto:test@example.com" };
}

test("an encrypted payload opens on the subscriber's side, including Arabic text", async () => {
  const { keys, open } = browser();
  const text = JSON.stringify({ title: "عميل جديد", body: "تمت إضافة عميل" });
  const body = await encryptPayload(new TextEncoder().encode(text), keys);
  assert.equal(open(body), text);
  // The record size header and the key id length follow the RFC.
  assert.equal(Buffer.from(body).readUInt32BE(16), 4096);
  assert.equal(body[20], 65);
});

test("two messages never share a salt or sender key", async () => {
  const { keys } = browser();
  const a = await encryptPayload(new TextEncoder().encode("x"), keys);
  const b = await encryptPayload(new TextEncoder().encode("x"), keys);
  assert.notDeepEqual(a.slice(0, 16), b.slice(0, 16));
  assert.notDeepEqual(a.slice(21, 86), b.slice(21, 86));
});

test("a damaged subscription key is refused", async () => {
  await assert.rejects(() => encryptPayload(new Uint8Array([1]), { p256dh: "AAAA", auth: "AAAA" }));
});

test("the VAPID token is a valid ES256 JWT for the push service origin", async () => {
  const vapid = vapidKeys();
  const now = Date.UTC(2026, 10, 2);
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, now);
  const match = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(match);
  const [, h, c, s, k] = match!;
  assert.equal(k, vapid.publicKey);
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "mailto:test@example.com");
  assert.equal(claims.exp, Math.floor(now / 1000) + 43200);
  const publicKey = crypto.createPublicKey({
    key: { kty: "EC", crv: "P-256", x: bytesToBase64Url(base64UrlToBytes(vapid.publicKey).slice(1, 33)), y: bytesToBase64Url(base64UrlToBytes(vapid.publicKey).slice(33)) },
    format: "jwk",
  });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
});

test("only the real push services are accepted as endpoints", () => {
  for (const ok of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])
    assert.equal(isAllowedPushEndpoint(ok), true, ok);
  for (const bad of [
    "http://fcm.googleapis.com/x",
    "https://127.0.0.1/x",
    "https://localhost/x",
    "https://169.254.169.254/latest",
    "https://evilfcm.googleapis.com.attacker.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://attacker.com/fcm.googleapis.com",
    "not a url",
  ])
    assert.equal(isAllowedPushEndpoint(bad), false, bad);
});

test("sendWebPush posts the encrypted body with VAPID headers and reports gone subscriptions", async () => {
  const { keys, open } = browser();
  const vapid = vapidKeys();
  const calls: { url: string; init: any }[] = [];
  const original = globalThis.fetch;
  let status = 201;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(status === 410 ? "gone" : "", { status });
  }) as typeof fetch;
  try {
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", ...keys };
    const ok = await sendWebPush(subscription, { title: "t" }, vapid, { topic: "chat:123/abc", urgency: "high", ttlSeconds: 60 });
    assert.deepEqual({ ok: ok.ok, gone: ok.gone, status: ok.status }, { ok: true, gone: false, status: 201 });
    const { headers, body } = calls[0].init;
    assert.match(headers.Authorization, /^vapid t=/);
    assert.equal(headers["Content-Encoding"], "aes128gcm");
    assert.equal(headers.TTL, "60");
    assert.equal(headers.Urgency, "high");
    assert.equal(headers.Topic, "chat123abc");
    assert.equal(open(body), JSON.stringify({ title: "t" }));

    status = 410;
    const gone = await sendWebPush(subscription, { title: "t" }, vapid);
    assert.deepEqual({ ok: gone.ok, gone: gone.gone }, { ok: false, gone: true });

    status = 500;
    const failed = await sendWebPush(subscription, { title: "t" }, vapid);
    assert.deepEqual({ ok: failed.ok, gone: failed.gone }, { ok: false, gone: false });
  } finally {
    globalThis.fetch = original;
  }
});
