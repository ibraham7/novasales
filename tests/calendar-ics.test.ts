import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, icsEscape, icsFold } from "../src/modules/calendar/ics.ts";

const NOW = new Date("2026-11-23T06:00:00Z");
const m = (id: string, extra: any = {}) => ({ id, starts_at: "2026-11-23T07:00:00.000Z", ends_at: "2026-11-23T08:30:00.000Z", status: "confirmed", type_name: "عرض توضيحي", channel: "link", location: "https://meet.example.com/x", ...extra });

test("ICS: UTC times, stable ids, CRLF lines, the right calendar frame", () => {
  const ics = buildIcs([m("a1")], { now: NOW });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("UID:a1@novasales\r\n") && ics.includes("DTSTART:20261123T070000Z\r\n") && ics.includes("DTEND:20261123T083000Z\r\n") && ics.includes("DTSTAMP:20261123T060000Z\r\n"));
  assert.ok(ics.includes("STATUS:CONFIRMED"));
  assert.ok(!/[^\r]\n/.test(ics), "every line ends with CRLF");
});

test("ICS privacy: the title is only the type; no customer name, phone or notes; place only for link and in-person", () => {
  const ics = buildIcs([m("a1", { channel: "call", location: "+905066903027", contact_name: "أحمد علي", internal_notes: "SECRET", title: "T" }), m("a2", { channel: "in_person", location: "المكتب, الطابق 2" })], { now: NOW });
  assert.ok(!/905066903027|أحمد|SECRET|DESCRIPTION|ATTENDEE/.test(ics.replace(/\r\n /g, "")));
  assert.ok(ics.includes("SUMMARY:عرض توضيحي"));
  assert.equal((ics.match(/LOCATION:/g) ?? []).length, 1);
  assert.ok(ics.includes("LOCATION:المكتب\\, الطابق 2"));
});

test("ICS: cancelled and no-show are left out; a meeting without a type is called «اجتماع»; booked is tentative", () => {
  const ics = buildIcs([m("x1", { status: "cancelled" }), m("x2", { status: "no_show" }), m("x3", { status: "booked", type_name: null })], { now: NOW });
  assert.ok(!ics.includes("x1@") && !ics.includes("x2@") && ics.includes("x3@"));
  assert.ok(ics.includes("SUMMARY:اجتماع") && ics.includes("STATUS:TENTATIVE"));
});

test("ICS escaping and folding: special characters escaped; long lines folded at 75 bytes without cutting a letter", () => {
  assert.equal(icsEscape("a,b;c\\d\ne"), "a\\,b\;c\\\\d\\ne");
  const folded = icsFold("SUMMARY:" + "ع".repeat(80));
  for (const line of folded.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, "each line is at most 75 bytes");
  assert.equal(folded.replace(/\r\n /g, ""), "SUMMARY:" + "ع".repeat(80), "unfolding restores the text exactly");
});
