/**
 * The places in the system where something happens that people should hear about. Each function
 * decides who is told and what the notification says; the call sites only pass the facts. They
 * never throw, so a problem with notifications cannot break the action that caused them.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyInBackground, notifyUsers, resolveManagerIds } from "./notify.server";
import { clip } from "./types";

const db = supabaseAdmin as any;
const safe = <T extends unknown[]>(label: string, run: (...args: T) => Promise<void>) =>
  (...args: T): void => {
    void run(...args).catch((error) => console.error(`[push] ${label} failed`, error instanceof Error ? error.message : error));
  };

async function contactName(organizationId: string, contactId?: string | null): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await db.from("crm_contacts").select("display_name,full_name").eq("organization_id", organizationId).eq("id", contactId).maybeSingle();
  return data?.display_name || data?.full_name || null;
}

/** A new customer: the person it belongs to, or the managers when nobody owns it yet. */
export const notifyNewCustomer = safe(
  "new customer",
  async (input: {
    organizationId: string;
    actorUserId?: string | null;
    entityId: string;
    name?: string | null;
    contactId?: string | null;
    ownerUserId?: string | null;
    departmentId?: string | null;
    source?: string | null;
    url?: string;
  }) => {
    const name = input.name || (await contactName(input.organizationId, input.contactId)) || "عميل جديد";
    const recipients = input.ownerUserId ? [input.ownerUserId] : await resolveManagerIds(input.organizationId, input.departmentId);
    await notifyUsers({
      organizationId: input.organizationId,
      type: "lead_created",
      userIds: recipients,
      excludeUserId: input.actorUserId,
      title: "عميل جديد",
      body: clip([name, input.source].filter(Boolean).join(" · "), 200),
      url: input.url ?? "/leads",
      tag: `customer:${input.entityId}`,
      dedupeKey: `lead_created:${input.entityId}`,
    });
  },
);

/** A customer or opportunity handed to someone: only that person is told. */
export const notifyAssignment = safe(
  "assignment",
  async (input: {
    organizationId: string;
    actorUserId?: string | null;
    toUserId: string;
    entityId: string;
    name?: string | null;
    contactId?: string | null;
    url?: string;
  }) => {
    const name = input.name || (await contactName(input.organizationId, input.contactId)) || "عميل";
    await notifyUsers({
      organizationId: input.organizationId,
      type: "assignment",
      userIds: [input.toUserId],
      excludeUserId: input.actorUserId,
      title: "تم إسناد عميل إليك",
      body: clip(name, 200),
      url: input.url ?? "/leads",
      tag: `assignment:${input.entityId}`,
      // The same hand-over is announced once, even if the request is repeated within the same minute.
      dedupeKey: `assignment:${input.entityId}:${input.toUserId}:${new Date().toISOString().slice(0, 16)}`,
    });
  },
);

const money = (total: unknown, currency: unknown) => (total == null ? "" : `${Number(total).toLocaleString("en-US")} ${currency ?? ""}`.trim());

/** A new sale: the sales person (when someone else made it) and the managers. */
export const notifySaleCreated = safe(
  "sale created",
  async (input: { organizationId: string; actorUserId?: string | null; orderId: string; salesRepUserId?: string | null; departmentId?: string | null; total?: unknown; currency?: unknown }) => {
    const managers = await resolveManagerIds(input.organizationId, input.departmentId);
    await notifyUsers({
      organizationId: input.organizationId,
      type: "sale_created",
      userIds: [...managers, ...(input.salesRepUserId ? [input.salesRepUserId] : [])],
      excludeUserId: input.actorUserId,
      title: "عملية بيع جديدة",
      body: money(input.total, input.currency) ? `الإجمالي: ${money(input.total, input.currency)}` : "تم إنشاء عملية بيع جديدة",
      url: "/sales",
      tag: `sale:${input.orderId}`,
      dedupeKey: `sale_created:${input.orderId}`,
    });
  },
);

const SALE_STATUS_TEXT = { confirmed: "تم تأكيد عملية البيع", cancelled: "تم إلغاء عملية البيع", deleted: "تم حذف عملية البيع" } as const;

/** A sale confirmed, cancelled or deleted. */
export const notifySaleStatus = safe(
  "sale status",
  async (input: { organizationId: string; actorUserId?: string | null; orderId: string; status: keyof typeof SALE_STATUS_TEXT; salesRepUserId?: string | null; departmentId?: string | null }) => {
    const managers = await resolveManagerIds(input.organizationId, input.departmentId);
    await notifyUsers({
      organizationId: input.organizationId,
      type: "sale_status",
      userIds: [...managers, ...(input.salesRepUserId ? [input.salesRepUserId] : [])],
      excludeUserId: input.actorUserId,
      title: SALE_STATUS_TEXT[input.status],
      body: "افتح المبيعات لمراجعة التفاصيل",
      url: "/sales",
      tag: `sale:${input.orderId}`,
      dedupeKey: `sale_status:${input.orderId}:${input.status}`,
    });
  },
);

/** Where a task's page is: its opportunity, lead or contact. */
export function taskUrl(entityType?: string | null, entityId?: string | null): string {
  if (entityType === "opportunity" && entityId) return `/pipeline/${entityId}`;
  if (entityType === "lead") return "/leads";
  if (entityType === "contact") return "/contacts";
  return "/dashboard";
}

/** A task given to someone: only that person is told. */
export const notifyTaskAssigned = safe(
  "task assigned",
  async (input: { organizationId: string; actorUserId?: string | null; taskId: string; title: string; assigneeUserId: string; entityType?: string | null; entityId?: string | null }) => {
    await notifyUsers({
      organizationId: input.organizationId,
      type: "task_assigned",
      userIds: [input.assigneeUserId],
      excludeUserId: input.actorUserId,
      title: "مهمة جديدة لك",
      body: clip(input.title, 200),
      url: taskUrl(input.entityType, input.entityId),
      tag: `task:${input.taskId}`,
      dedupeKey: `task_assigned:${input.taskId}:${input.assigneeUserId}`,
    });
  },
);

const handledDue = new Set<string>();

/**
 * Tasks whose time has come in the last hours and are still open: the person they are assigned to
 * is told once. Run every minute by the server's ticker.
 */
export async function notifyDueTasks(): Promise<{ checked: number }> {
  const now = Date.now();
  const { data: tasks, error } = await db
    .from("crm_tasks")
    .select("id,organization_id,assignee_user_id,title,due_at,entity_type,entity_id")
    .in("status", ["open", "in_progress"])
    .not("assignee_user_id", "is", null)
    .lte("due_at", new Date(now).toISOString())
    .gte("due_at", new Date(now - 6 * 60 * 60 * 1000).toISOString())
    .limit(200);
  if (error) {
    // Before the notifications migration or on a read problem there is nothing to do.
    if (error.code === "PGRST205" || error.code === "42P01") return { checked: 0 };
    throw new Error(error.message);
  }
  const fresh = (tasks ?? []).filter((t: any) => !handledDue.has(`${t.id}:${t.due_at}`));
  for (const task of fresh) {
    const key = `${task.id}:${task.due_at}`;
    handledDue.add(key);
    notifyInBackground({
      organizationId: task.organization_id,
      type: "task_due",
      userIds: [task.assignee_user_id],
      title: "مهمة مستحقة الآن",
      body: clip(task.title, 200),
      url: taskUrl(task.entity_type, task.entity_id),
      tag: `task:${task.id}`,
      dedupeKey: `task_due:${key}`,
      logNoDevice: true,
      urgency: "high",
      ttlSeconds: 6 * 60 * 60,
    });
  }
  if (handledDue.size > 5000) handledDue.clear();
  return { checked: fresh.length };
}
