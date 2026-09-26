// Event bus over the existing `domain_events` table.
// Publishes to DB and dispatches to Workflow Engine.
import { DomainEventSchema, type DomainEvent } from "./types";

export async function publishEvent(event: DomainEvent): Promise<void> {
  const parsed = DomainEventSchema.parse(event);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: inserted, error } = await db.from("domain_events").insert({
    organization_id: parsed.organizationId ?? null,
    event_type: parsed.type,
    aggregate_type: parsed.aggregateType ?? null,
    aggregate_id: parsed.aggregateId ?? null,
    actor_user_id: parsed.actorUserId ?? null,
    payload: parsed.payload,
  }).select("id").single();
  if (error) throw new Error(error.message);

  // Dispatch to workflow engine (best-effort)
  if (parsed.organizationId) {
    try {
      const { dispatchEvent } = await import("@/modules/workflow/dispatch.server");
      await dispatchEvent({
        id: inserted?.id,
        organizationId: parsed.organizationId,
        type: parsed.type,
        payload: parsed.payload,
      });
    } catch (e) {
      console.error("[event.bus] dispatch failed", e);
    }

    // Fan out to outbound webhooks (best-effort)
    try {
      const { enqueueWebhookDeliveries } = await import("@/modules/integrations/webhooks.server");
      await enqueueWebhookDeliveries(parsed.organizationId, parsed.type, {
        organization_id: parsed.organizationId,
        aggregate_type: parsed.aggregateType,
        aggregate_id: parsed.aggregateId,
        actor_user_id: parsed.actorUserId,
        payload: parsed.payload,
      });
    } catch (e) {
      console.error("[event.bus] webhook enqueue failed", e);
    }
  }
}
