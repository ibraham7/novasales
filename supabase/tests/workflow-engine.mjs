import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import ts from "typescript";
const { PGlite } = await import(pathToFileURL(process.env.LEAD_DB_MODULE));
const pg = new PGlite();
await pg.exec(
  `create role anon;create role authenticated;create role service_role;create table organizations(id uuid primary key);create table crm_leads(id uuid primary key,organization_id uuid,contact_id uuid);`,
);
await pg.exec(
  await readFile("supabase/migrations/20261002211605_restore_workflow_engine.sql", "utf8"),
);
const org = "10000000-0000-0000-0000-000000000001",
  other = "10000000-0000-0000-0000-000000000002";
await pg.query("insert into organizations values($1),($2)", [org, other]);
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.columns = "*";
    this.mode = "select";
  }
  select(columns = "*") {
    this.columns = columns;
    return this;
  }
  eq(key, val) {
    this.filters.push([key, val]);
    return this;
  }
  insert(value) {
    this.mode = "insert";
    this.value = value;
    return this;
  }
  update(value) {
    this.mode = "update";
    this.value = value;
    return this;
  }
  maybeSingle() {
    this.singleResult = true;
    return this;
  }
  single() {
    this.singleResult = true;
    return this;
  }
  async run() {
    try {
      const args = [];
      const bind = (v) => {
        args.push(v && typeof v === "object" ? JSON.stringify(v) : v);
        return "$" + args.length;
      };
      const cols = this.columns
        .split(",")
        .map((x) => x.trim())
        .join(",");
      let sql;
      if (this.mode === "insert") {
        const keys = Object.keys(this.value);
        sql = `insert into ${this.table}(${keys.join(",")}) values(${keys.map((k) => bind(this.value[k])).join(",")}) returning ${cols}`;
      } else {
        let prefix =
          this.mode === "update"
            ? `update ${this.table} set ${Object.entries(this.value)
                .map(([k, v]) => k + "=" + bind(v))
                .join(",")}`
            : `select ${cols} from ${this.table}`;
        const where = this.filters.map(([k, v]) => k + "=" + bind(v)).join(" and ");
        sql =
          prefix +
          (where ? " where " + where : "") +
          (this.mode === "update" ? " returning " + cols : "");
      }
      const { rows } = await pg.query(sql, args);
      return { data: this.singleResult ? (rows[0] ?? null) : rows, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }
  then(resolve, reject) {
    return this.run().then(resolve, reject);
  }
}
globalThis.__wfDb = { from: (table) => new Query(table) };
globalThis.__wfActionCalls = [];
const dir = await mkdtemp(path.join(tmpdir(), "wf-engine-"));
await writeFile(path.join(dir, "db.mjs"), "export const supabaseAdmin=globalThis.__wfDb;");
await writeFile(
  path.join(dir, "registry.mjs"),
  `export async function ensureActionsRegistered(){};export function getAction(name){return async()=>{globalThis.__wfActionCalls.push(name);return {ok:name!=='fail',error:name==='fail'?'Action failed':undefined};};}`,
);
const guardSource = (
  await readFile("src/modules/workflow/actions/tenant-guard.server.ts", "utf8")
).replaceAll("@/integrations/supabase/client.server", "./db.mjs");
await writeFile(
  path.join(dir, "guard.mjs"),
  ts.transpileModule(guardSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText,
);
for (const file of ["definition", "types", "executor.server"]) {
  let source = await readFile("src/modules/workflow/" + file + ".ts", "utf8");
  source = source
    .replaceAll("@/integrations/supabase/client.server", "./db.mjs")
    .replaceAll("./actions/registry.server", "./registry.mjs")
    .replaceAll("./actions/tenant-guard.server", "./guard.mjs")
    .replaceAll('"./definition"', '"./definition.mjs"')
    .replaceAll('"./types"', '"./types.mjs"');
  await writeFile(
    path.join(dir, file + ".mjs"),
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText,
  );
}
const engine = await import(pathToFileURL(path.join(dir, "executor.server.mjs")));
async function workflow(steps) {
  const { rows } = await pg.query(
    `insert into wf_workflows(organization_id,name,trigger_type,definition) values($1,'test','manual',$2) returning id`,
    [org, JSON.stringify({ engine: "v1", version: 1, steps })],
  );
  return rows[0].id;
}
const id = await workflow([
  { id: "a", type: "action", action: "one", config: {}, next: "wait" },
  { id: "wait", type: "delay", duration_minutes: 1, next: "b" },
  { id: "b", type: "action", action: "two", config: {} },
]);
await assert.rejects(engine.startRun({ workflowId: id, organizationId: other }), /مؤسستك/);
const runId = await engine.startRun({ workflowId: id, organizationId: org });
assert.deepEqual(globalThis.__wfActionCalls, ["one"]);
assert.equal(
  (await pg.query("select status from wf_runs where id=$1", [runId])).rows[0].status,
  "waiting",
);
await pg.query(`update wf_workflows set definition=$1 where id=$2`, [
  JSON.stringify({
    engine: "v1",
    steps: [{ id: "a", type: "action", action: "changed", config: {} }],
  }),
  id,
]);
await engine.resumeRun(runId, "b");
await engine.resumeRun(runId, "b");
assert.deepEqual(globalThis.__wfActionCalls, ["one", "two"]);
assert.equal(
  (await pg.query("select status from wf_runs where id=$1", [runId])).rows[0].status,
  "completed",
);
const delay = await workflow([{ id: "d", type: "delay", duration_minutes: 1 }]);
const finalRun = await engine.startRun({ workflowId: delay, organizationId: org });
await engine.resumeRun(finalRun, null);
assert.equal(
  (await pg.query("select status from wf_runs where id=$1", [finalRun])).rows[0].status,
  "completed",
);
const fail = await workflow([{ id: "f", type: "action", action: "fail", config: {} }]);
const failedRun = await engine.startRun({ workflowId: fail, organizationId: org });
assert.equal(
  (await pg.query("select status from wf_runs where id=$1", [failedRun])).rows[0].status,
  "failed",
);
const foreign = await pg
  .query(`insert into wf_runs(organization_id,workflow_id,definition) values($1,$2,'{}')`, [
    other,
    id,
  ])
  .catch((e) => e);
assert.ok(foreign instanceof Error);
const permissions = await pg.query(
  `select has_table_privilege('anon','wf_workflows','select') as client,has_table_privilege('service_role','wf_workflows','insert') as server`,
);
assert.deepEqual(permissions.rows[0], { client: false, server: true });
await pg.exec(
  "create table crm_contacts(id uuid primary key,organization_id uuid);create table crm_pipelines(id uuid primary key,organization_id uuid);create table crm_pipeline_stages(id uuid primary key,pipeline_id uuid);",
);
const contact = "20000000-0000-0000-0000-000000000001",
  pipeline = "30000000-0000-0000-0000-000000000001",
  stage = "40000000-0000-0000-0000-000000000001";
await pg.query("insert into crm_contacts values($1,$2)", [contact, other]);
await pg.query("insert into crm_pipelines values($1,$2)", [pipeline, other]);
await pg.query("insert into crm_pipeline_stages values($1,$2)", [stage, pipeline]);
const { guardActionTenant } = await import(pathToFileURL(path.join(dir, "guard.mjs")));
await assert.rejects(
  guardActionTenant({ contact_id: contact }, { organizationId: org, triggerPayload: {} }),
  /المؤسسة/,
);
await assert.rejects(
  guardActionTenant({ stage_id: stage }, { organizationId: org, triggerPayload: {} }),
  /المؤسسة/,
);
await guardActionTenant(
  { contact_id: contact, stage_id: stage },
  { organizationId: other, triggerPayload: {} },
);
await pg.close();
console.log(
  "Local PostgreSQL workflow engine: tenant isolation, snapshot, delay/resume/end, failure and server-only grants passed",
);
