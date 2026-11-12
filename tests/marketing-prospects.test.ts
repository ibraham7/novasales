import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { listProspects, safeTerm, saveFoundPlaces, updateProspects } from "../src/modules/marketing/prospects-core.ts";
import { EMPTY_FILTERS, normalizeFilters } from "../src/modules/marketing/filters.ts";
import type { FoundPlace } from "../src/modules/marketing/google-places.ts";

const UNIQUE = { ob_prospects: ["organization_id", "provider", "external_id"] };
const place = (id: string, extra: Partial<FoundPlace> = {}): FoundPlace => ({
  externalId: id, name: `عيادة ${id}`, category: "Dentist", address: "Şişli", lat: 1, lng: 2, phoneRaw: "+90 532 123 45 67",
  website: null, mapsUrl: null, rating: 4.5, ratingsCount: 10, businessStatus: "OPERATIONAL", ...extra,
});
const base = { organizationId: "org-1", searchId: "s1", country: "TR", dial: "90", city: "إسطنبول", now: new Date("2026-11-03T10:00:00Z") };

test("a search stores new businesses with their phone classified and a 30-day expiry", async () => {
  const db = fakeDb({}, UNIQUE);
  const result = await saveFoundPlaces(db, { ...base, places: [place("a"), place("b", { phoneRaw: "+90 212 555 10 20" }), place("c", { phoneRaw: null })], minRating: 0 });
  assert.deepEqual(result, { found: 3, kept: 3, created: 3, updated: 0, filteredOut: 0 });
  const [a, b, c] = db.tables.ob_prospects;
  // The status is not sent: the database default («new») applies to a new business.
  assert.equal("status" in a, false);
  assert.equal(a.organization_id, "org-1");
  assert.equal(a.city, "إسطنبول");
  assert.deepEqual([a.phone_e164, a.phone_kind], ["905321234567", "mobile"]);
  assert.equal(b.phone_kind, "landline");
  assert.deepEqual([c.phone_e164, c.phone_kind], [null, "unknown"]);
  assert.equal(a.expires_at, "2026-12-03T10:00:00.000Z");
});

test("searching again refreshes a known business but keeps its status, notes and first search", async () => {
  const db = fakeDb({}, UNIQUE);
  await saveFoundPlaces(db, { ...base, places: [place("a")], minRating: 0 });
  Object.assign(db.tables.ob_prospects[0], { status: "approved", notes: "اتصل بعد العيد" });
  const again = await saveFoundPlaces(db, { ...base, searchId: "s2", places: [place("a", { name: "عيادة جديدة الاسم" }), place("b")], minRating: 0 });
  assert.deepEqual([again.created, again.updated], [1, 1]);
  assert.equal(db.tables.ob_prospects.length, 2);
  const a = db.tables.ob_prospects.find((r) => r.external_id === "a");
  assert.deepEqual([a.name, a.status, a.notes, a.search_id], ["عيادة جديدة الاسم", "approved", "اتصل بعد العيد", "s1"]);
});

test("the same Google place in two organizations is two separate records", async () => {
  const db = fakeDb({}, UNIQUE);
  await saveFoundPlaces(db, { ...base, places: [place("a")], minRating: 0 });
  await saveFoundPlaces(db, { ...base, organizationId: "org-2", places: [place("a")], minRating: 0 });
  assert.deepEqual(db.tables.ob_prospects.map((r) => r.organization_id).sort(), ["org-1", "org-2"]);
});

test("the minimum rating drops businesses below it and those without a rating", async () => {
  const db = fakeDb({}, UNIQUE);
  const result = await saveFoundPlaces(db, { ...base, places: [place("a", { rating: 4.8 }), place("b", { rating: 3.9 }), place("c", { rating: null })], minRating: 4 });
  assert.deepEqual([result.kept, result.filteredOut], [1, 2]);
  assert.equal(db.tables.ob_prospects.length, 1);
});

test("every read and write is scoped to the organization", async () => {
  const db = fakeDb({ ob_prospects: [{ id: "x1", organization_id: "org-1", status: "new" }, { id: "x2", organization_id: "org-2", status: "new" }] }, UNIQUE);
  const listed = await listProspects(db, "org-1", { ...EMPTY_FILTERS, page: 1, pageSize: 25 });
  assert.deepEqual(listed.rows.map((r: any) => r.id), ["x1"]);
  // A person cannot change another organization's business by sending its id.
  assert.equal(await updateProspects(db, "org-1", { ids: ["x1", "x2"], status: "qualified" }), 1);
  assert.equal(db.tables.ob_prospects.find((r) => r.id === "x2").status, "new");
  for (const call of db.calls.filter((c) => c.table === "ob_prospects" && c.op !== "upsert"))
    assert.ok(call.filters.some(([op, col]) => op === "eq" && col === "organization_id"), `${call.op} without organization filter`);
});

test("a business that already started a conversation is not moved by hand, notes can always change", async () => {
  const db = fakeDb({ ob_prospects: [{ id: "r1", organization_id: "o", status: "replied" }, { id: "n1", organization_id: "o", status: "new" }] }, UNIQUE);
  assert.equal(await updateProspects(db, "o", { ids: ["r1", "n1"], status: "excluded" }), 1);
  assert.equal(db.tables.ob_prospects.find((r) => r.id === "r1").status, "replied");
  assert.equal(await updateProspects(db, "o", { ids: ["r1"], notes: "ملاحظة" }), 1);
  assert.equal(db.tables.ob_prospects.find((r) => r.id === "r1").notes, "ملاحظة");
});

test("filters become database filters, and the search term cannot break out of the filter", async () => {
  const db = fakeDb({ ob_prospects: [] }, UNIQUE);
  await listProspects(db, "org-1", { ...normalizeFilters({ sort: "rating", status: { include: ["new", "approved"] }, hasPhone: true, mobileOnly: true, hasWebsite: true, minRating: 4, q: "عيادة),status.eq.approved" }), page: 2, pageSize: 10 });
  const filters = db.calls.at(-1)!.filters.map(([op, col]) => `${op}:${col}`);
  for (const expected of ["eq:organization_id", "in:status", "not.is:phone_e164", "eq:phone_kind", "not.is:website", "gte:rating", "or:*"]) assert.ok(filters.includes(expected), expected);
  const or = db.calls.at(-1)!.filters.find(([op]) => op === "or")![2] as string;
  assert.ok(!or.includes("),status"), or);
  assert.equal(safeTerm("a%b_c,(d)*\"e'f\\g"), "a b c d e f g");
});

test("businesses can be deleted, except those still waiting in a campaign", async () => {
  const { deleteProspects } = await import("../src/modules/marketing/prospects-core.ts");
  const row = (id: string) => ({ id, organization_id: "org-1", name: id });
  const db = fakeDb({ ob_prospects: [row("a"), row("b"), { ...row("c"), organization_id: "org-2" }], cmp_recipients: [{ id: "r1", organization_id: "org-1", ob_prospect_id: "b", status: "queued" }] });
  await assert.rejects(() => deleteProspects(db, "org-1", ["a", "b"]), /لم ينته إرسالها/);
  assert.equal(db.tables.ob_prospects.length, 3);
  assert.equal(await deleteProspects(db, "org-1", ["a", "c"]), 1);
  assert.deepEqual(db.tables.ob_prospects.map((r: any) => r.id), ["b", "c"]);
});

test("a business that asked to stop can be moved again only once its number is off the do-not-send list", async () => {
  const row = (id: string, phone: string) => ({ id, organization_id: "org-1", name: id, status: "opted_out", phone_e164: phone });
  const db = fakeDb({ ob_prospects: [row("a", "905320000001"), row("b", "905320000002")], ob_suppressions: [{ organization_id: "org-1", channel: "whatsapp", identifier: "905320000001" }] });
  const { countStillStopped } = await import("../src/modules/marketing/prospects-core.ts");
  assert.equal(await updateProspects(db, "org-1", { ids: ["a", "b"], status: "approved" }), 1);
  assert.deepEqual(db.tables.ob_prospects.map((r: any) => r.status), ["opted_out", "approved"]);
  assert.equal(await countStillStopped(db, "org-1", ["a", "b"]), 1);
});
