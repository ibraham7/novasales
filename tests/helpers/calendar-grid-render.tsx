import React from "react";
import { renderToString } from "react-dom/server";
import { CalendarGrid } from "@/components/calendar/calendar-grid";
const meetings = [
  { id: "m1", owner_user_id: "u1", starts_at: "2026-11-23T07:00:00Z", ends_at: "2026-11-23T08:00:00Z", status: "confirmed", title: null, contact_name: "أحمد", type_name: "عرض توضيحي", type_color: "#8b5cf6", owner_name: "مندوب" },
  { id: "m2", owner_user_id: "u2", starts_at: "2026-11-23T07:30:00Z", ends_at: "2026-11-23T08:30:00Z", status: "booked", title: "مكالمة", contact_name: null, type_name: null, type_color: null, owner_name: "مندوب 2" },
  { id: "m3", owner_user_id: "u1", starts_at: "2026-11-24T10:00:00Z", ends_at: "2026-11-24T10:30:00Z", status: "cancelled", title: null, contact_name: "سارة", type_name: "متابعة", type_color: "#10b981", owner_name: "مندوب" },
];
const out: Record<string, string> = {};
for (const view of ["day", "week", "month"] as const) {
  out[view] = renderToString(<CalendarGrid view={view} anchor="2026-11-23" today="2026-11-23" tz="Europe/Istanbul" workStart="09:00" workEnd="18:00" meetings={meetings} showOwner onPick={() => {}} onSlot={() => {}} onDay={() => {}} />);
}
console.log(JSON.stringify(out));
