import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FILTERS, PRESETS, compactFilters, countActiveFilters, decodeFilters, encodeFilters, filterChips, normalizeFilters } from "../src/modules/marketing/filters.ts";
import { applyProspectFilters } from "../src/modules/marketing/filters-query.ts";

/** Records every builder call so the conditions can be checked without a database. */
function recorder() {
  const calls: [string, ...unknown[]][] = [];
  const q: any = new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => (calls.push([name, ...args]), q) });
  return { q, calls };
}
const run = (patch: object) => {
  const r = recorder();
  applyProspectFilters(r.q, normalizeFilters({ ...EMPTY_FILTERS, ...patch }));
  return r.calls;
};

test("no filters means no conditions", () => {
  assert.deepEqual(run({}), []);
  assert.equal(countActiveFilters(EMPTY_FILTERS), 0);
});

test("include and exclude: text exclusion keeps rows where the column is empty", () => {
  const calls = run({ keywords: { include: ["dental"], exclude: ["vet"] } });
  assert.deepEqual(calls[0], ["or", "name.ilike.%dental%,category.ilike.%dental%,address.ilike.%dental%"]);
  assert.deepEqual(calls.slice(1).map((c) => c[1]), ["name.is.null,name.not.ilike.%vet%", "category.is.null,category.not.ilike.%vet%", "address.is.null,address.not.ilike.%vet%"]);
});

test("codes, technologies and statuses become in / not-in / overlap conditions, and unsafe characters are dropped", () => {
  const calls = run({ country: { include: ["SA"], exclude: ["TR"] }, tech: { include: ["shopify"], exclude: ["wix"] }, status: { include: [], exclude: ["invalid"] }, city: { include: ["a,b)(c"], exclude: [] } });
  assert.deepEqual(calls.find((c) => c[0] === "in"), ["in", "country", ["SA"]]);
  assert.ok(calls.some((c) => c[0] === "or" && c[1] === "country.is.null,country.not.in.(TR)"));
  assert.deepEqual(calls.find((c) => c[0] === "overlaps"), ["overlaps", "tech", ["shopify"]]);
  assert.deepEqual(calls.find((c) => c[0] === "not" && c[1] === "tech"), ["not", "tech", "ov", "{wix}"]);
  assert.deepEqual(calls.find((c) => c[0] === "not" && c[1] === "status"), ["not", "status", "in", "(invalid)"]);
  assert.ok(calls.some((c) => c[0] === "or" && c[1] === "city.ilike.%a b c%"));
});

test("flags and ranges", () => {
  const calls = run({ minRating: 4, ratingsMin: 10, ratingsMax: 500, hasEmail: true, excludeInCrm: true, excludeContacted: true, operatingOnly: true });
  const names = calls.map((c) => c.slice(0, 3).join("|"));
  for (const expected of ["gte|rating|4", "gte|ratings_count|10", "lte|ratings_count|500", "neq|emails|{}", "is|promoted_contact_id|", "eq|business_status|OPERATIONAL"]) assert.ok(names.some((n) => n.startsWith(expected)), expected);
  assert.ok(calls.some((c) => c[0] === "not" && c[1] === "status" && String(c[3]).includes("opted_out")));
});

test("chips: one per value, removing one leaves the rest; the count counts a filter once", () => {
  const f = normalizeFilters({ city: { include: ["Riyadh", "Jeddah"], exclude: ["Dammam"] }, hasPhone: true });
  assert.equal(countActiveFilters(f), 2);
  const chips = filterChips(f);
  assert.equal(chips.length, 4);
  const removed = chips.find((c) => c.id === "city:include:Riyadh")!.remove(f);
  assert.deepEqual(removed.city, { include: ["Jeddah"], exclude: ["Dammam"] });
  assert.equal(chips.find((c) => c.id === "city:exclude:Dammam")!.tone, "exclude");
});

test("the link format is compact, round-trips, and survives garbage", () => {
  assert.equal(encodeFilters(EMPTY_FILTERS), "");
  const f = normalizeFilters({ country: { include: ["SA"], exclude: [] }, minRating: 4 });
  assert.deepEqual(Object.keys(compactFilters(f)).sort(), ["country", "minRating"]);
  assert.deepEqual(decodeFilters(encodeFilters(f)), f);
  assert.deepEqual(decodeFilters("{not json"), EMPTY_FILTERS);
  const hostile = normalizeFilters({ tech: { include: ["shopify", "nope"] }, status: { include: ["x"] }, searchId: "../../x", minRating: 99, lang: ["zz"] });
  assert.deepEqual([hostile.tech.include, hostile.status.include, hostile.searchId, hostile.minRating, hostile.lang], [["shopify"], [], "", 0, []]);
});

test("ready presets: unique, each sets at least one filter, survive the link format, and the clinic one matches medical words", () => {
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
  for (const p of PRESETS) {
    assert.ok(countActiveFilters(p.filters) > 0, p.id);
    assert.deepEqual(decodeFilters(encodeFilters(p.filters)), p.filters, p.id);
  }
  const clinics = PRESETS.find((x) => x.id === "clinics")!;
  assert.ok(["dent", "clinic", "أسنان"].every((w) => clinics.filters.keywords.include.includes(w)));
  assert.equal(clinics.filters.operatingOnly, true);
  const sa = PRESETS.find((x) => x.id === "qawsan-sa")!;
  assert.deepEqual(sa.filters.country.include, ["SA"]);
  assert.ok(["Riyadh", "الرياض", "Jeddah", "جدة", "Dammam", "الدمام"].every((c) => sa.filters.city.include.includes(c)));
  assert.ok(sa.needsData.length >= 4);
});
