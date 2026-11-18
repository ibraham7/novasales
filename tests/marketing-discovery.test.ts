import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { discoverProspects, fold, mentionsPhone, nameTokens, pickSocials, pickWebsite, rateResult, resolveSuggestion, type SearchResult, type WebSearchLike } from "../src/modules/marketing/discover-core.ts";
import { createSerperSearch, discoveryConfigured } from "../src/modules/marketing/web-search.server.ts";

const r = (link: string, title = "", snippet = ""): SearchResult => ({ link, title, snippet });

test("the words that tell a business apart are kept, the words that say what kind of business it is are dropped", () => {
  assert.deepEqual(nameTokens("Rengin Eczanesi • Pharmacy • Аптека"), ["rengin"]);
  assert.deepEqual(nameTokens("Eczane Ayasofya"), ["ayasofya"]);
  assert.deepEqual(nameTokens("Dent Clinic Ağız ve Diş Sağlığı Kliniği"), []);
  assert.deepEqual(nameTokens("صيدلية شهير / Şehir eczanesi"), ["شهير", "sehir"]);
  assert.equal(fold("Şişli İletişim"), "sisli iletisim");
  assert.equal(fold("صيدلية"), "صيدليه");
});

test("a business's own number is recognised however a page writes it", () => {
  assert.ok(mentionsPhone("Tel: 0532 561 98 00 | Fatih", "905325619800"));
  assert.ok(mentionsPhone("+90 (532) 561-98-00", "905325619800"));
  assert.ok(mentionsPhone("٠٥٣٢٥٦١٩٨٠٠", "905325619800"));
  assert.ok(!mentionsPhone("Tel: 0532 561 98 01", "905325619800"));
  assert.ok(!mentionsPhone("anything", null));
});

const subject = { name: "Rengin Eczanesi", city: "Beyoğlu", phone: "905445556677" };

test("a result is believed when it carries the business's own number, or when name and city agree", () => {
  assert.equal(rateResult(subject, r("https://www.instagram.com/renginecz", "Rengin Eczanesi (@renginecz)", "0544 555 66 77 Beyoğlu"))?.confidence, "confirmed");
  assert.equal(rateResult(subject, r("https://www.instagram.com/renginecz", "Rengin Eczanesi (@renginecz)", "Beyoğlu İstanbul"))?.confidence, "likely");
  // the same single word without the city could be any of several pharmacies
  assert.equal(rateResult(subject, r("https://www.instagram.com/x", "Rengin Hanım", "güzellik salonu")), null);
  assert.equal(rateResult(subject, r("https://www.instagram.com/yenieczane", "Yeni Eczanesi", "Beyoğlu")), null);
  assert.equal(rateResult({ ...subject, name: "Dent Clinic" }, r("https://x.example/", "Dent Clinic", "")), null);
});

test("a social page is taken per platform: the proven one beats the merely likely one, share and post links are ignored", () => {
  const found = pickSocials(subject, [
    r("https://www.instagram.com/p/ABC123/", "Rengin Eczanesi post", "Beyoğlu"),
    r("https://www.instagram.com/rengin.eczane/", "Rengin Eczanesi", "Beyoğlu"),
    r("https://www.instagram.com/renginecz/", "Rengin Eczanesi (@renginecz)", "0544 555 66 77"),
    r("https://www.facebook.com/renginecz", "Rengin Eczanesi - Beyoğlu", ""),
    r("https://www.facebook.com/sharer/sharer.php?u=x", "Rengin Eczanesi", "Beyoğlu"),
  ]);
  assert.deepEqual(found, {
    instagram: { url: "https://www.instagram.com/renginecz", confidence: "confirmed" },
    facebook: { url: "https://www.facebook.com/renginecz", confidence: "likely" },
  });
});

test("a website is the business's own: directories, social pages and pages that only mention it are not", () => {
  const results = [
    r("https://www.doktortakvimi.com/klinikler/rengin-eczanesi", "Rengin Eczanesi", "Beyoğlu"),
    r("https://eczaneler.gen.tr/rengin", "Rengin Eczanesi nöbetçi", "Beyoğlu"),
    r("https://www.instagram.com/renginecz", "Rengin Eczanesi", "Beyoğlu"),
    r("https://haberler.example/gundem/yeni", "Beyoğlu'nda yeni eczane haberi", "Rengin Eczanesi Beyoğlu"),
    r("https://www.renginecz.com/iletisim", "Rengin Eczanesi - İletişim", "Beyoğlu 0544 555 66 77"),
  ];
  assert.deepEqual(pickWebsite(subject, results), { url: "https://www.renginecz.com/", confidence: "confirmed", score: 1 });
  assert.equal(pickWebsite(subject, results.slice(0, 4)), null);
});

const search = (answers: Record<string, SearchResult[]>, log: string[] = []): WebSearchLike =>
  async (query) => {
    log.push(query);
    const key = Object.keys(answers).find((k) => query.includes(k));
    if (key === "FAIL") throw new Error("boom");
    return key ? answers[key] : [];
  };

const rows = () => [
  { id: "a", organization_id: "o", name: "Rengin Eczanesi", city: "Beyoğlu", country: "TR", website: null, phone_e164: "905445556677", socials: {}, discovered: {} },
  { id: "x", organization_id: "other", name: "Rengin Eczanesi", city: "Beyoğlu", country: "TR", website: null, phone_e164: "905445556677", socials: {}, discovered: {} },
];

test("what the business's own number proves is added at once and read; what only looks right is kept as a suggestion", async () => {
  const db = fakeDb({ ob_prospects: rows() });
  const log: string[] = [];
  const webSearch = search(
    {
      "site:instagram.com": [r("https://www.instagram.com/renginecz", "Rengin Eczanesi (@renginecz)", "0544 555 66 77"), r("https://www.facebook.com/renginecz", "Rengin Eczanesi", "Beyoğlu")],
      "Rengin Eczanesi Beyoğlu": [r("https://www.renginecz.com/", "Rengin Eczanesi", "Beyoğlu")],
    },
    log,
  );
  const pages: string[] = [];
  const fetchPage = async (url: string) => {
    pages.push(url);
    return { finalUrl: url, html: '<a href="tel:0544 555 66 77">x</a><a href="mailto:rengin@renginecz.com">m</a><a href="https://wa.me/905445556677">w</a>' };
  };
  const summary = await discoverProspects(db, "o", ["a", "x"], { search: webSearch, fetchPage }, new Date("2026-11-19T10:00:00Z"));
  assert.deepEqual([summary.requested, summary.searched, summary.confirmed, summary.nothingFound, summary.failed], [1, 2, 1, 0, 0]);
  const [a, x] = db.tables.ob_prospects;
  assert.equal(a.socials.instagram, "https://www.instagram.com/renginecz", "proven by the phone number: added");
  assert.equal(a.socials.facebook, undefined, "only likely: not added");
  assert.deepEqual(a.discovered.socials, { facebook: { url: "https://www.facebook.com/renginecz", confidence: "likely" } });
  // the candidate site shows the business's own number, so it is its site: set and read
  assert.equal(a.website, "https://www.renginecz.com/");
  assert.equal(a.enrich_status, "done");
  assert.deepEqual(a.emails, ["rengin@renginecz.com"]);
  assert.equal(a.site_whatsapp, "+905445556677");
  assert.equal(a.discovered_at, "2026-11-19T10:00:00.000Z");
  assert.equal(x.discovered_at, undefined, "another organization's business is never touched");
  for (const call of db.calls.filter((c: any) => c.table === "ob_prospects"))
    assert.ok(call.filters.some(([op, col]: any) => op === "eq" && col === "organization_id"), `${call.op} without organization filter`);
  assert.ok(pages.every((p) => p.startsWith("https://www.renginecz.com")));
});

test("a website that does not show the business's number stays a suggestion and is never set on its own", async () => {
  const db = fakeDb({ ob_prospects: rows().slice(0, 1) });
  const webSearch = search({ "Rengin Eczanesi Beyoğlu": [r("https://www.renginecz.com/", "Rengin Eczanesi", "Beyoğlu İstanbul")] });
  const fetchPage = async (url: string) => ({ finalUrl: url, html: "<html>welcome, no number here</html>" });
  const summary = await discoverProspects(db, "o", ["a"], { search: webSearch, fetchPage });
  assert.equal(summary.suggested, 1);
  const a = db.tables.ob_prospects[0];
  assert.equal(a.website, null);
  assert.deepEqual(a.discovered.website, { url: "https://www.renginecz.com/", confidence: "likely" });
});

test("it searches only for what is missing, skips names that say nothing, and keeps going when one search fails", async () => {
  const db = fakeDb({
    ob_prospects: [
      { id: "full", organization_id: "o", name: "Rengin Eczanesi", city: "x", country: "TR", website: "https://a.example/", phone_e164: null, socials: { instagram: "https://i", facebook: "https://f" }, discovered: {} },
      { id: "generic", organization_id: "o", name: "Dent Clinic", city: "x", country: "TR", website: null, phone_e164: null, socials: {}, discovered: {} },
      { id: "boom", organization_id: "o", name: "FAIL Eczanesi", city: "x", country: "TR", website: null, phone_e164: null, socials: {}, discovered: {} },
      { id: "empty", organization_id: "o", name: "Zeytin Eczanesi", city: "x", country: "TR", website: null, phone_e164: null, socials: {}, discovered: {} },
    ],
  });
  const log: string[] = [];
  const summary = await discoverProspects(db, "o", ["full", "generic", "boom", "empty"], { search: search({ FAIL: [] }, log), fetchPage: async (u) => ({ finalUrl: u, html: "" }) });
  assert.deepEqual([summary.requested, summary.tooGeneric, summary.failed, summary.nothingFound], [4, 1, 1, 1]);
  assert.equal(summary.error, "boom");
  assert.ok(!log.some((q) => q.includes("Dent")), "a generic name is not searched");
  assert.ok(log.filter((q) => q.includes("Rengin")).length === 0, "a business with a site and both pages needs no search");
  assert.equal(db.tables.ob_prospects.find((r: any) => r.id === "generic").discovered_at != null, true);
});

test("a person accepts or ignores a suggestion, and only their own organization's business can be changed", async () => {
  const base = { organization_id: "o", website: null, socials: { instagram: "https://i" }, discovered: { website: { url: "https://www.renginecz.com/", confidence: "likely" }, socials: { facebook: { url: "https://www.facebook.com/renginecz", confidence: "likely" }, x: { url: "https://x.com/r", confidence: "likely" } } } };
  const db = fakeDb({ ob_prospects: [{ id: "a", ...base }, { id: "b", ...base, organization_id: "other" }] });
  await resolveSuggestion(db, "o", { id: "a", kind: "social", platform: "facebook", accept: true });
  let a = db.tables.ob_prospects[0];
  assert.deepEqual(a.socials, { instagram: "https://i", facebook: "https://www.facebook.com/renginecz" });
  assert.deepEqual(Object.keys(a.discovered.socials), ["x"]);
  await resolveSuggestion(db, "o", { id: "a", kind: "social", platform: "x", accept: false });
  a = db.tables.ob_prospects[0];
  assert.equal(a.socials.x, undefined);
  assert.deepEqual(a.discovered.socials, {});
  await resolveSuggestion(db, "o", { id: "a", kind: "website", accept: true });
  a = db.tables.ob_prospects[0];
  assert.equal(a.website, "https://www.renginecz.com/");
  assert.equal(a.discovered.website, undefined);
  await assert.rejects(resolveSuggestion(db, "o", { id: "b", kind: "website", accept: true }), /غير موجودة/);
  assert.equal(db.tables.ob_prospects[1].website, null);
  await assert.rejects(resolveSuggestion(db, "o", { id: "a", kind: "social", platform: "tiktok", accept: true }), /لا يوجد اقتراح/);
});

test("the search service is called with the key in a header, and its answers and failures are handled without leaking the key", async () => {
  const calls: any[] = [];
  const ok = (async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ organic: [{ title: "T", link: "https://a.example/", snippet: "S" }, { title: "no link" }, { link: 5 }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const results = await createSerperSearch("SECRET-KEY", ok)("Rengin Eczanesi Beyoğlu", { country: "tr", lang: "tr" });
  assert.deepEqual(results, [{ title: "T", link: "https://a.example/", snippet: "S" }]);
  assert.equal(calls[0].url, "https://google.serper.dev/search");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["X-API-KEY"], "SECRET-KEY");
  assert.deepEqual(JSON.parse(calls[0].init.body), { q: "Rengin Eczanesi Beyoğlu", gl: "tr", hl: "tr", num: 10 });
  assert.ok(!calls[0].url.includes("SECRET-KEY"), "the key is in a header, not in the address");

  const fail = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
  for (const [status, text] of [[401, /غير صالح/], [403, /غير صالح/], [429, /رصيد/], [402, /رصيد/], [500, /500/]] as const) {
    await assert.rejects(createSerperSearch("SECRET-KEY", fail(status))("q", { country: "tr", lang: "tr" }), (e: Error) => text.test(e.message) && !e.message.includes("SECRET-KEY"));
  }
  const down = (async () => {
    throw new Error("connect ECONNREFUSED with SECRET-KEY");
  }) as unknown as typeof fetch;
  await assert.rejects(createSerperSearch("SECRET-KEY", down)("q", { country: "tr", lang: "tr" }), (e: Error) => /الاتصال/.test(e.message) && !e.message.includes("SECRET-KEY"));
});

test("the search is off until a key is set", () => {
  assert.equal(discoveryConfigured({}), false);
  assert.equal(discoveryConfigured({ SERPER_API_KEY: "  " }), false);
  assert.equal(discoveryConfigured({ SERPER_API_KEY: "abc" }), true);
});
