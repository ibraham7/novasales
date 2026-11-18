/**
 * Finds the website and social pages of a business that Google Maps lists without them, by searching the
 * web for its name and city. A search result is only believed when it is clearly the same business:
 *  - «confirmed»: the business's own phone number appears in the result (or on the candidate site), so the
 *    page is added to the business at once;
 *  - «likely»: the name (and city) match but nothing proves it, so the page is only suggested and a person
 *    accepts or ignores it. A wrong social page or website would send a message to the wrong business.
 * The search service, the page fetcher and the database are passed in, so this is tested without a network.
 */
import { MARKETING_COUNTRIES } from "./countries.ts";
import { enrichProspects, type PageFetcherLike } from "./enrich-core.ts";
import { classifyWebsite, extractPhones } from "./site-extract.ts";
import { normalizeSiteUrl } from "./url-safety.ts";

export type SearchResult = { title: string; link: string; snippet: string };
export type WebSearchLike = (query: string, options: { country: string; lang: string }) => Promise<SearchResult[]>;
export type Confidence = "confirmed" | "likely";
export type Suggestion = { url: string; confidence: Confidence };
export type Discovered = { website?: Suggestion; socials?: Record<string, Suggestion> };

export const DISCOVER_BATCH_MAX = 25;
const CONCURRENCY = 2;

/** Words that say what a business is, not which one it is. */
const GENERIC = new Set(([
  "eczane", "eczanesi", "ecz", "pharmacy", "pharmacie", "apotheke", "aptek", "apteka", "аптека", "аптеки", "clinic", "klinik", "klinigi", "dental", "dent", "dis", "agiz", "saglgi", "sagligi", "poliklinigi", "polikliniği", "hastanesi", "hospital", "medical", "center", "centre", "merkezi", "tip", "saglik", "doktor", "dr", "ltd", "sti", "ve", "and", "the", "ile",
  "صيدلية", "عيادة", "مركز", "مستشفى", "دكتور", "الدكتور", "طبية", "للاسنان", "الاسنان", "اسنان",
]).map((word) => fold(word)));

/** Lower case, Turkish letters and accents flattened, Arabic marks removed: «Şişli Eczanesi» → «sisli eczanesi». */
export function fold(text: string): string {
  return String(text ?? "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

/** The words of a name that tell this business apart from the others of its kind. */
export function nameTokens(name: string): string[] {
  const tokens = fold(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !GENERIC.has(t));
  return [...new Set(tokens)];
}

const digitsOf = (text: string) => String(text ?? "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/\D/g, "");

/** The business's own number appears in this text, however it is written (its last 9 digits). */
export function mentionsPhone(text: string, phone: string | null | undefined): boolean {
  const own = digitsOf(phone ?? "");
  if (own.length < 9) return false;
  return digitsOf(text).includes(own.slice(-9));
}

/** The part of a social address that names the account (instagram.com/«handle»). */
const handleOf = (link: string) => {
  try {
    return decodeURIComponent(new URL(link).pathname.split("/").filter(Boolean)[0] ?? "");
  } catch {
    return "";
  }
};

export type Subject = { name: string; city: string | null; phone: string | null };

/** How sure we are that a search result is this business, or null when we are not. */
export function rateResult(subject: Subject, result: SearchResult): { confidence: Confidence; score: number } | null {
  const tokens = nameTokens(subject.name);
  if (!tokens.length) return null;
  const hay = fold(`${result.title} ${handleOf(result.link)} ${result.snippet}`);
  const hits = tokens.filter((t) => hay.includes(t)).length;
  const score = hits / tokens.length;
  const phone = mentionsPhone(`${result.title} ${result.snippet}`, subject.phone);
  if (phone && hits >= 1) return { confidence: "confirmed", score };
  const city = subject.city ? fold(subject.city) : "";
  const cityHit = city.length >= 3 && hay.includes(city);
  if (score >= 0.75 && (tokens.length >= 2 || cityHit)) return { confidence: "likely", score };
  return null;
}

const rank = (c: Confidence) => (c === "confirmed" ? 2 : 1);

/** Pages that list many businesses, or are social/search platforms: never a business's own website. */
const NOT_A_BUSINESS_SITE = /(^|\.)(google|bing|yandex|duckduckgo|facebook|instagram|twitter|x|tiktok|youtube|linkedin|pinterest|wikipedia|yelp|tripadvisor|foursquare|booking|sahibinden|doktortakvimi|whatclinic|zavis|bookimed|eczaneler|nobetcieczane|eczaneadresleri|yellowpages|cylex|hotfrog|mapquest|waze|apple|trustpilot|jotform|wa|t)\.(com|net|org|co|gen\.tr|com\.tr|ai|me|link)$|rehber|directory|listing|nobetci/i;

export function pickSocials(subject: Subject, results: SearchResult[]): Record<string, Suggestion> {
  const best: Record<string, { s: Suggestion; score: number }> = {};
  for (const result of results) {
    const found = classifyWebsite(result.link);
    if (!found || found.kind !== "social") continue;
    const rated = rateResult(subject, result);
    if (!rated) continue;
    const current = best[found.platform];
    if (!current || rank(rated.confidence) > rank(current.s.confidence) || (rank(rated.confidence) === rank(current.s.confidence) && rated.score > current.score)) {
      best[found.platform] = { s: { url: found.url, confidence: rated.confidence }, score: rated.score };
    }
  }
  return Object.fromEntries(Object.entries(best).map(([platform, v]) => [platform, v.s]));
}

export function pickWebsite(subject: Subject, results: SearchResult[]): { url: string; confidence: Confidence; score: number } | null {
  let best: { url: string; confidence: Confidence; score: number } | null = null;
  for (const result of results) {
    const url = normalizeSiteUrl(result.link);
    if (!url || NOT_A_BUSINESS_SITE.test(url.hostname.replace(/^www\./, ""))) continue;
    const tokens = nameTokens(subject.name);
    // the site's own address or title carries the name: a page that merely mentions the business is not its site
    const own = fold(`${url.hostname} ${result.title}`);
    if (!tokens.some((t) => own.includes(t))) continue;
    const rated = rateResult(subject, result);
    if (!rated) continue;
    if (!best || rank(rated.confidence) > rank(best.confidence) || (rank(rated.confidence) === rank(best.confidence) && rated.score > best.score)) {
      best = { url: `${url.origin}/`, confidence: rated.confidence, score: rated.score };
    }
  }
  return best;
}

const LANG: Record<string, string> = { TR: "tr", DE: "de", FR: "fr", NL: "nl", GB: "en", US: "en", CA: "en" };
const searchOptions = (country: string | null | undefined) => ({ country: (country || "TR").toLowerCase(), lang: LANG[country ?? "TR"] ?? "ar" });
const dialOf = (country: string | null | undefined) => MARKETING_COUNTRIES.find((c) => c.code === country)?.dial ?? "";

export type DiscoverSummary = {
  requested: number;
  searched: number;
  /** Added at once, because the business's own phone number proves they are its pages. */
  confirmed: number;
  /** Kept as suggestions for a person to accept. */
  suggested: number;
  /** Nothing matched safely. */
  nothingFound: number;
  /** Already has a website and both pages: nothing to search for. */
  alreadyComplete: number;
  /** The name says only what the business is («Eczane»), so a search cannot tell it from the others. */
  tooGeneric: number;
  failed: number;
  error: string | null;
};

type Row = { id: string; name: string; city: string | null; country: string | null; website: string | null; phone_e164: string | null; socials: Record<string, string> | null; discovered: Discovered | null };

export async function discoverProspects(
  db: any,
  organizationId: string,
  ids: string[],
  deps: { search: WebSearchLike; fetchPage: PageFetcherLike },
  now: Date = new Date(),
): Promise<DiscoverSummary> {
  const wanted = [...new Set(ids)].slice(0, DISCOVER_BATCH_MAX);
  const { data: rows, error } = await db.from("ob_prospects").select("id,name,city,country,website,phone_e164,socials,discovered").eq("organization_id", organizationId).in("id", wanted);
  if (error) throw new Error(error.message);
  const summary: DiscoverSummary = { requested: (rows ?? []).length, searched: 0, confirmed: 0, suggested: 0, nothingFound: 0, alreadyComplete: 0, tooGeneric: 0, failed: 0, error: null };
  const stamp = now.toISOString();
  const save = async (id: string, patch: Record<string, unknown>) => {
    const { error: saveError } = await db.from("ob_prospects").update({ ...patch, discovered_at: stamp, updated_at: stamp }).eq("organization_id", organizationId).eq("id", id);
    if (saveError) throw new Error(saveError.message);
  };

  const work = async (row: Row) => {
    const subject: Subject = { name: row.name, city: row.city, phone: row.phone_e164 };
    if (!nameTokens(row.name).length) {
      summary.tooGeneric++;
      return save(row.id, {});
    }
    const needsSocials = !row.socials?.instagram || !row.socials?.facebook;
    const needsWebsite = !row.website?.trim();
    if (!needsSocials && !needsWebsite) {
      summary.alreadyComplete++;
      return;
    }
    const options = searchOptions(row.country);
    const place = [row.name, row.city].filter(Boolean).join(" ");
    try {
      const socials: Record<string, string> = { ...(row.socials ?? {}) };
      const suggestions: Discovered = { ...(row.discovered ?? {}) };
      let confirmed = 0;
      let suggested = 0;
      let confirmedWebsite: string | null = null;

      // Social pages: one search for Instagram and Facebook together.
      if (!socials.instagram || !socials.facebook) {
        summary.searched++;
        const found = pickSocials(subject, await deps.search(`${place} (site:instagram.com OR site:facebook.com)`, options));
        for (const [platform, s] of Object.entries(found)) {
          if (socials[platform]) continue;
          if (s.confidence === "confirmed") {
            socials[platform] = s.url;
            confirmed++;
          } else {
            suggestions.socials = { ...(suggestions.socials ?? {}), [platform]: s };
            suggested++;
          }
        }
      }

      // The website, only for a business Google lists without one.
      if (!row.website?.trim()) {
        summary.searched++;
        const site = pickWebsite(subject, await deps.search(place, options));
        if (site) {
          let proven = site.confidence === "confirmed";
          if (!proven && row.phone_e164) {
            // A site that shows the business's own number is its site.
            try {
              const page = await deps.fetchPage(site.url);
              proven = extractPhones(page.html, dialOf(row.country)).includes(row.phone_e164) || mentionsPhone(page.html.replace(/<[^>]+>/g, " "), row.phone_e164);
            } catch {
              /* an unreadable candidate stays a suggestion */
            }
          }
          if (proven) {
            confirmedWebsite = site.url;
            confirmed++;
          } else {
            suggestions.website = { url: site.url, confidence: "likely" };
            suggested++;
          }
        }
      }

      if (confirmed) summary.confirmed++;
      else if (suggested) summary.suggested++;
      else summary.nothingFound++;
      await save(row.id, { socials, discovered: suggestions, ...(confirmedWebsite ? { website: confirmedWebsite, enrich_status: null } : {}) });
      // A website we are sure about is read at once, like any other.
      if (confirmedWebsite) await enrichProspects(db, organizationId, [row.id], deps.fetchPage, now);
    } catch (e) {
      summary.failed++;
      summary.error ??= e instanceof Error ? e.message : "تعذّر البحث";
    }
  };

  const queue = [...((rows ?? []) as Row[])];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let row = queue.shift(); row; row = queue.shift()) await work(row);
    }),
  );
  return summary;
}

/** A person accepts or ignores a suggested website or social page. Only this organization's business is touched. */
export async function resolveSuggestion(db: any, organizationId: string, input: { id: string; kind: "website" | "social"; platform?: string; accept: boolean }): Promise<{ ok: boolean }> {
  const { data: row, error } = await db.from("ob_prospects").select("id,website,socials,discovered").eq("organization_id", organizationId).eq("id", input.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("الجهة غير موجودة");
  const discovered: Discovered = { ...(row.discovered ?? {}) };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.kind === "website") {
    const suggestion = discovered.website;
    if (!suggestion) throw new Error("لا يوجد اقتراح");
    if (input.accept && !row.website?.trim()) {
      patch.website = suggestion.url;
      patch.enrich_status = null;
    }
    delete discovered.website;
  } else {
    const platform = input.platform ?? "";
    const suggestion = discovered.socials?.[platform];
    if (!suggestion) throw new Error("لا يوجد اقتراح");
    if (input.accept) patch.socials = { ...(row.socials ?? {}), [platform]: suggestion.url };
    const { [platform]: _removed, ...rest } = discovered.socials ?? {};
    discovered.socials = rest;
  }
  patch.discovered = discovered;
  const { error: saveError } = await db.from("ob_prospects").update(patch).eq("organization_id", organizationId).eq("id", input.id);
  if (saveError) throw new Error(saveError.message);
  return { ok: true };
}
