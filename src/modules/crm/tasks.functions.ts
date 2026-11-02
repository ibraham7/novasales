import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

const EntityType = z.enum(["lead", "opportunity", "contact"]);
const TaskStatus = z.enum(["open", "in_progress", "done", "cancelled"]);
const TaskPriority = z.enum(["low", "normal", "high", "urgent"]);

export const listTasks = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({
      entityType: EntityType.optional(),
      entityId: z.string().uuid().optional(),
      assigneeId: z.string().uuid().optional(),
      status: TaskStatus.optional(),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(d ?? {})
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    let q = db
      .from("crm_tasks")
      .select("*")
      .eq("organization_id", organizationId)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(data.limit);
    if (data.entityType) q = q.eq("entity_type", data.entityType);
    if (data.entityId) q = q.eq("entity_id", data.entityId);
    if (data.assigneeId) q = q.eq("assignee_user_id", data.assigneeId);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createTask = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      entityType: EntityType.optional(),
      entityId: z.string().uuid().optional(),
      title: z.string().trim().min(1).max(200),
      description: z.string().max(2000).optional(),
      dueAt: z.string().optional(),
      priority: TaskPriority.default("normal"),
      assigneeUserId: z.string().uuid().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
    const { data: row, error } = await db
      .from("crm_tasks")
      .insert({
        organization_id: organizationId,
        entity_type: data.entityType,
        entity_id: data.entityId,
        title: data.title,
        description: data.description,
        due_at: data.dueAt,
        priority: data.priority,
        assignee_user_id: data.assigneeUserId,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (row.assignee_user_id) {
      void import("@/modules/notifications/events.server").then((m) =>
        m.notifyTaskAssigned({ organizationId, actorUserId: userId, taskId: row.id, title: row.title, assigneeUserId: row.assignee_user_id, entityType: row.entity_type, entityId: row.entity_id }),
      );
    }
    return row;
  });

export const updateTask = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      taskId: z.string().uuid(),
      title: z.string().max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      dueAt: z.string().nullable().optional(),
      priority: TaskPriority.optional(),
      status: TaskStatus.optional(),
      assigneeUserId: z.string().uuid().nullable().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.dueAt !== undefined) patch.due_at = data.dueAt;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.status !== undefined) {
      patch.status = data.status;
      if (data.status === "done") patch.completed_at = new Date().toISOString();
    }
    if (data.assigneeUserId !== undefined) patch.assignee_user_id = data.assigneeUserId;
    const { error } = await db.from("crm_tasks").update(patch).eq("id", data.taskId).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    if (data.assigneeUserId) {
      const { data: task } = await db.from("crm_tasks").select("id,title,entity_type,entity_id").eq("id", data.taskId).eq("organization_id", organizationId).maybeSingle();
      if (task)
        void import("@/modules/notifications/events.server").then((m) =>
          m.notifyTaskAssigned({ organizationId, actorUserId: userId, taskId: task.id, title: task.title, assigneeUserId: data.assigneeUserId!, entityType: task.entity_type, entityId: task.entity_id }),
        );
    }
    return { ok: true };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ taskId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const { error } = await db.from("crm_tasks").delete().eq("id", data.taskId).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
