// Outbound webhook dispatcher — enqueues deliveries and retries with backoff.
import { createHmac } from "node:crypto";

export const AVAILABLE_EVENTS = [
  "lead.created",
  "lead.updated",
  "lead.assigned",
  "opportunity.created",
  "opportunity.stage_changed",
  "opportunity.won",
  "opportunity.lost",
  "contact.created",
  "message.received",
  "message.sent",
] as const;

export type WebhookEvent = (typeof AVAILABLE_EVENTS)[number];

/** Enqueue deliveries for all webhooks in the org listening to eventType. */
export async function enqueueWebhookDeliveries(
  organizationId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: hooks } = await db
      .from("integ_webhooks")
      .select("id, events")
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    const targets = (hooks ?? []).filter((h: any) => (h.events ?? []).includes(eventType) || (h.events ?? []).includes("*"));
    if (targets.length === 0) return;
    await db.from("integ_webhook_deliveries").insert(
      targets.map((h: any) => ({
        webhook_id: h.id,
        organization_id: organizationId,
        event_type: eventType,
        payload,
        status: "pending",
        next_retry_at: new Date().toISOString(),
      })),
    );
  } catch (e) {
    console.error("[webhooks] enqueue failed", e);
  }
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

const BACKOFF_MINUTES = [1, 5, 15, 60, 240]; // 5 attempts total

/** Process one pending delivery. Returns true on success. */
export async function deliverOne(deliveryId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: d } = await db
    .from("integ_webhook_deliveries")
    .select("*, webhook:integ_webhooks(url, secret, headers, is_active)")
    .eq("id", deliveryId)
    .maybeSingle();
  if (!d || !d.webhook || d.webhook.is_active === false) {
    await db.from("integ_webhook_deliveries").update({ status: "failed", last_error: "webhook missing or disabled" }).eq("id", deliveryId);
    return false;
  }
  const body = JSON.stringify({ event: d.event_type, delivery_id: d.id, occurred_at: d.created_at, data: d.payload });
  const signature = sign(d.webhook.secret, body);
  const started = Date.now();
  const attempt = (d.attempts ?? 0) + 1;
  try {
    const res = await fetch(d.webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-novasales-event": d.event_type,
        "x-novasales-signature": `sha256=${signature}`,
        "x-novasales-delivery-id": d.id,
        ...((d.webhook.headers as Record<string, string>) ?? {}),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text().catch(() => "");
    if (res.ok) {
      await db.from("integ_webhook_deliveries").update({
        status: "delivered",
        attempts: attempt,
        response_status: res.status,
        response_body: text.slice(0, 2000),
        delivered_at: new Date().toISOString(),
        next_retry_at: null,
      }).eq("id", deliveryId);
      return true;
    }
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  } catch (e) {
    const msg = (e as Error).message;
    const backoffIdx = Math.min(attempt - 1, BACKOFF_MINUTES.length - 1);
    const nextRetry = attempt >= BACKOFF_MINUTES.length
      ? null
      : new Date(Date.now() + BACKOFF_MINUTES[backoffIdx] * 60_000).toISOString();
    await db.from("integ_webhook_deliveries").update({
      status: attempt >= BACKOFF_MINUTES.length ? "failed" : "pending",
      attempts: attempt,
      last_error: msg,
      next_retry_at: nextRetry,
    }).eq("id", deliveryId);
    console.error(`[webhooks] delivery ${deliveryId} attempt ${attempt} failed in ${Date.now() - started}ms:`, msg);
    return false;
  }
}

/** Cron tick: pick pending deliveries and try them. */
export async function tickWebhooks(): Promise<{ processed: number; delivered: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: pending } = await db
    .from("integ_webhook_deliveries")
    .select("id")
    .eq("status", "pending")
    .lte("next_retry_at", new Date().toISOString())
    .limit(100);
  let delivered = 0;
  for (const p of (pending ?? []) as any[]) {
    const ok = await deliverOne(p.id);
    if (ok) delivered++;
  }
  return { processed: pending?.length ?? 0, delivered };
}
