/**
 * The nearest free times for a meeting of N minutes: used by the booking form and, later, by the chat («هل يناسبك
 * الثلاثاء 3 م؟»). Uses the same rules as the database (validateMeetingTime) and skips times already taken.
 * With several agents the options are different times (one agent per time), earliest first. Pure.
 */
import { effectiveTimezone, overlapsBusy, validateMeetingTime, type Busy, type CalendarContext } from "./rules.ts";
import { addDays, fromMinutes, localParts, zonedToUtc } from "./time.ts";

export type AgentAvailability = { ownerId: string; ctx: CalendarContext; busy: Busy[] };
export type Slot = { ownerId: string; date: string; start: string; end: string; startsAt: string; endsAt: string };

export function suggestSlots(o: { agents: AgentAvailability[]; durationMin: number; now: number; count?: number; horizonDays?: number; stepMin?: number; leadMin?: number }): Slot[] {
  const count = o.count ?? 3, horizon = o.horizonDays ?? 14, step = Math.max(5, o.stepMin ?? 30), lead = o.leadMin ?? 60;
  const all: Slot[] = [];
  for (const agent of o.agents) {
    const tz = effectiveTimezone(agent.ctx);
    const first = localParts(o.now, tz).date;
    let found = 0;
    for (let d = 0; d <= horizon && found < count; d++) {
      const date = addDays(first, d);
      for (let m = 0; m + o.durationMin <= 24 * 60 && found < count; m += step) {
        const start = zonedToUtc(date, fromMinutes(m), tz);
        if (start === null || start < o.now + lead * 60_000) continue;
        const end = start + o.durationMin * 60_000;
        if (validateMeetingTime(agent.ctx, start, end, agent.busy)) continue;
        all.push({ ownerId: agent.ownerId, date, start: fromMinutes(m), end: fromMinutes((m + o.durationMin) % 1440), startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() });
        found++;
      }
    }
  }
  const taken = new Set<string>();
  return all.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).filter((s) => (taken.has(s.startsAt) ? false : (taken.add(s.startsAt), true))).slice(0, count);
}
export { overlapsBusy };
