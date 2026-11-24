/**
 * The calendar's configuration: the organization's default week, meeting types, and each agent's own schedule, breaks,
 * days off and time zone. Managers (calendar.manage) can change anything in their organization; anyone else only their
 * own schedule, breaks, days off and time zone. Everything is scoped to the actor's organization. Nothing is sent to anyone.
 */
import { calendarError } from "./errors.ts";
import { loadSettings, type Actor } from "./service.ts";
import { isValidTimeZone, toMinutes } from "./time.ts";

const fail = (message: string): never => { throw new Error(message); };
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const own = (actor: Actor, userId: string) => actor.canManage || userId === actor.userId;
const hhmm = (t: unknown) => String(t ?? "").slice(0, 5);

function timeRange(label: string, start: string, end: string, allowMidnightEnd: boolean) {
  if (!HHMM.test(start) || !(HHMM.test(end))) fail(`${label}: اكتب الوقت بصيغة ساعة:دقيقة`);
  if (end === "00:00" ? !allowMidnightEnd : toMinutes(end) <= toMinutes(start)) fail(`${label}: وقت النهاية يجب أن يكون بعد البداية`);
}

export async function getCalendarConfig(db: any, actor: Actor, input: { userId?: string | null }) {
  const userId = input.userId ?? actor.userId;
  if (!own(actor, userId)) fail("لا يمكنك عرض إعدادات مندوب آخر");
  const settings = await loadSettings(db, actor.organizationId);
  const scoped = (table: string) => db.from(table).select("*").eq("organization_id", actor.organizationId).eq("user_id", userId);
  const [types, availability, breaks, timeOff, prefs] = await Promise.all([
    db.from("cal_meeting_types").select("*").eq("organization_id", actor.organizationId),
    scoped("cal_availability"), scoped("cal_breaks"), scoped("cal_time_off"),
    db.from("cal_agent_prefs").select("timezone").eq("organization_id", actor.organizationId).eq("user_id", userId).maybeSingle(),
  ]);
  return {
    enabled: settings.enabled, userId,
    org: { timezone: settings.timezone as string, workingDays: (settings.working_days as number[]).map(Number), workStart: hhmm(settings.work_start), workEnd: hhmm(settings.work_end) },
    types: ((types.data ?? []) as any[]).sort((a, b) => a.sort_order - b.sort_order).map((t) => ({ id: t.id, name: t.name, duration_minutes: t.duration_minutes, color: t.color, is_active: t.is_active })),
    availability: ((availability.data ?? []) as any[]).map((a) => ({ weekday: a.weekday, start: hhmm(a.start_time), end: hhmm(a.end_time) })).sort((a, b) => a.weekday - b.weekday),
    breaks: ((breaks.data ?? []) as any[]).map((b) => ({ id: b.id, weekday: b.weekday, start: hhmm(b.start_time), end: hhmm(b.end_time) })),
    timeOff: ((timeOff.data ?? []) as any[]).map((t) => ({ id: t.id, from: String(t.starts_on), to: String(t.ends_on), reason: t.reason ?? null })).sort((a, b) => a.from.localeCompare(b.from)),
    agentTimezone: (prefs.data?.timezone ?? null) as string | null,
  };
}

export async function saveOrgSettings(db: any, actor: Actor, input: { timezone: string; workingDays: number[]; workStart: string; workEnd: string }) {
  if (!actor.canManage) fail("ليس لديك صلاحية إدارة التقويم");
  if (!isValidTimeZone(input.timezone)) fail("المنطقة الزمنية غير معروفة");
  const days = [...new Set(input.workingDays)].sort();
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) fail("اختر يوم عمل واحداً على الأقل");
  timeRange("ساعات الدوام", input.workStart, input.workEnd, true);
  const { error } = await db.from("cal_settings").update({ timezone: input.timezone, working_days: days, work_start: input.workStart, work_end: input.workEnd, updated_by: actor.userId, updated_at: new Date().toISOString() }).eq("organization_id", actor.organizationId);
  if (error) throw new Error(calendarError(error));
  return { ok: true };
}

/** Replaces the agent's own week: their working days (empty = use the organization's), breaks and time zone. */
export async function saveSchedule(db: any, actor: Actor, input: { userId?: string | null; availability: { weekday: number; start: string; end: string }[]; breaks: { weekday: number; start: string; end: string }[]; agentTimezone?: string | null }) {
  const userId = input.userId ?? actor.userId;
  if (!own(actor, userId)) fail("لا يمكنك تعديل جدول مندوب آخر");
  const { data: member } = await db.from("org_memberships").select("user_id").eq("organization_id", actor.organizationId).eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (!member) fail("المندوب غير فعّال في هذه المؤسسة");
  const weekdays = new Set<number>();
  for (const a of input.availability) {
    if (!Number.isInteger(a.weekday) || a.weekday < 0 || a.weekday > 6 || weekdays.has(a.weekday)) fail("يوم العمل غير صحيح أو مكرر");
    weekdays.add(a.weekday);
    timeRange("دوام المندوب", a.start, a.end, true);
  }
  for (const b of input.breaks) {
    if (!Number.isInteger(b.weekday) || b.weekday < 0 || b.weekday > 6) fail("يوم الاستراحة غير صحيح");
    timeRange("الاستراحة", b.start, b.end, false);
  }
  if (input.agentTimezone && !isValidTimeZone(input.agentTimezone)) fail("المنطقة الزمنية غير معروفة");
  const org = actor.organizationId;
  const { data: existing } = await db.from("cal_availability").select("id,weekday").eq("organization_id", org).eq("user_id", userId);
  const have = new Map<number, string>(((existing ?? []) as any[]).map((r) => [r.weekday, r.id]));
  for (const [weekday, id] of have) if (!weekdays.has(weekday)) await db.from("cal_availability").delete().eq("id", id).eq("organization_id", org);
  for (const a of input.availability) {
    const row = { start_time: a.start, end_time: a.end };
    const result = have.has(a.weekday)
      ? await db.from("cal_availability").update(row).eq("id", have.get(a.weekday)).eq("organization_id", org)
      : await db.from("cal_availability").insert({ organization_id: org, user_id: userId, weekday: a.weekday, ...row });
    if (result.error) throw new Error(calendarError(result.error));
  }
  await db.from("cal_breaks").delete().eq("organization_id", org).eq("user_id", userId);
  if (input.breaks.length) {
    const { error } = await db.from("cal_breaks").insert(input.breaks.map((b) => ({ organization_id: org, user_id: userId, weekday: b.weekday, start_time: b.start, end_time: b.end })));
    if (error) throw new Error(calendarError(error));
  }
  if (input.agentTimezone !== undefined) {
    await db.from("cal_agent_prefs").delete().eq("organization_id", org).eq("user_id", userId);
    if (input.agentTimezone) {
      const { error } = await db.from("cal_agent_prefs").insert({ organization_id: org, user_id: userId, timezone: input.agentTimezone });
      if (error) throw new Error(calendarError(error));
    }
  }
  return { ok: true };
}

export async function addTimeOff(db: any, actor: Actor, input: { userId?: string | null; from: string; to: string; reason?: string | null }) {
  const userId = input.userId ?? actor.userId;
  if (!own(actor, userId)) fail("لا يمكنك تعديل إجازات مندوب آخر");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.to < input.from) fail("تاريخ الإجازة غير صحيح");
  const { data: member } = await db.from("org_memberships").select("user_id").eq("organization_id", actor.organizationId).eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (!member) fail("المندوب غير فعّال في هذه المؤسسة");
  const { error } = await db.from("cal_time_off").insert({ organization_id: actor.organizationId, user_id: userId, starts_on: input.from, ends_on: input.to, reason: input.reason?.trim() || null });
  if (error) throw new Error(calendarError(error));
  return { ok: true };
}

export async function deleteTimeOff(db: any, actor: Actor, id: string) {
  const { data } = await db.from("cal_time_off").select("id,user_id").eq("id", id).eq("organization_id", actor.organizationId).maybeSingle();
  if (!data || !own(actor, data.user_id)) fail("الإجازة غير موجودة");
  const { error } = await db.from("cal_time_off").delete().eq("id", id).eq("organization_id", actor.organizationId);
  if (error) throw new Error(calendarError(error));
  return { ok: true };
}

export async function saveMeetingType(db: any, actor: Actor, input: { id?: string | null; name: string; durationMinutes: number; color: string; isActive?: boolean }) {
  if (!actor.canManage) fail("ليس لديك صلاحية إدارة التقويم");
  const name = input.name.trim();
  if (!name || name.length > 80) fail("اكتب اسم النوع (حتى 80 حرفاً)");
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 600) fail("مدة الموعد من 5 إلى 600 دقيقة");
  if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) fail("اللون غير صحيح");
  const row = { name, duration_minutes: input.durationMinutes, color: input.color, ...(input.isActive === undefined ? {} : { is_active: input.isActive }) };
  if (input.id) {
    const { data, error } = await db.from("cal_meeting_types").update(row).eq("id", input.id).eq("organization_id", actor.organizationId).select("id").maybeSingle();
    if (error) throw new Error(calendarError(error));
    if (!data) fail("النوع غير موجود");
    return { id: input.id as string };
  }
  const { data: all } = await db.from("cal_meeting_types").select("sort_order").eq("organization_id", actor.organizationId);
  const next = Math.max(0, ...((all ?? []) as any[]).map((t) => t.sort_order ?? 0)) + 1;
  const { data, error } = await db.from("cal_meeting_types").insert({ organization_id: actor.organizationId, sort_order: next, ...row }).select("id").single();
  if (error) throw new Error(calendarError(error));
  return { id: data.id as string };
}
