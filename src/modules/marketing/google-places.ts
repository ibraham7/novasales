/**
 * Google Places API (New): Text Search over HTTP. Nothing here touches the database, and the
 * fetch function can be replaced, so it is tested without calling Google.
 */
import { PLACES_MAX_RESULTS, PLACES_PAGE_SIZE, buildTextQuery, type SearchInput } from "./search-input.ts";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
/** Only the fields we use: the field mask decides what Google charges for. */
export const FIELD_MASK = [
  "nextPageToken",
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
].join(",");

export type FoundPlace = {
  externalId: string;
  name: string;
  category: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phoneRaw: string | null;
  website: string | null;
  mapsUrl: string | null;
  rating: number | null;
  ratingsCount: number | null;
  businessStatus: string | null;
};

export function mapPlace(raw: any): FoundPlace | null {
  const id = String(raw?.id ?? "").trim();
  const name = String(raw?.displayName?.text ?? "").trim();
  if (!id || !name) return null;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    externalId: id,
    name: name.slice(0, 200),
    category: String(raw?.primaryTypeDisplayName?.text ?? raw?.primaryType ?? "").trim().slice(0, 120) || null,
    address: String(raw?.formattedAddress ?? "").trim().slice(0, 300) || null,
    lat: num(raw?.location?.latitude),
    lng: num(raw?.location?.longitude),
    phoneRaw: String(raw?.internationalPhoneNumber ?? raw?.nationalPhoneNumber ?? "").trim().slice(0, 40) || null,
    website: String(raw?.websiteUri ?? "").trim().slice(0, 300) || null,
    mapsUrl: String(raw?.googleMapsUri ?? "").trim().slice(0, 300) || null,
    rating: num(raw?.rating),
    ratingsCount: num(raw?.userRatingCount),
    businessStatus: String(raw?.businessStatus ?? "").trim().slice(0, 40) || null,
  };
}

/** A message the user can act on, without ever including the key. */
function describeFailure(status: number, body: any): string {
  const reason = String(body?.error?.message ?? "").slice(0, 200);
  if (status === 400) return `طلب البحث غير صالح${reason ? `: ${reason}` : ""}`;
  if (status === 401 || status === 403)
    return "رفضت Google المفتاح: تأكد أن Places API (New) مفعّلة لمشروعك، وأن الفوترة مفعّلة، وأن قيود المفتاح تسمح بعنوان السيرفر";
  if (status === 429) return "تجاوزت حصة Google الحالية؛ حاول لاحقاً";
  return `خطأ من Google (${status})${reason ? `: ${reason}` : ""}`;
}

export type PlacesSearchResult = { places: FoundPlace[]; requests: number };

/**
 * Runs the search page by page until `maxResults` are collected or Google has no more. Every page
 * is one billable request, so it stops as soon as it has enough.
 */
export async function searchPlaces(
  input: SearchInput,
  apiKey: string,
  doFetch: typeof fetch = fetch,
): Promise<PlacesSearchResult> {
  const wanted = Math.min(input.maxResults, PLACES_MAX_RESULTS);
  const seen = new Set<string>();
  const places: FoundPlace[] = [];
  let pageToken: string | undefined;
  let requests = 0;
  do {
    const body: Record<string, unknown> = {
      textQuery: buildTextQuery(input),
      regionCode: input.country,
      pageSize: PLACES_PAGE_SIZE,
      ...(input.language !== "any" ? { languageCode: input.language } : {}),
      ...(pageToken ? { pageToken } : {}),
    };
    requests++;
    const response = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json: any = await response.json().catch(() => null);
    if (!response.ok) throw new Error(describeFailure(response.status, json));
    for (const raw of json?.places ?? []) {
      const place = mapPlace(raw);
      if (!place || seen.has(place.externalId)) continue;
      seen.add(place.externalId);
      places.push(place);
    }
    pageToken = typeof json?.nextPageToken === "string" && json.nextPageToken ? json.nextPageToken : undefined;
  } while (pageToken && places.length < wanted);
  return { places: places.slice(0, wanted), requests };
}
