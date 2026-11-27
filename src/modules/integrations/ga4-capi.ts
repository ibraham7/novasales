/**
 * Turns an organization's CRM conversion events into Google Analytics 4 Measurement Protocol events (the
 * organization's own GA4 property; Google Ads can import GA4 conversions). Pure: rows in, requests out.
 *
 * GA4 sees these as offline events of a user it may never have seen on the website, so they carry a stable
 * client id and, when the CRM knows them, the SHA-256 hashes of the email and phone (Google's user_data).
 * The live collect endpoint always answers 2xx and never confirms receipt; the «test» button uses the debug
 * endpoint, which does check the shape of the event.
 */
import { metaPhone, sha256, type ContactInfo, type ConversionEventRow } from "./meta-capi.ts";

/** GA4 accepts events up to 72 hours old. */
export const GA4_MAX_AGE_MS = 72 * 60 * 60 * 1000;
/** At most this many events in one request. */
export const GA4_MAX_EVENTS = 25;
export const GA4_COLLECT_URL = "https://www.google-analytics.com/mp/collect";
export const GA4_DEBUG_URL = "https://www.google-analytics.com/debug/mp/collect";

const GOAL_EVENTS: Record<string, string> = { qualified_lead: "qualify_lead", booking: "schedule_appointment", purchase: "purchase" };

export type Ga4Request = {
  client_id: string;
  user_id: string;
  user_data?: { sha256_email_address?: string[]; sha256_phone_number?: string[] };
  events: { name: string; params: Record<string, unknown>; timestamp_micros: number }[];
};

/** The Measurement ID of a GA4 data stream (a «G-» id; «AW-» tags cannot receive events). */
export const isGa4MeasurementId = (id: string) => /^G-[A-Z0-9]{4,20}$/i.test(id.trim());

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null);

/** The GA4 events of one conversion row (a row can be both a goal and a quality signal). */
export function ga4EventsFor(row: ConversionEventRow): { name: string; params: Record<string, unknown>; timestamp_micros: number }[] {
  const timestamp = new Date(row.occurred_at).getTime() * 1000;
  const attribution = row.attribution ?? {};
  const common: Record<string, unknown> = {
    engagement_time_msec: 1,
    stage_name: row.stage_name,
    ...(str(attribution.utm_source) ? { source: str(attribution.utm_source) } : {}),
    ...(str(attribution.utm_medium) ? { medium: str(attribution.utm_medium) } : {}),
    ...(str(attribution.utm_campaign) ? { campaign: str(attribution.utm_campaign) } : {}),
  };
  const events: { name: string; params: Record<string, unknown>; timestamp_micros: number }[] = [];
  const goal = row.is_first_for_goal ? GOAL_EVENTS[row.event_kind] : undefined;
  if (goal) {
    const value = row.value == null ? null : Number(row.value);
    events.push({
      name: goal,
      timestamp_micros: timestamp,
      params: {
        ...common,
        ...(goal === "purchase" || value != null ? { value: value ?? 0, currency: (row.currency || "USD").toUpperCase() } : {}),
        ...(goal === "purchase" ? { transaction_id: `${row.id}:${row.event_kind}` } : {}),
      },
    });
  }
  if (row.is_quality_signal && row.quality_level)
    events.push({ name: "lead_quality", timestamp_micros: timestamp, params: { ...common, lead_quality: row.quality_level, quality_score: row.quality_score ?? 0 } });
  return events;
}

/** One request per person (GA4 takes one client id per request), at most 25 events each. */
export async function ga4RequestsFor(rows: ConversionEventRow[], contacts: Map<string, ContactInfo>): Promise<{ rowIds: string[]; request: Ga4Request }[]> {
  const byPerson = new Map<string, ConversionEventRow[]>();
  for (const row of rows) {
    const key = row.contact_id ?? row.opportunity_id;
    byPerson.set(key, [...(byPerson.get(key) ?? []), row]);
  }
  const out: { rowIds: string[]; request: Ga4Request }[] = [];
  for (const [person, list] of byPerson) {
    const info = contacts.get(list[0]!.contact_id ?? "") ?? {};
    const email = String(info.email ?? "").trim().toLowerCase();
    const phone = metaPhone(list.find((r) => r.contact_phone)?.contact_phone ?? null);
    const userData: NonNullable<Ga4Request["user_data"]> = {
      ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { sha256_email_address: [await sha256(email)] } : {}),
      ...(phone ? { sha256_phone_number: [await sha256(`+${phone}`)] } : {}),
    };
    const pairs = list.flatMap((row) => ga4EventsFor(row).map((event) => ({ rowId: row.id, event })));
    for (let i = 0; i < pairs.length; i += GA4_MAX_EVENTS) {
      const slice = pairs.slice(i, i + GA4_MAX_EVENTS);
      out.push({
        rowIds: [...new Set(slice.map((p) => p.rowId))],
        request: {
          client_id: `novasales.${person}`,
          user_id: person,
          ...(Object.keys(userData).length ? { user_data: userData } : {}),
          events: slice.map((p) => p.event),
        },
      });
    }
  }
  return out;
}
