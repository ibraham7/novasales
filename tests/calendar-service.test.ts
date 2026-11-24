import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import * as svc from "../src/modules/calendar/service.ts";
import { zonedToUtc } from "../src/modules/calendar/time.ts";

const A = "org-a", B = "org-b";
const iso = (date: string, time: string) => new Date(zonedToUtc(date, time, "Europe/Istanbul")!).toISOString();
const actor = (userId: string, extra: Partial<svc.Actor> = {}, organizationId = A): svc.Actor => ({ userId, organizationId, canViewAll: false, canBook: true, canManage: false, ...extra });
const agent1 = actor("a1"), agent2 = actor("a2"), manager = actor("mgr", { canViewAll: true, canManage: true }), readOnly = actor("a1", { canBook: false });
const meeting = (id: string, org: string, owner: string, from: string, to: string, extra: any = {}) => ({ id, organization_id: org, owner_user_id: owner, starts_at: iso("2026-11-23", from), ends_at: iso("2026-11-23", to), status: "booked", channel: "call", title: `T-${id}`, ...extra });

function setup(extra: Record<string, any[]> = {}, enabled = { [A]: true, [B]: true } as Record<string, boolean>) {
  const db: any = fakeDb({
    cal_settings: Object.entries(enabled).map(([organization_id, cal_enabled]) => ({ organization_id, cal_enabled, timezone: "Europe/Istanbul", working_days: [1, 2, 3, 4, 5], work_start: "09:00", work_end: "18:00" })),
    org_memberships: [
      ...["a1", "a2", "mgr", "shared"].map((user_id) => ({ user_id, organization_id: A, is_active: true })),
      ...["b1", "shared"].map((user_id) => ({ user_id, organization_id: B, is_active: true })),
    ],
    crm_contacts: [{ id: "cA", organization_id: A, display_name: "عميل أ" }, { id: "cB", organization_id: B, display_name: "عميل ب" }],
    crm_leads: [{ id: "lB", organization_id: B }],
    opp_opportunities: [{ id: "oA", organization_id: A, stage: "new" }, { id: "oB", organization_id: B }],
    cal_meeting_types: [{ id: "tA", organization_id: A, name: "عرض توضيحي", duration_minutes: 30, color: "#8b5cf6", sort_order: 1, is_active: true }, { id: "tB", organization_id: B, name: "نوع ب", duration_minutes: 30, color: "#000000", sort_order: 1, is_active: true }],
    profiles: [{ id: "a1", full_name: "مندوب 1" }],
    cal_meetings: [],
    cal_meeting_attendees: [],
    ...extra,
  });
  const rpcCalls: any[] = [];
  db.rpc = async (name: string, args: any) => { rpcCalls.push([name, args]); return { error: null }; };
  return { db, rpcCalls };
}
const input = (extra: any = {}) => ({ startsAt: iso("2026-11-23", "10:00"), endsAt: iso("2026-11-23", "11:00"), ...extra });
const rejects = (p: Promise<unknown>, message: string | RegExp) => assert.rejects(p, (e: Error) => (typeof message === "string" ? e.message === message : message.test(e.message)));

test("off by default: nothing can be booked or suggested until a manager switches the calendar on", async () => {
  const { db, rpcCalls } = setup({}, { [A]: false });
  await rejects(svc.createMeeting(db, agent1, input()), "التقويم غير مفعّل لهذه المؤسسة");
  await rejects(svc.suggestTimes(db, agent1, { durationMin: 30 }), "التقويم غير مفعّل لهذه المؤسسة");
  assert.deepEqual(await svc.getCalendarState(db, agent1), { viewerId: agent1.userId, enabled: false, timezone: "Europe/Istanbul", viewerTimezone: "Europe/Istanbul", workStart: "09:00", workEnd: "18:00", workingDays: [1, 2, 3, 4, 5], canViewAll: false, canBook: true, canManage: false });
  await rejects(svc.enableCalendar(db, agent1), "ليس لديك صلاحية إدارة التقويم");
  assert.equal(rpcCalls.length, 0);
  await svc.enableCalendar(db, manager);
  assert.deepEqual(rpcCalls, [["cal_enable", { _org: A, _actor: "mgr" }]]);
  assert.equal(db.tables.cal_meetings.length, 0);
});

test("an agent books for themselves; the meeting carries the organization and the actor, and names are filled in", async () => {
  const { db } = setup();
  const m = await svc.createMeeting(db, agent1, input({ contactId: "cA", opportunityId: "oA", meetingTypeId: "tA", internalNotes: "  ملاحظة  " }));
  assert.deepEqual([m.organization_id, m.owner_user_id, m.created_by, m.status, m.contact_name, m.type_name, m.owner_name, m.internal_notes], [A, "a1", "a1", "booked", "عميل أ", "عرض توضيحي", "مندوب 1", "ملاحظة"]);
  const byType = await svc.createMeeting(db, agent1, { startsAt: iso("2026-11-23", "14:00"), meetingTypeId: "tA" });
  assert.equal(new Date(byType.ends_at).getTime() - new Date(byType.starts_at).getTime(), 30 * 60_000, "end comes from the type's duration");
  await rejects(svc.createMeeting(db, agent1, { startsAt: iso("2026-11-23", "15:00") }), "اكتب وقت نهاية الموعد أو اختر نوعاً له مدة");
});

test("who may book: a read-only person no; an agent for a colleague no; a manager yes, but only for a member of the organization", async () => {
  const { db } = setup();
  await rejects(svc.createMeeting(db, readOnly, input()), "ليس لديك صلاحية حجز المواعيد");
  await rejects(svc.createMeeting(db, agent1, input({ ownerId: "a2" })), "لا يمكنك حجز موعد لمندوب آخر");
  assert.equal((await svc.createMeeting(db, manager, input({ ownerId: "a2" }))).owner_user_id, "a2");
  await rejects(svc.createMeeting(db, manager, input({ ownerId: "b1", startsAt: iso("2026-11-23", "12:00"), endsAt: iso("2026-11-23", "12:30") })), "المندوب غير فعّال في هذه المؤسسة");
  assert.equal(db.tables.cal_meetings.length, 1);
});

test("reading: an agent sees only their own meetings, a manager sees the organization, never another organization", async () => {
  const { db } = setup({ cal_meetings: [meeting("m1", A, "a1", "09:00", "10:00"), meeting("m2", A, "a2", "10:00", "11:00"), meeting("m3", B, "b1", "09:00", "10:00"), meeting("m4", A, "a1", "11:00", "12:00", { status: "cancelled" })] });
  const range = { from: iso("2026-11-23", "00:00"), to: iso("2026-11-24", "00:00") };
  assert.deepEqual((await svc.listMeetings(db, agent1, range)).map((m: any) => m.id), ["m1"]);
  assert.deepEqual((await svc.listMeetings(db, agent1, { ...range, ownerId: "a2" })).map((m: any) => m.id), ["m1"], "an agent cannot ask for a colleague's calendar");
  assert.deepEqual((await svc.listMeetings(db, manager, range)).map((m: any) => m.id), ["m1", "m2"]);
  assert.deepEqual((await svc.listMeetings(db, manager, { ...range, ownerId: "a2" })).map((m: any) => m.id), ["m2"]);
  assert.deepEqual((await svc.listMeetings(db, manager, { ...range, includeInactive: true })).map((m: any) => m.id), ["m1", "m2", "m4"]);
  assert.deepEqual((await svc.listMeetings(db, actor("b1", {}, B), range)).map((m: any) => m.id), ["m3"]);
  await rejects(svc.listMeetings(db, manager, { from: range.from, to: iso("2027-03-01", "00:00") }), /لا يتجاوز 70 يوماً/);
  await rejects(svc.listMeetings(db, manager, { from: range.to, to: range.from }), "نطاق التاريخ غير صحيح");
});

test("by id: a colleague's meeting and another organization's meeting look exactly like a missing one, and cannot be changed", async () => {
  const { db } = setup({ cal_meetings: [meeting("m1", A, "a1", "09:00", "10:00"), meeting("m2", A, "a2", "10:00", "11:00"), meeting("m3", B, "b1", "09:00", "10:00")] });
  for (const id of ["m2", "m3", "nope"]) {
    await rejects(svc.getMeeting(db, agent1, id), "الموعد غير موجود");
    await rejects(svc.updateMeeting(db, agent1, id, { title: "x" }), "الموعد غير موجود");
    await rejects(svc.setMeetingStatus(db, agent1, id, "confirmed"), "الموعد غير موجود");
    await rejects(svc.recordOutcome(db, agent1, id, "lost"), "الموعد غير موجود");
  }
  await rejects(svc.getMeeting(db, manager, "m3"), "الموعد غير موجود");
  await rejects(svc.setMeetingStatus(db, manager, "m3", "cancelled"), "الموعد غير موجود");
  assert.deepEqual(db.tables.cal_meetings.map((m: any) => [m.id, m.status, m.title]), [["m1", "booked", "T-m1"], ["m2", "booked", "T-m2"], ["m3", "booked", "T-m3"]], "nothing changed");
  assert.equal((await svc.getMeeting(db, manager, "m2")).id, "m2");
});

test("links from another organization are refused and nothing is written", async () => {
  const { db } = setup();
  for (const extra of [{ contactId: "cB" }, { leadId: "lB" }, { opportunityId: "oB" }, { meetingTypeId: "tB" }]) {
    await rejects(svc.createMeeting(db, agent1, input(extra)), "العميل أو الفرصة أو نوع الموعد لا يتبع هذه المؤسسة");
  }
  assert.equal(db.tables.cal_meetings.length, 0);
  const m = await svc.createMeeting(db, agent1, input());
  await rejects(svc.updateMeeting(db, agent1, m.id, { contactId: "cB" }), "العميل أو الفرصة أو نوع الموعد لا يتبع هذه المؤسسة");
});

test("the same person in two organizations: busy in one blocks the other, with a message that reveals nothing", async () => {
  const { db } = setup({ cal_meetings: [meeting("mb", B, "shared", "10:00", "11:00", { title: "SECRET-TITLE" })] });
  let message = "";
  try { await svc.createMeeting(db, actor("shared"), input({ startsAt: iso("2026-11-23", "10:30"), endsAt: iso("2026-11-23", "11:30") })); } catch (e) { message = (e as Error).message; }
  assert.equal(message, "المندوب مشغول بهذا الوقت");
  assert.ok(!/org-b|SECRET|mb/.test(message));
  assert.ok((await svc.createMeeting(db, actor("shared"), input({ startsAt: iso("2026-11-23", "11:00"), endsAt: iso("2026-11-23", "12:00") }))).id, "back-to-back is fine");
});

test("hours, breaks and overlap inside the organization are refused with plain Arabic", async () => {
  const { db } = setup({ cal_availability: [], cal_breaks: [{ organization_id: A, user_id: "a1", weekday: 1, start_time: "12:00:00", end_time: "13:00:00" }], cal_time_off: [{ organization_id: A, user_id: "a1", starts_on: "2026-11-25", ends_on: "2026-11-25" }] });
  await rejects(svc.createMeeting(db, agent1, { startsAt: iso("2026-11-23", "07:00"), endsAt: iso("2026-11-23", "08:00") }), "الموعد خارج ساعات عمل المندوب");
  await rejects(svc.createMeeting(db, agent1, { startsAt: iso("2026-11-28", "10:00"), endsAt: iso("2026-11-28", "11:00") }), "هذا اليوم خارج أيام العمل");
  await rejects(svc.createMeeting(db, agent1, { startsAt: iso("2026-11-23", "12:15"), endsAt: iso("2026-11-23", "12:45") }), "الموعد يتعارض مع استراحة المندوب");
  await rejects(svc.createMeeting(db, agent1, { startsAt: iso("2026-11-25", "10:00"), endsAt: iso("2026-11-25", "11:00") }), "المندوب في إجازة في هذا اليوم");
  await svc.createMeeting(db, agent1, input());
  await rejects(svc.createMeeting(db, agent1, input({ startsAt: iso("2026-11-23", "10:30"), endsAt: iso("2026-11-23", "11:30") })), "المندوب مشغول بهذا الوقت");
  assert.equal(db.tables.cal_meetings.length, 1);
});

test("rescheduling: a meeting never clashes with itself, moving into a busy time is refused, a finished one cannot move", async () => {
  const { db } = setup({ cal_meetings: [meeting("m1", A, "a1", "10:00", "11:00"), meeting("m2", A, "a1", "14:00", "15:00"), meeting("done", A, "a1", "16:00", "17:00", { status: "completed" })] });
  const moved = await svc.updateMeeting(db, agent1, "m1", { startsAt: iso("2026-11-23", "10:30") });
  assert.equal(moved.ends_at, iso("2026-11-23", "11:30"), "the length is kept");
  await rejects(svc.updateMeeting(db, agent1, "m1", { startsAt: iso("2026-11-23", "14:30") }), "المندوب مشغول بهذا الوقت");
  await rejects(svc.updateMeeting(db, agent1, "done", { startsAt: iso("2026-11-23", "09:00") }), "الموعد منتهٍ ولا يمكن تغيير وقته أو مسؤوله");
  await rejects(svc.updateMeeting(db, agent1, "m1", { ownerId: "a2" }), "لا يمكنك نقل الموعد لمندوب آخر");
  assert.equal((await svc.updateMeeting(db, manager, "m1", { ownerId: "a2" })).owner_user_id, "a2");
  assert.equal((await svc.updateMeeting(db, agent1, "m2", { title: "عنوان جديد" })).title, "عنوان جديد");
});

test("statuses and outcome: allowed moves only, cancel keeps the reason, the outcome comes after completed and never moves the opportunity", async () => {
  const { db } = setup({ cal_meetings: [meeting("m1", A, "a1", "10:00", "11:00"), meeting("m2", A, "a1", "12:00", "13:00")] });
  await rejects(svc.recordOutcome(db, agent1, "m1", "advanced"), "تُسجَّل نتيجة الموعد بعد انتهائه فقط");
  assert.equal((await svc.setMeetingStatus(db, agent1, "m1", "confirmed")).status, "confirmed");
  assert.equal((await svc.setMeetingStatus(db, agent1, "m1", "in_progress")).status, "in_progress");
  await rejects(svc.setMeetingStatus(db, agent1, "m1", "confirmed"), "لا يمكن نقل الموعد إلى هذه الحالة");
  await svc.setMeetingStatus(db, agent1, "m1", "completed");
  const done = await svc.recordOutcome(db, agent1, "m1", "needs_followup", "  نتابع الأسبوع القادم ");
  assert.deepEqual([done.outcome, done.outcome_note], ["needs_followup", "نتابع الأسبوع القادم"]);
  await rejects(svc.recordOutcome(db, agent1, "m1", "won"), "نتيجة الموعد غير معروفة");
  await rejects(svc.setMeetingStatus(db, agent1, "m1", "cancelled"), "لا يمكن نقل الموعد إلى هذه الحالة");
  const cancelled = await svc.setMeetingStatus(db, agent1, "m2", "cancelled", "العميل اعتذر");
  assert.deepEqual([cancelled.status, cancelled.cancellation_reason], ["cancelled", "العميل اعتذر"]);
  await rejects(svc.setMeetingStatus(db, agent1, "m2", "completed"), "لا يمكن نقل الموعد إلى هذه الحالة");
  assert.deepEqual(db.tables.opp_opportunities.find((o: any) => o.id === "oA"), { id: "oA", organization_id: A, stage: "new" }, "the opportunity was not touched");
  assert.equal(db.calls.filter((c: any) => c.table === "opp_opportunities" && c.op !== "select").length, 0);
});

test("database errors become plain Arabic and never show details", async () => {
  const { db } = setup();
  const real = db.from.bind(db);
  db.from = (table: string) => {
    const q = real(table);
    if (table === "cal_meetings") q.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'conflicting key value violates exclusion constraint "cal_meetings_owner_no_overlap" DETAIL: Key (owner_user_id, tstzrange(starts_at, ends_at))=(shared, [x,y)) conflicts with existing key from organization org-b' } }) }) });
    return q;
  };
  let message = "";
  try { await svc.createMeeting(db, agent1, input()); } catch (e) { message = (e as Error).message; }
  assert.equal(message, "المندوب مشغول بهذا الوقت");
});

test("suggested times: scoped to the agent, skip busy time in ANY organization, and every one is bookable", async () => {
  const { db } = setup({ cal_meetings: [meeting("mb", B, "shared", "09:00", "11:00")] });
  const now = new Date(iso("2026-11-23", "08:00")).getTime();
  const slots = await svc.suggestTimes(db, actor("shared"), { durationMin: 30, now, count: 2 });
  assert.deepEqual(slots.map((s: any) => s.start), ["11:00", "11:30"], "09:00-11:00 is taken in the other organization");
  assert.ok(slots.every((s: any) => Object.keys(s).sort().join() === "date,end,endsAt,ownerId,start,startsAt"), "only times leave the function");
  for (const s of slots) await svc.createMeeting(db, actor("shared"), { startsAt: s.startsAt, endsAt: s.endsAt });
  const forOthers = await svc.suggestTimes(db, agent1, { durationMin: 30, ownerIds: ["a2"], now, count: 1 });
  assert.equal(forOthers[0].ownerId, "a1", "an agent only gets their own times");
  assert.equal((await svc.suggestTimes(db, manager, { meetingTypeId: "tA", ownerIds: ["a2"], now, count: 1 }))[0].ownerId, "a2");
  await rejects(svc.suggestTimes(db, manager, { meetingTypeId: "tB", now }), "العميل أو الفرصة أو نوع الموعد لا يتبع هذه المؤسسة");
  await rejects(svc.suggestTimes(db, manager, { ownerIds: ["b1"], durationMin: 30, now }), "المندوب غير فعّال في هذه المؤسسة");
});

test("every read and write of an organization's data is scoped to the actor's organization (or to the person for busy times)", async () => {
  const { db } = setup({ cal_meetings: [meeting("m1", A, "a1", "09:00", "10:00")] });
  await svc.listMeetings(db, agent1, { from: iso("2026-11-23", "00:00"), to: iso("2026-11-24", "00:00") });
  await svc.createMeeting(db, agent1, input({ contactId: "cA", meetingTypeId: "tA" }));
  await svc.setMeetingStatus(db, agent1, "m1", "confirmed");
  await svc.suggestTimes(db, agent1, { durationMin: 30 });
  for (const call of db.calls) {
    if (call.op === "insert" || call.table === "profiles") continue;
    const has = (column: string, value: string) => call.filters.some(([, c, v]: any) => c === column && v === value);
    // A person's busy time spans organizations: by owner, by the meetings they take part in (their user id), or by those meeting ids.
    const byPerson = (call.table === "cal_meetings" && call.filters.some(([, c]: any) => c === "owner_user_id" || c === "id")) || (call.table === "cal_meeting_attendees" && call.filters.some(([, c]: any) => c === "user_id"));
    const ok = has("organization_id", A) || byPerson;
    assert.ok(ok, `${call.table} ${call.op} is not scoped: ${JSON.stringify(call.filters)}`);
  }
});

test("who a meeting can be booked for: an agent only themselves, a manager the active members of their own organization", async () => {
  const { db } = setup({ profiles: [{ id: "a1", full_name: "مندوب 1" }, { id: "a2", full_name: "مندوب 2" }, { id: "b1", full_name: "مندوب ب" }] });
  assert.deepEqual(await svc.listOwners(db, agent1), [{ id: "a1", name: "مندوب 1" }]);
  const owners = await svc.listOwners(db, manager);
  assert.deepEqual(owners.map((o: any) => o.id).sort(), ["a1", "a2", "mgr", "shared"], "no member of organization B");
});

test("a ticket's meeting list also shows meetings booked for the same customer from the calendar (contact only)", async () => {
  const { db } = setup({ cal_meetings: [
    meeting("viaOpp", A, "mgr", "10:00", "10:30", { opportunity_id: "oA", contact_id: "cA" }),
    meeting("viaContact", A, "mgr", "11:00", "11:30", { contact_id: "cA" }),
    meeting("other", A, "mgr", "12:00", "12:30", { contact_id: "cOther" }),
  ] });
  const ids = (await svc.listEntityMeetings(db, manager, { opportunityId: "oA", contactId: "cA" })).map((m: any) => m.id).sort();
  assert.deepEqual(ids, ["viaContact", "viaOpp"]);
  assert.deepEqual((await svc.listEntityMeetings(db, manager, { contactId: "cA" })).map((m: any) => m.id).sort(), ["viaContact", "viaOpp"]);
  assert.deepEqual((await svc.listEntityMeetings(db, manager, { opportunityId: "oA" })).map((m: any) => m.id), ["viaOpp"]);
});

test("an agent also sees and handles meetings of THEIR tickets and leads that a manager booked under another name; never other agents' meetings", async () => {
  const { db } = setup({
    opp_opportunities: [{ id: "oA", organization_id: A, owner_agent_id: "a1" }, { id: "oOther", organization_id: A, owner_agent_id: "a2" }],
    crm_leads: [{ id: "lA", organization_id: A, owner_user_id: "a1" }],
    cal_meetings: [
      meeting("mine-by-owner", A, "a1", "09:00", "09:30"),
      meeting("booked-by-manager-opp", A, "mgr", "10:00", "10:30", { opportunity_id: "oA", created_by: "mgr" }),
      meeting("booked-by-manager-lead", A, "mgr", "11:00", "11:30", { lead_id: "lA", created_by: "mgr" }),
      meeting("other-agents-ticket", A, "mgr", "12:00", "12:30", { opportunity_id: "oOther", created_by: "mgr" }),
      meeting("manager-private", A, "mgr", "13:00", "13:30", { created_by: "mgr" }),
    ],
  });
  const range = { from: iso("2026-11-23", "00:00"), to: iso("2026-11-24", "00:00") };
  assert.deepEqual((await svc.listMeetings(db, agent1, range)).map((m: any) => m.id), ["mine-by-owner", "booked-by-manager-opp", "booked-by-manager-lead"]);
  assert.deepEqual((await svc.listMeetings(db, agent2, range)).map((m: any) => m.id), ["other-agents-ticket"]);
  assert.equal((await svc.listMeetings(db, manager, range)).length, 5);
  assert.deepEqual((await svc.listEntityMeetings(db, agent1, { opportunityId: "oA", contactId: "cA" })).map((m: any) => m.id), ["booked-by-manager-opp"]);
  assert.equal((await svc.getMeeting(db, agent1, "booked-by-manager-opp")).id, "booked-by-manager-opp");
  await rejects(svc.getMeeting(db, agent1, "other-agents-ticket"), /غير موجود|لا يوجد|not found/i);
  await rejects(svc.getMeeting(db, agent1, "manager-private"), /غير موجود|لا يوجد|not found/i);
});

test("a meeting WITH a team member (a manager's meeting with an agent): it shows in the agent's calendar and blocks the agent's time", async () => {
  const { db } = setup();
  // The manager books a meeting under their own name with agent a1 taking part.
  const m = await svc.createMeeting(db, manager, input({ ownerId: "mgr", title: "اجتماع مع الإدارة", attendeeIds: ["a1"] }));
  assert.deepEqual(m.attendees.map((a: any) => a.id), ["a1"]);
  const range = { from: iso("2026-11-23", "00:00"), to: iso("2026-11-24", "00:00") };
  assert.deepEqual((await svc.listMeetings(db, agent1, range)).map((x: any) => x.id), [m.id], "the agent sees it");
  assert.deepEqual((await svc.listMeetings(db, agent2, range)).map((x: any) => x.id), [], "another agent does not");
  assert.equal((await svc.getMeeting(db, agent1, m.id)).title, "اجتماع مع الإدارة");
  // The agent cannot be booked for a customer meeting at that time, but can right after.
  await rejects(svc.createMeeting(db, agent1, input({ contactId: "cA" })), "المندوب مشغول بهذا الوقت");
  await rejects(svc.createMeeting(db, manager, input({ ownerId: "a1", contactId: "cA" })), "المندوب مشغول بهذا الوقت");
  const after = await svc.createMeeting(db, agent1, input({ startsAt: iso("2026-11-23", "11:00"), endsAt: iso("2026-11-23", "11:30"), contactId: "cA" }));
  assert.ok(after.id);
  // Suggested times for the agent skip the meeting they take part in.
  const slots = await svc.suggestTimes(db, agent1, { durationMin: 60, now: Date.parse(iso("2026-11-23", "09:00")) });
  assert.ok(slots.every((s: any) => !(Date.parse(s.startsAt) < Date.parse(iso("2026-11-23", "11:00")) && Date.parse(s.endsAt) > Date.parse(iso("2026-11-23", "10:00")))));
});

test("attendees: only managers add them, they must be active members and free, and the owner is not a second time", async () => {
  const { db } = setup();
  await rejects(svc.createMeeting(db, agent1, input({ attendeeIds: ["a2"] })), "إضافة مشاركين من الفريق للمدراء فقط");
  await rejects(svc.createMeeting(db, manager, input({ ownerId: "mgr", attendeeIds: ["mgr"] })), "صاحب الموعد مشارك فيه أصلاً");
  await rejects(svc.createMeeting(db, manager, input({ ownerId: "mgr", attendeeIds: ["stranger"] })), "المندوب غير فعّال في هذه المؤسسة");
  await svc.createMeeting(db, agent2, input());
  await rejects(svc.createMeeting(db, manager, input({ ownerId: "mgr", attendeeIds: ["a2"] })), "أحد المشاركين مشغول بهذا الوقت");
  assert.equal(db.tables.cal_meetings.length, 1, "nothing half-made was left");
});

test("changing the people of a meeting replaces them; moving it checks they are free", async () => {
  const { db } = setup();
  const m = await svc.createMeeting(db, manager, input({ ownerId: "mgr", attendeeIds: ["a1"] }));
  await svc.updateMeeting(db, manager, m.id, { attendeeIds: ["a2"] });
  assert.deepEqual(db.tables.cal_meeting_attendees.map((a: any) => a.user_id), ["a2"]);
  await svc.createMeeting(db, agent2, input({ startsAt: iso("2026-11-23", "12:00"), endsAt: iso("2026-11-23", "12:30") }));
  await rejects(svc.updateMeeting(db, manager, m.id, { startsAt: iso("2026-11-23", "12:00"), endsAt: iso("2026-11-23", "13:00") }), "أحد المشاركين مشغول بهذا الوقت");
  await svc.updateMeeting(db, manager, m.id, { attendeeIds: [] });
  assert.equal(db.tables.cal_meeting_attendees.length, 0);
});

test("deleting a meeting: whoever may handle it, in their own organization; others get «not found»; a read-only user cannot", async () => {
  const { db } = setup({ cal_meetings: [meeting("m1", A, "a1", "09:00", "09:30"), meeting("m2", A, "a2", "10:00", "10:30"), meeting("mB", B, "b1", "09:00", "09:30")] });
  await rejects(svc.deleteMeeting(db, readOnly, "m1"), "ليس لديك صلاحية حذف المواعيد");
  await rejects(svc.deleteMeeting(db, agent1, "m2"), /غير موجود/);
  await rejects(svc.deleteMeeting(db, manager, "mB"), /غير موجود/);
  assert.equal(db.tables.cal_meetings.length, 3, "nothing was removed by the refused attempts");
  assert.deepEqual(await svc.deleteMeeting(db, agent1, "m1"), { ok: true });
  assert.deepEqual(await svc.deleteMeeting(db, manager, "m2"), { ok: true });
  assert.deepEqual(db.tables.cal_meetings.map((m: any) => m.id), ["mB"]);
});
