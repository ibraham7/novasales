/**
 * Sends each organization's CRM conversion events to that organization's own TikTok Pixel
 * (Events API). An organization without a pixel code and access token sends nothing.
 * Deliveries are recorded per event in crm_conversion_deliveries (platform «tiktok»).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { openSecret } from "./secret-box.server";
import { contactInfo } from "./meta-capi.server";
import { TIKTOK_MAX_AGE_MS, TIKTOK_TRACK_URL, isTikTokPixelCode, tiktokRequestsFor, type TikTokEvent } from "./tiktok-capi.ts";
import type { ConversionEventRow } from "./meta-capi.ts";

const db = supabaseAdmin as any;
const BATCH = 100;
const MAX_ATTEMPTS = 5;
const PAGE = 200;
const MAX_PAGES = 15;
const EVENT_COLUMNS = "id,opportunity_id,contact_id,stage_name,event_kind,is_first_for_goal,value,currency,attribution,quality_level,quality_score,is_quality_signal,contact_phone,occurred_at";

export type TikTokConnection = { organization_id: string; pixel_id: string; access_token: string; test_event_code?: string | null };

const MISSING = new Set(["PGRST205", "42P01"]);

/** Sends one request to TikTok. An HTTP error, or a non-zero «code» in the JSON answer, is a failure. */
export async function postTikTok(connection: TikTokConnection, events: TikTokEvent[], testEventCode?: string | null): Promise<{ code: number | null; message: string | null }> {
  const token = await openSecret(connection.access_token);
  const res = await fetch(TIKTOK_TRACK_URL, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", "Access-Token": token },
    body: JSON.stringify({ event_source: "web", event_source_id: connection.pixel_id, ...(testEventCode ? { test_event_code: testEventCode } : {}), data: events }),
  });
  const json = (await res.json().catch(() => null)) as { code?: number; message?: string } | null;
  const code = typeof json?.code === "number" ? json.code : null;
  const message = json?.message ?? null;
  if (!res.ok || (code != null && code !== 0)) throw new Error(`TikTok: ${message ?? `HTTP ${res.status}`}${code ? ` (code ${code})` : ""}`);
  return { code, message };
}

/** Delivers the waiting events of one organization (or all connected ones). */
export async function deliverTikTokConversions(organizationId?: string) {
  let query = db.from("org_marketing_pixels").select("organization_id,pixel_id,access_token,test_event_code").eq("platform", "tiktok").not("access_token", "is", null);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data: connections, error } = await query;
  if (error && MISSING.has(error.code)) return { sent: 0, failed: 0 };
  if (error) throw new Error(error.message);
  let sent = 0;
  let failed = 0;
  for (const connection of ((connections ?? []) as TikTokConnection[]).filter((c) => isTikTokPixelCode(c.pixel_id))) {
    const oldest = new Date(Date.now() - TIKTOK_MAX_AGE_MS + 60 * 60 * 1000).toISOString();
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
        .eq("platform", "tiktok")
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
    const requests = await tiktokRequestsFor(rows, people);
    const covered = new Set(requests.flatMap((r) => r.rowIds));
    const now = new Date().toISOString();
    // Rows that make no TikTok event (a «new lead» or «lost» row, say) are recorded so they are not looked at again.
    const nothing = rows.filter((r) => !covered.has(r.id));
    if (nothing.length)
      await db.from("crm_conversion_deliveries").upsert(
        nothing.map((r) => ({ event_id: r.id, organization_id: connection.organization_id, platform: "tiktok", state: "skipped", attempts: 1, updated_at: now })),
        { onConflict: "event_id,platform" },
      );
    for (const { rowIds, events: tiktokEvents } of requests) {
      try {
        await postTikTok(connection, tiktokEvents, connection.test_event_code);
        await db.from("crm_conversion_deliveries").upsert(
          rowIds.map((id) => ({ event_id: id, organization_id: connection.organization_id, platform: "tiktok", state: "sent", attempts: (state.get(id)?.attempts ?? 0) + 1, error: null, delivered_at: now, updated_at: now })),
          { onConflict: "event_id,platform" },
        );
        sent += rowIds.length;
      } catch (e) {
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        await db.from("crm_conversion_deliveries").upsert(
          rowIds.map((id) => ({ event_id: id, organization_id: connection.organization_id, platform: "tiktok", state: "failed", attempts: (state.get(id)?.attempts ?? 0) + 1, error: message, updated_at: now })),
          { onConflict: "event_id,platform" },
        );
        failed += rowIds.length;
        console.error(`[conversions] tiktok delivery failed org=${connection.organization_id}: ${message}`);
      }
    }
  }
  return { sent, failed };
}
