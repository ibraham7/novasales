/**
 * What happens to an event BEFORE any workflow is started by it:
 *  1. Stopping: a workflow that asked «stop me when the customer replies» (or «when the ticket moves») has its
 *     waiting runs cancelled for that ticket, so a follow-up never goes out after the customer answered or the
 *     ticket moved on.
 *  2. Understanding a short answer: an exact «إيقاف/stop» puts the number on the do-not-send list; an exact yes/no
 *     becomes an event (`messaging.reply.yes` / `.no`) that workflows can wait for. Anything unclear changes nothing.
 * It runs inside the worker (off by default), so the inbound message path itself is untouched. The database and the
 * stop-list writer are passed in, so it is tested without either.
 */
import { classifyReply } from "./reply-intent.ts";
import { type StopReason } from "./trigger-config.ts";

export type PreEvent = { id?: string; organizationId: string; type: string; payload: Record<string, any> };
export type PreDeps = { db: any; suppress: (organizationId: string, phone: string, reason: string) => Promise<void> };

const REASON_TEXT: Record<StopReason, string> = { customer_reply: "أُوقف: ردّ العميل", stage_change: "أُوقف: انتقلت التذكرة لمرحلة أخرى" };
const chunks = <T>(items: T[], size = 100) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function ticketsOfChat(db: any, organizationId: string, sessionId: string): Promise<string[]> {
  const { data } = await db.from("crm_opportunity_sessions").select("opportunity_id").eq("organization_id", organizationId).eq("session_ref", sessionId);
  return [...new Set<string>((data ?? []).map((l: any) => l.opportunity_id as string))];
}

/** Cancels the waiting runs this event tells to stop; returns how many. */
export async function cancelRunsOnEvent(db: any, evt: PreEvent): Promise<number> {
  const reason: StopReason | null = evt.type === "messaging.message.received" ? "customer_reply" : evt.type === "crm.opportunity.stage_changed" ? "stage_change" : null;
  if (!reason) return 0;
  const tickets = reason === "customer_reply" ? (evt.payload.session_id ? await ticketsOfChat(db, evt.organizationId, String(evt.payload.session_id)) : []) : evt.payload.opportunity_id ? [String(evt.payload.opportunity_id)] : [];
  if (!tickets.length) return 0;

  const { data: runs, error } = await db.from("wf_runs").select("id,workflow_id,trigger_event_id,context").eq("organization_id", evt.organizationId).in("status", ["waiting", "running"]).limit(1000);
  if (error) throw new Error("تعذر قراءة التشغيلات المنتظرة");
  const mine = (runs ?? []).filter((r: any) => r.trigger_event_id !== evt.id && tickets.includes(String(r.context?.trigger?.opportunity_id ?? "")));
  if (!mine.length) return 0;

  const wfIds = [...new Set(mine.map((r: any) => r.workflow_id as string))];
  const { data: workflows } = await db.from("wf_workflows").select("id,trigger_config").eq("organization_id", evt.organizationId).in("id", wfIds);
  const stops = new Set((workflows ?? []).filter((w: any) => Array.isArray(w.trigger_config?.stop_on) && w.trigger_config.stop_on.includes(reason)).map((w: any) => w.id as string));
  const ids = mine.filter((r: any) => stops.has(r.workflow_id)).map((r: any) => r.id as string);

  const stamp = new Date().toISOString();
  for (const part of chunks(ids)) {
    await db.from("wf_runs").update({ status: "cancelled", finished_at: stamp, next_step_id: null, error: REASON_TEXT[reason] }).eq("organization_id", evt.organizationId).in("id", part).in("status", ["waiting", "running"]);
    await db.from("wf_jobs").update({ status: "done", error: "cancelled" }).eq("organization_id", evt.organizationId).in("run_id", part).eq("status", "pending");
  }
  return ids.length;
}

/** A real phone number: plain digits, or a jid of the normal WhatsApp kind. A hidden id («…@lid») is not a number. */
const dialableDigits = (value: unknown): string | null => {
  const [id, domain] = String(value ?? "").trim().split("@");
  if (domain !== undefined && domain !== "s.whatsapp.net" && domain !== "c.us") return null;
  if (!id || /[a-zA-Z:]/.test(id)) return null;
  const d = id.replace(/\D/g, "");
  return d.length >= 7 && d.length <= 15 ? d : null;
};

/** The customer's number for a chat: the chat's own peer when it is a real number, else the ticket's customer. */
async function phoneOfChat(db: any, organizationId: string, sessionId: string, peer: unknown, tickets: string[]): Promise<string | null> {
  const own = dialableDigits(peer);
  if (own) return own;
  if (!tickets.length) return null;
  const { data: opps } = await db.from("opp_opportunities").select("contact_id").eq("organization_id", organizationId).in("id", tickets);
  const contactIds = [...new Set((opps ?? []).map((o: any) => o.contact_id).filter(Boolean))];
  if (!contactIds.length) return null;
  const { data: points } = await db.from("crm_contact_points").select("identifier").eq("organization_id", organizationId).eq("channel_type", "whatsapp").in("contact_id", contactIds);
  for (const p of points ?? []) {
    const d = dialableDigits(p.identifier);
    if (d) return d;
  }
  return null;
}

/** Acts on an exact stop / yes / no reply. Returns what it understood and whether it did something. */
export async function handleReplyIntent(deps: PreDeps, evt: PreEvent): Promise<{ intent: string; applied: boolean }> {
  if (evt.type !== "messaging.message.received") return { intent: "unknown", applied: false };
  const intent = classifyReply(evt.payload.text);
  if (intent === "unknown" || !evt.payload.session_id) return { intent, applied: false };
  const { db } = deps;
  const sessionId = String(evt.payload.session_id);
  const tickets = await ticketsOfChat(db, evt.organizationId, sessionId);
  const phone = await phoneOfChat(db, evt.organizationId, sessionId, evt.payload.peer, tickets);

  if (intent === "stop") {
    if (!phone) return { intent, applied: false };
    await deps.suppress(evt.organizationId, phone, "ردّ بكلمة إيقاف");
    return { intent, applied: true };
  }
  await db.from("domain_events").insert({
    organization_id: evt.organizationId,
    event_type: intent === "yes" ? "messaging.reply.yes" : "messaging.reply.no",
    aggregate_type: "msg_session",
    aggregate_id: sessionId,
    payload: { session_id: sessionId, opportunity_id: tickets[0] ?? null, phone, text: String(evt.payload.text ?? "").slice(0, 40) },
  });
  return { intent, applied: true };
}

export async function preDispatch(deps: PreDeps, evt: PreEvent): Promise<{ cancelled: number; reply: string }> {
  const cancelled = await cancelRunsOnEvent(deps.db, evt);
  const reply = (await handleReplyIntent(deps, evt)).intent;
  return { cancelled, reply };
}
