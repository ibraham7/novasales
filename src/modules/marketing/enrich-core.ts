/**
 * Fills a business's emails, social pages and WhatsApp link from its own public website. The page
 * fetcher and the database are passed in, so this is tested without a network or Supabase.
 */
import { detectLang, detectTech, extractContacts, mergeContacts, type SiteContacts } from "./site-extract.ts";
import { normalizeSiteUrl } from "./url-safety.ts";

export type PageFetcherLike = (url: string) => Promise<{ finalUrl: string; html: string }>;

export const ENRICH_BATCH_MAX = 25;
const CONCURRENCY = 3;

/** Home page plus up to two contact/about pages of the same site. Only the home page must work. */
export type SiteReading = SiteContacts & { tech: string[]; lang: string | null };

export async function readSite(website: string, fetchPage: PageFetcherLike): Promise<SiteReading> {
  const start = normalizeSiteUrl(website);
  if (!start) throw new Error("عنوان الموقع غير صالح أو غير مسموح");
  const home = await fetchPage(start.toString());
  const first = extractContacts(home.html, home.finalUrl);
  const parts = [first];
  for (const link of first.contactLinks) {
    try {
      const page = await fetchPage(link);
      parts.push(extractContacts(page.html, page.finalUrl));
    } catch {
      /* a missing contact page is fine */
    }
  }
  return { ...mergeContacts(parts, new URL(home.finalUrl).hostname), tech: detectTech(home.html), lang: detectLang(home.html) };
}

export type EnrichSummary = { requested: number; done: number; failed: number; noWebsite: number; withEmail: number; withSocial: number; withWhatsapp: number };

export async function enrichProspects(db: any, organizationId: string, ids: string[], fetchPage: PageFetcherLike, now: Date = new Date()): Promise<EnrichSummary> {
  const wanted = [...new Set(ids)].slice(0, ENRICH_BATCH_MAX);
  const { data: rows, error } = await db.from("ob_prospects").select("id,website").eq("organization_id", organizationId).in("id", wanted);
  if (error) throw new Error(error.message);
  const summary: EnrichSummary = { requested: (rows ?? []).length, done: 0, failed: 0, noWebsite: 0, withEmail: 0, withSocial: 0, withWhatsapp: 0 };
  const stamp = now.toISOString();
  const save = async (id: string, patch: Record<string, unknown>) => {
    const { error: saveError } = await db.from("ob_prospects").update({ ...patch, enriched_at: stamp, updated_at: stamp }).eq("organization_id", organizationId).eq("id", id);
    if (saveError) throw new Error(saveError.message);
  };
  const work = async (row: { id: string; website: string | null }) => {
    if (!row.website?.trim()) {
      summary.noWebsite++;
      return save(row.id, { enrich_status: "no_website", enrich_error: null });
    }
    try {
      const found = await readSite(row.website, fetchPage);
      summary.done++;
      if (found.emails.length) summary.withEmail++;
      if (Object.keys(found.socials).length) summary.withSocial++;
      if (found.whatsapp) summary.withWhatsapp++;
      await save(row.id, { emails: found.emails, socials: found.socials, site_whatsapp: found.whatsapp, tech: found.tech, site_lang: found.lang, enrich_status: "done", enrich_error: null });
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
