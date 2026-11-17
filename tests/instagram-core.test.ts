import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthorizeUrl,
  canRefreshToken,
  cleanAuthCode,
  isInstagramConfigured,
  linkRedirectUri,
  messagingWindow,
  newLinkState,
  parseInstagramWebhook,
  previewFor,
  tokenState,
  verifyHubSignature,
} from "../src/modules/channels/instagram/instagram-core.ts";

const NOW = new Date("2026-11-20T12:00:00.000Z");

test("the login link asks Instagram's own page for the messaging permissions and carries the state", () => {
  const url = new URL(buildAuthorizeUrl({ appId: "123", redirectUri: "https://x.example/channels", state: "abc" }));
  assert.equal(url.origin + url.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "123");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "https://x.example/channels");
  assert.equal(url.searchParams.get("state"), "abc");
  assert.deepEqual(url.searchParams.get("scope")?.split(","), ["instagram_business_basic", "instagram_business_manage_messages"]);
  assert.equal(url.searchParams.get("force_reauth"), "true");
  assert.equal(url.searchParams.has("password"), false);
});

test("the returned code loses its trailing #_, and states are long and different each time", () => {
  assert.equal(cleanAuthCode("AQD123#_"), "AQD123");
  assert.equal(cleanAuthCode("AQD123"), "AQD123");
  const a = newLinkState();
  const b = newLinkState();
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.notEqual(a, b);
});

test("configuration needs the app id, the secret and the public address", () => {
  assert.equal(isInstagramConfigured({}), false);
  assert.equal(isInstagramConfigured({ INSTAGRAM_APP_ID: "1", INSTAGRAM_APP_SECRET: "s" }), false);
  assert.equal(isInstagramConfigured({ INSTAGRAM_APP_ID: "1", INSTAGRAM_APP_SECRET: "s", PUBLIC_APP_URL: "https://a.example" }), true);
  assert.equal(linkRedirectUri({ PUBLIC_APP_URL: "https://a.example/" }), "https://a.example/channels");
  assert.equal(linkRedirectUri({}), null);
});

test("replies are allowed for 24 hours after the customer's last message, not after", () => {
  assert.equal(messagingWindow(null, NOW).open, false);
  assert.equal(messagingWindow("2026-11-19T12:00:01.000Z", NOW).open, true);
  assert.equal(messagingWindow("2026-11-19T12:00:00.000Z", NOW).open, false);
  assert.equal(messagingWindow("2026-11-20T11:00:00.000Z", NOW).expiresAt?.toISOString(), "2026-11-21T11:00:00.000Z");
});

test("a token is ok, due for refresh in its last 7 days, or expired", () => {
  assert.equal(tokenState("2026-12-30T00:00:00.000Z", NOW), "ok");
  assert.equal(tokenState("2026-11-26T00:00:00.000Z", NOW), "refresh_due");
  assert.equal(tokenState("2026-11-20T11:59:59.000Z", NOW), "expired");
  assert.equal(tokenState(null, NOW), "expired");
});

test("Meta refuses to refresh a token younger than a day or one that already expired", () => {
  assert.equal(canRefreshToken("2026-11-20T00:00:00.000Z", "2026-12-30T00:00:00.000Z", NOW), false);
  assert.equal(canRefreshToken("2026-11-19T11:00:00.000Z", "2026-11-25T00:00:00.000Z", NOW), true);
  assert.equal(canRefreshToken(null, "2026-11-25T00:00:00.000Z", NOW), true);
  assert.equal(canRefreshToken("2026-10-01T00:00:00.000Z", "2026-11-19T00:00:00.000Z", NOW), false);
});

const incoming = {
  object: "instagram",
  entry: [
    {
      id: "IG_ACCOUNT",
      time: 1,
      messaging: [
        { sender: { id: "CUSTOMER" }, recipient: { id: "IG_ACCOUNT" }, timestamp: 1_790_000_000_000, message: { mid: "m1", text: "السلام عليكم" } },
        { sender: { id: "IG_ACCOUNT" }, recipient: { id: "CUSTOMER" }, timestamp: 1_790_000_001_000, message: { mid: "m2", text: "أهلاً", is_echo: true } },
        { sender: { id: "CUSTOMER" }, recipient: { id: "IG_ACCOUNT" }, timestamp: 1_790_000_002_000, message: { mid: "m3", attachments: [{ type: "image", payload: { url: "https://cdn.example/a.jpg" } }] } },
        { sender: { id: "CUSTOMER" }, recipient: { id: "IG_ACCOUNT" }, timestamp: 1_790_000_003_000, read: { mid: "m1" } },
      ],
    },
  ],
};

test("a notification becomes inbound, echo and photo events; reads and other objects are ignored", () => {
  const events = parseInstagramWebhook(incoming);
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((e) => [e.mid, e.igUserId, e.customerId, e.isEcho]),
    [
      ["m1", "IG_ACCOUNT", "CUSTOMER", false],
      ["m2", "IG_ACCOUNT", "CUSTOMER", true],
      ["m3", "IG_ACCOUNT", "CUSTOMER", false],
    ],
  );
  assert.deepEqual(events[2].attachments, [{ type: "image", url: "https://cdn.example/a.jpg" }]);
  assert.equal(previewFor(events[2]), "📷 صورة");
  assert.equal(previewFor(events[0]), "السلام عليكم");
  assert.deepEqual(parseInstagramWebhook({ object: "page", entry: incoming.entry }), []);
  assert.deepEqual(parseInstagramWebhook(null), []);
  assert.deepEqual(parseInstagramWebhook({ object: "instagram", entry: [{ id: "X", messaging: [{ sender: { id: "X" }, recipient: { id: "X" }, message: { mid: "self", text: "x" } }] }] }), []);
});

test("the signature must match the body and the secret", async () => {
  const body = JSON.stringify(incoming);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyHubSignature(body, `sha256=${sig}`, "secret"), true);
  assert.equal(await verifyHubSignature(body + " ", `sha256=${sig}`, "secret"), false);
  assert.equal(await verifyHubSignature(body, `sha256=${sig}`, "other"), false);
  assert.equal(await verifyHubSignature(body, null, "secret"), false);
  assert.equal(await verifyHubSignature(body, `sha256=${sig}`, undefined), false);
});

import { splitForInstagram } from "../src/modules/channels/instagram/instagram-core.ts";

test("a long reply is split into parts that each fit in 1000 bytes, without losing any word", () => {
  assert.deepEqual(splitForInstagram("مرحباً"), ["مرحباً"]);
  const sentence = "هذا نص عربي طويل للتجربة ";
  const long = sentence.repeat(120);
  const parts = splitForInstagram(long);
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(new TextEncoder().encode(part).length <= 1000);
  assert.equal(parts.join(" ").replace(/\s+/g, " "), long.trim().replace(/\s+/g, " "));
  // one unbroken run longer than the limit is still cut, never dropped
  const solid = "ا".repeat(1200);
  const cut = splitForInstagram(solid);
  assert.equal(cut.join(""), solid);
  assert.ok(cut.every((part) => new TextEncoder().encode(part).length <= 1000));
});
