import { normalizeCampaignPhone } from "../campaigns/audience-file.ts";

export type PhoneKind = "mobile" | "landline" | "unknown";

/**
 * Whether a number is probably a mobile (a WhatsApp number) from its country prefix and shape.
 * Only countries whose numbering is known are judged; any other number is «unknown», never a guess.
 */
const MOBILE_RULES: { prefix: string; length: number; mobile: RegExp }[] = [
  { prefix: "90", length: 12, mobile: /^905/ },
  { prefix: "966", length: 12, mobile: /^9665/ },
  { prefix: "971", length: 12, mobile: /^9715/ },
  { prefix: "20", length: 12, mobile: /^201/ },
  { prefix: "963", length: 12, mobile: /^9639/ },
  { prefix: "962", length: 12, mobile: /^9627[789]/ },
  { prefix: "965", length: 11, mobile: /^965[569]/ },
  { prefix: "974", length: 11, mobile: /^974[3567]/ },
];

export function phoneKind(digits: string | null): PhoneKind {
  if (!digits) return "unknown";
  const rule = MOBILE_RULES.find((r) => digits.startsWith(r.prefix) && digits.length === r.length);
  if (!rule) return "unknown";
  return rule.mobile.test(digits) ? "mobile" : "landline";
}

/** The phone Google published, as digits with the country code (or null), and its kind. */
export function prospectPhone(raw: string | null | undefined, defaultDial = ""): { e164: string | null; kind: PhoneKind } {
  const e164 = raw ? normalizeCampaignPhone(raw, defaultDial) : null;
  return { e164, kind: phoneKind(e164) };
}
