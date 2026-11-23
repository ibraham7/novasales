// Run with PGLITE_MODULE pointing to a separately installed @electric-sql/pglite (the btree_gist contrib ships with it).
// Checks the calendar database rules on a TEMPORARY database: safe-by-default, overlap across organizations without
// leaking, working hours / breaks / time off, DST and midnight, status guard, outcome rules, idempotent logging, isolation.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
const mod = process.env.PGLITE_MODULE ?? process.env.LEAD_DB_MODULE;
const { PGlite } = await import(mod ? pathToFileURL(mod) : "@electric-sql/pglite");
const base = mod ? dirname(mod) : null;
const { btree_gist } = await import(base ? pathToFileURL(join(base, "contrib", "btree_gist.js")) : "@electric-sql/pglite/contrib/btree_gist");
const pg = new PGlite({ extensions: { btree_gist } });
await pg.exec(`create role anon;create role authenticated;create role service_role;
 create schema if not exists auth; create table auth.users(id uuid primary key);
 create table organizations(id uuid primary key);
 create table org_memberships(user_id uuid, organization_id uuid, is_active boolean default true);
 create table crm_contacts(id uuid primary key default gen_random_uuid(), organization_id uuid not null);
 create table crm_leads(id uuid primary key default gen_random_uuid(), organization_id uuid not null);
 create table opp_opportunities(id uuid primary key default gen_random_uuid(), organization_id uuid not null);
 create table rbac_permissions(key text primary key, description text);
 create table rbac_roles(id uuid primary key default gen_random_uuid(), organization_id uuid, key text);
 create table rbac_role_permissions(role_id uuid, permission_key text, primary key(role_id, permission_key));`);
await pg.exec(await readFile("supabase/migrations/20261002192009_restore_dashboard_activity_tables.sql", "utf8"));
const files = ["20261123120000_calendar_core", "20261123120100_calendar_rules", "20261123120200_calendar_dept_timezone"];
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const A = U(1), B = U(2), agent = U(11), other = U(12), tokyo = U(13);
await pg.query("insert into organizations values($1),($2)", [A, B]);
await pg.query("insert into auth.users values($1),($2),($3)", [agent, other, tokyo]);
await pg.query("insert into org_memberships values($1,$2,true),($1,$3,true),($4,$3,true),($5,$2,true)", [agent, A, B, other, tokyo]);
await pg.query("insert into rbac_roles(organization_id,key) values($1,'owner'),($1,'sales')", [A]);
await pg.query("insert into rbac_permissions values('x','x')");
for (const f of files) { const sql = await readFile(`supabase/migrations/${f}.sql`, "utf8"); await pg.exec(sql); await pg.exec(sql); } // safe to run twice

const code = async (sql, params = []) => { try { await pg.query(sql, params); return null; } catch (e) { return e.message; } };
const one = async (sql, params = []) => (await pg.query(sql, params)).rows[0];
const count = async (sql, params = []) => Number((await one(sql, params)).n);
const ins = (org, owner, starts, ends, extra = {}) => {
  const cols = { organization_id: org, owner_user_id: owner, starts_at: starts, ends_at: ends, ...extra };
  const keys = Object.keys(cols);
  return pg.query(`insert into cal_meetings(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`, Object.values(cols));
};

// 1) OFF by default: no settings = no bookings, and no seeds for anyone
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-11-23T07:00Z','2026-11-23T08:00Z')", [A, agent]), "CAL_DISABLED");
assert.equal(await count("select count(*) n from cal_meeting_types"), 0);
await pg.query("select cal_enable($1,$2)", [A, agent]);
await pg.query("select cal_enable($1,$2)", [A, agent]); // enabling twice does not seed twice
assert.equal(await count("select count(*) n from cal_meeting_types where organization_id=$1", [A]), 4);
assert.equal(await count("select count(*) n from cal_meeting_types where organization_id=$1", [B]), 0, "a different organization gets no seeds");
await pg.query("update cal_settings set cal_enabled=false where organization_id=$1", [A]);
await pg.query("select cal_enable($1,$2)", [A, agent]);
assert.equal(await count("select count(*) n from cal_meeting_types where organization_id=$1", [A]), 4, "re-enabling after a pause does not seed again");
await pg.query("update cal_meeting_types set is_active=false where organization_id=$1", [A]);
await pg.query("select cal_enable($1,$2)", [A, agent]);
assert.equal(await count("select count(*) n from cal_meeting_types where organization_id=$1", [A]), 4);
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-11-23T07:00Z','2026-11-23T08:00Z')", [B, other]), "CAL_DISABLED", "B is still off");

// 2) hours: default 09:00-18:00 Mon-Fri, Istanbul (UTC+3). 2026-11-23 is a Monday
const mon = (h1, h2) => [`2026-11-23T${String(h1 - 3).padStart(2, "0")}:00Z`, `2026-11-23T${String(h2 - 3).padStart(2, "0")}:00Z`];
assert.ok((await ins(A, agent, ...mon(10, 11))).rows[0].id);
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,$3,$4)", [A, agent, ...mon(7, 8)]), "CAL_OUTSIDE_HOURS");
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,$3,$4)", [A, agent, ...mon(17, 19)]), "CAL_OUTSIDE_HOURS");
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-11-28T07:00Z','2026-11-28T08:00Z')", [A, agent]), "CAL_CLOSED_DAY", "Saturday is closed by default");
// own schedule replaces the organization's hours
await pg.query("insert into cal_availability(organization_id,user_id,weekday,start_time,end_time) values($1,$2,1,'13:00','16:00')", [A, agent]);
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,$3,$4)", [A, agent, ...mon(9, 10)]), "CAL_OUTSIDE_HOURS", "own schedule 13-16 wins over 9-18");
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-11-24T10:00Z','2026-11-24T11:00Z')", [A, agent]), "CAL_OFF_DAY", "Tuesday is not in the agent's own schedule");
assert.ok((await ins(A, agent, ...mon(14, 15))).rows[0].id);
// break and time off
await pg.query("insert into cal_breaks(organization_id,user_id,weekday,start_time,end_time) values($1,$2,1,'15:00','15:30')", [A, agent]);
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,$3,$4)", [A, agent, "2026-11-23T12:10Z", "2026-11-23T12:40Z"]), "CAL_ON_BREAK");
await pg.query("insert into cal_availability(organization_id,user_id,weekday,start_time,end_time) values($1,$2,3,'09:00','18:00')", [A, agent]);
await pg.query("insert into cal_time_off(organization_id,user_id,starts_on,ends_on) values($1,$2,'2026-11-25','2026-11-26')", [A, agent]);
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-11-25T08:00Z','2026-11-25T09:00Z')", [A, agent]), "CAL_TIME_OFF");

// 3) overlap: same person never in two places, across organizations, with a generic message
await pg.query("select cal_enable($1,$2)", [B, other]);
const clash = await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,$3,$4)", [B, agent, ...mon(14, 15)]);
assert.equal(clash, "CAL_OWNER_BUSY", "agent is a member of both organizations: busy in A blocks B");
assert.ok(!clash.includes(A) && !/title|org|مؤسسة/.test(clash), "the message does not reveal the other organization");
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,$3,$4)", [A, agent, "2026-11-23T11:30Z", "2026-11-23T12:30Z"]), "CAL_OWNER_BUSY", "overlap inside one organization");
// back-to-back is fine
await pg.query("insert into cal_availability(organization_id,user_id,weekday,start_time,end_time) values($1,$2,5,'09:00','18:00')", [A, agent]);
assert.ok((await ins(A, agent, "2026-11-27T07:00Z", "2026-11-27T08:00Z")).rows[0].id);
assert.ok((await ins(A, agent, "2026-11-27T08:00Z", "2026-11-27T09:00Z")).rows[0].id, "end = next start is allowed");
// the exclusion constraint itself is the safety net (triggers off, as in a race)
await pg.exec("set session_replication_role = replica");
const raw = await pg.query("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-11-27T07:30Z','2026-11-27T08:30Z')", [A, agent]).catch((e) => e);
assert.equal(raw.constraint, "cal_meetings_owner_no_overlap");
await pg.exec("set session_replication_role = origin");
// a cancelled meeting frees the time
const freed = (await ins(A, agent, "2026-11-27T10:00Z", "2026-11-27T11:00Z")).rows[0].id;
await pg.query("update cal_meetings set status='cancelled' where id=$1", [freed]);
assert.ok((await ins(A, agent, "2026-11-27T10:00Z", "2026-11-27T11:00Z")).rows[0].id);

// 4) status guard and outcome
const m = (await ins(A, agent, "2026-11-27T12:00Z", "2026-11-27T13:00Z")).rows[0].id;
assert.equal(await code("update cal_meetings set outcome='advanced' where id=$1", [m]), 'new row for relation "cal_meetings" violates check constraint "cal_meetings_outcome_after_completed"', "no outcome before completed");
await pg.query("update cal_meetings set status='confirmed' where id=$1", [m]);
await pg.query("update cal_meetings set status='in_progress' where id=$1", [m]);
assert.equal(await code("update cal_meetings set status='confirmed' where id=$1", [m]), "CAL_BAD_TRANSITION");
await pg.query("update cal_meetings set status='completed', outcome='needs_followup', outcome_note='ok' where id=$1", [m]);
assert.equal((await one("select completed_at is not null ok from cal_meetings where id=$1", [m])).ok, true);
assert.equal(await code("update cal_meetings set status='cancelled' where id=$1", [m]), "CAL_BAD_TRANSITION", "completed is final");
assert.equal(await code("update cal_meetings set ends_at=ends_at + interval '1 hour' where id=$1", [m]), "CAL_FINAL_STATUS");
assert.ok(await code("update cal_meetings set outcome='won' where id=$1", [m]), "unknown outcome refused");
await pg.query("update cal_meetings set outcome='lost' where id=$1", [m]); // the outcome can still be corrected
const c = (await ins(A, agent, "2026-11-27T14:00Z", "2026-11-27T15:00Z")).rows[0].id;
await pg.query("update cal_meetings set status='cancelled', cancellation_reason='x' where id=$1", [c]);
assert.equal(await code("update cal_meetings set status='completed' where id=$1", [c]), "CAL_BAD_TRANSITION", "cancelled cannot become completed");
assert.ok(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at,status) values($1,$2,'2026-11-27T05:00Z','2026-11-27T05:30Z','completed')", [A, agent]), "cannot be created as completed");
const ns = (await ins(A, agent, "2026-11-27T13:00Z", "2026-11-27T13:30Z")).rows[0].id;
await pg.query("update cal_meetings set status='no_show' where id=$1", [ns]);
assert.equal(await code("update cal_meetings set status='booked' where id=$1", [ns]), "CAL_BAD_TRANSITION");

// 5) links must belong to the same organization
const cB = (await one("insert into crm_contacts(organization_id) values($1) returning id", [B])).id;
const cA = (await one("insert into crm_contacts(organization_id) values($1) returning id", [A])).id;
const oB = (await one("insert into opp_opportunities(organization_id) values($1) returning id", [B])).id;
const lB = (await one("insert into crm_leads(organization_id) values($1) returning id", [B])).id;
const tB = (await one("insert into cal_meeting_types(organization_id,name) values($1,'x') returning id", [B])).id;
for (const [col, val] of [["contact_id", cB], ["opportunity_id", oB], ["lead_id", lB], ["meeting_type_id", tB]]) {
  assert.equal(await code(`insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at,${col}) values($1,$2,'2026-11-30T07:00Z','2026-11-30T08:00Z',$3)`, [A, agent, val]), "CAL_CROSS_ORG", col);
}
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-11-30T07:00Z','2026-11-30T08:00Z')", [A, other]), "CAL_BAD_OWNER", "owner must be an active member");
await pg.query("update org_memberships set is_active=false where user_id=$1 and organization_id=$2", [agent, B]);
assert.equal(await count("select count(*) n from cal_meetings where organization_id=$1", [B]), 0, "nothing was written for organization B");
await pg.query("update org_memberships set is_active=true where user_id=$1 and organization_id=$2", [agent, B]);

// 6) time zones: stored in UTC, judged in the organization's (or the agent's) zone, DST and midnight included
await pg.query("update cal_settings set timezone='America/New_York', work_start='09:00', work_end='18:00', working_days='{0,1,2,3,4,5,6}' where organization_id=$1", [B]);
await pg.query("delete from cal_availability where organization_id=$1", [A]);
await pg.query("update cal_settings set timezone='America/New_York', working_days='{0,1,2,3,4,5,6}' where organization_id=$1", [A]);
await pg.query("insert into org_memberships values($1,$2,true)", [other, A]);
// spring forward 2026-03-08: 09:00 local is 13:00Z (EDT), not 14:00Z
assert.ok((await ins(A, other, "2026-03-08T13:00Z", "2026-03-08T14:00Z")).rows[0].id, "09:00 EDT on the DST day");
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-03-08T12:30Z','2026-03-08T13:00Z')", [A, other]), "CAL_OUTSIDE_HOURS", "08:30 EDT is before opening");
// fall back 2026-11-01: 09:00 local is 14:00Z (EST)
assert.ok((await ins(A, other, "2026-11-01T14:00Z", "2026-11-01T15:00Z")).rows[0].id, "09:00 EST on the fall-back day");
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-11-01T13:00Z','2026-11-01T14:00Z')", [A, other]), "CAL_OUTSIDE_HOURS", "13:00Z is 08:00 EST");
// midnight: a day that runs to 24:00 may end exactly at midnight, but a meeting may not cross it
await pg.query("update cal_settings set timezone='Europe/Istanbul', work_start='09:00', work_end='00:00' where organization_id=$1", [A]);
assert.ok((await ins(A, other, "2026-12-02T20:00Z", "2026-12-02T21:00Z")).rows[0].id, "23:00-00:00 Istanbul ends exactly at midnight");
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-12-03T20:30Z','2026-12-03T21:30Z')", [A, other]), "CAL_OUTSIDE_HOURS", "23:30 to 00:30 crosses midnight");
// the agent's own zone beats the organization's
await pg.query("update org_memberships set is_active=true where user_id=$1", [tokyo]);
await pg.query("insert into org_memberships values($1,$2,true)", [tokyo, A]);
await pg.query("insert into cal_agent_prefs(organization_id,user_id,timezone) values($1,$2,'Asia/Tokyo')", [A, tokyo]);
assert.ok((await ins(A, tokyo, "2026-12-03T00:00Z", "2026-12-03T01:00Z")).rows[0].id, "09:00 Tokyo = 00:00Z");
assert.equal(await code("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-12-03T20:00Z','2026-12-03T21:00Z')", [A, tokyo]), "CAL_OUTSIDE_HOURS", "20:00Z is 05:00 in Tokyo, before 09:00");
assert.equal(await code("update cal_settings set timezone='Mars/Base' where organization_id=$1", [A]), "CAL_BAD_TIMEZONE");

// 7) the log: one row per event (no duplicates on repeated edits), nothing sensitive
const oppA = (await one("insert into opp_opportunities(organization_id) values($1) returning id", [A])).id;
const typeA = (await one("select id from cal_meeting_types where organization_id=$1 order by sort_order limit 1", [A])).id;
const lg = (await ins(A, agent, "2026-12-07T10:00Z", "2026-12-07T11:00Z", { opportunity_id: oppA, meeting_type_id: typeA, internal_notes: "SECRET-NOTE 0555", location: "SECRET-PLACE" })).rows[0].id;
await pg.query("update cal_settings set working_days='{0,1,2,3,4,5,6}', timezone='Europe/Istanbul', work_start='00:00', work_end='00:00' where organization_id=$1", [A]);
for (let i = 0; i < 3; i++) await pg.query("update cal_meetings set internal_notes='SECRET-NOTE 0555', updated_at=now() where id=$1", [lg]);
await pg.query("update cal_meetings set status='confirmed' where id=$1", [lg]);
await pg.query("update cal_meetings set status='confirmed' where id=$1", [lg]);
await pg.query("update cal_meetings set starts_at='2026-12-07T11:00Z', ends_at='2026-12-07T12:00Z' where id=$1", [lg]);
await pg.query("update cal_meetings set status='in_progress' where id=$1", [lg]);
await pg.query("update cal_meetings set status='completed' where id=$1", [lg]);
await pg.query("update cal_meetings set outcome='advanced' where id=$1", [lg]);
await pg.query("update cal_meetings set outcome='advanced' where id=$1", [lg]);
const kinds = (await pg.query("select event_kind||':'||(metadata->>'sig') k from crm_timeline where ref_id=$1 order by 1", [lg])).rows.map((r) => r.k);
assert.deepEqual(kinds, ["meeting.created:created", "meeting.rescheduled:2026-12-07T11:00", "meeting.status:completed", "meeting.status:confirmed", "meeting.status:in_progress"]);
assert.equal(await count("select count(*) n from crm_activities where metadata->>'cal_meeting_id'=$1", [lg]), 1, "one activity when completed");
const dump = JSON.stringify([(await pg.query("select * from crm_timeline where ref_id=$1", [lg])).rows, (await pg.query("select * from crm_activities where metadata->>'cal_meeting_id'=$1", [lg])).rows]);
assert.ok(!/SECRET|0555/.test(dump), "no notes, place or phone numbers in the log");
assert.equal(await count("select count(*) n from crm_timeline t join cal_meetings m on m.id=t.ref_id where m.id=$1 and t.organization_id<>m.organization_id", [lg]), 0);
// a meeting without a contact/lead/opportunity logs nothing
const before = await count("select count(*) n from crm_timeline");
await ins(A, agent, "2026-12-08T10:00Z", "2026-12-08T11:00Z");
assert.equal(await count("select count(*) n from crm_timeline"), before);

// 8) closed to the browser, indexes and permissions
for (const t of ["cal_settings", "cal_agent_prefs", "cal_meeting_types", "cal_availability", "cal_breaks", "cal_time_off", "cal_meetings"]) {
  assert.equal((await one("select relrowsecurity r from pg_class where relname=$1", [t])).r, true, `${t} RLS`);
}
await pg.exec("set role authenticated");
assert.ok(await code("select * from cal_meetings"), "browser role cannot read meetings");
assert.ok(await code("select cal_enable('" + B + "','" + agent + "')"), "browser role cannot enable the calendar");
await pg.exec("reset role");
const idx = (await pg.query("select indexdef from pg_indexes where tablename='cal_meetings'")).rows.map((r) => r.indexdef).join("\n");
assert.match(idx, /\(organization_id, owner_user_id, starts_at\)/);
assert.equal(await count("select count(*) n from rbac_permissions where key like 'calendar.%'"), 4);
assert.equal(await count("select count(*) n from rbac_role_permissions where permission_key like 'calendar.%'"), 6, "owner 4 + sales 2 for the one organization that has roles");
console.log("calendar-core: all checks passed");
