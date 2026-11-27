/**
 * Turns an organization's CRM conversion events into TikTok Events API events (the organization's own TikTok Pixel).
 * Pure: rows in, requests out. Email, phone and external id are sent as SHA-256 hashes; the TikTok click id (ttclid) is not hashed.
 *
 * Wire format (v1.3, POST /open_api/v1.3/event/track/, header Access-Token): { event_source: "web", event_source_id: <pixel code>,
 * test_event_code?, data: [{ event, event_time (seconds), event_id, user, properties }] }.
 * The standard event names used here and the age limit are not confirmed by TikTok's own (script-rendered) documentation:
 * the «test» button with a Test Event Code in Events Manager is how to verify them.
 */
import { metaPhone, sha256, type ContactInfo, type ConversionEventRow } from "./meta-capi.ts";

export const TIKTOK_TRACK_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
/** Events older than this are not sent (TikTok's own limit is not documented in text we could read; stay on the safe side). */
export const TIKTOK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const TIKTOK_MAX_EVENTS = 50;

const GOAL_EVENTS: Record<string, string> = { qualified_lead: "SubmitForm", booking: "Schedule", purchase: "CompletePayment" };

export type TikTokEvent = {
  event: string;
  event_time: number;
  event_id: string;
  user: Record<string, unknown>;
  properties: Record<string, unknown>;
};

/** A TikTok Pixel code (about 20 letters and digits). */
export const isTikTokPixelCode = (id: string) => /^[A-Z0-9]{10,40}$/i.test(id.trim());

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

/** The TikTok events of one conversion row (a row can be both a goal and a quality signal). */
export async function tiktokEventsFor(row: ConversionEventRow, info: ContactInfo = {}): Promise<TikTokEvent[]> {
  const time = Math.floor(new Date(row.occurred_at).getTime() / 1000);
  const email = String(info.email ?? "").trim().toLowerCase();
  const phone = metaPhone(row.contact_phone ?? null);
  const ttclid = str(row.attribution?.ttclid);
  const user: Record<string, unknown> = {
    ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { email: await sha256(email) } : {}),
    ...(phone ? { phone: await sha256(`+${phone}`) } : {}),
    external_id: await sha256(row.contact_id ?? row.opportunity_id),
    ...(ttclid ? { ttclid } : {}),
  };
  const events: TikTokEvent[] = [];
  const goal = row.is_first_for_goal ? GOAL_EVENTS[row.event_kind] : undefined;
  if (goal) {
    const value = row.value == null ? null : Number(row.value);
    events.push({
      event: goal,
      event_time: time,
      event_id: `${row.id}:${row.event_kind}`,
      user,
      properties: {
        ...(goal === "CompletePayment" || value != null ? { value: value ?? 0, currency: (row.currency || "USD").toUpperCase() } : {}),
        content_type: "product",
        ...(goal === "CompletePayment" ? { order_id: row.id } : {}),
      },
    });
  }
  if (row.is_quality_signal && row.quality_level)
    events.push({
      event: "LeadQuality",
      event_time: time,
      event_id: `${row.id}:quality`,
      user,
      properties: { lead_quality: row.quality_level, quality_score: row.quality_score ?? 0 },
    });
  return events;
}

/** Requests of at most 50 events, each with the ids of the rows it covers. */
export async function tiktokRequestsFor(rows: ConversionEventRow[], contacts: Map<string, ContactInfo>): Promise<{ rowIds: string[]; events: TikTokEvent[] }[]> {
  const pairs: { rowId: string; event: TikTokEvent }[] = [];
  for (const row of rows)
    for (const event of await tiktokEventsFor(row, contacts.get(row.contact_id ?? "") ?? {})) pairs.push({ rowId: row.id, event });
  const out: { rowIds: string[]; events: TikTokEvent[] }[] = [];
  for (let i = 0; i < pairs.length; i += TIKTOK_MAX_EVENTS) {
    const slice = pairs.slice(i, i + TIKTOK_MAX_EVENTS);
    out.push({ rowIds: [...new Set(slice.map((p) => p.rowId))], events: slice.map((p) => p.event) });
  }
  return out;
}
