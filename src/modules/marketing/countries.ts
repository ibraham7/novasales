/** Countries offered in the search form: ISO code (used by Google as regionCode), Arabic name, dialing code. */
export const MARKETING_COUNTRIES = [
  { code: "TR", name: "تركيا", dial: "90" },
  { code: "SA", name: "السعودية", dial: "966" },
  { code: "AE", name: "الإمارات", dial: "971" },
  { code: "EG", name: "مصر", dial: "20" },
  { code: "SY", name: "سوريا", dial: "963" },
  { code: "JO", name: "الأردن", dial: "962" },
  { code: "LB", name: "لبنان", dial: "961" },
  { code: "IQ", name: "العراق", dial: "964" },
  { code: "KW", name: "الكويت", dial: "965" },
  { code: "QA", name: "قطر", dial: "974" },
  { code: "BH", name: "البحرين", dial: "973" },
  { code: "OM", name: "عُمان", dial: "968" },
  { code: "YE", name: "اليمن", dial: "967" },
  { code: "PS", name: "فلسطين", dial: "970" },
  { code: "MA", name: "المغرب", dial: "212" },
  { code: "DZ", name: "الجزائر", dial: "213" },
  { code: "TN", name: "تونس", dial: "216" },
  { code: "LY", name: "ليبيا", dial: "218" },
  { code: "DE", name: "ألمانيا", dial: "49" },
  { code: "GB", name: "بريطانيا", dial: "44" },
  { code: "FR", name: "فرنسا", dial: "33" },
  { code: "NL", name: "هولندا", dial: "31" },
  { code: "US", name: "الولايات المتحدة", dial: "1" },
  { code: "CA", name: "كندا", dial: "1" },
] as const;

export type MarketingCountryCode = (typeof MARKETING_COUNTRIES)[number]["code"];
export const MARKETING_COUNTRY_CODES = MARKETING_COUNTRIES.map((c) => c.code) as [MarketingCountryCode, ...MarketingCountryCode[]];

export const countryByCode = (code: string) => MARKETING_COUNTRIES.find((c) => c.code === code);
