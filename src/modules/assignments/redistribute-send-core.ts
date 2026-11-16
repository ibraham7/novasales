/**
 * The messages an agent sends to a customer who was just redistributed to them. They are queued when the
 * button is pressed and sent by a worker one at a time per agent, slowly and only inside the working
 * hours chosen at that moment — the agents are then at their phones when a customer answers.
 * Database and sender are parameters, so this is tested without Supabase or WhatsApp.
 */
import { dayStart, decideNext, extractVariants, parseSchedule, pickVariants, scheduleProblem, type SendSchedule } from "../campaigns/send-schedule.ts";

export const DEFAULT_REDISTRIBUTE_TEMPLATE = "{مرحباً|أهلاً} {{contact_name}} 👋\nمعك {{agent_name}} من {{department_name}}. سأكمل معك بخصوص طلبك.";
export const MAX_BODY = 900;
export const SEND_BATCH = 200;
const CHUNK = 100;
const chunks = <T>(items: T[], size = CHUNK) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

export type MessagePlan = { body: string; schedule: SendSchedule };

/** A problem in the message the manager typed, in Arabic, or null. */
export function messageProblem(plan: MessagePlan): string | null {
  const body = plan.body.trim();
  if (!body) return "اكتب نص الرسالة";
  if (body.length > MAX_BODY) return `الرسالة أطول من ${MAX_BODY} حرفاً`;
  return scheduleProblem(plan.schedule);
}

export function renderTemplate(template: string, ctx: Record<string, string>, random: () => number = Math.random): string {
  const { body, options } = extractVariants(template);
  const all = { ...ctx, ...pickVariants(options, random) };
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => all[key] ?? "").trim();
}

export type QueuedMove = { ticketId: string; contactId: string | null; to: string };

export async function enqueueSends(db: any, input: { organizationId: string; actorId: string; moves: QueuedMove[]; plan: MessagePlan; now?: Date }) {
  const problem = messageProblem(input.plan);
  if (problem) throw new Error(problem);
  const runAfter = (input.now ?? new Date()).toISOString();
  const rows = input.moves
    .filter((m) => m.contactId)
    .map((m) => ({ organization_id: input.organizationId, opportunity_id: m.ticketId, contact_id: m.contactId, to_user_id: m.to, body: input.plan.body.trim(), schedule: input.plan.schedule, status: "pending", run_after: runAfter, created_by: input.actorId }));
  for (const part of chunks(rows)) {
    const { error } = await db.from("crm_redistribution_sends").insert(part);
    if (error) throw new Error(error.message);
  }
  return { queued: rows.length };
}

export type AgentInfo = { name: string; departmentName: string; orgName: string; accountId: string | null };
export type SendDeps = {
  agent: (organizationId: string, userId: string) => Promise<AgentInfo>;
  contactName: (organizationId: string, contactId: string) => Promise<string>;
  send: (input: { organizationId: string; opportunityId: string; contactId: string; accountId: string; text: string; userId: string }) => Promise<{ sent: boolean; reason?: string }>;
  now?: Date;
  random?: () => number;
};

/** One tick: for each agent with something due, at most one message, if the hours and the daily limit allow it. */
export async function runDueSends(db: any, deps: SendDeps) {
  const now = deps.now ?? new Date();
  const { data: due, error } = await db.from("crm_redistribution_sends").select("*").eq("status", "pending").lte("run_after", now.toISOString()).order("created_at", { ascending: true }).limit(SEND_BATCH);
  if (error) throw new Error(error.message);
  const firstPerAgent = new Map<string, any>();
  for (const row of due ?? []) {
    const key = `${row.organization_id}:${row.to_user_id}`;
    if (!firstPerAgent.has(key)) firstPerAgent.set(key, row);
  }
  let sent = 0;
  const finish = (id: string, patch: Record<string, unknown>) => db.from("crm_redistribution_sends").update(patch).eq("id", id);
  for (const row of firstPerAgent.values()) {
    const schedule = parseSchedule(row.schedule);
    if (!schedule) {
      await finish(row.id, { status: "failed", reason: "إعدادات الإرسال غير صالحة" });
      continue;
    }
    const { data: sentRows } = await db.from("crm_redistribution_sends").select("id").eq("organization_id", row.organization_id).eq("to_user_id", row.to_user_id).eq("status", "sent").gte("sent_at", dayStart(now, schedule.timezone).toISOString());
    const decision = decideNext(schedule, now, (sentRows ?? []).length, 0, deps.random);
    const holdAgent = (until: Date) => db.from("crm_redistribution_sends").update({ run_after: until.toISOString() }).eq("organization_id", row.organization_id).eq("to_user_id", row.to_user_id).eq("status", "pending");
    if (decision.action === "wait") {
      await holdAgent(decision.until);
      continue;
    }
    // Claim the row: only one worker may send it.
    const { data: claimed } = await db.from("crm_redistribution_sends").update({ status: "sending" }).eq("id", row.id).eq("status", "pending").select("id");
    if (!claimed?.length) continue;
    const { data: ticket } = await db.from("opp_opportunities").select("id,owner_agent_id,deleted_at").eq("id", row.opportunity_id).eq("organization_id", row.organization_id).maybeSingle();
    if (!ticket || ticket.deleted_at || ticket.owner_agent_id !== row.to_user_id) {
      await finish(row.id, { status: "skipped", reason: "تغيّر مالك التذكرة أو حُذفت" });
      continue;
    }
    const agent = await deps.agent(row.organization_id, row.to_user_id);
    if (!agent.accountId || !row.contact_id) {
      await finish(row.id, { status: "skipped", reason: agent.accountId ? "لا جهة اتصال" : "لا يوجد رقم واتساب متصل للمندوب" });
      continue;
    }
    const text = renderTemplate(row.body, { contact_name: await deps.contactName(row.organization_id, row.contact_id) || "عزيزي", agent_name: agent.name, department_name: agent.departmentName, org_name: agent.orgName }, deps.random);
    let result: { sent: boolean; reason?: string };
    try {
      result = await deps.send({ organizationId: row.organization_id, opportunityId: row.opportunity_id, contactId: row.contact_id, accountId: agent.accountId, text, userId: row.to_user_id });
    } catch (e) {
      result = { sent: false, reason: e instanceof Error ? e.message : "فشل الإرسال" };
    }
    await finish(row.id, result.sent ? { status: "sent", sent_at: now.toISOString(), reason: null } : { status: "failed", reason: String(result.reason ?? "فشل الإرسال").slice(0, 200) });
    if (result.sent) sent++;
    await holdAgent(new Date(now.getTime() + decision.gapMs));
  }
  return { processed: sent };
}
