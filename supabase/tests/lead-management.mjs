// Run with LEAD_DB_MODULE pointing to a separately installed @electric-sql/pglite.
// This suite uses an isolated local PostgreSQL instance; it never connects to Supabase.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.LEAD_DB_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();
const org = "00000000-0000-0000-0000-000000000001",
  otherOrg = "00000000-0000-0000-0000-000000000002",
  actor = "00000000-0000-0000-0000-000000000003",
  sales = "00000000-0000-0000-0000-000000000004";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table organizations(id uuid primary key);
create table test_access(user_id uuid,organization_id uuid,access jsonb);
create function get_workspace_access_fast(uuid,uuid) returns jsonb language sql as 'select access from test_access where user_id=$1 and organization_id=$2';
create function has_permission(uuid,uuid,text) returns boolean language sql as 'select coalesce((select (access->''permissions'') ? $3 from test_access where user_id=$1 and organization_id=$2),false)';
create table org_departments(id uuid primary key,organization_id uuid);
create table org_memberships(id uuid default gen_random_uuid(),organization_id uuid,user_id uuid,is_active boolean default true);
create table org_department_members(id uuid default gen_random_uuid(),organization_id uuid,user_id uuid,department_id uuid,is_active boolean default true);
create table crm_contacts(id uuid primary key default gen_random_uuid(),organization_id uuid,display_name text,full_name text,lifecycle_stage text);
create table crm_contact_points(id uuid primary key default gen_random_uuid(),organization_id uuid,contact_id uuid references crm_contacts(id),channel_type text,identifier text,is_primary boolean,unique(organization_id,channel_type,identifier));
create table crm_leads(id uuid primary key default gen_random_uuid(),organization_id uuid,contact_id uuid references crm_contacts(id),department_id uuid,owner_user_id uuid,source text,status text default 'new',notes text check(notes is distinct from 'cause-failure'),custom_fields jsonb default '{}',score int,opened_at timestamptz default now(),converted_at timestamptz,updated_at timestamptz default now());
create table crm_pipelines(id uuid primary key default gen_random_uuid(),organization_id uuid,is_default boolean,created_at timestamptz default now());
create table crm_pipeline_stages(id uuid primary key default gen_random_uuid(),pipeline_id uuid,is_won boolean default false,is_lost boolean default false,ord int,probability int);
create table opp_opportunities(id uuid primary key default gen_random_uuid(),organization_id uuid,contact_id uuid,lead_id uuid references crm_leads(id) on delete set null,department_id uuid,owner_agent_id uuid,pipeline_id uuid,stage_id uuid,stage text,title text,source text,value numeric,currency text,expected_close_date date,probability int,deleted_at timestamptz,opened_at timestamptz default now());
create table crm_timeline(id uuid primary key default gen_random_uuid(),organization_id uuid,entity_type text,entity_id uuid,event_kind text,title text,actor_user_id uuid);
create table crm_tasks(id uuid default gen_random_uuid(),organization_id uuid,entity_type text,entity_id uuid);
create table crm_activities(id uuid default gen_random_uuid(),organization_id uuid,entity_type text,entity_id uuid);
`);
await db.query("insert into organizations values($1),($2)", [org, otherOrg]);
const permissions = [
  "crm.leads.create",
  "crm.leads.update",
  "crm.leads.delete",
  "crm.leads.assign",
  "crm.opportunities.create",
  "org.manage",
];
await db.query("insert into test_access values($1,$2,$3),($4,$2,$5)", [
  actor,
  org,
  { permissions, roleKeys: ["supervisor"], departmentIds: [], isSuperAdmin: false },
  sales,
  {
    permissions: ["crm.leads.create", "crm.leads.update"],
    roleKeys: ["sales"],
    departmentIds: [],
    isSuperAdmin: false,
  },
]);
await db.query("insert into org_memberships(organization_id,user_id) values($1,$2),($1,$3)", [
  org,
  actor,
  sales,
]);
await db.exec(
  await fs.readFile(
    new URL("../migrations/20261002202541_repair_lead_management.sql", import.meta.url),
    "utf8",
  ),
);
const save = async (input, id = null, user = actor) =>
  (await db.query("select crm_save_lead_atomic($1,$2,$3,$4) as lead", [org, user, id, input]))
    .rows[0].lead;
const count = async (table) =>
  Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
const lead = await save({ contactName: "Test", phone: "+905555555555", email: "test@example.com" });
assert.equal(await count("crm_contacts"), 1);
assert.equal(await count("crm_contact_points"), 2);
assert.equal(await count("crm_leads"), 1);
await save(
  { contactName: "Updated", phone: "+905555555556", email: "", status: "working" },
  lead.id,
);
assert.equal(
  (await db.query("select display_name from crm_contacts")).rows[0].display_name,
  "Updated",
);
assert.equal(
  (await db.query("select identifier from crm_contact_points")).rows[0].identifier,
  "+905555555556",
);
assert.equal(await count("crm_contact_points"), 1);
await assert.rejects(save({ contactName: "Duplicate", phone: "+905555555556" }));
assert.equal(await count("crm_contacts"), 1);
assert.equal(await count("crm_leads"), 1);
await assert.rejects(
  save({ contactName: "Broken", phone: "+905555555557", notes: "cause-failure" }),
);
assert.equal(await count("crm_contacts"), 1);
assert.equal(await count("crm_contact_points"), 1);
await assert.rejects(save({ status: "qualified" }, lead.id, sales), /خارج نطاق/);
await assert.rejects(
  save({ contactName: "Invalid contact", contactId: crypto.randomUUID() }),
  /جهة الاتصال/,
);
await assert.rejects(save({ contactName: "False conversion", status: "converted" }), /التحويل/);
await assert.rejects(
  db.query("select crm_convert_lead_atomic($1,$2,$3,$4)", [org, actor, lead.id, {}]),
  /مسار مبيعات/,
);
assert.equal(await count("opp_opportunities"), 0);
const pipe = (
  await db.query(
    "insert into crm_pipelines(organization_id,is_default) values($1,true) returning id",
    [org],
  )
).rows[0].id;
await db.query("insert into crm_pipeline_stages(pipeline_id,ord,probability) values($1,0,10)", [
  pipe,
]);
const convert = async () =>
  (
    await db.query("select crm_convert_lead_atomic($1,$2,$3,$4) as opp", [
      org,
      actor,
      lead.id,
      { currency: "TRY" },
    ])
  ).rows[0].opp;
const first = await convert(),
  second = await convert();
assert.equal(first.id, second.id);
assert.equal(first.currency, "TRY");
assert.equal(first.title, "Updated");
assert.equal(await count("opp_opportunities"), 1);
assert.equal(
  (await db.query("select status from crm_leads where id=$1", [lead.id])).rows[0].status,
  "converted",
);
await assert.rejects(save({ status: "new" }, lead.id), /تغيير حالة/);
await assert.rejects(
  db.query("select crm_delete_lead_atomic($1,$2,$3)", [org, actor, lead.id]),
  /مرتبط بفرصة/,
);
const removable = await save({ contactName: "Removable" });
await db.query("select crm_delete_lead_atomic($1,$2,$3)", [org, actor, removable.id]);
assert.equal(await count("crm_leads"), 1);
assert.equal(await count("crm_contacts"), 2);
const grants = await db.query(
  "select has_table_privilege('anon','crm_field_defs','SELECT') as table_access,has_function_privilege('authenticated','crm_save_lead_atomic(uuid,uuid,uuid,jsonb)','EXECUTE') as rpc_access",
);
assert.equal(grants.rows[0].table_access, false);
assert.equal(grants.rows[0].rpc_access, false);
await db.close();
console.log(
  "Local PostgreSQL: atomic save/update/rollback, scope, conversion idempotence, deletion and grants passed",
);
