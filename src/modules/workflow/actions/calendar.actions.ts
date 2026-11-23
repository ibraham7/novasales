/** The automation steps that change a meeting: confirm it, or cancel it. Calm by design: anything not applicable is «skipped». */
import { setMeetingStatusBySystem } from "../../calendar/service.ts";
import type { ActionHandler } from "./registry.server.ts";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function createCalendarActions(deps: { db: any }): Record<"calendar.meeting.confirm" | "calendar.meeting.cancel", ActionHandler> {
  const run = (to: "confirmed" | "cancelled"): ActionHandler => async (config, ctx) => {
    const meetingId = str(config.meeting_id) ?? str(ctx.triggerPayload.meeting_id);
    const result = await setMeetingStatusBySystem(deps.db, ctx.organizationId, meetingId, to, str(config.reason));
    return { ok: true, output: { outcome: result.outcome, reason: result.reason, meeting_id: meetingId, status: result.outcome === "done" ? to : null } };
  };
  return { "calendar.meeting.confirm": run("confirmed"), "calendar.meeting.cancel": run("cancelled") };
}
