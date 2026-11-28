/**
 * Sends each organization's CRM conversion events to that organization's own Google Analytics 4 property
 * (Measurement Protocol). An organization without a GA4 Measurement ID and API secret sends nothing.
 * Deliveries are recorded per event in crm_conversion_deliveries (platform «google»).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { openSecret } from "./secret-box.server";
import { contactInfo } from "./meta-capi.server";
import { GA4_COLLECT_URL, GA4_DEBUG_URL, GA4_MAX_AGE_MS, ga4RequestsFor, isGa4MeasurementId, type Ga4Request } from "./ga4-capi.ts";
import type { ConversionEventRow } from "./meta-capi.ts";

const db = supabaseAdmin as any;
const BATCH = 100;
const MAX_ATTEMPTS = 5;
const PAGE = 200;
const MAX_PAGES = 15;
const EVENT_COLUMNS = "id,opportunity_id,contact_id,stage_name,event_kind,is_first_for_goal,value,currency,attribution,quality_level,quality_score,is_quality_signal,contact_phone,occurred_at";

export type Ga4Connection = { organization_id: string; pixel_id: string; access_token: string };

const MISSING = new Set(["PGRST205", "42P01"]);

/** Sends one request to GA4. The live endpoint answers 2xx without checking anything; the debug one lists problems. */
export async function postGa4(connection: Ga4Connection, request: Ga4Request, debug = false): Promise<{ messages: { fieldPath?: string; description?: string; validationCode?: string }[] }> {
  const secret = await openSecret(connection.access_token);
  const url = new URL(debug ? GA4_DEBUG_URL : GA4_COLLECT_URL);
  url.searchParams.set("measurement_id", connection.pixel_id);
  url.searchParams.set("api_secret", secret);
  const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  if (!res.ok) throw new Error(`Google Analytics: HTTP ${res.status}`);
  if (!debug) return { messages: [] };
  const json = (await res.json().catch(() => null)) as { validationMessages?: { fieldPath?: string; description?: string; validationCode?: string }[] } | null;
  return { messages: json?.validationMessages ?? [] };
}

/** Delivers the waiting events of one organization (or all connected ones). */
export async function deliverGa4Conversions(organizationId?: string) {
  let query = db.from("org_marketing_pixels").select("organization_id,pixel_id,access_token").eq("platform", "google").not("access_token", "is", null);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data: connections, error } = await query;
  if (error && MISSING.has(error.code)) return { sent: 0, failed: 0 };
  if (error) throw new Error(error.message);
  let sent = 0;
  let failed = 0;
  for (const connection of ((connections ?? []) as Ga4Connection[]).filter((c) => isGa4MeasurementId(c.pixel_id))) {
    const oldest = new Date(Date.now() - GA4_MAX_AGE_MS + 60 * 60 * 1000).toISOString();
    // Walk the window page by page: the oldest events may all be delivered already, and the newer ones must still be reached.
    const state = new Map<string, { state: string; attempts: number }>();
    let rows: (ConversionEventRow & { id: string })[] = [];
    for (let page = 0; page < MAX_PAGES && !rows.length; page++) {
      const { data: events, error: eventsError } = await db
        .from("crm_conversion_events")
        .select(EVENT_COLUMNS)
        .eq("organization_id", connection.organization_id)
        .gte("occurred_at", oldest)
        .order("occurred_at")
        .order("id")
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (eventsError) throw new Error(eventsError.message);
      if (!events?.length) break;
      const { data: done, error: doneError } = await db
        .from("crm_conversion_deliveries")
        .select("event_id,state,attempts")
        .eq("organization_id", connection.organization_id)
        .eq("platform", "google")
        .in("event_id", events.map((e: { id: string }) => e.id));
      if (doneError) {
        if (MISSING.has(doneError.code)) return { sent, failed };
        throw new Error(doneError.message);
      }
      for (const d of done ?? []) state.set(d.event_id, d);
      rows = (events as (ConversionEventRow & { id: string })[]).filter((e) => {
        const d = state.get(e.id);
        return !d || (d.state === "failed" && d.attempts < MAX_ATTEMPTS);
      }).slice(0, BATCH);
      if (events.length < PAGE) break;
    }
    if (!rows.length) continue;
    const people = await contactInfo(connection.organization_id, rows.map((r) => r.contact_id ?? ""));
    const requests = await ga4RequestsFor(rows, people);
    const covered = new Set(requests.flatMap((r) => r.rowIds));
    const now = new Date().toISOString();
    // Rows that make no GA4 event (a «new lead» or «lost» row, say) are recorded so they are not looked at again.
    const nothing = rows.filter((r) => !covered.has(r.id));
    if (nothing.length)
      await db.from("crm_conversion_deliveries").upsert(
        nothing.map((r) => ({ event_id: r.id, organization_id: connection.organization_id, platform: "google", state: "skipped", attempts: 1, updated_at: now })),
        { onConflict: "event_id,platform" },
      );
    for (const { rowIds, request } of requests) {
      try {
        await postGa4(connection, request);
        await db.from("crm_conversion_deliveries").upsert(
          rowIds.map((id) => ({ event_id: id, organization_id: connection.organization_id, platform: "google", state: "sent", attempts: (state.get(id)?.attempts ?? 0) + 1, error: null, delivered_at: now, updated_at: now })),
          { onConflict: "event_id,platform" },
        );
        sent += rowIds.length;
      } catch (e) {
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        await db.from("crm_conversion_deliveries").upsert(
          rowIds.map((id) => ({ event_id: id, organization_id: connection.organization_id, platform: "google", state: "failed", attempts: (state.get(id)?.attempts ?? 0) + 1, error: message, updated_at: now })),
          { onConflict: "event_id,platform" },
        );
        failed += rowIds.length;
        console.error(`[conversions] ga4 delivery failed org=${connection.organization_id}: ${message}`);
      }
    }
  }
  return { sent, failed };
}
