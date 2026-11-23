import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import * as svc from "../src/modules/calendar/service.ts";
import * as cfg from "../src/modules/calendar/settings.ts";

const A = "org-a", B = "org-b";
const actor = (userId: string, extra: Partial<svc.Actor> = {}, organizationId = A): svc.Actor => ({ userId, organizationId, canViewAll: false, canBook: true, canManage: false, ...extra });
const agent = actor("a1"), colleague = actor("a2"), manager = actor("mgr", { canViewAll: true, canManage: true });
const rejects = (p: Promise<unknown>, m: string | RegExp) => assert.rejects(p, (e: Error) => (typeof m === "string" ? e.message === m : m.test(e.message)));
function setup(extra: Record<string, any[]> = {}) {
  return fakeDb({
    cal_settings: [{ organization_id: A, cal_enabled: true, timezone: "Europe/Istanbul", working_days: [1, 2, 3, 4, 5], work_start: "09:00:00", work_end: "18:00:00" }, { organization_id: B, cal_enabled: true, timezone: "UTC", working_days: [1], work_start: "09:00", work_end: "17:00" }],
    org_memberships: [...["a1", "a2", "mgr"].map((user_id) => ({ user_id, organization_id: A, is_active: true })), { user_id: "b1", organization_id: B, is_active: true }],
    cal_meeting_types: [{ id: "tA", organization_id: A, name: "عرض", duration_minutes: 30, color: "#112233", sort_order: 1, is_active: true }, { id: "tB", organization_id: B, name: "نوع ب", duration_minutes: 30, color: "#000000", sort_order: 1, is_active: true }],
    cal_availability: [], cal_breaks: [], cal_time_off: [], cal_agent_prefs: [], cal_meetings: [], ...extra,
  }) as any;
}

test("organization settings: only a manager, valid zone/days/hours, scoped to the organization", async () => {
  const db = setup();
  const good = { timezone: "Asia/Riyadh", workingDays: [0, 1, 2, 3, 4], workStart: "08:00", workEnd: "16:00" };
  await rejects(cfg.saveOrgSettings(db, agent, good), "ليس لديك صلاحية إدارة التقويم");
  await rejects(cfg.saveOrgSettings(db, manager, { ...good, timezone: "Mars/Base" }), "المنطقة الزمنية غير معروفة");
  await rejects(cfg.saveOrgSettings(db, manager, { ...good, workingDays: [] }), "اختر يوم عمل واحداً على الأقل");
  await rejects(cfg.saveOrgSettings(db, manager, { ...good, workingDays: [7] }), "اختر يوم عمل واحداً على الأقل");
  await rejects(cfg.saveOrgSettings(db, manager, { ...good, workStart: "17:00", workEnd: "09:00" }), /وقت النهاية يجب أن يكون بعد البداية/);
  await cfg.saveOrgSettings(db, manager, good);
  await cfg.saveOrgSettings(db, manager, { ...good, workEnd: "00:00" });
  assert.deepEqual(db.tables.cal_settings.find((s: any) => s.organization_id === A).timezone, "Asia/Riyadh");
  assert.equal(db.tables.cal_settings.find((s: any) => s.organization_id === B).timezone, "UTC", "the other organization is untouched");
});

test("own week: an agent edits only their own schedule; a manager can edit anyone in the organization; replaces rather than piles up", async () => {
  const db = setup();
  const week = { availability: [{ weekday: 1, start: "13:00", end: "16:00" }, { weekday: 2, start: "09:00", end: "18:00" }], breaks: [{ weekday: 1, start: "14:00", end: "14:30" }], agentTimezone: "Asia/Tokyo" };
  await rejects(cfg.saveSchedule(db, agent, { ...week, userId: "a2" }), "لا يمكنك تعديل جدول مندوب آخر");
  await cfg.saveSchedule(db, agent, week);
  await cfg.saveSchedule(db, agent, { ...week, availability: [{ weekday: 1, start: "10:00", end: "15:00" }], breaks: [] });
  const c = await cfg.getCalendarConfig(db, agent, {});
  assert.deepEqual(c.availability, [{ weekday: 1, start: "10:00", end: "15:00" }], "Tuesday was removed and Monday changed");
  assert.deepEqual([c.breaks.length, c.agentTimezone], [0, "Asia/Tokyo"]);
  await cfg.saveSchedule(db, manager, { userId: "a2", availability: [{ weekday: 3, start: "09:00", end: "12:00" }], breaks: [] });
  assert.equal((await cfg.getCalendarConfig(db, manager, { userId: "a2" })).availability[0]!.weekday, 3);
  await rejects(cfg.getCalendarConfig(db, agent, { userId: "a2" }), "لا يمكنك عرض إعدادات مندوب آخر");
  await rejects(cfg.saveSchedule(db, manager, { userId: "b1", availability: [], breaks: [] }), "المندوب غير فعّال في هذه المؤسسة");
  await cfg.saveSchedule(db, agent, { availability: [], breaks: [], agentTimezone: null });
  assert.deepEqual((await cfg.getCalendarConfig(db, agent, {})).availability, [], "empty = the organization's hours apply again");
  assert.equal(db.tables.cal_agent_prefs.length, 0);
});

test("schedule validation: duplicate or bad days, bad times, breaks, unknown time zone", async () => {
  const db = setup();
  const base = { availability: [], breaks: [] };
  await rejects(cfg.saveSchedule(db, agent, { ...base, availability: [{ weekday: 1, start: "09:00", end: "12:00" }, { weekday: 1, start: "13:00", end: "16:00" }] }), "يوم العمل غير صحيح أو مكرر");
  await rejects(cfg.saveSchedule(db, agent, { ...base, availability: [{ weekday: 9, start: "09:00", end: "12:00" }] }), "يوم العمل غير صحيح أو مكرر");
  await rejects(cfg.saveSchedule(db, agent, { ...base, availability: [{ weekday: 1, start: "9", end: "12:00" }] }), /ساعة:دقيقة/);
  await rejects(cfg.saveSchedule(db, agent, { ...base, breaks: [{ weekday: 1, start: "15:00", end: "14:00" }] }), /وقت النهاية يجب أن يكون بعد البداية/);
  await rejects(cfg.saveSchedule(db, agent, { ...base, breaks: [{ weekday: 1, start: "15:00", end: "00:00" }] }), /وقت النهاية يجب أن يكون بعد البداية/, "a break cannot end at 00:00");
  await rejects(cfg.saveSchedule(db, agent, { ...base, agentTimezone: "Nope/Zone" }), "المنطقة الزمنية غير معروفة");
  assert.equal(db.tables.cal_availability.length, 0);
});

test("days off: own only (a manager any member), dates checked, delete only inside the organization and by the owner", async () => {
  const db = setup();
  await cfg.addTimeOff(db, agent, { from: "2026-12-01", to: "2026-12-03", reason: " سفر " });
  await rejects(cfg.addTimeOff(db, agent, { from: "2026-12-05", to: "2026-12-01" }), "تاريخ الإجازة غير صحيح");
  await rejects(cfg.addTimeOff(db, agent, { userId: "a2", from: "2026-12-01", to: "2026-12-01" }), "لا يمكنك تعديل إجازات مندوب آخر");
  await cfg.addTimeOff(db, manager, { userId: "a2", from: "2026-12-10", to: "2026-12-10" });
  const mine = await cfg.getCalendarConfig(db, agent, {});
  assert.deepEqual(mine.timeOff.map((t) => [t.from, t.to, t.reason]), [["2026-12-01", "2026-12-03", "سفر"]]);
  const other = db.tables.cal_time_off.find((t: any) => t.user_id === "a2").id;
  await rejects(cfg.deleteTimeOff(db, agent, other), "الإجازة غير موجودة");
  await rejects(cfg.deleteTimeOff(db, actor("b1", { canManage: true }, B), other), "الإجازة غير موجودة");
  await cfg.deleteTimeOff(db, manager, other);
  assert.equal(db.tables.cal_time_off.length, 1);
});

test("meeting types: only a manager; scoped to the organization; validated; new ones go last", async () => {
  const db = setup();
  await rejects(cfg.saveMeetingType(db, agent, { name: "x", durationMinutes: 30, color: "#112233" }), "ليس لديك صلاحية إدارة التقويم");
  await rejects(cfg.saveMeetingType(db, manager, { name: " ", durationMinutes: 30, color: "#112233" }), /اسم النوع/);
  await rejects(cfg.saveMeetingType(db, manager, { name: "x", durationMinutes: 3, color: "#112233" }), /5 إلى 600/);
  await rejects(cfg.saveMeetingType(db, manager, { name: "x", durationMinutes: 30, color: "red" }), "اللون غير صحيح");
  const { id } = await cfg.saveMeetingType(db, manager, { name: "  ديمو  ", durationMinutes: 45, color: "#AABBCC" });
  assert.deepEqual(db.tables.cal_meeting_types.find((t: any) => t.id === id), { id, organization_id: A, sort_order: 2, name: "ديمو", duration_minutes: 45, color: "#AABBCC" });
  await rejects(cfg.saveMeetingType(db, manager, { id: "tB", name: "اختراق", durationMinutes: 30, color: "#000000" }), "النوع غير موجود");
  assert.equal(db.tables.cal_meeting_types.find((t: any) => t.id === "tB").name, "نوع ب", "another organization's type was not touched");
  await cfg.saveMeetingType(db, manager, { id: "tA", name: "عرض", durationMinutes: 30, color: "#112233", isActive: false });
  assert.equal(db.tables.cal_meeting_types.find((t: any) => t.id === "tA").is_active, false);
});

test("meetings of one opportunity or customer: newest first, scoped to the organization and to the agent", async () => {
  const m = (id: string, org: string, owner: string, day: number, extra: any = {}) => ({ id, organization_id: org, owner_user_id: owner, opportunity_id: "o1", contact_id: "c1", starts_at: `2026-11-${day}T10:00:00.000Z`, ends_at: `2026-11-${day}T11:00:00.000Z`, status: "booked", ...extra });
  const db = setup({ cal_meetings: [m("m1", A, "a1", 20), m("m2", A, "a2", 22), m("m3", B, "b1", 23), m("m4", A, "a1", 25, { opportunity_id: "o2" })] });
  assert.deepEqual((await svc.listEntityMeetings(db, agent, { opportunityId: "o1" })).map((x: any) => x.id), ["m1"], "an agent sees only their own");
  assert.deepEqual((await svc.listEntityMeetings(db, manager, { opportunityId: "o1" })).map((x: any) => x.id), ["m2", "m1"], "a manager sees the organization's, newest first, never the other organization's");
  assert.deepEqual((await svc.listEntityMeetings(db, manager, { contactId: "c1" })).map((x: any) => x.id), ["m4", "m2", "m1"]);
  await rejects(svc.listEntityMeetings(db, manager, {}), "حدّد الفرصة أو العميل");
});

test("ICS export: own meetings only, nothing but time and type leaves, cancelled left out", async () => {
  const m = (id: string, owner: string, extra: any = {}) => ({ id, organization_id: A, owner_user_id: owner, contact_id: "c1", meeting_type_id: "tA", starts_at: "2026-11-23T07:00:00.000Z", ends_at: "2026-11-23T08:00:00.000Z", status: "booked", channel: "call", location: "+905066903027", internal_notes: "SECRET", ...extra });
  const db = setup({ cal_meetings: [m("m1", "a1"), m("m2", "a2", { starts_at: "2026-11-23T09:00:00.000Z", ends_at: "2026-11-23T10:00:00.000Z" }), m("m3", "a1", { status: "cancelled", starts_at: "2026-11-23T12:00:00.000Z", ends_at: "2026-11-23T13:00:00.000Z" })], crm_contacts: [{ id: "c1", organization_id: A, display_name: "أحمد علي" }] });
  const range = { from: "2026-11-23T00:00:00.000Z", to: "2026-11-24T00:00:00.000Z", now: new Date("2026-11-23T06:00:00Z") };
  const ics = await svc.exportMeetingsIcs(db, agent, { ...range, ownerId: "a2" });
  assert.ok(ics.includes("m1@novasales") && !ics.includes("m2@novasales") && !ics.includes("m3@novasales"), "an agent gets only their own, even when asking for a colleague");
  assert.ok(!/905066903027|SECRET|أحمد/.test(ics));
  assert.ok((await svc.exportMeetingsIcs(db, manager, { ...range, ownerId: "a2" })).includes("m2@novasales"));
});
