/**
 * Turns an organization's CRM conversion events into Meta Conversions API events («CRM leads»): the
 * stage that marks a qualified lead, a booking or a sale, and the lead-quality score of the stage.
 * Phone numbers are sent only as SHA-256 hashes, as Meta requires.
 */
import { looksLikeLid } from "../campaigns/audience-file.ts";

export type ConversionEventRow = {
  id: string;
  opportunity_id: string;
  contact_id: string | null;
  stage_name: string;
  event_kind: string;
  is_first_for_goal: boolean;
  value: number | string | null;
  currency: string | null;
  attribution: Record<string, unknown> | null;
  quality_level: string | null;
  quality_score: number | null;
  is_quality_signal: boolean;
  contact_phone: string | null;
  occurred_at: string;
};

/** What the CRM knows about the person, sent hashed so Meta can match the event to an account. */
export type ContactInfo = { name?: string | null; email?: string | null; country?: string | null; city?: string | null };

/** Meta's normalisation: lower case, trimmed, no punctuation or spaces inside the value. */
const clean = (value: string) => value.toLowerCase().replace(/[\s.,'"()\-_]+/g, "");

/** Meta accepts events up to 7 days old. */
export const META_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const GOAL_EVENTS: Record<string, string> = { qualified_lead: "Lead", booking: "Schedule", purchase: "Purchase" };

export async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Digits with the country code, or null for WhatsApp internal ids and short numbers. */
export function metaPhone(raw: string | null): string | null {
  const digits = String(raw ?? "").split("@")[0].replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 8 || digits.length > 15 || looksLikeLid(digits)) return null;
  return digits;
}

/** The Meta events for one conversion row (a row can be both a goal and a quality signal). */
export async function metaEventsFor(row: ConversionEventRow, contact: ContactInfo = {}) {
  const time = Math.floor(new Date(row.occurred_at).getTime() / 1000);
  const phone = metaPhone(row.contact_phone);
  const fbclid = typeof row.attribution?.fbclid === "string" ? row.attribution.fbclid : null;
  const [first, ...rest] = String(contact.name ?? "").trim().split(/\s+/).filter(Boolean);
  const email = String(contact.email ?? "").trim().toLowerCase();
  const country = String(contact.country ?? "").trim().toLowerCase();
  const city = clean(String(contact.city ?? ""));
  const userData: Record<string, unknown> = {
    external_id: [await sha256(row.contact_id ?? row.opportunity_id)],
    ...(phone ? { ph: [await sha256(phone)] } : {}),
    ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { em: [await sha256(email)] } : {}),
    ...(first ? { fn: [await sha256(clean(first))] } : {}),
    ...(rest.length ? { ln: [await sha256(clean(rest.join("")))] } : {}),
    ...(/^[a-z]{2}$/.test(country) ? { country: [await sha256(country)] } : {}),
    ...(city ? { ct: [await sha256(city)] } : {}),
    ...(fbclid ? { fbc: `fb.1.${time * 1000}.${fbclid}` } : {}),
  };
  const base = { event_time: time, action_source: "system_generated", user_data: userData };
  const crm = { event_source: "crm", lead_event_source: "NovaSales", stage_name: row.stage_name };
  const events: Record<string, unknown>[] = [];
  const goal = row.is_first_for_goal ? GOAL_EVENTS[row.event_kind] : undefined;
  if (goal) {
    const value = row.value == null ? null : Number(row.value);
    events.push({
      ...base,
      event_name: goal,
      event_id: `${row.id}:${row.event_kind}`,
      custom_data: {
        ...crm,
        ...(goal === "Purchase" || value != null ? { value: value ?? 0, currency: (row.currency || "USD").toUpperCase() } : {}),
      },
    });
  }
  if (row.is_quality_signal && row.quality_level)
    events.push({
      ...base,
      event_name: "LeadQuality",
      event_id: `${row.id}:quality`,
      custom_data: { ...crm, lead_quality: row.quality_level, quality_score: row.quality_score ?? 0 },
    });
  return events;
}
