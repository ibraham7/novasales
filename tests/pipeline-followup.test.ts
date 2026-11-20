import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { fakeDb } from "./helpers/fake-db.ts";

const source = readFileSync(new URL("../src/modules/crm/pipeline.functions.ts", import.meta.url), "utf8").replace(/import\("([^"]+)"\)/g, (_, path) => `Promise.resolve(__deps[${JSON.stringify(path)}])`);
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const OPP = "00000000-0000-0000-0000-0000000000c1";

function setup(opts: { allowed?: boolean; rpcError?: any } = {}) {
  const access = { organizationId: "org-a", userId: "ali" };
  const db: any = fakeDb({ opp_opportunities: [{ id: OPP, organization_id: "org-a", owner_agent_id: "ali", department_id: null, deleted_at: null }, { id: "other-org-ticket", organization_id: "org-b", owner_agent_id: "x", department_id: null, deleted_at: null }] });
  const calls: any[] = [];
  let total = 0;
  db.rpc = async (name: string, args: any) => {
    calls.push({ name, args });
    if (opts.rpcError) return { data: null, error: opts.rpcError };
    total = name === "opp_add_followup" ? total + 1 : Math.max(0, total - 1);
    return { data: total, error: null };
  };
  const createServerFn = () => {
    let validate = (d: any) => d;
    const builder: any = { inputValidator(v: any) { validate = v; return builder; }, handler(fn: any) { return (args: any) => fn({ data: validate(args?.data ?? {}) }); } };
    return builder;
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (name: string) => (name === "@tanstack/react-start" ? { createServerFn } : { z }), __deps: {
    "@/platform/workspace/workspace.server": { supabaseAdmin: db, getWorkspace: async () => access },
    "@/platform/rbac/rbac.server": { requireAnyPermission: async () => access },
    "@/platform/rbac/data-scope.server": { canAccessOpportunityRow: () => opts.allowed ?? true },
  } });
  return { add: exports.addTicketFollowup, undo: exports.undoTicketFollowup, calls };
}

test("each press adds one follow-up for the person who pressed, and the new total comes back", async () => {
  const { add, calls } = setup();
  assert.equal((await add({ data: { opportunityId: OPP } })).count, 1);
  assert.equal((await add({ data: { opportunityId: OPP } })).count, 2);
  assert.deepEqual([calls[0].name, calls[0].args._org, calls[0].args._opp, calls[0].args._user], ["opp_add_followup", "org-a", OPP, "ali"]);
});

test("undo takes one back; the count never goes below zero", async () => {
  const { add, undo, calls } = setup();
  await add({ data: { opportunityId: OPP } });
  assert.equal((await undo({ data: { opportunityId: OPP } })).count, 0);
  assert.equal((await undo({ data: { opportunityId: OPP } })).count, 0);
  assert.equal(calls[1].name, "opp_undo_followup");
});

test("a ticket outside the user's scope or another organization's is refused before anything is written", async () => {
  const outside = setup({ allowed: false });
  await assert.rejects(outside.add({ data: { opportunityId: OPP } }), /غير موجودة أو غير مسموحة/);
  assert.equal(outside.calls.length, 0);
  const foreign = setup();
  await assert.rejects(foreign.add({ data: { opportunityId: "00000000-0000-0000-0000-0000000000f9" } }), /غير موجودة/);
  assert.equal(foreign.calls.length, 0);
});

test("without the SQL installed, the error says to run it", async () => {
  const { add } = setup({ rpcError: { code: "PGRST202", message: "Could not find the function" } });
  await assert.rejects(add({ data: { opportunityId: OPP } }), /شغّل ملف SQL/);
});
