/**
 * Sends each organization's CRM conversion events to that organization's own Snap Pixel
 * (Conversions API). An organization without a pixel id and access token sends nothing.
 * Deliveries are recorded per event in crm_conversion_deliveries (platform «snapchat»).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { openSecret } from "./secret-box.server";
import { contactInfo } from "./meta-capi.server";
import { SNAP_BASE_URL, SNAP_MAX_AGE_MS, isSnapPixelId, snapRequestsFor, type SnapEvent } from "./snapchat-capi.ts";
import type { ConversionEventRow } from "./meta-capi.ts";

const db = supabaseAdmin as any;
const BATCH = 100;
const MAX_ATTEMPTS = 5;
const EVENT_COLUMNS = "id,opportunity_id,contact_id,stage_name,event_kind,is_first_for_goal,value,currency,attribution,quality_level,quality_score,is_quality_signal,contact_phone,occurred_at";

export type SnapConnection = { organization_id: string; pixel_id: string; access_token: string };

const MISSING = new Set(["PGRST205", "42P01"]);

/** Sends one request to Snapchat (or only validates it). An HTTP error is a failure; the answer's text is kept in the error. */
export async function postSnap(connection: SnapConnection, events: SnapEvent[], validate = false): Promise<{ body: string }> {
  const token = await openSecret(connection.access_token);
  const url = new URL(`${SNAP_BASE_URL}/${encodeURIComponent(connection.pixel_id)}/events${validate ? "/validate" : ""}`);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: events }) });
  const body = (await res.text().catch(() => "")).replace(token, "***").slice(0, 400);
  if (!res.ok) throw new Error(`Snapchat: HTTP ${res.status} ${body}`.trim());
  return { body };
}

/** Delivers the waiting events of one organization (or all connected ones). */
export async function deliverSnapConversions(organizationId?: string) {
  let query = db.from("org_marketing_pixels").select("organization_id,pixel_id,access_token").eq("platform", "snapchat").not("access_token", "is", null);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data: connections, error } = await query;
  if (error && MISSING.has(error.code)) return { sent: 0, failed: 0 };
  if (error) throw new Error(error.message);
  let sent = 0;
  let failed = 0;
  for (const connection of ((connections ?? []) as SnapConnection[]).filter((c) => isSnapPixelId(c.pixel_id))) {
    const oldest = new Date(Date.now() - SNAP_MAX_AGE_MS + 60 * 60 * 1000).toISOString();
    const { data: events, error: eventsError } = await db
      .from("crm_conversion_events")
      .select(EVENT_COLUMNS)
      .eq("organization_id", connection.organization_id)
      .gte("occurred_at", oldest)
      .order("occurred_at")
      .limit(BATCH * 2);
    if (eventsError) throw new Error(eventsError.message);
    if (!events?.length) continue;
    const { data: done, error: doneError } = await db
      .from("crm_conversion_deliveries")
      .select("event_id,state,attempts")
      .eq("organization_id", connection.organization_id)
      .eq("platform", "snapchat")
      .in("event_id", events.map((e: { id: string }) => e.id));
    if (doneError) {
      if (MISSING.has(doneError.code)) return { sent, failed };
      throw new Error(doneError.message);
    }
    const state = new Map<string, { state: string; attempts: number }>((done ?? []).map((d: any) => [d.event_id, d]));
    const rows = (events as (ConversionEventRow & { id: string })[]).filter((e) => {
      const d = state.get(e.id);
      return !d || (d.state === "failed" && d.attempts < MAX_ATTEMPTS);
    }).slice(0, BATCH);
    if (!rows.length) continue;
    const people = await contactInfo(connection.organization_id, rows.map((r) => r.contact_id ?? ""));
    const requests = await snapRequestsFor(rows, people);
    const covered = new Set(requests.flatMap((r) => r.rowIds));
    const now = new Date().toISOString();
    // Rows that make no Snapchat event (a «new lead» or «lost» row, say) are recorded so they are not looked at again.
    const nothing = rows.filter((r) => !covered.has(r.id));
    if (nothing.length)
      await db.from("crm_conversion_deliveries").upsert(
        nothing.map((r) => ({ event_id: r.id, organization_id: connection.organization_id, platform: "snapchat", state: "skipped", attempts: 1, updated_at: now })),
        { onConflict: "event_id,platform" },
      );
    for (const { rowIds, events: snapEvents } of requests) {
      try {
        await postSnap(connection, snapEvents);
        await db.from("crm_conversion_deliveries").upsert(
          rowIds.map((id) => ({ event_id: id, organization_id: connection.organization_id, platform: "snapchat", state: "sent", attempts: (state.get(id)?.attempts ?? 0) + 1, error: null, delivered_at: now, updated_at: now })),
          { onConflict: "event_id,platform" },
        );
        sent += rowIds.length;
      } catch (e) {
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        await db.from("crm_conversion_deliveries").upsert(
          rowIds.map((id) => ({ event_id: id, organization_id: connection.organization_id, platform: "snapchat", state: "failed", attempts: (state.get(id)?.attempts ?? 0) + 1, error: message, updated_at: now })),
          { onConflict: "event_id,platform" },
        );
        failed += rowIds.length;
        console.error(`[conversions] snapchat delivery failed org=${connection.organization_id}: ${message}`);
      }
    }
  }
  return { sent, failed };
}
