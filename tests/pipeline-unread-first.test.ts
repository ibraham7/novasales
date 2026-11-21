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

function setup() {
  const access = { organizationId: "org-a", userId: "ali", departmentIds: [], permissions: [] };
  const opp = (id: string, extra: any = {}) => ({ id, organization_id: "org-a", stage_id: STAGE, owner_agent_id: "ali", department_id: null, contact_id: "c", deleted_at: null, ...extra });
  const db: any = fakeDb({
    crm_pipeline_stages: [{ id: STAGE, "crm_pipelines.organization_id": "org-a" }],
    // t1 and t2 are the newest two; t3 is older (beyond the limit of 2 per stage) but has a new message
    opp_opportunities: [opp("t1"), opp("t2"), opp("t3"), opp("t4", { organization_id: "org-b" })],
    msg_sessions: [
      { id: "s3", organization_id: "org-a", unread_count: 2, last_message_at: "2026-11-21T10:00:00Z", peer_identifier: "x" },
      { id: "s2", organization_id: "org-a", unread_count: 0, last_message_at: "2026-11-21T09:00:00Z", peer_identifier: "y" },
      { id: "s4", organization_id: "org-b", unread_count: 5, last_message_at: "2026-11-21T10:00:00Z", peer_identifier: "z" },
    ],
    crm_opportunity_sessions: [
      { organization_id: "org-a", opportunity_id: "t3", session_ref: "s3", channel: "whatsapp" },
      { organization_id: "org-a", opportunity_id: "t2", session_ref: "s2", channel: "whatsapp" },
      { organization_id: "org-b", opportunity_id: "t4", session_ref: "s4", channel: "whatsapp" },
    ],
  });
  const createServerFn = () => {
    let validate = (d: any) => d;
    const builder: any = { inputValidator(v: any) { validate = v; return builder; }, handler(fn: any) { return (args: any) => fn({ data: validate(args?.data ?? {}) }); } };
    return builder;
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (name: string) => (name === "@tanstack/react-start" ? { createServerFn } : { z }), __deps: {
    "@/platform/workspace/workspace.server": { supabaseAdmin: db, getWorkspace: async () => access },
    "@/platform/rbac/rbac.server": { requireAnyPermission: async () => access, getWorkspaceAccess: async () => access },
    "@/platform/rbac/data-scope.server": { getOpportunityVisibility: () => "all" },
  } });
  return exports.listOpportunitiesBoard;
}
const ids = (rows: any[]) => rows.map((r) => r.id as string).sort().join(",");

test("without the option, a stage only brings its newest tickets", async () => {
  const rows = await setup()({ data: { perStage: 2 } });
  assert.equal(ids(rows), "t1,t2");
});

test("with the option, a ticket with a new message comes along even when it is older than the newest few", async () => {
  const rows = await setup()({ data: { perStage: 2, withUnread: true } });
  assert.equal(ids(rows), "t1,t2,t3");
  const t3 = rows.find((r: any) => r.id === "t3");
  assert.equal(t3.unread_count, 2);
  assert.equal(t3.last_message_at, "2026-11-21T10:00:00Z");
});

test("another organization's unread tickets never come in", async () => {
  const rows = await setup()({ data: { perStage: 2, withUnread: true } });
  assert.ok(!ids(rows).includes("t4"));
});
