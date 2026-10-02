import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { randomBytes } from "node:crypto";

export const listWebhooks = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { requirePermission } = await import("@/platform/rbac/rbac.server");
  const { organizationId } = await requirePermission("integrations.manage");
  const { data, error } = await (supabaseAdmin as any)
    .from("integ_webhooks")
    .select("id, name, url, events, is_active, secret, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const createWebhook = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(120),
      url: z.string().url().max(500),
      events: z.array(z.string().max(60)).min(1).max(30),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { organizationId, userId } = await requirePermission("integrations.manage");
    const secret = "whsec_" + randomBytes(24).toString("hex");
    const { data: row, error } = await (supabaseAdmin as any)
      .from("integ_webhooks")
      .insert({
        organization_id: organizationId,
        name: data.name,
        url: data.url,
        events: data.events,
        secret,
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateWebhook = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      is_active: z.boolean().optional(),
      events: z.array(z.string().max(60)).optional(),
      name: z.string().trim().min(1).max(120).optional(),
      url: z.string().url().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { organizationId } = await requirePermission("integrations.manage");
    const patch: Record<string, unknown> = {};
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    if (data.events) patch.events = data.events;
    if (data.name) patch.name = data.name;
    if (data.url) patch.url = data.url;
    const { error } = await (supabaseAdmin as any)
      .from("integ_webhooks")
      .update(patch)
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWebhook = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { organizationId } = await requirePermission("integrations.manage");
    const { error } = await (supabaseAdmin as any)
      .from("integ_webhooks")
      .delete()
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDeliveries = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ webhookId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { organizationId } = await requirePermission("integrations.manage");
    const { data: rows } = await (supabaseAdmin as any)
      .from("integ_webhook_deliveries")
      .select("id, event_type, status, attempts, response_status, last_error, delivered_at, created_at")
      .eq("webhook_id", data.webhookId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(100);
    return rows ?? [];
  });

export const retryDelivery = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ deliveryId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { deliverOne } = await import("./webhooks.server");
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { organizationId } = await requirePermission("integrations.manage");
    // ensure ownership
    const { data: row } = await (supabaseAdmin as any)
      .from("integ_webhook_deliveries")
      .select("id")
      .eq("id", data.deliveryId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!row) throw new Error("Delivery not found");
    // reset to pending then deliver
    await (supabaseAdmin as any)
      .from("integ_webhook_deliveries")
      .update({ status: "pending", next_retry_at: new Date().toISOString() })
      .eq("id", data.deliveryId);
    const ok = await deliverOne(data.deliveryId);
    return { ok };
  });

export const listAvailableEvents = createServerFn({ method: "GET" }).handler(async () => {
  const { AVAILABLE_EVENTS } = await import("./webhooks.server");
  return AVAILABLE_EVENTS;
});
