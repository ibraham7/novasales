import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { CHANNELS, OUTCOMES, STATUSES } from "./status";

const id = z.string().uuid();
const iso = z.string().trim().min(10).max(40);

/** Who is calling, and what the calendar lets them do. Every function below starts here, so the organization is always the caller's. */
async function calendarAccess() {
  const { getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const access = await getWorkspaceAccess();
  const has = (key: string) => access.isSuperAdmin || access.permissions.includes(key);
  const actor = {
    userId: access.userId,
    organizationId: access.organizationId,
    canViewAll: has("calendar.view_all"),
    canBook: has("calendar.book"),
    canManage: has("calendar.manage"),
  };
  if (!(has("calendar.view") || actor.canViewAll || actor.canBook || actor.canManage)) throw new Error("ليس لديك صلاحية استخدام التقويم");
  return { actor, db: supabaseAdmin as any };
}

const meetingFields = {
  ownerId: id.optional(),
  startsAt: iso,
  endsAt: iso.optional(),
  contactId: id.nullable().optional(),
  leadId: id.nullable().optional(),
  opportunityId: id.nullable().optional(),
  meetingTypeId: id.nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  channel: z.enum(CHANNELS).optional(),
  location: z.string().max(500).nullable().optional(),
  internalNotes: z.string().max(4000).nullable().optional(),
};

export const getCalendarState = createServerFn({ method: "GET" }).handler(async () => {
  const { actor, db } = await calendarAccess();
  return (await import("./service")).getCalendarState(db, actor);
});

export const enableCalendar = createServerFn({ method: "POST" }).handler(async () => {
  const { actor, db } = await calendarAccess();
  return (await import("./service")).enableCalendar(db, actor);
});

export const disableCalendar = createServerFn({ method: "POST" }).handler(async () => {
  const { actor, db } = await calendarAccess();
  return (await import("./service")).disableCalendar(db, actor);
});

export const listMeetingTypes = createServerFn({ method: "GET" }).handler(async () => {
  const { actor, db } = await calendarAccess();
  return (await import("./service")).listMeetingTypes(db, actor);
});

export const listMeetings = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ from: iso, to: iso, ownerId: id.nullable().optional(), includeInactive: z.boolean().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { actor, db } = await calendarAccess();
    return (await import("./service")).listMeetings(db, actor, data);
  });

export const getMeeting = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { actor, db } = await calendarAccess();
    return (await import("./service")).getMeeting(db, actor, data.id);
  });

export const createMeeting = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ ...meetingFields, status: z.enum(["booked", "confirmed"]).optional() }).parse(d))
  .handler(async ({ data }) => {
    const { actor, db } = await calendarAccess();
    return (await import("./service")).createMeeting(db, actor, data);
  });

export const updateMeeting = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, patch: z.object({ ...meetingFields, startsAt: iso.optional() }) }).parse(d))
  .handler(async ({ data }) => {
    const { actor, db } = await calendarAccess();
    return (await import("./service")).updateMeeting(db, actor, data.id, data.patch);
  });

export const setMeetingStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, status: z.enum(STATUSES), reason: z.string().max(500).nullable().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { actor, db } = await calendarAccess();
    return (await import("./service")).setMeetingStatus(db, actor, data.id, data.status, data.reason);
  });

export const recordMeetingOutcome = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id, outcome: z.enum(OUTCOMES), note: z.string().max(2000).nullable().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { actor, db } = await calendarAccess();
    return (await import("./service")).recordOutcome(db, actor, data.id, data.outcome, data.note);
  });

export const suggestMeetingTimes = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ durationMin: z.number().int().min(5).max(600).optional(), meetingTypeId: id.nullable().optional(), ownerIds: z.array(id).max(10).optional(), count: z.number().int().min(1).max(10).optional() }).parse(d))
  .handler(async ({ data }) => {
    const { actor, db } = await calendarAccess();
    return (await import("./service")).suggestTimes(db, actor, data);
  });
