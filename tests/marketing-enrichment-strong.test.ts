import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { classifyWebsite, extractContacts, extractPhones, extractWhatsapp } from "../src/modules/marketing/site-extract.ts";
import { enrichProspects, readSite } from "../src/modules/marketing/enrich-core.ts";
import { createPageFetcher, decodeBody } from "../src/modules/marketing/site-fetch.server.ts";

test("a number published as a link (tel:) is found, in any way people write it", () => {
  const html = `<a href="tel:+90 212 252 59 25">call</a><a href="tel:05321234567">m</a>
    <a href="tel:+90%20(532)%20123%2045%2068">e</a><a href="tel:+905321234567">same as the second</a><a href="tel:123">short</a>`;
  assert.deepEqual(extractPhones(html, "90"), ["902122525925", "905321234567", "905321234568"]);
  // a local number cannot be completed without knowing the country
  assert.deepEqual(extractPhones('<a href="tel:05321234567">m</a>', ""), []);
});

test("schema.org telephone and numbers written after Tel / GSM / WhatsApp / هاتف are found", () => {
  const html = `<script type="application/ld+json">{"@type":"Pharmacy","telephone":["+90 212 555 10 20","0532 111 22 33"]}</script>
    <footer><p>Telefon: 0212 252 59 25</p><p>GSM : +90 505 440 98 85</p><p>هاتف: 0551 397 18 89</p></footer>`;
  assert.deepEqual(extractPhones(html, "90").sort(), ["902122525925", "902125551020", "905054409885", "905321112233", "905513971889"].sort());
});

test("numbers that are not phones are not taken: years, prices, ids and words that merely contain «ara» or «tel»", () => {
  const html = `<p>Since 2015 we served 4000 patients. Order 1234567890123456. Price para 1500000000. Hotel 9053211223344 view. Sara 905321234567</p>
    <p>Tel: 111111111111</p><script>var phone = "905321234567";</script>`;
  assert.deepEqual(extractPhones(html, "90"), []);
});

const wa = (html: string, dial = "") => extractWhatsapp(html, dial);

test("WhatsApp links in all their shapes give the number", () => {
  assert.equal(wa('<a href="https://wa.me/905321234567?text=hi">'), "+905321234567");
  assert.equal(wa('<a href="https://wa.me/+90 532 123 45 67">'), "+905321234567");
  assert.equal(wa('<a href="https://api.whatsapp.com/send/?phone=%2B905321234567&amp;text=hello">'), "+905321234567");
  assert.equal(wa('<a href="https://api.whatsapp.com/send?phone=905321234567&text=hello">'), "+905321234567");
  assert.equal(wa('<a href="whatsapp://send?phone=905321234567">'), "+905321234567");
  assert.equal(wa('<a href="https://web.whatsapp.com/send?phone=905321234567">'), "+905321234567");
  assert.equal(wa('<a href="https:\\/\\/wa.me\\/905321234567">'), "+905321234567");
});

test("chat buttons and plugins that keep the number in an attribute or a script setting are read", () => {
  assert.equal(wa('<div class="wa-chat" data-whatsapp="+90 532 123 45 67"></div>'), "+905321234567");
  assert.equal(wa('<script>window.cfg = {"whatsappNumber":"905321234567","color":"#25d366"}</script>'), "+905321234567");
  assert.equal(wa("<script>var whatsapp_number = '0532 123 45 67';</script>", "90"), "+905321234567");
  assert.equal(wa('<script>init({whatsapp: {phone: "905321234567"}})</script>'), "+905321234567");
});

test("a chat link without a number is kept as the link, and a real number is preferred over it", () => {
  assert.equal(wa('<a href="https://wa.me/message/ABCDEF123">'), "https://wa.me/message/ABCDEF123");
  assert.equal(wa('<a href="https://wa.link/xyz789">'), "https://wa.link/xyz789");
  assert.equal(wa('<a href="https://wa.me/message/ABCDEF123"></a><a href="https://wa.me/905321234567">'), "+905321234567");
});

test("share links, empty links and phones with no WhatsApp near them are not taken as WhatsApp", () => {
  assert.equal(wa('<a href="https://wa.me/?text=check%20this%20out">share</a>'), null);
  assert.equal(wa('<a href="whatsapp://send?text=hello">share</a>'), null);
  assert.equal(wa('<div data-phone="905321234567"></div><script>var phone = "905321234567"</script>'), null);
  assert.equal(wa('<a href="https://wa.me/111111111111">'), null);
});

test("a link-in-bio page (Linktree and the like) is followed and its contacts are merged in", async () => {
  const home = '<html><a href="https://linktr.ee/clinic.tr">links</a><a href="mailto:hi@clinic.com">m</a></html>';
  const c = extractContacts(home, "https://clinic.com/");
  assert.deepEqual(c.bioLinks, ["https://linktr.ee/clinic.tr"]);
  const seen: string[] = [];
  const fetchPage = async (url: string) => {
    seen.push(url);
    if (url === "https://clinic.com/") return { finalUrl: url, html: home };
    if (url === "https://linktr.ee/clinic.tr") return { finalUrl: url, html: '<a href="https://wa.me/905321234567">WhatsApp</a><a href="https://www.instagram.com/clinic.tr/">ig</a>' };
    throw new Error("404");
  };
  const found = await readSite("https://clinic.com/", fetchPage, "90");
  assert.equal(found.whatsapp, "+905321234567");
  assert.equal(found.socials.instagram, "https://www.instagram.com/clinic.tr");
  assert.deepEqual(found.emails, ["hi@clinic.com"]);
  assert.deepEqual(seen, ["https://clinic.com/", "https://linktr.ee/clinic.tr"]);
});

test("reading stops once the site gave an email and a phone, and goes on (to a limit) while it has not", async () => {
  const seen: string[] = [];
  const emailOnly = async (url: string) => {
    seen.push(url);
    return { finalUrl: url, html: url === "https://shop.com/" ? '<a href="mailto:hi@shop.com">x</a>' : "<html></html>" };
  };
  await readSite("https://shop.com/", emailOnly, "90");
  assert.equal(seen.length, 1 + 4, "the home page and at most four more");

  const seen2: string[] = [];
  const complete = async (url: string) => {
    seen2.push(url);
    return { finalUrl: url, html: '<a href="mailto:hi@shop.com">x</a><a href="tel:+902125551020">t</a>' };
  };
  await readSite("https://shop.com/", complete, "90");
  assert.deepEqual(seen2, ["https://shop.com/"]);
});

test("a social page or a chat link given as the «website» is kept as the contact itself, without being fetched", async () => {
  assert.deepEqual(classifyWebsite("https://www.instagram.com/clinic.tr/?hl=tr"), { kind: "social", platform: "instagram", url: "https://www.instagram.com/clinic.tr" });
  assert.deepEqual(classifyWebsite("facebook.com/clinictr"), { kind: "social", platform: "facebook", url: "https://www.facebook.com/clinictr" });
  assert.deepEqual(classifyWebsite("https://wa.me/905321234567"), { kind: "whatsapp", value: "+905321234567" });
  assert.equal(classifyWebsite("https://clinic.com/"), null);
  assert.equal(classifyWebsite("https://www.facebook.com/sharer/sharer.php?u=x"), null);

  let fetched = 0;
  const db = fakeDb({
    ob_prospects: [
      { id: "ig", organization_id: "o", website: "https://www.instagram.com/clinic.tr/", country: "TR", phone_e164: "905321111111" },
      { id: "wa", organization_id: "o", website: "https://wa.me/905322222222", country: "TR", phone_e164: "905321111111" },
    ],
  });
  const summary = await enrichProspects(db, "o", ["ig", "wa"], async () => {
    fetched++;
    throw new Error("must not be fetched");
  });
  assert.equal(fetched, 0);
  assert.deepEqual([summary.done, summary.fromProfileLink, summary.withSocial, summary.withWhatsapp, summary.failed], [2, 2, 1, 1, 0]);
  assert.deepEqual(db.tables.ob_prospects[0].socials, { instagram: "https://www.instagram.com/clinic.tr" });
  assert.equal(db.tables.ob_prospects[1].site_whatsapp, "+905322222222");
});

test("enrichment saves the site's phones (completed with the business's country), apart from the number Google gave", async () => {
  const db = fakeDb({
    ob_prospects: [
      { id: "a", organization_id: "org-1", website: "https://clinic.com/", country: "TR", phone_e164: "902122525925" },
      { id: "b", organization_id: "org-2", website: "https://clinic.com/", country: "TR", phone_e164: null },
    ],
  });
  const fetchPage = async (url: string) => ({ finalUrl: url, html: '<a href="tel:0212 252 59 25">own</a><a href="tel:0532 123 45 67">new</a><a href="mailto:hi@clinic.com">m</a>' });
  const summary = await enrichProspects(db, "org-1", ["a", "b"], fetchPage);
  assert.equal(summary.withPhone, 1);
  const [a, b] = db.tables.ob_prospects;
  assert.deepEqual(a.site_phones, ["905321234567"]);
  assert.equal(b.enrich_status, undefined, "another organization's business is never touched");
  for (const call of db.calls.filter((c) => c.table === "ob_prospects"))
    assert.ok(call.filters.some(([op, col]) => op === "eq" && col === "organization_id"), `${call.op} without organization filter`);
});

// ---- fetching ----

const ok = (html: string, type = "text/html; charset=utf-8") => new Response(html, { status: 200, headers: { "content-type": type } });
const resolveAll = async (host: string) => (host === "blocked.example" ? ["10.0.0.5"] : ["93.184.216.34"]);

test("a site that refuses an unknown robot is asked once more the way a browser asks", async () => {
  const agents: string[] = [];
  const doFetch = (async (_url: string, init: any) => {
    agents.push(init.headers["user-agent"]);
    return agents.length === 1 ? new Response("no", { status: 403 }) : ok("<html>hello</html>");
  }) as unknown as typeof fetch;
  const page = await createPageFetcher({ doFetch, resolve: resolveAll })("https://clinic.com/");
  assert.equal(page.html, "<html>hello</html>");
  assert.match(agents[0], /NovaSalesBot/);
  assert.match(agents[1], /Mozilla/);
});

test("a missing page (404) or a server error is not retried, and the refusal is reported if the retry is refused too", async () => {
  let calls = 0;
  const notFound = (async () => (calls++, new Response("x", { status: 404 }))) as unknown as typeof fetch;
  await assert.rejects(createPageFetcher({ doFetch: notFound, resolve: resolveAll })("https://clinic.com/x"), /404/);
  assert.equal(calls, 1);
  calls = 0;
  const refused = (async () => (calls++, new Response("x", { status: 403 }))) as unknown as typeof fetch;
  await assert.rejects(createPageFetcher({ doFetch: refused, resolve: resolveAll })("https://clinic.com/"), /403/);
  assert.equal(calls, 2);
});

test("a site that does not answer is tried with and without www, and the address checks still apply", async () => {
  const asked: string[] = [];
  const doFetch = (async (url: string) => {
    asked.push(url);
    return ok("<html>ok</html>");
  }) as unknown as typeof fetch;
  const resolve = async (host: string) => {
    if (host === "clinic.com") throw new Error("ENOTFOUND");
    return ["93.184.216.34"];
  };
  const page = await createPageFetcher({ doFetch, resolve })("https://clinic.com/");
  assert.equal(page.finalUrl, "https://www.clinic.com/");
  assert.deepEqual(asked, ["https://www.clinic.com/"]);

  // an alternate that points inside our network is refused like any other
  const inside = async (host: string) => {
    if (host === "clinic.com") throw new Error("ENOTFOUND");
    return ["10.0.0.5"];
  };
  await assert.rejects(createPageFetcher({ doFetch, resolve: inside })("https://clinic.com/"), /لا يعمل/);
});

test("pages in the old Turkish and Arabic encodings are decoded correctly", () => {
  const cp1254 = new Uint8Array([0x3c, 0x70, 0x3e, 0xdd, 0x6c, 0x65, 0x74, 0x69, 0xfe, 0x69, 0x6d, 0x3c, 0x2f, 0x70, 0x3e]); // <p>İletişim</p> in windows-1254
  assert.equal(decodeBody(cp1254, "text/html; charset=windows-1254"), "<p>İletişim</p>");
  const metaOnly = new Uint8Array([...new TextEncoder().encode('<meta charset="windows-1254"><p>'), 0xdd, 0x3c, 0x2f, 0x70, 0x3e]);
  assert.match(decodeBody(metaOnly, "text/html"), /<p>İ<\/p>/);
  assert.equal(decodeBody(new TextEncoder().encode("<p>عيادة</p>"), "text/html"), "<p>عيادة</p>");
  assert.equal(decodeBody(new TextEncoder().encode("x"), "text/html; charset=nonsense-9"), "x");
});
