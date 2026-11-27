/**
 * Turns an organization's CRM conversion events into Snapchat Conversions API (v3) events for the organization's own Snap Pixel.
 * Pure: rows in, requests out. Email, phone and external id are SHA-256 hashes (phone as digits without «+»); sc_click_id is not hashed.
 *
 * Wire format: POST https://tr.snapchat.com/v3/<pixel id>/events?access_token=<token> with { data: [{ event_name, action_source,
 * event_time (seconds), user_data, custom_data }] }; the same URL ending in /events/validate only checks the request.
 * Snapchat needs a hashed email or phone (or a click id) to match an event. The event names used here (SIGN_UP, RESERVE, PURCHASE,
 * CUSTOM_EVENT_1) are not confirmed by Snapchat's script-rendered documentation: the validate button is how to check them.
 */
import { metaPhone, sha256, type ContactInfo, type ConversionEventRow } from "./meta-capi.ts";

export const SNAP_BASE_URL = "https://tr.snapchat.com/v3";
export const SNAP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SNAP_MAX_EVENTS = 100;

const GOAL_EVENTS: Record<string, string> = { qualified_lead: "SIGN_UP", booking: "RESERVE", purchase: "PURCHASE" };

export type SnapEvent = {
  event_name: string;
  action_source: "OFFLINE";
  event_time: number;
  user_data: Record<string, unknown>;
  custom_data: Record<string, unknown>;
};

/** A Snap Pixel id (a UUID). */
export const isSnapPixelId = (id: string) => /^[0-9a-f-]{20,40}$/i.test(id.trim());

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

/** The Snapchat events of one conversion row; nothing when Snapchat would have no way to match the person. */
export async function snapEventsFor(row: ConversionEventRow, info: ContactInfo = {}): Promise<SnapEvent[]> {
  const time = Math.floor(new Date(row.occurred_at).getTime() / 1000);
  const email = String(info.email ?? "").trim().toLowerCase();
  const phone = metaPhone(row.contact_phone ?? null);
  const click = str(row.attribution?.sc_click_id);
  const matching: Record<string, unknown> = {
    ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { em: await sha256(email) } : {}),
    ...(phone ? { ph: await sha256(phone) } : {}),
    ...(click ? { sc_click_id: click } : {}),
  };
  if (!Object.keys(matching).length) return [];
  const user_data = { ...matching, external_id: await sha256(row.contact_id ?? row.opportunity_id) };
  const events: SnapEvent[] = [];
  const goal = row.is_first_for_goal ? GOAL_EVENTS[row.event_kind] : undefined;
  if (goal) {
    const value = row.value == null ? null : Number(row.value);
    events.push({
      event_name: goal,
      action_source: "OFFLINE",
      event_time: time,
      user_data,
      custom_data: {
        event_id: `${row.id}:${row.event_kind}`,
        ...(goal === "PURCHASE" || value != null ? { value: value ?? 0, currency: (row.currency || "USD").toUpperCase() } : {}),
        ...(goal === "PURCHASE" ? { order_id: row.id } : {}),
      },
    });
  }
  if (row.is_quality_signal && row.quality_level)
    events.push({
      event_name: "CUSTOM_EVENT_1",
      action_source: "OFFLINE",
      event_time: time,
      user_data,
      custom_data: { event_id: `${row.id}:quality`, lead_quality: row.quality_level, quality_score: row.quality_score ?? 0 },
    });
  return events;
}

/** Requests of at most 100 events, each with the ids of the rows it covers. */
export async function snapRequestsFor(rows: ConversionEventRow[], contacts: Map<string, ContactInfo>): Promise<{ rowIds: string[]; events: SnapEvent[] }[]> {
  const pairs: { rowId: string; event: SnapEvent }[] = [];
  for (const row of rows)
    for (const event of await snapEventsFor(row, contacts.get(row.contact_id ?? "") ?? {})) pairs.push({ rowId: row.id, event });
  const out: { rowIds: string[]; events: SnapEvent[] }[] = [];
  for (let i = 0; i < pairs.length; i += SNAP_MAX_EVENTS) {
    const slice = pairs.slice(i, i + SNAP_MAX_EVENTS);
    out.push({ rowIds: [...new Set(slice.map((p) => p.rowId))], events: slice.map((p) => p.event) });
  }
  return out;
}
