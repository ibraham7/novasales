/**
 * Fills a business's emails, phone numbers, social pages and WhatsApp link from its own public website.
 * The page fetcher and the database are passed in, so this is tested without a network or Supabase.
 */
import { MARKETING_COUNTRIES } from "./countries.ts";
import { classifyWebsite, detectLang, detectTech, extractContacts, mergeContacts, type SiteContacts } from "./site-extract.ts";
import { normalizeSiteUrl } from "./url-safety.ts";

export type PageFetcherLike = (url: string) => Promise<{ finalUrl: string; html: string }>;

export const ENRICH_BATCH_MAX = 25;
const CONCURRENCY = 3;
/** The home page plus at most this many more pages of one business. */
const MAX_EXTRA_PAGES = 4;
const GUESSED_PATHS = ["/contact", "/contact-us", "/iletisim", "/bize-ulasin", "/hakkimizda", "/about", "/about-us", "/en/contact", "/tr/iletisim", "/ar/contact"];

export type SiteReading = SiteContacts & { tech: string[]; lang: string | null };

/** What a business's website already gives: a way to write to it AND a way to reach it. */
const enough = (parts: SiteContacts[]) => parts.some((p) => p.emails.length) && parts.some((p) => p.whatsapp || p.phones.length);

/**
 * Home page, then the contact/about pages it links to, then a «link in bio» page it points to, then the
 * usual contact addresses, until the site has given an email and a phone or WhatsApp (never more than a few
 * pages). Only the home page must work; any other page that fails is skipped.
 */
export async function readSite(website: string, fetchPage: PageFetcherLike, dial = ""): Promise<SiteReading> {
  const start = normalizeSiteUrl(website);
  if (!start) throw new Error("عنوان الموقع غير صالح أو غير مسموح");
  const home = await fetchPage(start.toString());
  const first = extractContacts(home.html, home.finalUrl, dial);
  const parts = [first];
  const tried = new Set([home.finalUrl, start.toString()]);
  let extra = 0;
  const readExtra = async (link: string) => {
    if (extra >= MAX_EXTRA_PAGES || tried.has(link)) return;
    tried.add(link);
    extra++;
    try {
      const page = await fetchPage(link);
      parts.push(extractContacts(page.html, page.finalUrl, dial));
    } catch {
      /* a missing page is fine */
    }
  };
  for (const link of [...first.contactLinks, ...first.bioLinks]) await readExtra(link);
  if (!enough(parts)) {
    // Many sites do not link their contact page from the home page, so try the usual addresses.
    for (const path of GUESSED_PATHS) {
      if (enough(parts) || extra >= MAX_EXTRA_PAGES) break;
      await readExtra(new URL(path, home.finalUrl).toString());
    }
  }
  return { ...mergeContacts(parts, new URL(home.finalUrl).hostname), tech: detectTech(home.html), lang: detectLang(home.html) };
}

export type EnrichSummary = {
  requested: number;
  done: number;
  failed: number;
  noWebsite: number;
  withEmail: number;
  withPhone: number;
  withSocial: number;
  withWhatsapp: number;
  /** Businesses whose «website» was a social page or a chat link: kept as the contact itself. */
  fromProfileLink: number;
};

const dialOf = (country: string | null | undefined) => MARKETING_COUNTRIES.find((c) => c.code === country)?.dial ?? "";

export async function enrichProspects(db: any, organizationId: string, ids: string[], fetchPage: PageFetcherLike, now: Date = new Date()): Promise<EnrichSummary> {
  const wanted = [...new Set(ids)].slice(0, ENRICH_BATCH_MAX);
  const { data: rows, error } = await db.from("ob_prospects").select("id,website,country,phone_e164,socials,site_whatsapp").eq("organization_id", organizationId).in("id", wanted);
  if (error) throw new Error(error.message);
  const summary: EnrichSummary = { requested: (rows ?? []).length, done: 0, failed: 0, noWebsite: 0, withEmail: 0, withPhone: 0, withSocial: 0, withWhatsapp: 0, fromProfileLink: 0 };
  const stamp = now.toISOString();
  const save = async (id: string, patch: Record<string, unknown>) => {
    const { error: saveError } = await db.from("ob_prospects").update({ ...patch, enriched_at: stamp, updated_at: stamp }).eq("organization_id", organizationId).eq("id", id);
    if (saveError) throw new Error(saveError.message);
  };
  const work = async (row: { id: string; website: string | null; country: string | null; phone_e164: string | null; socials?: Record<string, string> | null; site_whatsapp?: string | null }) => {
    if (!row.website?.trim()) {
      summary.noWebsite++;
      return save(row.id, { enrich_status: "no_website", enrich_error: null });
    }
    const dial = dialOf(row.country);
    // A social page or chat link given as the «website» cannot be read, but it is itself the contact.
    const direct = classifyWebsite(row.website, dial);
    if (direct) {
      summary.done++;
      summary.fromProfileLink++;
      if (direct.kind === "social") {
        summary.withSocial++;
        return save(row.id, { socials: { ...(row.socials ?? {}), [direct.platform]: direct.url }, enrich_status: "done", enrich_error: null });
      }
      summary.withWhatsapp++;
      return save(row.id, { site_whatsapp: direct.value, enrich_status: "done", enrich_error: null });
    }
    try {
      const found = await readSite(row.website, fetchPage, dial);
      // The business's own number from Google is already known; the site's other numbers are the new ones.
      const phones = found.phones.filter((p) => p !== row.phone_e164);
      summary.done++;
      if (found.emails.length) summary.withEmail++;
      if (phones.length) summary.withPhone++;
      if (Object.keys(found.socials).length) summary.withSocial++;
      if (found.whatsapp) summary.withWhatsapp++;
      // What was already known (a page found by search, one added by hand) is kept; the site's own links win when both name a platform.
      await save(row.id, { emails: found.emails, site_phones: phones, socials: { ...(row.socials ?? {}), ...found.socials }, site_whatsapp: found.whatsapp ?? row.site_whatsapp ?? null, tech: found.tech, site_lang: found.lang, enrich_status: "done", enrich_error: null });
    } catch (e) {
      summary.failed++;
      await save(row.id, { enrich_status: "failed", enrich_error: (e instanceof Error ? e.message : "تعذّر قراءة الموقع").slice(0, 200) });
    }
  };
  const queue = [...(rows ?? [])];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let row = queue.shift(); row; row = queue.shift()) await work(row);
    }),
  );
  return summary;
}
