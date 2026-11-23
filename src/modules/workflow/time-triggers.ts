/**
 * Time-based triggers: «the ticket stayed in a stage for X», «the customer has not answered our last message for X»,
 * «nothing has happened on the ticket for X», «a task is overdue». The database does not announce these, so a scan
 * looks for them. Each finding starts the workflow that asked for it, ONCE: the run's trigger id is made from the
 * finding itself (the ticket and the moment it entered the stage, or the message it did not answer…), and the engine
 * never starts two runs of one workflow for the same trigger id. Finding is pure (rows in, candidates out); only
 * `scanTimeTriggers` reads the database, and starting a run is passed in.
 */
import { createHash } from "node:crypto";
import { isTimeEvent, type TimeEvent } from "./trigger-config.ts";

const MIN = 60_000;
const DAY = 86_400_000;
export type Candidate = { key: string; payload: Record<string, unknown> };

/** The same text always gives the same id (a UUID v5-shaped value), so a finding can be recognised again. */
export function eventUuid(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const stageEntered = (o: any): string | null => o.stage_entered_at ?? o.updated_at ?? o.opened_at ?? null;
const open = (o: any) => !o.deleted_at && !o.outcome;
const ticketPayload = (o: any, extra: Record<string, unknown>) => ({ opportunity_id: o.id, contact_id: o.contact_id ?? null, owner_user_id: o.owner_agent_id ?? null, stage_id: o.stage_id ?? null, source: o.source ?? null, ...extra });

export function stageTimeoutCandidates(opps: any[], now: Date, afterMinutes: number, stageId?: string | null): Candidate[] {
  const out: Candidate[] = [];
  for (const o of opps) {
    if (!open(o) || (stageId && o.stage_id !== stageId)) continue;
    const entered = stageEntered(o);
    if (!entered) continue;
    const minutes = (now.getTime() - new Date(entered).getTime()) / MIN;
    if (minutes < afterMinutes) continue;
    out.push({ key: `stage_timeout:${o.id}:${o.stage_id}:${entered}`, payload: ticketPayload(o, { minutes_in_stage: Math.floor(minutes) }) });
  }
  return out;
}

export type LastMessage = { id: string; session_id: string; direction: string; created_at: string };

/** The newest message of each chat. */
export function lastBySession(messages: LastMessage[]): Map<string, LastMessage> {
  const last = new Map<string, LastMessage>();
  for (const m of messages) {
    const have = last.get(m.session_id);
    if (!have || m.created_at > have.created_at) last.set(m.session_id, m);
  }
  return last;
}

/** Tickets whose chat's newest message is OURS and older than the wait: the customer has not answered. */
export function noReplyCandidates(opps: any[], links: { opportunity_id: string; session_ref: string }[], last: Map<string, LastMessage>, now: Date, afterMinutes: number, stageId?: string | null): Candidate[] {
  const out: Candidate[] = [];
  const sessionsOf = new Map<string, string[]>();
  for (const l of links) sessionsOf.set(l.opportunity_id, [...(sessionsOf.get(l.opportunity_id) ?? []), l.session_ref]);
  for (const o of opps) {
    if (!open(o) || (stageId && o.stage_id !== stageId)) continue;
    // The ticket's newest message across its chats.
    const newest = (sessionsOf.get(o.id) ?? []).map((s) => last.get(s)).filter(Boolean).sort((a, b) => b!.created_at.localeCompare(a!.created_at))[0];
    if (!newest || newest.direction !== "outbound") continue;
    const minutes = (now.getTime() - new Date(newest.created_at).getTime()) / MIN;
    if (minutes < afterMinutes) continue;
    out.push({ key: `no_reply:${o.id}:${newest.id}`, payload: ticketPayload(o, { minutes_without_reply: Math.floor(minutes), last_message_id: newest.id }) });
  }
  return out;
}

/** Tickets with no stage move, no update and no message for the wait. */
export function staleCandidates(opps: any[], lastMessageAt: Map<string, string | null>, now: Date, afterMinutes: number, stageId?: string | null): Candidate[] {
  const out: Candidate[] = [];
  for (const o of opps) {
    if (!open(o) || (stageId && o.stage_id !== stageId)) continue;
    const activity = [stageEntered(o), lastMessageAt.get(o.id) ?? null].filter(Boolean).sort().pop();
    if (!activity) continue;
    const minutes = (now.getTime() - new Date(activity).getTime()) / MIN;
    if (minutes < afterMinutes) continue;
    out.push({ key: `stale:${o.id}:${activity}`, payload: ticketPayload(o, { days_without_activity: Math.floor(minutes / 1440) }) });
  }
  return out;
}

export function overdueTaskCandidates(tasks: any[], now: Date, graceMinutes: number): Candidate[] {
  const out: Candidate[] = [];
  for (const t of tasks) {
    if (t.status !== "open" || !t.due_at) continue;
    if ((now.getTime() - new Date(t.due_at).getTime()) / MIN < graceMinutes) continue;
    out.push({
      key: `task_overdue:${t.id}:${t.due_at}`,
      payload: { task_id: t.id, task_title: t.title ?? null, due_at: t.due_at, assignee_user_id: t.assignee_user_id ?? null, owner_user_id: t.assignee_user_id ?? null, entity_type: t.entity_type ?? null, ...(t.entity_type === "opportunity" && t.entity_id ? { opportunity_id: t.entity_id } : {}) },
    });
  }
  return out;
}

/** Open tickets nobody owns for the wait: once per ticket (and again only if it is later unassigned anew). */
export function unassignedCandidates(opps: any[], now: Date, afterMinutes: number): Candidate[] {
  const out: Candidate[] = [];
  for (const o of opps) {
    if (!open(o) || o.owner_agent_id) continue;
    const since = o.opened_at ?? null;
    if (!since) continue;
    const minutes = (now.getTime() - new Date(since).getTime()) / MIN;
    if (minutes < afterMinutes) continue;
    out.push({ key: `unassigned:${o.id}:${since}`, payload: ticketPayload(o, { minutes_unassigned: Math.floor(minutes) }) });
  }
  return out;
}

/** The organization's local date (YYYY-MM-DD) and hour, for the morning digest. */
export function localParts(now: Date, timezone: string): { date: string; hour: number } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "0";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/** One digest per agent per local day, only after the chosen hour and only for agents who have something due. */
export function digestCandidates(tasks: any[], now: Date, timezone: string, hour: number): Candidate[] {
  const local = localParts(now, timezone);
  if (local.hour < hour) return [];
  const per = new Map<string, { due: number; overdue: number }>();
  for (const t of tasks) {
    if (t.status !== "open" || !t.due_at || !t.assignee_user_id) continue;
    const entry = per.get(t.assignee_user_id) ?? { due: 0, overdue: 0 };
    if (new Date(t.due_at).getTime() < now.getTime() && localParts(new Date(t.due_at), timezone).date < local.date) entry.overdue++;
    else entry.due++;
    per.set(t.assignee_user_id, entry);
  }
  return [...per].map(([user, c]) => ({ key: `digest:${user}:${local.date}`, payload: { owner_user_id: user, tasks_due_today: c.due, tasks_overdue: c.overdue, digest_date: local.date } }));
}

/**
 * Meetings that start within `beforeMinutes` (and have not started), once per meeting time and per wait. A reminder whose
 * moment had already passed when the meeting was booked is NOT sent (a «tomorrow» reminder for a meeting booked an hour ago).
 */
export function meetingStartsCandidates(meetings: any[], now: Date, beforeMinutes: number): Candidate[] {
  const out: Candidate[] = [];
  for (const m of meetings) {
    if (m.status !== "booked" && m.status !== "confirmed") continue;
    const start = new Date(m.starts_at).getTime();
    if (!(start > now.getTime()) || (start - now.getTime()) / MIN > beforeMinutes) continue;
    if (m.created_at && new Date(m.created_at).getTime() > start - beforeMinutes * MIN) continue;
    out.push({ key: `meeting_start:${m.id}:${new Date(m.starts_at).toISOString()}:${beforeMinutes}`, payload: { meeting_id: m.id, owner_user_id: m.owner_user_id, contact_id: m.contact_id ?? null, lead_id: m.lead_id ?? null, opportunity_id: m.opportunity_id ?? null, starts_at: new Date(m.starts_at).toISOString(), ends_at: new Date(m.ends_at).toISOString(), meeting_type: m.type_name ?? null, channel: m.channel ?? null, location: m.channel === "link" || m.channel === "in_person" ? (m.location ?? null) : null, minutes_before: Math.round((start - now.getTime()) / MIN) } });
  }
  return out;
}

/** One digest per agent per local day, after the chosen hour, only for agents with meetings today. */
export function meetingsDigestCandidates(meetings: any[], now: Date, timezone: string, hour: number): Candidate[] {
  const local = localParts(now, timezone);
  if (local.hour < hour) return [];
  const per = new Map<string, { count: number; first: number }>();
  for (const m of meetings) {
    if (m.status !== "booked" && m.status !== "confirmed" && m.status !== "in_progress") continue;
    const start = new Date(m.starts_at).getTime();
    if (localParts(new Date(start), timezone).date !== local.date) continue;
    const entry = per.get(m.owner_user_id) ?? { count: 0, first: Infinity };
    entry.count++; entry.first = Math.min(entry.first, start);
    per.set(m.owner_user_id, entry);
  }
  return [...per].map(([user, e]) => ({ key: `meetings_digest:${user}:${local.date}`, payload: { owner_user_id: user, meetings_today: e.count, first_meeting_at: new Date(e.first).toISOString(), digest_date: local.date } }));
}

/** WhatsApp accounts that are not connected, once per disconnection (the moment it changed). */
export function disconnectedCandidates(accounts: any[], now: Date, afterMinutes: number): Candidate[] {
  const out: Candidate[] = [];
  for (const a of accounts) {
    if (a.status === "connected" || !a.updated_at) continue;
    if ((now.getTime() - new Date(a.updated_at).getTime()) / MIN < afterMinutes) continue;
    out.push({ key: `disconnected:${a.id}:${a.updated_at}`, payload: { account_id: a.id, account_name: a.display_name ?? null, owner_user_id: a.owner_user_id ?? null, status: a.status ?? null } });
  }
  return out;
}

/* ------------------------------ reading the database ------------------------------ */

const OPP_COLUMNS = "id,contact_id,owner_agent_id,stage_id,source,outcome,deleted_at,stage_entered_at,updated_at,opened_at";
const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function oldOpenTickets(db: any, organizationId: string, cutoff: string, stageId: string | null, limit: number): Promise<any[]> {
  const base = (q: any) => {
    q = q.eq("organization_id", organizationId).is("deleted_at", null).is("outcome", null);
    return stageId ? q.eq("stage_id", stageId) : q;
  };
  const [entered, unknown] = await Promise.all([
    base(db.from("opp_opportunities").select(OPP_COLUMNS)).lte("stage_entered_at", cutoff).limit(limit),
    // Tickets from before the stage time was recorded: judged by their last update.
    base(db.from("opp_opportunities").select(OPP_COLUMNS)).is("stage_entered_at", null).lte("updated_at", cutoff).limit(limit),
  ]);
  const byId = new Map<string, any>();
  for (const row of [...(entered.data ?? []), ...(unknown.data ?? [])]) byId.set(row.id, row);
  return [...byId.values()];
}

async function chatLinks(db: any, organizationId: string, opportunityIds: string[]) {
  const links: { opportunity_id: string; session_ref: string }[] = [];
  for (const part of chunks(opportunityIds, 100)) {
    const { data } = await db.from("crm_opportunity_sessions").select("opportunity_id,session_ref").eq("organization_id", organizationId).in("opportunity_id", part);
    links.push(...(data ?? []));
  }
  return links;
}

export async function findCandidates(db: any, organizationId: string, event: TimeEvent, config: Record<string, any>, now: Date, limit = 200): Promise<Candidate[]> {
  const after = Number(config.after_minutes ?? 0);
  const stageId: string | null = config.stage_id ?? null;
  const cutoff = new Date(now.getTime() - after * MIN).toISOString();

  if (event === "time.stage_timeout") return stageTimeoutCandidates(await oldOpenTickets(db, organizationId, cutoff, stageId, limit), now, after, stageId);

  if (event === "time.task_overdue") {
    const { data } = await db.from("crm_tasks").select("id,title,status,due_at,assignee_user_id,entity_type,entity_id").eq("organization_id", organizationId).eq("status", "open")
      .lte("due_at", new Date(now.getTime() - after * MIN).toISOString()).gte("due_at", new Date(now.getTime() - 14 * DAY).toISOString()).limit(limit);
    return overdueTaskCandidates(data ?? [], now, after);
  }

  if (event === "time.unassigned") {
    const { data } = await db.from("opp_opportunities").select(OPP_COLUMNS).eq("organization_id", organizationId).is("deleted_at", null).is("outcome", null).is("owner_agent_id", null).lte("opened_at", cutoff).limit(limit);
    return unassignedCandidates(data ?? [], now, after);
  }

  if (event === "time.daily_digest") {
    const { data: settings } = await db.from("wf_settings").select("timezone").eq("organization_id", organizationId).maybeSingle();
    const timezone = settings?.timezone ?? "Europe/Istanbul";
    const { data } = await db.from("crm_tasks").select("id,status,due_at,assignee_user_id").eq("organization_id", organizationId).eq("status", "open").lte("due_at", new Date(now.getTime() + DAY).toISOString()).gte("due_at", new Date(now.getTime() - 14 * DAY).toISOString()).limit(1000);
    return digestCandidates(data ?? [], now, timezone, Number(config.hour ?? 9));
  }

  if (event === "time.meeting_starts_in") {
    const before = Number(config.before_minutes ?? 0);
    const { data } = await db.from("cal_meetings").select("id,owner_user_id,contact_id,lead_id,opportunity_id,meeting_type_id,starts_at,ends_at,status,channel,location,created_at").eq("organization_id", organizationId)
      .in("status", ["booked", "confirmed"]).gte("starts_at", now.toISOString()).lte("starts_at", new Date(now.getTime() + before * MIN).toISOString()).limit(limit);
    const typeIds = [...new Set((data ?? []).map((m: any) => m.meeting_type_id).filter(Boolean))] as string[];
    const types = typeIds.length ? (await db.from("cal_meeting_types").select("id,name").eq("organization_id", organizationId).in("id", typeIds)).data ?? [] : [];
    const names = new Map<string, string>(types.map((t: any) => [t.id, t.name]));
    return meetingStartsCandidates((data ?? []).map((m: any) => ({ ...m, type_name: names.get(m.meeting_type_id) ?? null })), now, before);
  }

  if (event === "time.meetings_digest") {
    const { data: settings } = await db.from("cal_settings").select("timezone").eq("organization_id", organizationId).maybeSingle();
    const timezone = settings?.timezone ?? "Europe/Istanbul";
    const { data } = await db.from("cal_meetings").select("id,owner_user_id,starts_at,status").eq("organization_id", organizationId).in("status", ["booked", "confirmed", "in_progress"])
      .gte("starts_at", new Date(now.getTime() - DAY).toISOString()).lte("starts_at", new Date(now.getTime() + DAY).toISOString()).limit(1000);
    return meetingsDigestCandidates(data ?? [], now, timezone, Number(config.hour ?? 8));
  }

  if (event === "time.channel_disconnected") {
    const { data } = await db.from("msg_channel_accounts").select("id,display_name,status,owner_user_id,updated_at").eq("organization_id", organizationId).neq("status", "connected").limit(limit);
    return disconnectedCandidates(data ?? [], now, after);
  }

  if (event === "time.stale") {
    const tickets = await oldOpenTickets(db, organizationId, cutoff, stageId, limit);
    const links = await chatLinks(db, organizationId, tickets.map((t) => t.id));
    const lastAt = new Map<string, string | null>();
    const sessionIds = [...new Set(links.map((l) => l.session_ref))];
    const sessionLast = new Map<string, string | null>();
    for (const part of chunks(sessionIds, 100)) {
      const { data } = await db.from("msg_sessions").select("id,last_message_at").eq("organization_id", organizationId).in("id", part);
      for (const s of data ?? []) sessionLast.set(s.id, s.last_message_at ?? null);
    }
    for (const l of links) {
      const at = sessionLast.get(l.session_ref) ?? null;
      const have = lastAt.get(l.opportunity_id) ?? null;
      if (at && (!have || at > have)) lastAt.set(l.opportunity_id, at);
    }
    return staleCandidates(tickets, lastAt, now, after, stageId);
  }

  // time.no_reply: chats whose last message is ours and old enough, then the open tickets linked to them.
  const from = new Date(now.getTime() - 30 * DAY).toISOString();
  const { data: sessions } = await db.from("msg_sessions").select("id").eq("organization_id", organizationId).gte("last_message_at", from).lte("last_message_at", cutoff).limit(300);
  const sessionIds = (sessions ?? []).map((s: any) => s.id as string);
  if (!sessionIds.length) return [];
  const messages: LastMessage[] = [];
  for (const part of chunks(sessionIds, 20)) {
    const { data } = await db.from("msg_messages").select("id,session_id,direction,created_at").eq("organization_id", organizationId).in("session_id", part).gte("created_at", from).order("created_at", { ascending: false }).limit(1000);
    messages.push(...(data ?? []));
  }
  const last = lastBySession(messages);
  const links: { opportunity_id: string; session_ref: string }[] = [];
  for (const part of chunks(sessionIds, 100)) {
    const { data } = await db.from("crm_opportunity_sessions").select("opportunity_id,session_ref").eq("organization_id", organizationId).in("session_ref", part);
    links.push(...(data ?? []));
  }
  const opps: any[] = [];
  for (const part of chunks([...new Set(links.map((l) => l.opportunity_id))], 100)) {
    const { data } = await db.from("opp_opportunities").select(OPP_COLUMNS).eq("organization_id", organizationId).in("id", part);
    opps.push(...(data ?? []));
  }
  return noReplyCandidates(opps, links, last, now, after, stageId);
}

export type ScanDeps = {
  db: any;
  startRun: (input: { workflowId: string; organizationId: string; triggerPayload: Record<string, unknown>; triggerEventId: string }) => Promise<string>;
  now?: Date;
  limit?: number;
};

/** One scan over the active workflows that use a time-based trigger. Each finding starts its workflow once. */
export async function scanTimeTriggers(deps: ScanDeps, organizationId?: string): Promise<{ workflows: number; found: number; started: number; failed: number }> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  let q = db.from("wf_workflows").select("id,organization_id,trigger_config").eq("is_active", true).eq("trigger_type", "event");
  if (organizationId) q = q.eq("organization_id", organizationId);
  const { data: workflows, error } = await q;
  if (error) throw new Error("تعذر تحميل قواعد الأتمتة الزمنية");
  const out = { workflows: 0, found: 0, started: 0, failed: 0 };
  for (const wf of workflows ?? []) {
    const config = wf.trigger_config ?? {};
    if (!isTimeEvent(config.event)) continue;
    out.workflows++;
    let candidates: Candidate[];
    try {
      candidates = await findCandidates(db, wf.organization_id, config.event, config, now, deps.limit ?? 200);
    } catch {
      out.failed++;
      continue;
    }
    out.found += candidates.length;
    const ids = candidates.map((c) => ({ c, id: eventUuid(`${wf.id}|${c.key}`) }));
    // Already started for this finding: leave it alone.
    const done = new Set<string>();
    for (const part of chunks(ids.map((x) => x.id), 100)) {
      const { data } = await db.from("wf_runs").select("trigger_event_id").eq("workflow_id", wf.id).eq("organization_id", wf.organization_id).in("trigger_event_id", part);
      for (const r of data ?? []) done.add(r.trigger_event_id);
    }
    for (const { c, id } of ids) {
      if (done.has(id)) continue;
      try {
        await deps.startRun({ workflowId: wf.id, organizationId: wf.organization_id, triggerPayload: { ...c.payload, time_event: config.event }, triggerEventId: id });
        out.started++;
      } catch {
        out.failed++;
      }
    }
  }
  return out;
}
