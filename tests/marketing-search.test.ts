import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_MASK, mapPlace, searchPlaces } from "../src/modules/marketing/google-places.ts";
import { prospectPhone, phoneKind } from "../src/modules/marketing/phone.ts";
import { buildTextQuery, estimateCostUsd, requestsFor } from "../src/modules/marketing/search-input.ts";

const raw = (id: string, extra: any = {}) => ({ id, displayName: { text: `عيادة ${id}` }, formattedAddress: "Şişli, İstanbul", ...extra });
const input = { what: "عيادات أسنان", country: "TR" as const, city: "إسطنبول", language: "ar" as const, minRating: 0, maxResults: 40 };

test("a place is mapped to the fields we keep, and an incomplete one is dropped", () => {
  const place = mapPlace(
    raw("p1", {
      location: { latitude: 41.06, longitude: 28.98 },
      primaryTypeDisplayName: { text: "Dentist" },
      internationalPhoneNumber: "+90 532 123 45 67",
      nationalPhoneNumber: "0532 123 45 67",
      websiteUri: "https://example.com",
      googleMapsUri: "https://maps.google.com/?cid=1",
      rating: 4.6,
      userRatingCount: 120,
      businessStatus: "OPERATIONAL",
    }),
  );
  assert.deepEqual(place, {
    externalId: "p1", name: "عيادة p1", category: "Dentist", address: "Şişli, İstanbul", lat: 41.06, lng: 28.98,
    phoneRaw: "+90 532 123 45 67", website: "https://example.com", mapsUrl: "https://maps.google.com/?cid=1", rating: 4.6, ratingsCount: 120, businessStatus: "OPERATIONAL",
  });
  assert.equal(mapPlace({ id: "x" }), null);
  assert.equal(mapPlace({ displayName: { text: "بلا معرّف" } }), null);
  assert.equal(mapPlace(raw("p2"))?.phoneRaw, null);
});

test("the query text joins the activity, keywords, city and country", () => {
  assert.equal(buildTextQuery({ what: "عيادات أسنان", keywords: " تقويم ", city: "إسطنبول", country: "TR" }), "عيادات أسنان تقويم إسطنبول تركيا");
  assert.equal(buildTextQuery({ what: "pharmacy", country: "DE" }), "pharmacy ألمانيا");
});

test("requests and cost follow the page size of 20", () => {
  assert.deepEqual([1, 20, 21, 40, 60, 99].map(requestsFor), [1, 1, 2, 2, 3, 3]);
  assert.equal(estimateCostUsd(3), 0.105);
  assert.equal(estimateCostUsd(2, 32), 0.064);
});

test("pages are followed until enough places are found, with the key and field mask sent", async () => {
  const calls: any[] = [];
  const pages = [
    { places: Array.from({ length: 20 }, (_, i) => raw(`a${i}`)), nextPageToken: "t1" },
    { places: [...Array.from({ length: 19 }, (_, i) => raw(`b${i}`)), raw("a0")], nextPageToken: "t2" },
    { places: [raw("c0")] },
  ];
  const fake = (async (_url: any, init: any) => {
    calls.push({ headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(pages[calls.length - 1]), { status: 200 });
  }) as typeof fetch;
  const result = await searchPlaces({ ...input, maxResults: 40 }, "KEY123", fake);
  // The repeated place a0 counts once, so 39 after two pages: a third page is needed to reach 40.
  assert.equal(result.places.length, 40);
  assert.equal(result.requests, 3);
  assert.equal(calls[0].headers["X-Goog-Api-Key"], "KEY123");
  assert.equal(calls[0].headers["X-Goog-FieldMask"], FIELD_MASK);
  assert.equal(calls[0].body.textQuery, "عيادات أسنان إسطنبول تركيا");
  assert.equal(calls[0].body.regionCode, "TR");
  assert.equal(calls[0].body.languageCode, "ar");
  assert.equal(calls[0].body.pageToken, undefined);
  assert.equal(calls[1].body.pageToken, "t1");
  assert.equal(calls[2].body.pageToken, "t2");
});

test("it stops paying for pages as soon as it has the results asked for", async () => {
  let count = 0;
  const fake = (async () => {
    count++;
    return new Response(JSON.stringify({ places: Array.from({ length: 20 }, (_, i) => raw(`p${count}-${i}`)), nextPageToken: "more" }), { status: 200 });
  }) as typeof fetch;
  const result = await searchPlaces({ ...input, maxResults: 10, language: "any" }, "K", fake);
  assert.equal(count, 1);
  assert.equal(result.places.length, 10);
});

test("Google failures become clear Arabic messages that never contain the key", async () => {
  const reply = (status: number, error: any = { message: "API key not valid: KEY-SECRET" }) => (async () => new Response(JSON.stringify({ error }), { status })) as typeof fetch;
  await assert.rejects(() => searchPlaces(input, "KEY-SECRET", reply(403)), (e: Error) => /Places API \(New\)/.test(e.message) && !e.message.includes("KEY-SECRET"));
  await assert.rejects(() => searchPlaces(input, "K", reply(429)), /حصة Google/);
  await assert.rejects(() => searchPlaces(input, "K", reply(400, { message: "bad query" })), /bad query/);
  await assert.rejects(() => searchPlaces(input, "K", (async () => new Response("<html>", { status: 502 })) as typeof fetch), /502/);
});

test("phones are normalised and classified only where the numbering is known", () => {
  assert.deepEqual(prospectPhone("+90 532 123 45 67"), { e164: "905321234567", kind: "mobile" });
  assert.deepEqual(prospectPhone("+90 212 555 10 20"), { e164: "902125551020", kind: "landline" });
  assert.deepEqual(prospectPhone("+966 50 123 4567"), { e164: "966501234567", kind: "mobile" });
  assert.deepEqual(prospectPhone("0532 123 45 67", "90"), { e164: "905321234567", kind: "mobile" });
  assert.deepEqual(prospectPhone("+49 30 1234567"), { e164: "49301234567", kind: "unknown" });
  assert.deepEqual(prospectPhone(null), { e164: null, kind: "unknown" });
  assert.deepEqual(prospectPhone("not a phone"), { e164: null, kind: "unknown" });
  assert.equal(phoneKind("90532"), "unknown");
});
