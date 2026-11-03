import { countryByCode, type MarketingCountryCode } from "./countries.ts";

/** Google returns 20 places per request, and a query reaches at most about 60 through its pages. */
export const PLACES_PAGE_SIZE = 20;
export const PLACES_MAX_RESULTS = 60;
/** An estimate only: the real price is on Google's pricing page and can change. */
export const DEFAULT_PRICE_PER_1000_REQUESTS_USD = 35;

export type SearchInput = {
  /** The activity searched for, e.g. «عيادات أسنان». */
  what: string;
  keywords?: string;
  country: MarketingCountryCode;
  city?: string;
  language: "any" | "ar" | "tr" | "en";
  /** Applied after the search, to what Google returned. */
  minRating: number;
  maxResults: number;
};

/** The text Google searches: the activity, the extra words, the city and the country. */
export function buildTextQuery(input: Pick<SearchInput, "what" | "keywords" | "city" | "country">): string {
  const country = countryByCode(input.country)?.name ?? input.country;
  return [input.what, input.keywords, input.city, country]
    .map((part) => String(part ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

export const requestsFor = (maxResults: number) => Math.max(1, Math.ceil(Math.min(maxResults, PLACES_MAX_RESULTS) / PLACES_PAGE_SIZE));

export const estimateCostUsd = (requests: number, pricePer1000 = DEFAULT_PRICE_PER_1000_REQUESTS_USD) =>
  Math.round(requests * (pricePer1000 / 1000) * 10000) / 10000;
