/**
 * Calendar export (ICS, RFC 5545) for the person's own phone/Google/Outlook calendar. Times are UTC. Privacy: the title is
 * only the meeting type (never the customer's name or phone), no description, and the place/link appears only for
 * link and in-person meetings (for calls and WhatsApp the "place" is usually a phone number). Cancelled and no-show are left out.
 */
export type IcsMeeting = { id: string; starts_at: string; ends_at: string; status: string; type_name?: string | null; channel?: string | null; location?: string | null };

const SKIP = new Set(["cancelled", "no_show"]);
const STATUS: Record<string, string> = { booked: "TENTATIVE", confirmed: "CONFIRMED", in_progress: "CONFIRMED", completed: "CONFIRMED" };

export const icsEscape = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (iso: string | Date) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

/** Folds a line at 75 bytes (never inside a multi-byte character), continuation lines start with a space. */
export function icsFold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "", bytes = 0, limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) { parts.push(current); current = ""; bytes = 0; limit = 74; }
    current += ch; bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(meetings: IcsMeeting[], opts: { now: Date; name?: string }): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NovaSales//Calendar//AR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEscape(opts.name ?? "NovaSales")}`];
  for (const m of meetings) {
    if (SKIP.has(m.status)) continue;
    lines.push("BEGIN:VEVENT", `UID:${m.id}@novasales`, `DTSTAMP:${stamp(opts.now)}`, `DTSTART:${stamp(m.starts_at)}`, `DTEND:${stamp(m.ends_at)}`, `SUMMARY:${icsEscape(m.type_name?.trim() || "اجتماع")}`);
    if ((m.channel === "link" || m.channel === "in_person") && m.location?.trim()) lines.push(`LOCATION:${icsEscape(m.location.trim())}`);
    lines.push(`STATUS:${STATUS[m.status] ?? "TENTATIVE"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
