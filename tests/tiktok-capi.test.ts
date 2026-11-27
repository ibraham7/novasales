import { test } from "node:test";
import assert from "node:assert/strict";
import { TIKTOK_MAX_EVENTS, isTikTokPixelCode, tiktokEventsFor, tiktokRequestsFor } from "../src/modules/integrations/tiktok-capi.ts";
import { sha256 } from "../src/modules/integrations/meta-capi.ts";

const row = (extra: any = {}) => ({
  id: "e1", opportunity_id: "o1", contact_id: "c1", stage_name: "عرض سعر", event_kind: "purchase", is_first_for_goal: true, value: 150, currency: "try",
  attribution: { ttclid: "TT123" }, quality_level: null, quality_score: null, is_quality_signal: false,
  contact_phone: "905066903027", occurred_at: "2026-11-27T10:00:00Z", ...extra,
});

test("pixel codes are letters and digits only", () => {
  assert.equal(isTikTokPixelCode("C4ABCDEF123456789"), true);
  assert.equal(isTikTokPixelCode("123"), false);
  assert.equal(isTikTokPixelCode("G-ABCD123456"), false);
});

test("a sale is CompletePayment with value, currency, order id; time in seconds; ttclid not hashed", async () => {
  const [e] = await tiktokEventsFor(row(), { email: " Bashar@Example.com " });
  assert.equal(e!.event, "CompletePayment");
  assert.equal(e!.event_time, Math.floor(Date.parse("2026-11-27T10:00:00Z") / 1000));
  assert.equal(e!.event_id, "e1:purchase");
  assert.deepEqual([e!.properties.value, e!.properties.currency, e!.properties.order_id], [150, "TRY", "e1"]);
  assert.equal(e!.user.ttclid, "TT123");
  assert.equal(e!.user.email, await sha256("bashar@example.com"));
  assert.equal(e!.user.phone, await sha256("+905066903027"));
  assert.equal(e!.user.external_id, await sha256("c1"));
});

test("goals map to SubmitForm and Schedule; a repeated goal sends nothing; a quality signal is LeadQuality", async () => {
  assert.equal((await tiktokEventsFor(row({ event_kind: "qualified_lead", value: null })))[0]!.event, "SubmitForm");
  assert.equal((await tiktokEventsFor(row({ event_kind: "booking", value: null })))[0]!.event, "Schedule");
  assert.deepEqual(await tiktokEventsFor(row({ is_first_for_goal: false })), []);
  const both = await tiktokEventsFor(row({ is_quality_signal: true, quality_level: "excellent", quality_score: 10 }));
  assert.deepEqual(both.map((e) => e.event), ["CompletePayment", "LeadQuality"]);
  assert.deepEqual(await tiktokEventsFor(row({ event_kind: "lost", is_first_for_goal: false })), []);
});

test("a long history is cut into requests of at most 50 events", async () => {
  const rows = Array.from({ length: 55 }, (_, i) => row({ id: "x" + i, is_quality_signal: true, quality_level: "good", quality_score: 6, is_first_for_goal: false }));
  const requests = await tiktokRequestsFor(rows, new Map());
  assert.deepEqual(requests.map((r) => r.events.length), [TIKTOK_MAX_EVENTS, 5]);
});
