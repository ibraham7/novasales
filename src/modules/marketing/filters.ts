/**
 * The lead filters: their shape, defaults, the chips shown for them, the saved-search format and the ready presets.
 * Safe for client code (no server imports); the server applies the same shape in filters-query.ts.
 */
import { MARKETING_COUNTRIES } from "./countries.ts";
import { PROSPECT_STATUS_LABELS } from "./statuses.ts";

export type IncExc = { include: string[]; exclude: string[] };
export const emptyIncExc = (): IncExc => ({ include: [], exclude: [] });

export type Filters = {
  q: string;
  name: IncExc; // company name or website domain
  country: IncExc; // ISO codes
  city: IncExc;
  keywords: IncExc; // activity and keywords: name, category, address
  tech: IncExc; // keys of TECHNOLOGIES
  lang: string[]; // site language codes
  status: IncExc;
  minRating: number;
  ratingsMin: number | null;
  ratingsMax: number | null;
  hasPhone: boolean;
  mobileOnly: boolean;
  hasWebsite: boolean;
  hasEmail: boolean;
  hasSocial: boolean;
  operatingOnly: boolean;
  excludeContacted: boolean;
  excludeInCrm: boolean;
  searchId: string;
  sort: "recent" | "rating" | "name";
};

export const EMPTY_FILTERS: Filters = {
  q: "",
  name: emptyIncExc(),
  country: emptyIncExc(),
  city: emptyIncExc(),
  keywords: emptyIncExc(),
  tech: emptyIncExc(),
  lang: [],
  status: emptyIncExc(),
  minRating: 0,
  ratingsMin: null,
  ratingsMax: null,
  hasPhone: false,
  mobileOnly: false,
  hasWebsite: false,
  hasEmail: false,
  hasSocial: false,
  operatingOnly: false,
  excludeContacted: false,
  excludeInCrm: false,
  searchId: "",
  sort: "recent",
};

/** Technologies the site reader can recognise (the technical names stay in English). */
export const TECHNOLOGIES: { key: string; label: string }[] = [
  { key: "shopify", label: "Shopify" },
  { key: "salla", label: "Salla" },
  { key: "zid", label: "Zid" },
  { key: "wordpress", label: "WordPress" },
  { key: "woocommerce", label: "WooCommerce" },
  { key: "wix", label: "Wix" },
  { key: "squarespace", label: "Squarespace" },
  { key: "magento", label: "Magento" },
  { key: "google_analytics", label: "Google Analytics" },
  { key: "google_tag_manager", label: "Google Tag Manager" },
  { key: "google_ads", label: "Google Ads" },
  { key: "meta_pixel", label: "Meta Pixel" },
  { key: "tiktok_pixel", label: "TikTok Pixel" },
  { key: "hubspot", label: "HubSpot" },
  { key: "salesforce", label: "Salesforce" },
  { key: "intercom", label: "Intercom" },
];
export const TECH_KEYS = TECHNOLOGIES.map((t) => t.key);

export const LANGUAGES: { key: string; label: string }[] = [
  { key: "ar", label: "العربية" },
  { key: "en", label: "English" },
  { key: "tr", label: "Türkçe" },
  { key: "fr", label: "Français" },
  { key: "de", label: "Deutsch" },
  { key: "es", label: "Español" },
];

export const STATUS_OPTIONS = Object.entries(PROSPECT_STATUS_LABELS).map(([key, label]) => ({ key, label }));
export const COUNTRY_OPTIONS = MARKETING_COUNTRIES.map((c) => ({ key: c.code as string, label: c.name as string }));

/** Statuses that mean «someone already talked to this business». */
export const CONTACTED_STATUSES = ["contacted", "replied", "interested", "not_interested", "converted", "opted_out"];

/**
 * Filters that need data this system does not hold (people, company size, revenue, funding, intent…).
 * They are shown locked, so nobody mistakes an empty result for «nothing exists».
 */
export const LOCKED_FILTERS: { group: "people" | "company" | "signals"; key: string; label: string }[] = [
  { group: "people", key: "job_titles", label: "المسمى الوظيفي (Job Titles)" },
  { group: "people", key: "seniority", label: "المستوى الإداري (Seniority)" },
  { group: "people", key: "departments", label: "القسم والوظيفة (Departments)" },
  { group: "people", key: "person_location", label: "موقع الشخص (Person Location)" },
  { group: "people", key: "person_name", label: "اسم الشخص (Name)" },
  { group: "people", key: "email_status", label: "حالة الإيميل (Email Status)" },
  { group: "people", key: "phone_status", label: "حالة الهاتف (Phone Status)" },
  { group: "people", key: "time_in_role", label: "المدة بالوظيفة الحالية" },
  { group: "people", key: "experience", label: "سنوات الخبرة" },
  { group: "people", key: "job_change", label: "تغيير الوظيفة مؤخراً" },
  { group: "people", key: "person_languages", label: "لغات الشخص" },
  { group: "company", key: "employees", label: "عدد الموظفين (Employees)" },
  { group: "company", key: "sic_naics", label: "أكواد SIC / NAICS" },
  { group: "company", key: "revenue", label: "الإيرادات (Revenue)" },
  { group: "company", key: "funding", label: "التمويل (Funding)" },
  { group: "company", key: "job_postings", label: "الوظائف الشاغرة (Job Postings)" },
  { group: "company", key: "headcount_growth", label: "نمو الموظفين (Headcount Growth)" },
  { group: "company", key: "founded_year", label: "سنة التأسيس (Founded Year)" },
  { group: "company", key: "lookalikes", label: "شركات مشابهة (Lookalikes)" },
  { group: "signals", key: "buying_intent", label: "نية الشراء (Buying Intent)" },
  { group: "signals", key: "signals", label: "الإشارات (Signals)" },
  { group: "signals", key: "website_visitors", label: "زوار موقعي (Website Visitors)" },
  { group: "signals", key: "lead_score", label: "تقييم العميل (Lead Score)" },
];

/* -------------------------------- helpers -------------------------------- */

export const incExcCount = (v: IncExc) => v.include.length + v.exclude.length;

export function countActiveFilters(f: Filters): number {
  return (
    Number(!!f.q.trim()) +
    [f.name, f.country, f.city, f.keywords, f.tech, f.status].filter((v) => incExcCount(v) > 0).length +
    Number(f.lang.length > 0) +
    Number(f.minRating > 0) +
    Number(f.ratingsMin != null || f.ratingsMax != null) +
    [f.hasPhone, f.mobileOnly, f.hasWebsite, f.hasEmail, f.hasSocial, f.operatingOnly, f.excludeContacted, f.excludeInCrm].filter(Boolean).length +
    Number(!!f.searchId)
  );
}

const labelOf = (list: { key: string; label: string }[], key: string) => list.find((x) => x.key === key)?.label ?? key;

export type Chip = { id: string; label: string; tone: "include" | "exclude" | "neutral"; remove: (f: Filters) => Filters };

/** One chip per active value, each able to remove itself. */
export function filterChips(f: Filters): Chip[] {
  const chips: Chip[] = [];
  const incExc = (field: "name" | "country" | "city" | "keywords" | "tech" | "status", title: string, show: (v: string) => string) => {
    for (const side of ["include", "exclude"] as const) {
      for (const value of f[field][side]) {
        chips.push({
          id: `${field}:${side}:${value}`,
          label: `${side === "exclude" ? "ليس " : ""}${title}: ${show(value)}`,
          tone: side,
          remove: (cur) => ({ ...cur, [field]: { ...cur[field], [side]: cur[field][side].filter((x) => x !== value) } }),
        });
      }
    }
  };
  if (f.q.trim()) chips.push({ id: "q", label: `بحث: ${f.q.trim()}`, tone: "neutral", remove: (c) => ({ ...c, q: "" }) });
  incExc("name", "الشركة", (v) => v);
  incExc("country", "الدولة", (v) => labelOf(COUNTRY_OPTIONS, v));
  incExc("city", "المدينة", (v) => v);
  incExc("keywords", "كلمة", (v) => v);
  incExc("tech", "التقنية", (v) => labelOf(TECHNOLOGIES, v));
  incExc("status", "الحالة", (v) => labelOf(STATUS_OPTIONS, v));
  for (const l of f.lang) chips.push({ id: `lang:${l}`, label: `لغة الموقع: ${labelOf(LANGUAGES, l)}`, tone: "include", remove: (c) => ({ ...c, lang: c.lang.filter((x) => x !== l) }) });
  if (f.minRating > 0) chips.push({ id: "minRating", label: `التقييم ${f.minRating}+`, tone: "neutral", remove: (c) => ({ ...c, minRating: 0 }) });
  if (f.ratingsMin != null || f.ratingsMax != null)
    chips.push({ id: "ratings", label: `عدد التقييمات ${f.ratingsMin ?? 0}–${f.ratingsMax ?? "∞"}`, tone: "neutral", remove: (c) => ({ ...c, ratingsMin: null, ratingsMax: null }) });
  const flags: [keyof Filters, string][] = [
    ["hasPhone", "لديه هاتف"],
    ["mobileOnly", "جوال (واتساب)"],
    ["hasWebsite", "لديه موقع"],
    ["hasEmail", "لديه إيميل"],
    ["hasSocial", "لديه حسابات تواصل"],
    ["operatingOnly", "يعمل حالياً"],
    ["excludeContacted", "استثناء من تم التواصل معهم"],
    ["excludeInCrm", "استثناء الموجودين في CRM"],
  ];
  for (const [key, label] of flags) if (f[key]) chips.push({ id: String(key), label, tone: key.startsWith("exclude") ? "exclude" : "neutral", remove: (c) => ({ ...c, [key]: false }) });
  if (f.searchId) chips.push({ id: "searchId", label: "عملية بحث محددة", tone: "neutral", remove: (c) => ({ ...c, searchId: "" }) });
  return chips;
}

/* ------------------------- saved format and the URL ------------------------- */

/** Only what differs from the defaults, so a link or a saved search stays short. */
export function compactFilters(f: Filters): Partial<Filters> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(EMPTY_FILTERS) as (keyof Filters)[]) {
    if (JSON.stringify(f[key]) !== JSON.stringify(EMPTY_FILTERS[key])) out[key] = f[key];
  }
  return out as Partial<Filters>;
}

const strings = (v: unknown, max = 50): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80).slice(0, max) : []);
const incExc = (v: any): IncExc => ({ include: strings(v?.include), exclude: strings(v?.exclude) });
const numberOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** Anything unknown or malformed (an old saved search, a hand-edited link) falls back to the default. */
export function normalizeFilters(raw: unknown): Filters {
  const v: any = raw && typeof raw === "object" ? raw : {};
  const flag = (k: string) => v[k] === true;
  return {
    q: typeof v.q === "string" ? v.q.slice(0, 80) : "",
    name: incExc(v.name),
    country: incExc(v.country),
    city: incExc(v.city),
    keywords: incExc(v.keywords),
    tech: { include: strings(v.tech?.include).filter((x) => TECH_KEYS.includes(x)), exclude: strings(v.tech?.exclude).filter((x) => TECH_KEYS.includes(x)) },
    lang: strings(v.lang).filter((x) => LANGUAGES.some((l) => l.key === x)),
    status: { include: strings(v.status?.include).filter((x) => x in PROSPECT_STATUS_LABELS), exclude: strings(v.status?.exclude).filter((x) => x in PROSPECT_STATUS_LABELS) },
    minRating: typeof v.minRating === "number" && v.minRating >= 0 && v.minRating <= 5 ? v.minRating : 0,
    ratingsMin: numberOrNull(v.ratingsMin),
    ratingsMax: numberOrNull(v.ratingsMax),
    hasPhone: flag("hasPhone"),
    mobileOnly: flag("mobileOnly"),
    hasWebsite: flag("hasWebsite"),
    hasEmail: flag("hasEmail"),
    hasSocial: flag("hasSocial"),
    operatingOnly: flag("operatingOnly"),
    excludeContacted: flag("excludeContacted"),
    excludeInCrm: flag("excludeInCrm"),
    searchId: typeof v.searchId === "string" && /^[0-9a-f-]{36}$/i.test(v.searchId) ? v.searchId : "",
    sort: v.sort === "rating" || v.sort === "name" ? v.sort : "recent",
  };
}

export const encodeFilters = (f: Filters): string => {
  const c = compactFilters(f);
  return Object.keys(c).length ? JSON.stringify(c) : "";
};
export function decodeFilters(text: string | null | undefined): Filters {
  if (!text) return EMPTY_FILTERS;
  try {
    return normalizeFilters(JSON.parse(text));
  } catch {
    return EMPTY_FILTERS;
  }
}

/* ---------------------------------- presets ---------------------------------- */

export type Preset = { id: string; name: string; filters: Filters; needsData: string[] };

/** Ready searches. Parts that need people/company data are listed in `needsData` and applied once a data source exists. */
export const PRESETS: Preset[] = [
  {
    id: "qawsan-sa",
    name: "عملاء قوسان - السعودية",
    filters: normalizeFilters({
      country: { include: ["SA"], exclude: [] },
      city: { include: ["Riyadh", "الرياض", "Jeddah", "جدة", "Dammam", "الدمام"], exclude: [] },
    }),
    needsData: ["المستوى: Owner, Founder, C-Suite, Director", "القسم: Marketing, Management", "الموظفون: 11–200", "حالة الإيميل: Verified"],
  },
];
