// Applies the Serena migration in PGlite and checks its rules.
// PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/serena-assistant.mjs
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const { PGlite } = await import(process.env.PGLITE_MODULE);
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create table organizations(id uuid primary key);
insert into organizations values ('00000000-0000-0000-0000-000000000001');`);
await db.exec(await readFile(new URL("../migrations/20261016120000_serena_assistant.sql", import.meta.url), "utf8"));
const org = "00000000-0000-0000-0000-000000000001";

await db.query("insert into serena_settings(organization_id, model, api_key_cipher, api_key_hint, whatsapp_numbers) values($1,'gemini-flash','x','LXD3','{905551234567}')", [org]);
await assert.rejects(db.query("insert into serena_settings(organization_id) values($1)", [org]), /duplicate key/, "one settings row per organization");
await assert.rejects(db.query("update serena_settings set provider='other'"), /check/, "only supported providers");
await assert.rejects(db.query("update serena_settings set api_key_hint='a-long-hint'"), /check/, "the hint never holds the key");

const insert = (externalId) => db.query("insert into serena_messages(organization_id, channel, user_ref, role, content, external_id) values($1,'whatsapp','905551234567','user','hi',$2)", [org, externalId]);
await insert("wamid.1");
await assert.rejects(insert("wamid.1"), /duplicate key/, "a redelivered WhatsApp message is stored once");
await insert(null);
await insert(null);
await assert.rejects(db.query("insert into serena_messages(organization_id, channel, user_ref, role, content) values($1,'sms','x','user','hi')", [org]), /check/);

const grants = await db.query("select grantee, privilege_type from information_schema.role_table_grants where table_name in ('serena_settings','serena_messages') and grantee in ('anon','authenticated')");
assert.equal(grants.rows.length, 0, "browser roles cannot read keys or conversations");
const rls = await db.query("select relname, relrowsecurity from pg_class where relname in ('serena_settings','serena_messages')");
assert.ok(rls.rows.every((row) => row.relrowsecurity));
console.log("serena migration: settings rules, WhatsApp de-duplication and access control passed");
