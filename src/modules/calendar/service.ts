/**
 * The calendar's server logic: every operation takes the database and the person acting as parameters, so it is
 * tested without Supabase. Rules it enforces (the database enforces the same ones again as the last word):
 *   - everything is scoped to the actor's organization; a meeting of another organization is «not found»;
 *   - an agent sees and changes only their own meetings, a manager (calendar.view_all) sees all of the organization;
 *   - customers, leads, opportunities and meeting types must belong to the same organization;
 *   - nothing works until the organization switched the calendar on;
 *   - errors are plain Arabic sentences, never database details or anything about another organization.
 * Nothing here sends a message to anyone.
 */
import { calendarError, ruleMessage } from "./errors.ts";
import { validateMeetingTime, type Busy, type CalendarContext } from "./rules.ts";
import { suggestSlots } from "./slots.ts";
import { BUSY_STATUSES, CHANNELS, canMove, canSetOutcome, isFinal, OUTCOMES, type MeetingStatus } from "./status.ts";

export type Actor = { userId: string; organizationId: string; canViewAll: boolean; canBook: boolean; canManage: boolean };
export type MeetingInput = {
  ownerId?: string; startsAt: string; endsAt?: string; contactId?: string | null; leadId?: string | null; opportunityId?: string | null;
  meetingTypeId?: string | null; title?: string | null; channel?: string; location?: string | null; internalNotes?: string | null; status?: "booked" | "confirmed";
  /** Team members who take part (a meeting with the manager): it shows in their calendar and blocks their time. Managers only. */
  attendeeIds?: string[];
};
export type MeetingPatch = Partial<Omit<MeetingInput, "status">>;

const NOT_FOUND = "الموعد غير موجود";
const DEFAULTS = { timezone: "Europe/Istanbul", working_days: [1, 2, 3, 4, 5], work_start: "09:00", work_end: "18:00" };
export const MAX_RANGE_DAYS = 70;
const fail = (message: string): never => { throw new Error(message); };

/* ----------------------------- settings ----------------------------- */

export async function loadSettings(db: any, organizationId: string) {
  const { data, error } = await db.from("cal_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (error) throw new Error(calendarError(error));
  return data ? { ...DEFAULTS, ...data, enabled: data.cal_enabled === true } : { ...DEFAULTS, enabled: false };
}
async function requireEnabled(db: any, organizationId: string) {
  const settings = await loadSettings(db, organizationId);
  if (!settings.enabled) fail(ruleMessage("CAL_DISABLED")!);
  return settings;
}

export async function getCalendarState(db: any, actor: Actor) {
  const s = await loadSettings(db, actor.organizationId);
  const { data: prefs } = await db.from("cal_agent_prefs").select("timezone").eq("organization_id", actor.organizationId).eq("user_id", actor.userId).maybeSingle();
  return {
    viewerId: actor.userId, enabled: s.enabled, timezone: s.timezone as string, viewerTimezone: (prefs?.timezone || s.timezone) as string,
    workStart: hhmm(s.work_start), workEnd: hhmm(s.work_end), workingDays: (s.working_days as number[]).map(Number),
    canViewAll: actor.canViewAll, canBook: actor.canBook, canManage: actor.canManage,
  };
}

/** Switches the calendar on for the actor's organization. The first time it also creates the default meeting types. */
export async function enableCalendar(db: any, actor: Actor) {
  if (!actor.canManage) fail("ليس لديك صلاحية إدارة التقويم");
  const { error } = await db.rpc("cal_enable", { _org: actor.organizationId, _actor: actor.userId });
  if (error) throw new Error(calendarError(error));
  return { enabled: true };
}
export async function disableCalendar(db: any, actor: Actor) {
  if (!actor.canManage) fail("ليس لديك صلاحية إدارة التقويم");
  const { error } = await db.from("cal_settings").update({ cal_enabled: false, updated_by: actor.userId, updated_at: new Date().toISOString() }).eq("organization_id", actor.organizationId);
  if (error) throw new Error(calendarError(error));
  return { enabled: false };
}

export async function listMeetingTypes(db: any, actor: Actor) {
  const { data, error } = await db.from("cal_meeting_types").select("id,name,duration_minutes,color,sort_order,is_active").eq("organization_id", actor.organizationId).eq("is_active", true);
  if (error) throw new Error(calendarError(error));
  return ((data ?? []) as any[]).sort((a, b) => a.sort_order - b.sort_order);
}

/** Who a meeting can be booked for: a manager gets the organization's active members, an agent only themselves. */
export async function listOwners(db: any, actor: Actor) {
  if (!actor.canViewAll) {
    const { data } = await db.from("profiles").select("id,full_name").eq("id", actor.userId).maybeSingle();
    return [{ id: actor.userId, name: data?.full_name || "أنا" }];
  }
  const { data: members, error } = await db.from("org_memberships").select("user_id").eq("organization_id", actor.organizationId).eq("is_active", true);
  if (error) throw new Error(calendarError(error));
  const ids = ((members ?? []) as any[]).map((m) => m.user_id);
  if (!ids.length) return [];
  const { data: people } = await db.from("profiles").select("id,full_name").in("id", ids);
  const names = new Map<string, string>(((people ?? []) as any[]).map((p) => [p.id, p.full_name || ""]));
  return ids.map((id) => ({ id, name: names.get(id) || "بلا اسم" })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/* ----------------------------- the agent's week ----------------------------- */

const hhmm = (t: string) => String(t).slice(0, 5);
export async function loadAgentContext(db: any, organizationId: string, ownerId: string): Promise<CalendarContext> {
  const own = (table: string) => db.from(table).select("*").eq("organization_id", organizationId).eq("user_id", ownerId);
  const [settings, prefs, availability, breaks, timeOff] = await Promise.all([loadSettings(db, organizationId), own("cal_agent_prefs").maybeSingle(), own("cal_availability"), own("cal_breaks"), own("cal_time_off")]);
  return {
    timezone: settings.timezone, agentTimezone: prefs.data?.timezone ?? null,
    workingDays: (settings.working_days as number[]).map(Number), workStart: hhmm(settings.work_start), workEnd: hhmm(settings.work_end),
    availability: ((availability.data ?? []) as any[]).map((a) => ({ weekday: a.weekday, start: hhmm(a.start_time), end: hhmm(a.end_time) })),
    breaks: ((breaks.data ?? []) as any[]).map((b) => ({ weekday: b.weekday, start: hhmm(b.start_time), end: hhmm(b.end_time) })),
    timeOff: ((timeOff.data ?? []) as any[]).map((t) => ({ from: String(t.starts_on), to: String(t.ends_on) })),
  };
}

/** The agent's busy times across ALL organizations (the same person cannot be in two places). Only times and status leave this function. */
/** The time already taken by a person: the meetings they own AND the ones they take part in. */
async function loadBusy(db: any, ownerId: string, fromIso: string, toIso: string): Promise<Busy[]> {
  const { data, error } = await db.from("cal_meetings").select("id,starts_at,ends_at,status").eq("owner_user_id", ownerId).in("status", [...BUSY_STATUSES]).lte("starts_at", toIso).gte("ends_at", fromIso);
  if (error) throw new Error(calendarError(error));
  const rows = [...((data ?? []) as any[])];
  const { data: mine } = await db.from("cal_meeting_attendees").select("meeting_id").eq("user_id", ownerId);
  const attended = ((mine ?? []) as any[]).map((a) => a.meeting_id as string).filter((mid) => !rows.some((r) => r.id === mid));
  if (attended.length) {
    const { data: more, error: moreError } = await db.from("cal_meetings").select("id,starts_at,ends_at,status").in("id", attended).in("status", [...BUSY_STATUSES]).lte("starts_at", toIso).gte("ends_at", fromIso);
    if (moreError) throw new Error(calendarError(moreError));
    rows.push(...((more ?? []) as any[]));
  }
  return rows.map((m) => ({ id: m.id, starts_at: m.starts_at, ends_at: m.ends_at, status: m.status }));
}

/** Who may be added to a meeting: active members of the organization other than its owner, only booked by a manager, at most 10. */
async function checkAttendees(db: any, actor: Actor, ownerId: string, ids: string[] | undefined, startsAt: string, endsAt: string, ignoreId?: string): Promise<string[]> {
  const unique = [...new Set(ids ?? [])];
  if (!unique.length) return [];
  if (!actor.canViewAll) fail("إضافة مشاركين من الفريق للمدراء فقط");
  if (unique.length > 10) fail("عدد المشاركين الأقصى 10");
  const s = Date.parse(startsAt), e = Date.parse(endsAt);
  for (const userId of unique) {
    if (userId === ownerId) fail("صاحب الموعد مشارك فيه أصلاً");
    await requireMember(db, actor.organizationId, userId);
    const busy = await loadBusy(db, userId, new Date(s - 86_400_000).toISOString(), new Date(e + 86_400_000).toISOString());
    if (busy.some((b) => b.id !== ignoreId && new Date(b.starts_at).getTime() < e && new Date(b.ends_at).getTime() > s)) fail(ruleMessage("CAL_ATTENDEE_BUSY")!);
  }
  return unique;
}

async function saveAttendees(db: any, organizationId: string, meetingId: string, userIds: string[]) {
  const { error: delError } = await db.from("cal_meeting_attendees").delete().eq("organization_id", organizationId).eq("meeting_id", meetingId);
  if (delError) throw new Error(calendarError(delError));
  if (!userIds.length) return;
  const { error } = await db.from("cal_meeting_attendees").insert(userIds.map((user_id) => ({ meeting_id: meetingId, organization_id: organizationId, user_id })));
  if (error) throw new Error(calendarError(error));
}

async function requireMember(db: any, organizationId: string, userId: string) {
  const { data } = await db.from("org_memberships").select("user_id").eq("organization_id", organizationId).eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (!data) fail(ruleMessage("CAL_BAD_OWNER")!);
}

async function checkLinks(db: any, organizationId: string, links: { contactId?: string | null; leadId?: string | null; opportunityId?: string | null; meetingTypeId?: string | null }) {
  const tables: [string, string | null | undefined][] = [["crm_contacts", links.contactId], ["crm_leads", links.leadId], ["opp_opportunities", links.opportunityId], ["cal_meeting_types", links.meetingTypeId]];
  for (const [table, id] of tables) {
    if (!id) continue;
    const { data } = await db.from(table).select("id").eq("id", id).eq("organization_id", organizationId).maybeSingle();
    if (!data) fail(ruleMessage("CAL_CROSS_ORG")!);
  }
}

/* ----------------------------- reading ----------------------------- */

const scoped = (actor: Actor, ownerId: string) => actor.canViewAll || ownerId === actor.userId;

/**
 * The meetings an agent (without «see all») may see and handle: the ones they own, the ones they booked, and the ones that belong
 * to a ticket or lead assigned to them, even when a manager booked them under the manager's own name. A manager sees all.
 */
async function visibleTo(db: any, actor: Actor, rows: any[]): Promise<any[]> {
  if (actor.canViewAll) return rows;
  const { data: attended } = rows.length ? await db.from("cal_meeting_attendees").select("meeting_id").eq("organization_id", actor.organizationId).eq("user_id", actor.userId).in("meeting_id", rows.map((r) => r.id)) : { data: [] };
  const attending = new Set(((attended ?? []) as any[]).map((a) => a.meeting_id as string));
  const others = rows.filter((r) => r.owner_user_id !== actor.userId && r.created_by !== actor.userId && !attending.has(r.id));
  const ids = (key: string) => [...new Set(others.map((r) => r[key]).filter(Boolean))] as string[];
  const [opps, leads] = await Promise.all([
    ids("opportunity_id").length ? db.from("opp_opportunities").select("id,owner_agent_id").eq("organization_id", actor.organizationId).in("id", ids("opportunity_id")) : { data: [] },
    ids("lead_id").length ? db.from("crm_leads").select("id,owner_user_id").eq("organization_id", actor.organizationId).in("id", ids("lead_id")) : { data: [] },
  ]);
  const mineOpp = new Set(((opps.data ?? []) as any[]).filter((o) => o.owner_agent_id === actor.userId).map((o) => o.id));
  const mineLead = new Set(((leads.data ?? []) as any[]).filter((l) => l.owner_user_id === actor.userId).map((l) => l.id));
  return rows.filter((r) => r.owner_user_id === actor.userId || r.created_by === actor.userId || attending.has(r.id) || (r.opportunity_id && mineOpp.has(r.opportunity_id)) || (r.lead_id && mineLead.has(r.lead_id)));
}

/** One meeting by id, only if it is in the actor's organization AND the actor may see it. Anything else is «not found». */
async function ownMeeting(db: any, actor: Actor, id: string) {
  const { data, error } = await db.from("cal_meetings").select("*").eq("id", id).eq("organization_id", actor.organizationId).maybeSingle();
  if (error) throw new Error(calendarError(error));
  if (!data || (await visibleTo(db, actor, [data])).length === 0) fail(NOT_FOUND);
  return data;
}

async function decorate(db: any, organizationId: string, rows: any[]) {
  const ids = (key: string) => [...new Set(rows.map((r) => r[key]).filter(Boolean))] as string[];
  const { data: attendeeRows } = rows.length ? await db.from("cal_meeting_attendees").select("meeting_id,user_id").eq("organization_id", organizationId).in("meeting_id", rows.map((r) => r.id)) : { data: [] };
  const attendeesOf = new Map<string, string[]>();
  for (const a of (attendeeRows ?? []) as any[]) attendeesOf.set(a.meeting_id, [...(attendeesOf.get(a.meeting_id) ?? []), a.user_id]);
  const [contacts, types, people] = await Promise.all([
    ids("contact_id").length ? db.from("crm_contacts").select("id,display_name,full_name").eq("organization_id", organizationId).in("id", ids("contact_id")) : { data: [] },
    ids("meeting_type_id").length ? db.from("cal_meeting_types").select("id,name,color,duration_minutes").eq("organization_id", organizationId).in("id", ids("meeting_type_id")) : { data: [] },
    (() => { const people = [...new Set([...ids("owner_user_id"), ...[...attendeesOf.values()].flat()])]; return people.length ? db.from("profiles").select("id,full_name").in("id", people) : { data: [] }; })(),
  ]);
  const contact = new Map<string, string>((contacts.data ?? []).map((c: any) => [c.id, c.display_name || c.full_name || ""]));
  const type = new Map<string, any>((types.data ?? []).map((t: any) => [t.id, t]));
  const person = new Map<string, string>((people.data ?? []).map((p: any) => [p.id, p.full_name || ""]));
  return rows.map((r) => ({ ...r, contact_name: contact.get(r.contact_id) ?? null, type_name: type.get(r.meeting_type_id)?.name ?? null, type_color: type.get(r.meeting_type_id)?.color ?? null, owner_name: person.get(r.owner_user_id) ?? null, attendees: (attendeesOf.get(r.id) ?? []).map((id) => ({ id, name: person.get(id) ?? null })) }));
}

export async function listMeetings(db: any, actor: Actor, input: { from: string; to: string; ownerId?: string | null; includeInactive?: boolean }) {
  const from = Date.parse(input.from), to = Date.parse(input.to);
  if (!(to > from)) fail("نطاق التاريخ غير صحيح");
  if (to - from > MAX_RANGE_DAYS * 86_400_000) fail(`اختر نطاقاً لا يتجاوز ${MAX_RANGE_DAYS} يوماً`);
  let q = db.from("cal_meetings").select("*").eq("organization_id", actor.organizationId).gte("starts_at", new Date(from).toISOString()).lt("starts_at", new Date(to).toISOString()).limit(1000);
  if (actor.canViewAll && input.ownerId) q = q.eq("owner_user_id", input.ownerId);
  if (!input.includeInactive) q = q.in("status", ["booked", "confirmed", "in_progress", "completed"]);
  const { data, error } = await q;
  if (error) throw new Error(calendarError(error));
  const rows = (await visibleTo(db, actor, (data ?? []) as any[])).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return decorate(db, actor.organizationId, rows);
}

export async function getMeeting(db: any, actor: Actor, id: string) {
  const row = await ownMeeting(db, actor, id);
  return (await decorate(db, actor.organizationId, [row]))[0];
}

/* ----------------------------- writing ----------------------------- */

const clean = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

async function endFor(db: any, organizationId: string, startsAt: string, endsAt: string | undefined, typeId: string | null | undefined) {
  if (endsAt) return endsAt;
  if (!typeId) return fail("اكتب وقت نهاية الموعد أو اختر نوعاً له مدة");
  const { data } = await db.from("cal_meeting_types").select("duration_minutes").eq("id", typeId).eq("organization_id", organizationId).maybeSingle();
  if (!data) fail(ruleMessage("CAL_CROSS_ORG")!);
  return new Date(Date.parse(startsAt) + data.duration_minutes * 60_000).toISOString();
}

async function checkTime(db: any, organizationId: string, ownerId: string, startsAt: string, endsAt: string, ignoreId?: string) {
  const s = Date.parse(startsAt), e = Date.parse(endsAt);
  if (Number.isNaN(s) || Number.isNaN(e)) fail(ruleMessage("CAL_BAD_RANGE")!);
  const [ctx, busy] = await Promise.all([loadAgentContext(db, organizationId, ownerId), loadBusy(db, ownerId, new Date(s - 86_400_000).toISOString(), new Date(e + 86_400_000).toISOString())]);
  const problem = ruleMessage(validateMeetingTime(ctx, s, e, busy, ignoreId));
  if (problem) fail(problem);
}

export async function createMeeting(db: any, actor: Actor, input: MeetingInput) {
  if (!actor.canBook) fail("ليس لديك صلاحية حجز المواعيد");
  const ownerId = input.ownerId ?? actor.userId;
  if (!scoped(actor, ownerId)) fail("لا يمكنك حجز موعد لمندوب آخر");
  await requireEnabled(db, actor.organizationId);
  await requireMember(db, actor.organizationId, ownerId);
  await checkLinks(db, actor.organizationId, input);
  const channel = input.channel ?? "call";
  if (!(CHANNELS as readonly string[]).includes(channel)) fail("قناة الموعد غير معروفة");
  const endsAt = await endFor(db, actor.organizationId, input.startsAt, input.endsAt, input.meetingTypeId);
  await checkTime(db, actor.organizationId, ownerId, input.startsAt, endsAt);
  const attendees = await checkAttendees(db, actor, ownerId, input.attendeeIds, input.startsAt, endsAt);
  const { data, error } = await db.from("cal_meetings").insert({
    organization_id: actor.organizationId, owner_user_id: ownerId, contact_id: input.contactId ?? null, lead_id: input.leadId ?? null, opportunity_id: input.opportunityId ?? null,
    meeting_type_id: input.meetingTypeId ?? null, title: clean(input.title), starts_at: new Date(input.startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(), channel,
    location: clean(input.location), internal_notes: clean(input.internalNotes), status: input.status ?? "booked", created_by: actor.userId, updated_by: actor.userId,
  }).select("*").single();
  if (error) throw new Error(calendarError(error));
  if (attendees.length) {
    try {
      await saveAttendees(db, actor.organizationId, data.id, attendees);
    } catch (e) {
      // Someone became busy in between: the meeting is not left half made.
      await db.from("cal_meetings").delete().eq("id", data.id).eq("organization_id", actor.organizationId);
      throw e;
    }
  }
  return (await decorate(db, actor.organizationId, [data]))[0];
}

export async function updateMeeting(db: any, actor: Actor, id: string, patch: MeetingPatch) {
  if (!actor.canBook) fail("ليس لديك صلاحية تعديل المواعيد");
  const current = await ownMeeting(db, actor, id);
  const next: Record<string, unknown> = { updated_by: actor.userId };
  const ownerId = patch.ownerId ?? current.owner_user_id;
  if (patch.ownerId && patch.ownerId !== current.owner_user_id) {
    if (!actor.canViewAll) fail("لا يمكنك نقل الموعد لمندوب آخر");
    await requireMember(db, actor.organizationId, patch.ownerId);
    next.owner_user_id = patch.ownerId;
  }
  await checkLinks(db, actor.organizationId, patch);
  if (patch.contactId !== undefined) next.contact_id = patch.contactId;
  if (patch.leadId !== undefined) next.lead_id = patch.leadId;
  if (patch.opportunityId !== undefined) next.opportunity_id = patch.opportunityId;
  if (patch.meetingTypeId !== undefined) next.meeting_type_id = patch.meetingTypeId;
  if (patch.title !== undefined) next.title = clean(patch.title);
  if (patch.location !== undefined) next.location = clean(patch.location);
  if (patch.internalNotes !== undefined) next.internal_notes = clean(patch.internalNotes);
  if (patch.channel !== undefined) {
    if (!(CHANNELS as readonly string[]).includes(patch.channel)) fail("قناة الموعد غير معروفة");
    next.channel = patch.channel;
  }
  const startsAt = patch.startsAt ?? current.starts_at;
  const endsAt = patch.endsAt ?? (patch.startsAt ? new Date(Date.parse(patch.startsAt) + (Date.parse(current.ends_at) - Date.parse(current.starts_at))).toISOString() : current.ends_at);
  const timeChanged = new Date(startsAt).getTime() !== new Date(current.starts_at).getTime() || new Date(endsAt).getTime() !== new Date(current.ends_at).getTime() || ownerId !== current.owner_user_id;
  if (timeChanged) {
    if (isFinal(current.status)) fail(ruleMessage("CAL_FINAL_STATUS")!);
    await checkTime(db, actor.organizationId, ownerId, startsAt, endsAt, id);
    next.starts_at = new Date(startsAt).toISOString();
    next.ends_at = new Date(endsAt).toISOString();
  }
  // The people taking part: a new list replaces the old one; when only the time moves, the current ones must be free at the new time.
  let attendees: string[] | null = null;
  if (patch.attendeeIds !== undefined) attendees = await checkAttendees(db, actor, ownerId, patch.attendeeIds, startsAt, endsAt, id);
  else if (timeChanged) {
    const { data: now } = await db.from("cal_meeting_attendees").select("user_id").eq("organization_id", actor.organizationId).eq("meeting_id", id);
    const keep = ((now ?? []) as any[]).map((a) => a.user_id as string);
    if (keep.length) await checkAttendees(db, { ...actor, canViewAll: true }, ownerId, keep, startsAt, endsAt, id);
  }
  const { data, error } = await db.from("cal_meetings").update(next).eq("id", id).eq("organization_id", actor.organizationId).select("*").maybeSingle();
  if (error) throw new Error(calendarError(error));
  if (!data) fail(NOT_FOUND);
  if (attendees) await saveAttendees(db, actor.organizationId, id, attendees);
  return (await decorate(db, actor.organizationId, [data]))[0];
}

/**
 * Removes a meeting for good (a meeting booked by mistake). Unlike cancelling, which keeps it with its reason, nothing is left in the
 * calendar. Whoever may handle the meeting may delete it; its people (attendees) go with it.
 */
export async function deleteMeeting(db: any, actor: Actor, id: string) {
  if (!actor.canBook) fail("ليس لديك صلاحية حذف المواعيد");
  await ownMeeting(db, actor, id);
  const { error } = await db.from("cal_meetings").delete().eq("id", id).eq("organization_id", actor.organizationId);
  if (error) throw new Error(calendarError(error));
  return { ok: true as const };
}

export async function setMeetingStatus(db: any, actor: Actor, id: string, status: MeetingStatus, reason?: string | null) {
  if (!actor.canBook) fail("ليس لديك صلاحية تعديل المواعيد");
  const current = await ownMeeting(db, actor, id);
  if (current.status === status) return (await decorate(db, actor.organizationId, [current]))[0];
  if (!canMove(current.status, status)) fail(ruleMessage("CAL_BAD_TRANSITION")!);
  const patch: Record<string, unknown> = { status, updated_by: actor.userId };
  if (status === "cancelled") patch.cancellation_reason = clean(reason);
  const { data, error } = await db.from("cal_meetings").update(patch).eq("id", id).eq("organization_id", actor.organizationId).select("*").maybeSingle();
  if (error) throw new Error(calendarError(error));
  if (!data) fail(NOT_FOUND);
  return (await decorate(db, actor.organizationId, [data]))[0];
}

/** The outcome of a finished meeting. It records what happened; it never moves the opportunity to another stage. */
export async function recordOutcome(db: any, actor: Actor, id: string, outcome: string, note?: string | null) {
  if (!actor.canBook) fail("ليس لديك صلاحية تعديل المواعيد");
  if (!(OUTCOMES as readonly string[]).includes(outcome)) fail("نتيجة الموعد غير معروفة");
  const current = await ownMeeting(db, actor, id);
  if (!canSetOutcome(current.status)) fail(ruleMessage("CAL_OUTCOME_NOT_ALLOWED")!);
  const { data, error } = await db.from("cal_meetings").update({ outcome, outcome_note: clean(note), updated_by: actor.userId }).eq("id", id).eq("organization_id", actor.organizationId).select("*").maybeSingle();
  if (error) throw new Error(calendarError(error));
  if (!data) fail(NOT_FOUND);
  return (await decorate(db, actor.organizationId, [data]))[0];
}

/* ----------------------------- free times ----------------------------- */

export async function suggestTimes(db: any, actor: Actor, input: { durationMin?: number; meetingTypeId?: string | null; ownerIds?: string[]; now?: number; count?: number }) {
  if (!actor.canBook) fail("ليس لديك صلاحية حجز المواعيد");
  await requireEnabled(db, actor.organizationId);
  let duration = input.durationMin;
  if (!duration && input.meetingTypeId) {
    const { data } = await db.from("cal_meeting_types").select("duration_minutes").eq("id", input.meetingTypeId).eq("organization_id", actor.organizationId).maybeSingle();
    if (!data) fail(ruleMessage("CAL_CROSS_ORG")!);
    duration = data.duration_minutes;
  }
  if (!duration || duration < 5 || duration > 600) fail("مدة الموعد غير صحيحة");
  const owners = (actor.canViewAll ? (input.ownerIds?.length ? input.ownerIds : [actor.userId]) : [actor.userId]).slice(0, 10);
  const now = input.now ?? Date.now();
  const agents = [];
  for (const ownerId of owners) {
    await requireMember(db, actor.organizationId, ownerId);
    agents.push({ ownerId, ctx: await loadAgentContext(db, actor.organizationId, ownerId), busy: await loadBusy(db, ownerId, new Date(now).toISOString(), new Date(now + 20 * 86_400_000).toISOString()) });
  }
  return suggestSlots({ agents, durationMin: duration as number, now, count: Math.min(input.count ?? 3, 10) });
}

/* ----------------------------- meetings of one customer / opportunity ----------------------------- */

/** The meetings linked to an opportunity, lead or contact (newest first), limited to what the actor may see. */
export async function listEntityMeetings(db: any, actor: Actor, input: { opportunityId?: string | null; leadId?: string | null; contactId?: string | null }) {
  if (!input.opportunityId && !input.leadId && !input.contactId) fail("حدّد الفرصة أو العميل");
  // Every link counts: a meeting booked from the calendar for a customer carries only the contact, yet belongs on that customer's ticket too.
  const links: [string, string][] = [["opportunity_id", input.opportunityId ?? ""], ["lead_id", input.leadId ?? ""], ["contact_id", input.contactId ?? ""]].filter(([, id]) => id) as [string, string][];
  const found = new Map<string, any>();
  for (const [column, id] of links) {
    const { data, error } = await db.from("cal_meetings").select("*").eq("organization_id", actor.organizationId).eq(column, id).limit(100);
    if (error) throw new Error(calendarError(error));
    for (const row of await visibleTo(db, actor, (data ?? []) as any[])) found.set(row.id, row);
  }
  const rows = [...found.values()].sort((a, b) => b.starts_at.localeCompare(a.starts_at)).slice(0, 50);
  return decorate(db, actor.organizationId, rows);
}

/** The actor's meetings (or one agent's, for a manager) as an ICS file. Nothing but times and the type leaves. */
export async function exportMeetingsIcs(db: any, actor: Actor, input: { from: string; to: string; ownerId?: string | null; now?: Date }) {
  const { buildIcs } = await import("./ics.ts");
  const rows = await listMeetings(db, actor, { from: input.from, to: input.to, ownerId: input.ownerId ?? (actor.canViewAll ? null : actor.userId) });
  return buildIcs(rows as any[], { now: input.now ?? new Date(), name: "NovaSales" });
}
