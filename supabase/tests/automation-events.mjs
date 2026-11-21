// Run with PGLITE_MODULE (or LEAD_DB_MODULE) pointing to a separately installed @electric-sql/pglite.
// Checks the automation events recorded by the database itself, and the old-events cleanup. Sends nothing.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const mod = process.env.PGLITE_MODULE ?? process.env.LEAD_DB_MODULE;
const { PGlite } = await import(mod ? pathToFileURL(mod) : "@electric-sql/pglite");
const pg = new PGlite();
await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table organizations(id uuid primary key);
 create table crm_leads(id uuid primary key,organization_id uuid not null,contact_id uuid);
 create table crm_pipeline_stages(id uuid primary key,name text not null);
 create table opp_opportunities(id uuid primary key,organization_id uuid not null,contact_id uuid,lead_id uuid,owner_agent_id uuid,
  pipeline_id uuid,stage_id uuid,stage text,source text,value numeric,currency text,title text,updated_at timestamptz default now());`);
await pg.exec(await readFile("supabase/migrations/20261002211605_restore_workflow_engine.sql", "utf8"));
const events = await readFile("supabase/migrations/20261121120000_automation_opportunity_events.sql", "utf8");
const cleanup = await readFile("supabase/migrations/20261121120100_automation_skip_old_events.sql", "utf8");
await pg.exec(events);
await pg.exec(events); // safe to run twice

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const org = U(1), other = U(2), contact = U(10), opp = U(20), pipe = U(30), s1 = U(41), s2 = U(42), ali = U(51), sara = U(52);
await pg.query("insert into organizations values($1),($2)", [org, other]);
await pg.query("insert into crm_pipeline_stages values($1,'تواصل جديد'),($2,'عرض سعر')", [s1, s2]);
await pg.query("insert into opp_opportunities(id,organization_id,contact_id,owner_agent_id,pipeline_id,stage_id,source,value,currency) values($1,$2,$3,$4,$5,$6,'whatsapp',1500,'USD')", [opp, org, contact, ali, pipe, s1]);
const rows = async () => (await pg.query("select event_type,aggregate_id,organization_id,payload from domain_events where event_type like 'crm.opportunity.%' order by created_at,id")).rows;

// 1) nothing yet: creating a ticket records no stage/owner event (the app records «created» itself)
assert.equal((await rows()).length, 0);

// 2) moving the ticket records ONE stage-changed event with everything an automation needs
await pg.query("update opp_opportunities set stage_id=$1 where id=$2", [s2, opp]);
let ev = await rows();
assert.equal(ev.length, 1);
assert.equal(ev[0].event_type, "crm.opportunity.stage_changed");
assert.equal(ev[0].organization_id, org);
const p = ev[0].payload;
assert.deepEqual([p.opportunity_id, p.contact_id, p.owner_user_id, p.pipeline_id], [opp, contact, ali, pipe]);
assert.deepEqual([p.from_stage_id, p.to_stage_id, p.stage_id], [s1, s2, s2]);
assert.deepEqual([p.from_stage_name, p.to_stage_name, p.source, Number(p.value), p.currency], ["تواصل جديد", "عرض سعر", "whatsapp", 1500, "USD"]);
const entered = (await pg.query("select stage_entered_at from opp_opportunities where id=$1", [opp])).rows[0].stage_entered_at;
assert.ok(entered, "the time the ticket entered its stage is kept");

// 3) changes that are not a stage or owner change record nothing; setting the same stage again records nothing
await pg.query("update opp_opportunities set value=2000, title='x' where id=$1", [opp]);
await pg.query("update opp_opportunities set stage_id=$1 where id=$2", [s2, opp]);
assert.equal((await rows()).length, 1);

// 4) a new owner records an assigned event with the previous and new owner; no owner (null) records nothing
await pg.query("update opp_opportunities set owner_agent_id=$1 where id=$2", [sara, opp]);
await pg.query("update opp_opportunities set owner_agent_id=null where id=$1", [opp]);
ev = await rows();
assert.deepEqual(ev.map((e) => e.event_type), ["crm.opportunity.stage_changed", "crm.opportunity.assigned"]);
assert.deepEqual([ev[1].payload.from_user_id, ev[1].payload.to_user_id], [ali, sara]);

// 5) moving stage and owner together records both events
await pg.query("update opp_opportunities set stage_id=$1, owner_agent_id=$2 where id=$3", [s1, ali, opp]);
assert.equal((await rows()).length, 4);

// 6) every event is waiting for the worker; nothing was processed
assert.equal((await pg.query("select count(*)::int n from domain_events where workflow_status<>'pending'")).rows[0].n, 0);

// 7) the function is server-only
const grants = await pg.query("select has_function_privilege('authenticated','public.wf_opportunity_events()','execute') client, has_function_privilege('service_role','public.wf_opportunity_events()','execute') server");
assert.deepEqual(grants.rows[0], { client: false, server: true });

// 8) the cleanup marks only pending events older than 6 hours, keeps the rows, and is safe to run twice
await pg.query("insert into domain_events(organization_id,event_type,workflow_status,created_at) values($1,'old.pending','pending',now()-interval '7 hours'),($1,'fresh.pending','pending',now()-interval '1 hour'),($1,'old.failed','failed',now()-interval '9 hours')", [org]);
const before = (await pg.query("select count(*)::int n from domain_events")).rows[0].n;
await pg.exec(cleanup);
await pg.exec(cleanup);
const after = Object.fromEntries((await pg.query("select event_type,workflow_status,workflow_error from domain_events where event_type in ('old.pending','fresh.pending','old.failed')")).rows.map((r) => [r.event_type, [r.workflow_status, r.workflow_error]]));
assert.deepEqual(after["old.pending"], ["done", "تخطّي قبل تفعيل الأتمتة"]);
assert.deepEqual(after["fresh.pending"], ["pending", null]);
assert.deepEqual(after["old.failed"], ["failed", null]);
assert.equal((await pg.query("select count(*)::int n from domain_events")).rows[0].n, before);
console.log("Local PostgreSQL automation events: stage and owner events with full payload, no noise, server-only, old-events cleanup passed");
