/**
 * Saving and reading discovered businesses. The database is passed in, so this is tested without
 * Supabase. Every query is scoped to one organization.
 */
import type { FoundPlace } from "./google-places.ts";
import { blockedPhones } from "./outbound-core.ts";
import { prospectPhone } from "./phone.ts";
import type { ManualStatus } from "./statuses.ts";
import { applyProspectFilters } from "./filters-query.ts";
import type { Filters } from "./filters.ts";

export const PROVIDER = "google_places";
/** Google's data is a cache: it expires after this many days and is refreshed or removed. */
export const CACHE_DAYS = 30;
const CHUNK = 100;

const chunks = <T>(items: T[], size = CHUNK) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

const COLUMNS =
  "id,name,category,address,city,country,phone_raw,phone_e164,phone_kind,website,maps_url,rating,ratings_count,business_status,status,notes,search_id,created_at,updated_at,expires_at,emails,socials,site_whatsapp,enrich_status,enriched_at,enrich_error,tech,site_lang";

export type SaveInput = {
  organizationId: string;
  searchId: string;
  country: string;
  dial: string;
  city?: string | null;
  places: FoundPlace[];
  /** Applied here, to what Google returned. */
  minRating: number;
  now?: Date;
};

/**
 * Stores what a search found. A business already known (same Google place) is refreshed but keeps
 * its status, notes and the search that first found it; a new one is added as «new».
 */
export async function saveFoundPlaces(db: any, input: SaveInput) {
  const now = input.now ?? new Date();
  const kept = input.places.filter((p) => input.minRating <= 0 || (p.rating != null && p.rating >= input.minRating));
  const cache = (p: FoundPlace) => {
    const phone = prospectPhone(p.phoneRaw, input.dial);
    return {
      name: p.name,
      category: p.category,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      phone_raw: p.phoneRaw,
      phone_e164: phone.e164,
      phone_kind: phone.kind,
      website: p.website,
      maps_url: p.mapsUrl,
      rating: p.rating,
      ratings_count: p.ratingsCount,
      business_status: p.businessStatus,
      fetched_at: now.toISOString(),
      expires_at: new Date(now.getTime() + CACHE_DAYS * 86_400_000).toISOString(),
      updated_at: now.toISOString(),
    };
  };

  const known = new Set<string>();
  for (const part of chunks(kept.map((p) => p.externalId))) {
    const { data, error } = await db.from("ob_prospects").select("external_id").eq("organization_id", input.organizationId).eq("provider", PROVIDER).in("external_id", part);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) known.add(row.external_id);
  }

  const fresh = kept.filter((p) => !known.has(p.externalId));
  for (const part of chunks(fresh)) {
    const { error } = await db.from("ob_prospects").upsert(
      part.map((p) => ({
        organization_id: input.organizationId,
        provider: PROVIDER,
        external_id: p.externalId,
        search_id: input.searchId,
        city: input.city || null,
        country: input.country,
        ...cache(p),
      })),
      { onConflict: "organization_id,provider,external_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
  }
  for (const p of kept.filter((x) => known.has(x.externalId))) {
    const { error } = await db.from("ob_prospects").update(cache(p)).eq("organization_id", input.organizationId).eq("provider", PROVIDER).eq("external_id", p.externalId);
    if (error) throw new Error(error.message);
  }
  return { found: input.places.length, kept: kept.length, created: fresh.length, updated: known.size, filteredOut: input.places.length - kept.length };
}

export type ProspectFilters = Filters & { page: number; pageSize: number };

/** A search term safe to put inside a PostgREST filter. */
export const safeTerm = (value: string) => value.replace(/[%_,()*"'\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

export async function listProspects(db: any, organizationId: string, f: ProspectFilters) {
  let query = db.from("ob_prospects").select(COLUMNS, { count: "exact" }).eq("organization_id", organizationId);
  query = applyProspectFilters(query, f);
  query = f.sort === "rating" ? query.order("rating", { ascending: false, nullsFirst: false }) : f.sort === "name" ? query.order("name", { ascending: true }) : query.order("created_at", { ascending: false });
  const from = (f.page - 1) * f.pageSize;
  const { data, error, count } = await query.range(from, from + f.pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], total: count ?? 0 };
}

/** How many businesses are in each status (whole organization, ignoring the filters). */
export async function countByStatus(db: any, organizationId: string): Promise<Record<string, number>> {
  const { data, error } = await db.from("ob_prospects").select("status").eq("organization_id", organizationId).limit(20000);
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

/** Sets the status and/or notes of businesses of this organization; returns how many were changed. */
export async function updateProspects(db: any, organizationId: string, input: { ids: string[]; status?: ManualStatus; notes?: string }) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.status) patch.status = input.status;
  if (input.notes !== undefined) patch.notes = input.notes || null;
  const movable = ["new", "review", "qualified", "excluded", "approved", "contacted", "invalid"];
  let changed = 0;
  for (const part of chunks([...new Set(input.ids)])) {
    // Businesses that replied, are interested or were moved to the CRM are not moved by hand. A business that
    // asked to stop stays stopped while its number is on the do-not-send list; once the number is taken off, it can be moved again.
    let rest = part;
    if (input.status) {
      const released = await releasedOptOuts(db, organizationId, part);
      if (released.length) {
        const { data, error } = await db.from("ob_prospects").update(patch).eq("organization_id", organizationId).in("id", released).eq("status", "opted_out").select("id");
        if (error) throw new Error(error.message);
        changed += (data ?? []).length;
        rest = part.filter((id) => !released.includes(id));
      }
    }
    if (!rest.length) continue;
    let query = db.from("ob_prospects").update(patch).eq("organization_id", organizationId).in("id", rest);
    if (input.status) query = query.in("status", movable);
    const { data, error } = await query.select("id");
    if (error) throw new Error(error.message);
    changed += (data ?? []).length;
  }
  return changed;
}

/** Of these businesses, those marked «opted out» whose number is no longer on the do-not-send list. */
async function releasedOptOuts(db: any, organizationId: string, ids: string[]): Promise<string[]> {
  const { data, error } = await db.from("ob_prospects").select("id,phone_e164").eq("organization_id", organizationId).in("id", ids).eq("status", "opted_out");
  if (error) throw new Error(error.message);
  const rows: { id: string; phone_e164: string | null }[] = data ?? [];
  if (!rows.length) return [];
  const blocked = await blockedPhones(db, organizationId, rows.map((r) => r.phone_e164 ?? ""));
  return rows.filter((r) => !r.phone_e164 || !blocked.has(r.phone_e164)).map((r) => r.id);
}

/** How many of these businesses are stopped for good (their number is still on the do-not-send list). */
export async function countStillStopped(db: any, organizationId: string, ids: string[]): Promise<number> {
  const { data, error } = await db.from("ob_prospects").select("id,phone_e164").eq("organization_id", organizationId).in("id", [...new Set(ids)]).eq("status", "opted_out");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/**
 * Permanently deletes businesses. One that is still waiting in a campaign that has not finished
 * sending is refused, so a campaign never loses people mid-way. «Do not send» numbers stay.
 */
export async function deleteProspects(db: any, organizationId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  for (const part of chunks(unique)) {
    const { data, error } = await db.from("cmp_recipients").select("id").eq("organization_id", organizationId).in("ob_prospect_id", part).in("status", ["queued", "sending"]).limit(1);
    if (error && !["PGRST205", "42P01", "42703"].includes(error.code)) throw new Error(error.message);
    if ((data ?? []).length > 0) throw new Error("بين الجهات المحددة جهة داخل حملة لم ينته إرسالها؛ أوقف الحملة أو انتظر انتهاءها");
  }
  let deleted = 0;
  for (const part of chunks(unique)) {
    const { data, error } = await db.from("ob_prospects").delete().eq("organization_id", organizationId).in("id", part).select("id");
    if (error) throw new Error(error.message);
    deleted += (data ?? []).length;
  }
  return deleted;
}
