import { test } from "node:test";
import assert from "node:assert/strict";
import { GA4_MAX_EVENTS, ga4EventsFor, ga4RequestsFor, isGa4MeasurementId } from "../src/modules/integrations/ga4-capi.ts";
import { sha256 } from "../src/modules/integrations/meta-capi.ts";

const row = (extra: any = {}) => ({
  id: "e1", opportunity_id: "o1", contact_id: "c1", stage_name: "عرض سعر", event_kind: "purchase", is_first_for_goal: true, value: 150, currency: "try",
  attribution: { utm_source: "google", utm_medium: "cpc", utm_campaign: "winter" }, quality_level: null, quality_score: null, is_quality_signal: false,
  contact_phone: "905066903027", occurred_at: "2026-11-27T10:00:00Z", ...extra,
});

test("only G- ids can receive GA4 events", () => {
  assert.equal(isGa4MeasurementId("G-ABCD123456"), true);
  assert.equal(isGa4MeasurementId("AW-123456789"), false);
  assert.equal(isGa4MeasurementId(""), false);
});

test("a sale is a GA4 purchase with value, currency and a transaction id; time in microseconds", () => {
  const [e] = ga4EventsFor(row());
  assert.equal(e!.name, "purchase");
  assert.equal(e!.timestamp_micros, Date.parse("2026-11-27T10:00:00Z") * 1000);
  assert.deepEqual([e!.params.value, e!.params.currency, e!.params.transaction_id], [150, "TRY", "e1:purchase"]);
  assert.deepEqual([e!.params.source, e!.params.medium, e!.params.campaign], ["google", "cpc", "winter"]);
});

test("goals map to qualify_lead and schedule_appointment; a repeated goal sends nothing; a quality signal is lead_quality", () => {
  assert.equal(ga4EventsFor(row({ event_kind: "qualified_lead", value: null }))[0]!.name, "qualify_lead");
  assert.equal(ga4EventsFor(row({ event_kind: "booking", value: null }))[0]!.name, "schedule_appointment");
  assert.deepEqual(ga4EventsFor(row({ is_first_for_goal: false })), []);
  const both = ga4EventsFor(row({ is_quality_signal: true, quality_level: "excellent", quality_score: 10 }));
  assert.deepEqual(both.map((e) => e.name), ["purchase", "lead_quality"]);
  assert.equal(both[1]!.params.lead_quality, "excellent");
  assert.deepEqual(ga4EventsFor(row({ event_kind: "lost", is_first_for_goal: false })), []);
});

test("one request per person with hashed email and phone (E.164, lower case); a person's events are grouped", async () => {
  const requests = await ga4RequestsFor(
    [row({ id: "e1" }), row({ id: "e2", event_kind: "booking", value: null }), row({ id: "e3", contact_id: "c2", opportunity_id: "o2", contact_phone: null })],
    new Map([["c1", { email: " Bashar@Example.com " }]]),
  );
  assert.equal(requests.length, 2);
  const first = requests[0]!.request;
  assert.deepEqual(requests[0]!.rowIds, ["e1", "e2"]);
  assert.equal(first.client_id, "novasales.c1");
  assert.deepEqual(first.user_data, { sha256_email_address: [await sha256("bashar@example.com")], sha256_phone_number: [await sha256("+905066903027")] });
  assert.equal(requests[1]!.request.user_data, undefined, "nothing to hash, nothing sent");
});

test("a long history is cut into requests of at most 25 events", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => row({ id: "x" + i, is_quality_signal: true, quality_level: "good", quality_score: 6, is_first_for_goal: false }));
  const requests = await ga4RequestsFor(rows, new Map());
  assert.deepEqual(requests.map((r) => r.request.events.length), [GA4_MAX_EVENTS, 5]);
});
