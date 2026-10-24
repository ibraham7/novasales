/**
 * Sends each organization's CRM conversion events to that organization's own Meta pixel through the
 * Conversions API. An organization without a Meta pixel and token sends nothing; its events stay
 * «بانتظار ربط المنصة».
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { graphBase } from "@/modules/channels/whatsapp/cloud-http";
import { openSecret } from "./secret-box.server";
import { META_MAX_AGE_MS, metaEventsFor, type ConversionEventRow } from "./meta-capi";

const db = supabaseAdmin as any;
const BATCH = 50;
const MAX_ATTEMPTS = 5;
const EVENT_COLUMNS =
  "id,opportunity_id,contact_id,stage_name,event_kind,is_first_for_goal,value,currency,attribution,quality_level,quality_score,is_quality_signal,contact_phone,occurred_at,delivery_attempts";

export type MetaConnection = { organization_id: string; pixel_id: string; access_token: string; test_event_code: string | null };

/** A Graph API call; the error is Meta's own message. */
export async function metaGraph<T = any>(path: string, token: string, body?: unknown): Promise<T> {
  const url = new URL(`${graphBase()}/${path.replace(/^\//, "")}`);
  if (!body) url.searchParams.set("access_token", token);
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    signal: AbortSignal.timeout(15000),
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: token }) } : {}),
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok || json?.error) {
    const err = json?.error ?? {};
    const message = err.error_user_msg || err.message || `HTTP ${res.status}`;
    throw Object.assign(
      new Error(err.code === 190 ? `انتهت صلاحية رمز الوصول أو أُلغي — أدخل رمزًا جديدًا (${message})` : `Meta: ${message}`),
      { metaCode: Number(err.code ?? 0) },
    );
  }
  return json as T;
}

/** Sends events to the pixel; returns how many Meta received. */
export async function sendMetaEvents(connection: MetaConnection, events: Record<string, unknown>[]) {
  const token = await openSecret(connection.access_token);
  const res = await metaGraph<{ events_received?: number }>(`${connection.pixel_id}/events`, token, {
    data: events,
    ...(connection.test_event_code ? { test_event_code: connection.test_event_code } : {}),
  });
  return res.events_received ?? 0;
}

/** Delivers the waiting events of one organization (or all connected ones). */
export async function deliverMetaConversions(organizationId?: string) {
  let query = db
    .from("org_marketing_pixels")
    .select("organization_id,pixel_id,access_token,test_event_code")
    .eq("platform", "facebook")
    .not("access_token", "is", null);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data: connections, error } = await query;
  // Before the table's migration runs there is simply nothing to send.
  if (error?.code === "PGRST205" || error?.code === "42P01") return { sent: 0, failed: 0 };
  if (error) throw new Error(error.message);
  let sent = 0;
  let failed = 0;
  for (const connection of (connections ?? []) as MetaConnection[]) {
    const oldest = new Date(Date.now() - META_MAX_AGE_MS + 60 * 60 * 1000).toISOString();
    // Events Meta would refuse as too old.
    await db
      .from("crm_conversion_events")
      .update({ delivery_state: "skipped", delivery_error: "أقدم من 7 أيام؛ Meta لا تقبله" })
      .eq("organization_id", connection.organization_id)
      .eq("delivery_state", "awaiting_connection")
      .lt("occurred_at", oldest);
    const { data: rows, error: rowsError } = await db
      .from("crm_conversion_events")
      .select(EVENT_COLUMNS)
      .eq("organization_id", connection.organization_id)
      .eq("delivery_state", "awaiting_connection")
      .gte("occurred_at", oldest)
      .order("occurred_at")
      .limit(BATCH);
    if (rowsError) throw new Error(rowsError.message);
    if (!rows?.length) continue;
    const ids = rows.map((r: { id: string }) => r.id);
    try {
      const events = (await Promise.all(rows.map((r: ConversionEventRow) => metaEventsFor(r)))).flat();
      if (events.length) await sendMetaEvents(connection, events);
      await db
        .from("crm_conversion_events")
        .update({ delivery_state: "sent", delivered_at: new Date().toISOString(), delivery_error: null })
        .in("id", ids);
      sent += rows.length;
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      // A bad token is the connection's fault, not the events': they wait for a new token.
      const tokenProblem = /رمز الوصول/.test(message);
      for (const row of rows as { id: string; delivery_attempts: number }[]) {
        const attempts = (row.delivery_attempts ?? 0) + (tokenProblem ? 0 : 1);
        await db
          .from("crm_conversion_events")
          .update({
            delivery_attempts: attempts,
            delivery_error: message,
            ...(attempts >= MAX_ATTEMPTS ? { delivery_state: "failed" } : {}),
          })
          .eq("id", row.id);
      }
      failed += rows.length;
      console.error(`[conversions] meta delivery failed org=${connection.organization_id}: ${message}`);
    }
  }
  return { sent, failed };
}
