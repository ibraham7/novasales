/** Turns the lead filters into database conditions. `query` is a Supabase query builder; every call keeps it scoped. */
import { CONTACTED_STATUSES, type Filters, type IncExc } from "./filters.ts";

/** A term made safe for a PostgREST filter string. */
export const term = (value: string) => value.replace(/[%_,()*"'\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
const terms = (values: string[]) => [...new Set(values.map(term).filter(Boolean))];
const list = (values: string[]) => values.map((v) => v.replace(/[^A-Za-z0-9_-]/g, "")).filter(Boolean);

/** Text columns that may be empty: «does not contain X» must keep the rows where the column is empty. */
function text(query: any, columns: string[], v: IncExc) {
  const inc = terms(v.include);
  const exc = terms(v.exclude);
  if (inc.length) query = query.or(inc.flatMap((t) => columns.map((c) => `${c}.ilike.%${t}%`)).join(","));
  for (const t of exc) for (const c of columns) query = query.or(`${c}.is.null,${c}.not.ilike.%${t}%`);
  return query;
}

function codes(query: any, column: string, v: IncExc, nullable: boolean) {
  const inc = list(v.include);
  const exc = list(v.exclude);
  if (inc.length) query = query.in(column, inc);
  if (exc.length) query = nullable ? query.or(`${column}.is.null,${column}.not.in.(${exc.join(",")})`) : query.not(column, "in", `(${exc.join(",")})`);
  return query;
}

export function applyProspectFilters(query: any, f: Filters) {
  const q = term(f.q);
  if (q) {
    const digits = q.replace(/\D/g, "");
    query = query.or([`name.ilike.%${q}%`, `address.ilike.%${q}%`, `category.ilike.%${q}%`, ...(digits.length >= 3 ? [`phone_e164.ilike.%${digits}%`] : [])].join(","));
  }
  query = text(query, ["name", "website"], f.name);
  query = text(query, ["city"], f.city);
  query = text(query, ["name", "category", "address"], f.keywords);
  query = codes(query, "country", f.country, true);
  query = codes(query, "status", f.status, false);

  const techIn = list(f.tech.include);
  const techOut = list(f.tech.exclude);
  if (techIn.length) query = query.overlaps("tech", techIn);
  if (techOut.length) query = query.not("tech", "ov", `{${techOut.join(",")}}`);
  const lang = list(f.lang);
  if (lang.length) query = query.in("site_lang", lang);

  if (f.minRating > 0) query = query.gte("rating", f.minRating);
  if (f.ratingsMin != null) query = query.gte("ratings_count", f.ratingsMin);
  if (f.ratingsMax != null) query = query.lte("ratings_count", f.ratingsMax);
  if (f.hasPhone) query = query.not("phone_e164", "is", null);
  if (f.mobileOnly) query = query.eq("phone_kind", "mobile");
  if (f.hasWebsite) query = query.not("website", "is", null);
  if (f.hasEmail) query = query.neq("emails", "{}");
  if (f.hasSocial) query = query.neq("socials", "{}");
  if (f.operatingOnly) query = query.eq("business_status", "OPERATIONAL");
  if (f.excludeContacted) query = query.not("status", "in", `(${CONTACTED_STATUSES.join(",")})`);
  if (f.excludeInCrm) query = query.is("promoted_contact_id", null);
  if (f.searchId) query = query.eq("search_id", f.searchId);
  return query;
}
