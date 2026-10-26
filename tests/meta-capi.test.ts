import { test } from "node:test";
import assert from "node:assert/strict";
import { metaEventsFor, metaPhone, sha256, type ConversionEventRow } from "../src/modules/integrations/meta-capi.ts";
import { cleanPixelId } from "../src/modules/integrations/social-platforms.ts";

const row = (patch: Partial<ConversionEventRow> = {}): ConversionEventRow => ({
  id: "e1",
  opportunity_id: "o1",
  contact_id: "c1",
  stage_name: "مؤهل",
  event_kind: "qualified_lead",
  is_first_for_goal: true,
  value: null,
  currency: null,
  attribution: {},
  quality_level: null,
  quality_score: null,
  is_quality_signal: false,
  contact_phone: "966501234567@s.whatsapp.net",
  occurred_at: "2026-10-20T10:00:00Z",
  ...patch,
});

test("qualified lead becomes a hashed Lead event", async () => {
  const [event] = (await metaEventsFor(row({ attribution: { fbclid: "AbC" } }))) as any[];
  assert.equal(event.event_name, "Lead");
  assert.equal(event.event_id, "e1:qualified_lead");
  assert.equal(event.action_source, "system_generated");
  assert.deepEqual(event.user_data.ph, [await sha256("966501234567")]);
  assert.equal(event.user_data.fbc, `fb.1.${Date.parse("2026-10-20T10:00:00Z")}.AbC`);
  assert.equal(JSON.stringify(event).includes("966501234567"), false);
});

test("name, email and country are hashed when the CRM has them", async () => {
  const [event] = (await metaEventsFor(row(), { name: "Ahmed Al-Sayed Ali", email: " Ahmed@Example.com ", country: "SA", city: "Riyadh" })) as any[];
  assert.deepEqual(event.user_data.fn, [await sha256("ahmed")]);
  assert.deepEqual(event.user_data.ln, [await sha256("alsayedali")]);
  assert.deepEqual(event.user_data.em, [await sha256("ahmed@example.com")]);
  assert.deepEqual(event.user_data.country, [await sha256("sa")]);
  assert.equal(JSON.stringify(event).toLowerCase().includes("ahmed"), false);
  const [bare] = (await metaEventsFor(row(), { email: "not-an-email", country: "Saudi" })) as any[];
  assert.equal(bare.user_data.em, undefined);
  assert.equal(bare.user_data.country, undefined);
});

test("purchase carries value and currency; quality adds its own event", async () => {
  const events = (await metaEventsFor(
    row({ event_kind: "purchase", value: "150", currency: "sar", is_quality_signal: true, quality_level: "good", quality_score: 6 }),
  )) as any[];
  assert.deepEqual(events.map((e) => e.event_name), ["Purchase", "LeadQuality"]);
  assert.equal(events[0].custom_data.value, 150);
  assert.equal(events[0].custom_data.currency, "SAR");
  assert.equal(events[1].custom_data.quality_score, 6);
});

test("re-entries and WhatsApp internal ids send nothing extra", async () => {
  assert.equal((await metaEventsFor(row({ is_first_for_goal: false }))).length, 0);
  assert.equal(metaPhone("123456789012345"), null);
  assert.equal(metaPhone("00963 944 123 456"), "963944123456");
});

test("pixel ids are checked per platform", () => {
  assert.equal(cleanPixelId("facebook", " 4618096201805650 "), "4618096201805650");
  assert.throws(() => cleanPixelId("facebook", "abc"));
  assert.equal(cleanPixelId("google", "AW-123456789"), "AW-123456789");
});
