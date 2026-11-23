/**
 * A meeting reminder is written when the meeting is found, but it may go out later (held for the sending hours). Before it
 * leaves, check that the meeting is still the same one: not cancelled, not moved, not already over. Pure on its inputs except
 * for one read; the database is a parameter.
 */
export const MEETING_REMINDER_EVENT = "time.meeting_reminder";
export const MEETING_CHANGED_REASON = "تغيّر الموعد أو أُلغي أو انتهى، فلم يُرسل التذكير";

/** The trigger of a reminder run, or null when this run is not a meeting reminder. */
export function reminderMeeting(trigger: Record<string, unknown> | null | undefined): { id: string; startsAt: string } | null {
  if (!trigger || trigger.time_event !== MEETING_REMINDER_EVENT) return null;
  const id = typeof trigger.meeting_id === "string" ? trigger.meeting_id : null;
  const startsAt = typeof trigger.meeting_starts_at === "string" ? trigger.meeting_starts_at : null;
  return id && startsAt ? { id, startsAt } : null;
}

/** True when the reminder may still be sent. Anything that is not a reminder passes. */
export async function meetingStillValid(db: any, organizationId: string, trigger: Record<string, unknown> | null | undefined, now: Date): Promise<boolean> {
  const wanted = reminderMeeting(trigger);
  if (!wanted) return true;
  const { data } = await db.from("cal_meetings").select("id,status,starts_at").eq("id", wanted.id).eq("organization_id", organizationId).maybeSingle();
  if (!data) return false;
  if (data.status !== "booked" && data.status !== "confirmed") return false;
  const start = new Date(data.starts_at).getTime();
  return start === new Date(wanted.startsAt).getTime() && start > now.getTime();
}
