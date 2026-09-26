import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const EntityType = z.enum(["lead", "opportunity", "contact"]);
const ActivityType = z.enum(["call", "meeting", "message", "email", "note", "system", "custom"]);

export const listActivities = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({
      entityType: EntityType,
      entityId: z.string().uuid(),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { data: rows, error } = await db
      .from("crm_activities")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("entity_type", data.entityType)
      .eq("entity_id", data.entityId)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listTimeline = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({
      entityType: EntityType,
      entityId: z.string().uuid(),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { data: rows, error } = await db
      .from("crm_timeline")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("entity_type", data.entityType)
      .eq("entity_id", data.entityId)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createActivity = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      entityType: EntityType,
      entityId: z.string().uuid(),
      activityType: ActivityType,
      subject: z.string().max(200).optional(),
      body: z.string().max(5000).optional(),
      direction: z.enum(["inbound", "outbound"]).optional(),
      channel: z.string().max(50).optional(),
      occurredAt: z.string().optional(),
      durationSeconds: z.number().int().min(0).optional(),
      metadata: z.record(z.unknown()).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
    const { data: row, error } = await db
      .from("crm_activities")
      .insert({
        organization_id: organizationId,
        entity_type: data.entityType,
        entity_id: data.entityId,
        activity_type: data.activityType,
        actor_user_id: userId,
        actor_type: "user",
        subject: data.subject,
        body: data.body,
        direction: data.direction,
        channel: data.channel,
        occurred_at: data.occurredAt ?? new Date().toISOString(),
        duration_seconds: data.durationSeconds,
        metadata: data.metadata ?? {},
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteActivity = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ activityId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { error } = await db
      .from("crm_activities")
      .delete()
      .eq("id", data.activityId)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
