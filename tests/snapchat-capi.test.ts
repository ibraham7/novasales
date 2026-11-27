import { test } from "node:test";
import assert from "node:assert/strict";
import { SNAP_MAX_EVENTS, isSnapPixelId, snapEventsFor, snapRequestsFor } from "../src/modules/integrations/snapchat-capi.ts";
import { sha256 } from "../src/modules/integrations/meta-capi.ts";

const row = (extra: any = {}) => ({
  id: "e1", opportunity_id: "o1", contact_id: "c1", stage_name: "عرض سعر", event_kind: "purchase", is_first_for_goal: true, value: 150, currency: "try",
  attribution: { sc_click_id: "SC1" }, quality_level: null, quality_score: null, is_quality_signal: false,
  contact_phone: "905066903027", occurred_at: "2026-11-27T10:00:00Z", ...extra,
});

test("pixel ids are uuid-like", () => {
  assert.equal(isSnapPixelId("12345678-1234-1234-1234-123456789abc"), true);
  assert.equal(isSnapPixelId("G-ABCD123456"), false);
});

test("a sale is PURCHASE with value, currency, order id; hashed email and phone (digits only); click id not hashed", async () => {
  const [e] = await snapEventsFor(row(), { email: " Bashar@Example.com " });
  assert.equal(e!.event_name, "PURCHASE");
  assert.equal(e!.event_time, Math.floor(Date.parse("2026-11-27T10:00:00Z") / 1000));
  assert.deepEqual([e!.custom_data.value, e!.custom_data.currency, e!.custom_data.order_id], [150, "TRY", "e1"]);
  assert.equal(e!.user_data.em, await sha256("bashar@example.com"));
  assert.equal(e!.user_data.ph, await sha256("905066903027"));
  assert.equal(e!.user_data.sc_click_id, "SC1");
});

test("goals map to SIGN_UP and RESERVE; repeats send nothing; quality is CUSTOM_EVENT_1", async () => {
  assert.equal((await snapEventsFor(row({ event_kind: "qualified_lead", value: null })))[0]!.event_name, "SIGN_UP");
  assert.equal((await snapEventsFor(row({ event_kind: "booking", value: null })))[0]!.event_name, "RESERVE");
  assert.deepEqual(await snapEventsFor(row({ is_first_for_goal: false })), []);
  const both = await snapEventsFor(row({ is_quality_signal: true, quality_level: "good", quality_score: 6 }));
  assert.deepEqual(both.map((e) => e.event_name), ["PURCHASE", "CUSTOM_EVENT_1"]);
});

test("a person Snapchat cannot match (no email, phone or click id) sends nothing", async () => {
  assert.deepEqual(await snapEventsFor(row({ contact_phone: null, attribution: {} })), []);
});

test("a long history is cut into requests of at most 100 events", async () => {
  const rows = Array.from({ length: 105 }, (_, i) => row({ id: "x" + i, is_quality_signal: true, quality_level: "good", quality_score: 6, is_first_for_goal: false }));
  const requests = await snapRequestsFor(rows, new Map());
  assert.deepEqual(requests.map((r) => r.events.length), [SNAP_MAX_EVENTS, 5]);
});
