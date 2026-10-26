/**
 * Sends each organization's CRM conversion events to that organization's own Meta pixel through the
 * Conversions API. An organization without a Meta pixel and token sends nothing; its events stay
 * «بانتظار ربط المنصة».
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { graphBase } from "@/modules/channels/whatsapp/cloud-http";
import { openSecret } from "./secret-box.server";
import { META_MAX_AGE_MS, metaEventsFor, type ContactInfo, type ConversionEventRow } from "./meta-capi";

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

/** Sends events to the pixel; returns how many Meta received and its trace id (for Meta support). */
export async function sendMetaEvents(connection: MetaConnection, events: Record<string, unknown>[]) {
  const token = await openSecret(connection.access_token);
  const res = await metaGraph<{ events_received?: number; fbtrace_id?: string }>(`${connection.pixel_id}/events`, token, {
    data: events,
    ...(connection.test_event_code ? { test_event_code: connection.test_event_code } : {}),
  });
  const received = res.events_received ?? 0;
  console.log(
    `[conversions] meta response org=${connection.organization_id} pixel=${connection.pixel_id} sent=${events.length} received=${received} test=${connection.test_event_code ? "yes" : "no"} trace=${res.fbtrace_id ?? "-"}`,
  );
  return { received, trace: res.fbtrace_id ?? null };
}

/** Name, email, country and city of the contacts behind the events. */
async function contactInfo(organizationId: string, contactIds: string[]): Promise<Map<string, ContactInfo>> {
  const ids = [...new Set(contactIds.filter(Boolean))];
  const info = new Map<string, ContactInfo>();
  if (!ids.length) return info;
  const [contacts, emails] = await Promise.all([
    db.from("crm_contacts").select("id,full_name,display_name,country,city").eq("organization_id", organizationId).in("id", ids),
    db.from("crm_contact_points").select("contact_id,identifier").eq("organization_id", organizationId).eq("channel_type", "email").in("contact_id", ids),
  ]);
  for (const c of contacts.data ?? []) info.set(c.id, { name: c.full_name || c.display_name, country: c.country, city: c.city });
  for (const e of emails.data ?? []) info.set(e.contact_id, { ...(info.get(e.contact_id) ?? {}), email: e.identifier });
  return info;
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
      const people = await contactInfo(connection.organization_id, rows.map((r: ConversionEventRow) => r.contact_id ?? ""));
      const events = (await Promise.all(rows.map((r: ConversionEventRow) => metaEventsFor(r, people.get(r.contact_id ?? "") ?? {})))).flat();
      if (events.length) {
        // «Sent» only when Meta itself confirms it received every event.
        const { received, trace } = await sendMetaEvents(connection, events);
        if (received < events.length) throw new Error(`Meta استلمت ${received} من ${events.length} حدث (trace ${trace ?? "-"})`);
      }
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
