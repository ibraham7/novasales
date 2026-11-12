import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { extractContacts, extractEmails, extractWhatsapp } from "../src/modules/marketing/site-extract.ts";
import { isBlockedHostname, isPrivateIp, normalizeSiteUrl } from "../src/modules/marketing/url-safety.ts";
import { enrichProspects, readSite } from "../src/modules/marketing/enrich-core.ts";
import { createPageFetcher } from "../src/modules/marketing/site-fetch.server.ts";

const HOME = `<html><body>
<a href="mailto:Info@Clinic.com?subject=hi">اتصل</a> <p>sales@clinic.com و logo@2x.png و you@example.com</p>
<a href="https://www.instagram.com/clinic.istanbul/?hl=en">ig</a>
<a href="https://instagram.com/p/ABC123/">post</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
<a href="https://facebook.com/clinicpage">fb</a>
<a href="https://www.tiktok.com/@clinic">tt</a>
<a href="https://www.linkedin.com/company/clinic-co/">li</a>
<a href="https://twitter.com/intent/tweet?text=x">tweet</a>
<a href="https://wa.me/905321234567?text=hello">wa</a>
<a href="/iletisim">İletişim</a><a href="/blog/post">blog</a><a href="https://other.com/contact">other</a>
</body></html>`;

test("emails: mailto and plain text, junk and image names dropped, own domain first", () => {
  assert.deepEqual(extractEmails(HOME, "www.clinic.com"), ["info@clinic.com", "sales@clinic.com"]);
  assert.deepEqual(extractEmails("اكتب لنا: a&#64;b.org", ""), ["a@b.org"]);
});

test("social pages: profiles kept, share/post links ignored, first per platform", () => {
  const c = extractContacts(HOME, "https://www.clinic.com/");
  assert.deepEqual(c.socials, {
    instagram: "https://www.instagram.com/clinic.istanbul",
    facebook: "https://www.facebook.com/clinicpage",
    tiktok: "https://www.tiktok.com/@clinic",
    linkedin: "https://www.linkedin.com/company/clinic-co",
  });
  assert.equal(c.whatsapp, "+905321234567");
  assert.deepEqual(c.contactLinks, ["https://www.clinic.com/iletisim"]);
});

test("whatsapp links in their different forms", () => {
  assert.equal(extractWhatsapp('<a href="https://api.whatsapp.com/send?phone=966501234567&text=x">'), "+966501234567");
  assert.equal(extractWhatsapp('<a href="https://api.whatsapp.com/send?text=x&amp;phone=966501234567">'), "+966501234567");
  assert.equal(extractWhatsapp("<p>no link</p>"), null);
});

test("urls: only public http(s) sites are allowed", () => {
  assert.equal(normalizeSiteUrl("clinic.com/ar")?.toString(), "https://clinic.com/ar");
  for (const bad of ["http://localhost/x", "http://127.0.0.1", "http://10.0.0.5", "http://169.254.169.254/latest", "http://[::1]/", "ftp://a.com", "https://user:pw@a.com", "https://a.com:8080", "http://intranet", "https://x.internal", "javascript:alert(1)", ""]) {
    assert.equal(normalizeSiteUrl(bad), null, bad);
  }
  assert.equal(isPrivateIp("192.168.1.1"), true);
  assert.equal(isPrivateIp("172.20.0.1"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("::ffff:10.0.0.1"), true);
  assert.equal(isPrivateIp("fd00::1"), true);
  assert.equal(isBlockedHostname("shop.example.com"), false);
});

test("the fetcher refuses private DNS answers and re-checks every redirect", async () => {
  const never = (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
  await assert.rejects(createPageFetcher({ doFetch: never, resolve: async () => ["10.0.0.7"] })("https://evil.com"), /غير مسموح/);
  const calls: string[] = [];
  const redirectToLocal = (async (url: string) => {
    calls.push(url);
    return new Response(null, { status: 302, headers: { location: "http://localhost/admin" } });
  }) as unknown as typeof fetch;
  await assert.rejects(createPageFetcher({ doFetch: redirectToLocal, resolve: async () => ["93.184.216.34"] })("https://ok.com"), /غير صالح أو غير مسموح/);
  assert.equal(calls.length, 1);
});

test("the fetcher reads html, rejects other types and caps the size", async () => {
  const resolve = async () => ["93.184.216.34"];
  const html = (async () => new Response("<p>hi</p>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch;
  assert.equal((await createPageFetcher({ doFetch: html, resolve })("https://ok.com")).html, "<p>hi</p>");
  const pdf = (async () => new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } })) as unknown as typeof fetch;
  await assert.rejects(createPageFetcher({ doFetch: pdf, resolve })("https://ok.com"), /ليس صفحة ويب/);
  const big = (async () => new Response("a".repeat(3_000_000), { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  assert.ok((await createPageFetcher({ doFetch: big, resolve })("https://ok.com")).html.length <= 1_000_000);
});

const pages: Record<string, string> = {
  "https://clinic.com/": HOME.replace("/iletisim", "/contact"),
  "https://clinic.com/contact": '<p>reach us: owner@clinic.com</p><a href="https://www.youtube.com/@clinictv">yt</a>',
};
const fakeFetch = async (url: string) => {
  const html = pages[url];
  if (!html) throw new Error("الموقع لا يستجيب");
  return { finalUrl: url, html };
};

test("readSite merges the home page with its contact page", async () => {
  const c = await readSite("clinic.com", fakeFetch);
  assert.deepEqual(c.emails, ["info@clinic.com", "sales@clinic.com", "owner@clinic.com"]);
  assert.equal(c.socials.youtube, "https://www.youtube.com/@clinictv");
  assert.equal(c.whatsapp, "+905321234567");
});

test("enrichProspects saves results per organization and marks failures and missing sites", async () => {
  const db = fakeDb({
    ob_prospects: [
      { id: "p1", organization_id: "org-1", website: "https://clinic.com/" },
      { id: "p2", organization_id: "org-1", website: null },
      { id: "p3", organization_id: "org-1", website: "https://down.com/" },
      { id: "p4", organization_id: "org-2", website: "https://clinic.com/" },
    ],
  });
  const s = await enrichProspects(db, "org-1", ["p1", "p2", "p3", "p4"], fakeFetch, new Date("2026-11-05T10:00:00Z"));
  assert.deepEqual(s, { requested: 3, done: 1, failed: 1, noWebsite: 1, withEmail: 1, withSocial: 1, withWhatsapp: 1 });
  const [p1, p2, p3, p4] = db.tables.ob_prospects;
  assert.equal(p1.enrich_status, "done");
  assert.deepEqual(p1.emails.slice(0, 1), ["info@clinic.com"]);
  assert.equal(p1.enriched_at, "2026-11-05T10:00:00.000Z");
  assert.equal(p2.enrich_status, "no_website");
  assert.deepEqual([p3.enrich_status, p3.enrich_error], ["failed", "الموقع لا يستجيب"]);
  assert.equal(p4.enrich_status, undefined); // another organization's business is never touched
});

test("technologies and the page language are read from the page source", async () => {
  const { detectTech, detectLang } = await import("../src/modules/marketing/site-extract.ts");
  const shop = `<html lang="ar-SA"><script src="https://cdn.shopify.com/s/x.js"></script><script>fbq('init','1')</script><script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script></html>`;
  assert.deepEqual(detectTech(shop).sort(), ["google_analytics", "meta_pixel", "shopify"]);
  assert.equal(detectLang(shop), "ar");
  assert.deepEqual(detectTech('<link href="/wp-content/plugins/woocommerce/a.css">').sort(), ["woocommerce", "wordpress"]);
  assert.deepEqual(detectTech("<html><body>hi</body></html>"), []);
  assert.equal(detectLang("<html><body></body></html>"), null);
});
