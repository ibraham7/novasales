import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { fakeDb } from "./helpers/fake-db.ts";

const source = readFileSync(new URL("../src/modules/crm/pipeline.functions.ts", import.meta.url), "utf8").replace(/import\("([^"]+)"\)/g, (_, path) => `Promise.resolve(__deps[${JSON.stringify(path)}])`);
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const STAGE = "00000000-0000-0000-0000-0000000000a1";
const OTHER_STAGE = "00000000-0000-0000-0000-0000000000a2";
const id = (n: number) => `00000000-0000-0000-0000-00000000010${n}`;

function setup(opts: { denied?: string[]; rpcError?: any } = {}) {
  const access = { organizationId: "org-a", userId: "ali" };
  const row = (n: number, extra: any = {}) => ({ id: id(n), organization_id: "org-a", stage_id: STAGE, owner_agent_id: "ali", department_id: null, deleted_at: null, ...extra });
  const db: any = fakeDb({
    crm_pipeline_stages: [{ id: STAGE, "crm_pipelines.organization_id": "org-a" }],
    opp_opportunities: [row(1), row(2), row(3), row(4), row(5, { stage_id: OTHER_STAGE }), row(6, { deleted_at: "x" }), row(7, { organization_id: "org-b" })],
  });
  const rpcCalls: any[] = [];
  db.rpc = async (name: string, args: any) => { rpcCalls.push({ name, args }); return { error: opts.rpcError ?? null }; };
  const createServerFn = () => {
    let validate = (d: any) => d;
    const builder: any = { inputValidator(v: any) { validate = v; return builder; }, handler(fn: any) { return (args: any) => fn({ data: validate(args?.data ?? {}) }); } };
    return builder;
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (name: string) => (name === "@tanstack/react-start" ? { createServerFn } : { z }), __deps: {
    "@/platform/workspace/workspace.server": { supabaseAdmin: db, getWorkspace: async () => access },
    "@/platform/rbac/rbac.server": { requireAnyPermission: async () => access },
    "@/platform/rbac/data-scope.server": { canAccessOpportunityRow: (_a: any, r: any) => !(opts.denied ?? []).includes(r.id) },
  } });
  return { reorder: exports.reorderBoardColumn, rpcCalls };
}

test("the column is saved as the agent sees it, and tickets that were not on screen follow in their old order", async () => {
  const { reorder, rpcCalls } = setup();
  const r = await reorder({ data: { stageId: STAGE, orderedIds: [id(3), id(1)] } });
  assert.equal(r.placed, 2);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "opp_set_board_order");
  assert.deepEqual([...rpcCalls[0].args._ids], [id(3), id(1), id(2), id(4)]);
  assert.deepEqual([rpcCalls[0].args._org, rpcCalls[0].args._stage], ["org-a", STAGE]);
});

test("tickets of another stage, deleted, another organization's or outside the user's scope are never placed", async () => {
  const { reorder, rpcCalls } = setup({ denied: [id(2)] });
  await reorder({ data: { stageId: STAGE, orderedIds: [id(5), id(6), id(7), id(2), id(4), id(4)] } });
  assert.deepEqual([...rpcCalls[0].args._ids].slice(0, 1), [id(4)]);
  assert.equal(new Set(rpcCalls[0].args._ids).size, rpcCalls[0].args._ids.length);
  assert.ok(![id(5), id(6), id(7)].some((x) => rpcCalls[0].args._ids.includes(x)));
});

test("nothing allowed to place means no write at all; a missing SQL function says to run the SQL", async () => {
  const none = setup({ denied: [id(1)] });
  const result = await none.reorder({ data: { stageId: STAGE, orderedIds: [id(1)] } });
  assert.deepEqual([result.ok, result.placed], [true, 0]);
  assert.equal(none.rpcCalls.length, 0);
  const missing = setup({ rpcError: { code: "PGRST202", message: "Could not find the function" } });
  await assert.rejects(missing.reorder({ data: { stageId: STAGE, orderedIds: [id(1)] } }), /شغّل ملف SQL/);
});
