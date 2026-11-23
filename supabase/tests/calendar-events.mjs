// Run with PGLITE_MODULE pointing to a separately installed @electric-sql/pglite (the btree_gist contrib ships with it).
// Checks the calendar's automation events on a TEMPORARY database: one event per real change, none for plain edits,
// nothing sensitive in the payload, nothing sent.
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
 create table domain_events(id uuid primary key default gen_random_uuid(), organization_id uuid, event_type text not null, aggregate_type text, aggregate_id uuid, actor_user_id uuid, payload jsonb not null default '{}', created_at timestamptz not null default now(), workflow_status text not null default 'pending');
 create table org_memberships(user_id uuid, organization_id uuid, is_active boolean default true);
 create table crm_contacts(id uuid primary key default gen_random_uuid(), organization_id uuid not null);
 create table crm_leads(id uuid primary key default gen_random_uuid(), organization_id uuid not null);
 create table opp_opportunities(id uuid primary key default gen_random_uuid(), organization_id uuid not null);
 create table rbac_permissions(key text primary key, description text);
 create table rbac_roles(id uuid primary key default gen_random_uuid(), organization_id uuid, key text);
 create table rbac_role_permissions(role_id uuid, permission_key text, primary key(role_id, permission_key));`);
await pg.exec(await readFile("supabase/migrations/20261002192009_restore_dashboard_activity_tables.sql", "utf8"));
const files = ["20261123120000_calendar_core", "20261123120100_calendar_rules", "20261123120200_calendar_dept_timezone", "20261123130000_calendar_events"];
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const A = U(1), B = U(2), agent = U(11), other = U(12), tokyo = U(13);
await pg.query("insert into organizations values($1),($2)", [A, B]);
await pg.query("insert into auth.users values($1),($2),($3)", [agent, other, tokyo]);
await pg.query("insert into org_memberships values($1,$2,true),($1,$3,true),($4,$3,true),($5,$2,true)", [agent, A, B, other, tokyo]);
await pg.query("insert into rbac_roles(organization_id,key) values($1,'owner'),($1,'sales')", [A]);
await pg.query("insert into rbac_permissions values('x','x')");
for (const f of files) { const sql = await readFile(`supabase/migrations/${f}.sql`, "utf8"); await pg.exec(sql); await pg.exec(sql); } // safe to run twice

const one = async (sql, params = []) => (await pg.query(sql, params)).rows[0];
const events = async (id) => (await pg.query("select event_type, payload from domain_events where aggregate_id=$1 order by created_at, id", [id])).rows;
await pg.query("select cal_enable($1,$2)", [A, agent]);
const typeId = (await one("select id from cal_meeting_types where organization_id=$1 order by sort_order limit 1", [A])).id;
const oppId = (await one("insert into opp_opportunities(organization_id) values($1) returning id", [A])).id;
const m = (await one("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at,opportunity_id,meeting_type_id,channel,location,internal_notes) values($1,$2,'2026-11-23T07:00Z','2026-11-23T08:00Z',$3,$4,'call','+905066903027','SECRET-NOTE') returning id", [A, agent, oppId, typeId])).id;
let ev = await events(m);
assert.deepEqual(ev.map((e) => e.event_type), ["calendar.meeting.created"]);
assert.equal(ev[0].payload.opportunity_id, oppId);
assert.equal(ev[0].payload.meeting_type, "مكالمة تعريفية");
assert.ok(!/SECRET|905066903027/.test(JSON.stringify(ev[0].payload)), "no notes and no phone-like place for a call");
// plain edits do not create events
for (let i = 0; i < 3; i++) await pg.query("update cal_meetings set internal_notes='x', title='t' where id=$1", [m]);
assert.equal((await events(m)).length, 1);
await pg.query("update cal_meetings set status='confirmed' where id=$1", [m]);
await pg.query("update cal_meetings set status='confirmed' where id=$1", [m]);
await pg.query("update cal_meetings set starts_at='2026-11-23T08:00Z', ends_at='2026-11-23T09:00Z' where id=$1", [m]);
await pg.query("update cal_meetings set status='in_progress' where id=$1", [m]);
await pg.query("update cal_meetings set status='completed', outcome='advanced' where id=$1", [m]);
await pg.query("update cal_meetings set outcome='lost' where id=$1", [m]);
assert.deepEqual((await events(m)).map((e) => e.event_type), ["calendar.meeting.created", "calendar.meeting.confirmed", "calendar.meeting.rescheduled", "calendar.meeting.completed"]);
const last = (await events(m)).at(-1);
assert.equal(last.payload.outcome, "advanced");
// cancelled and no-show
const c = (await one("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at) values($1,$2,'2026-11-24T07:00Z','2026-11-24T08:00Z') returning id", [A, agent])).id;
await pg.query("update cal_meetings set status='cancelled' where id=$1", [c]);
const n = (await one("insert into cal_meetings(organization_id,owner_user_id,starts_at,ends_at,channel,location) values($1,$2,'2026-11-25T07:00Z','2026-11-25T08:00Z','link','https://meet.example.com/x') returning id", [A, agent])).id;
await pg.query("update cal_meetings set status='no_show' where id=$1", [n]);
assert.deepEqual((await events(c)).map((e) => e.event_type), ["calendar.meeting.created", "calendar.meeting.cancelled"]);
const ns = await events(n);
assert.deepEqual(ns.map((e) => e.event_type), ["calendar.meeting.created", "calendar.meeting.no_show"]);
assert.equal(ns[0].payload.location, "https://meet.example.com/x", "a link meeting carries its link");
// the events belong to the meeting's organization, wait as pending, and the function is closed to the browser
assert.equal((await one("select count(*)::int n from domain_events where organization_id<>$1", [A])).n, 0);
assert.equal((await one("select count(*)::int n from domain_events where workflow_status<>'pending'")).n, 0);
await pg.exec("set role authenticated");
assert.ok(await pg.query("select cal_meeting_events()").then(() => false, () => true));
await pg.exec("reset role");
console.log("calendar-events: all checks passed");
