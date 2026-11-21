// Run with PGLITE_MODULE (or LEAD_DB_MODULE) pointing to a separately installed @electric-sql/pglite.
// Checks the send-settings and message-log tables: defaults (sending OFF), constraints, the once-only index, grants.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const mod = process.env.PGLITE_MODULE ?? process.env.LEAD_DB_MODULE;
const { PGlite } = await import(mod ? pathToFileURL(mod) : "@electric-sql/pglite");
const pg = new PGlite();
await pg.exec(`create role anon;create role authenticated;create role service_role;
 create schema if not exists auth; create table auth.users(id uuid primary key);
 create table organizations(id uuid primary key);`);
const sql = await readFile("supabase/migrations/20261121130000_automation_send_log.sql", "utf8");
await pg.exec(sql);
await pg.exec(sql); // safe to run twice
const alerts = await readFile("supabase/migrations/20261121140000_automation_alerts_switch.sql", "utf8");
await pg.exec(alerts);
await pg.exec(alerts); // safe to run twice
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const a = U(1), b = U(2);
await pg.query("insert into organizations values($1),($2)", [a, b]);

// 1) a new organization's settings are OFF by default, with Istanbul hours
await pg.query("insert into wf_settings(organization_id) values($1)", [a]);
const s = (await pg.query("select * from wf_settings where organization_id=$1", [a])).rows[0];
assert.deepEqual([s.sending_enabled, s.timezone, s.send_window_start, s.send_window_end, s.daily_limit], [false, "Europe/Istanbul", "09:00", "20:00", 100]);

// 1b) staff alerts are OFF by default too
assert.equal((await pg.query("select alerts_enabled from wf_settings where organization_id=$1", [a])).rows[0].alerts_enabled, false);

// 2) settings are checked: bad times, limits and gaps are refused
const bad = async (sqlText, params = []) => { try { await pg.query(sqlText, params); return false; } catch { return true; } };
assert.ok(await bad("update wf_settings set send_window_start='25:00' where organization_id=$1", [a]));
assert.ok(await bad("update wf_settings set send_window_end='9:00' where organization_id=$1", [a]));
assert.ok(await bad("update wf_settings set daily_limit=0 where organization_id=$1", [a]));
assert.ok(await bad("update wf_settings set daily_limit=5000 where organization_id=$1", [a]));
assert.ok(await bad("update wf_settings set gap_min_seconds=-1 where organization_id=$1", [a]));
assert.ok(await bad("update wf_settings set defer_ttl_minutes=1 where organization_id=$1", [a]));

// 3) log rows: channel, kind and status are checked
const ins = (org, key, status, extra = "") => pg.query(`insert into wf_message_log(organization_id,channel,kind,status,dedupe_key${extra ? "," + extra.split("=")[0] : ""}) values($1,'whatsapp','service',$2,$3${extra ? ",$4" : ""})`, extra ? [org, status, key, extra.split("=")[1]] : [org, status, key]);
assert.ok(await bad("insert into wf_message_log(organization_id,channel,kind,status) values($1,'sms','service','sent')", [a]));
assert.ok(await bad("insert into wf_message_log(organization_id,channel,kind,status) values($1,'whatsapp','ads','sent')", [a]));
assert.ok(await bad("insert into wf_message_log(organization_id,channel,kind,status) values($1,'whatsapp','service','done')", [a]));

// 4) the same message (key) can be sent or waiting only once per organization; skipped/failed free the key
await ins(a, "k1", "sent");
assert.ok(await bad("insert into wf_message_log(organization_id,channel,kind,status,dedupe_key) values($1,'whatsapp','service','deferred','k1')", [a]), "sent blocks the same key");
assert.ok(await bad("insert into wf_message_log(organization_id,channel,kind,status,dedupe_key) values($1,'whatsapp','service','sending','k1')", [a]), "sending blocks the same key");
await ins(b, "k1", "sent"); // another organization: a different message
await ins(a, "k2", "failed");
await ins(a, "k2", "sent"); // a failed one freed the key
await ins(a, "k3", "skipped");
await ins(a, "k3", "skipped"); // skipped rows may repeat
await ins(a, "k3", "deferred");
assert.ok(await bad("insert into wf_message_log(organization_id,channel,kind,status,dedupe_key) values($1,'whatsapp','service','deferred','k3')", [a]));
await pg.query("insert into wf_message_log(organization_id,channel,kind,status) values($1,'email','promo','skipped'),($1,'email','promo','skipped')", [a]); // no key: never blocked
assert.equal((await pg.query("select allow_first_contact from wf_message_log limit 1")).rows[0].allow_first_contact, false);

// 5) deleting an organization removes its settings and log
await pg.query("delete from organizations where id=$1", [b]);
assert.equal((await pg.query("select count(*)::int n from wf_message_log where organization_id=$1", [b])).rows[0].n, 0);

// 6) both tables are server-only
const g = await pg.query(`select has_table_privilege('authenticated','public.wf_settings','select') c1, has_table_privilege('authenticated','public.wf_message_log','insert') c2,
 has_table_privilege('service_role','public.wf_settings','update') s1, has_table_privilege('service_role','public.wf_message_log','insert') s2`);
assert.deepEqual(g.rows[0], { c1: false, c2: false, s1: true, s2: true });
console.log("Local PostgreSQL automation send log: sending and staff alerts OFF by default, constraints, once-only message key, server-only passed");
