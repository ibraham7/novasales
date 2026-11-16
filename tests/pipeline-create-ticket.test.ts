import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { fakeDb } from "./helpers/fake-db.ts";

// Runs the real server function with an in-memory database.
const source = readFileSync(new URL("../src/modules/crm/pipeline.functions.ts", import.meta.url), "utf8").replace(/import\("([^"]+)"\)/g, (_, path) => `Promise.resolve(__deps[${JSON.stringify(path)}])`);
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const STAGE = "00000000-0000-0000-0000-0000000000a1";
const LABEL = "00000000-0000-0000-0000-0000000000b1";
const FOREIGN_LABEL = "00000000-0000-0000-0000-0000000000b2";

function setup() {
  const access = { organizationId: "org-a", userId: "ali", departmentIds: ["dept-a"], permissions: ["crm.opportunities.create"] };
  const db = fakeDb({
    crm_pipeline_stages: [{ id: STAGE, pipeline_id: "pipe", probability: 10, is_won: false, is_lost: false, "crm_pipelines.organization_id": "org-a" }],
    opp_labels: [{ id: LABEL, organization_id: "org-a", name: "نوفا سيلز", color: "#0079bf" }, { id: FOREIGN_LABEL, organization_id: "org-b", name: "x", color: "#000000" }],
  });
  const createServerFn = () => {
    let validate = (d: any) => d;
    const builder: any = { inputValidator(v: any) { validate = v; return builder; }, handler(fn: any) { return (args: any) => fn({ data: validate(args?.data ?? {}) }); } };
    return builder;
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (name: string) => (name === "@tanstack/react-start" ? { createServerFn } : { z }), __deps: {
    "@/platform/workspace/workspace.server": { supabaseAdmin: db, getWorkspace: async () => access },
    "@/platform/rbac/rbac.server": { requireAnyPermission: async () => access },
    "./contacts.server": { normalizePhone: (p: string) => p.replace(/\D/g, "") },
    "@/modules/superadmin/settings.functions": { getPublicPlatformSettings: async () => ({ default_currency: "USD" }) },
  } });
  return { fn: exports.createOpportunityInStage, db: db as any };
}
const all = async (db: any, table: string) => (await db.from(table).select("*")).data as any[];

test("a ticket needs only a name: no number means no contact point", async () => {
  const { fn, db } = setup();
  const r = await fn({ data: { stageId: STAGE, name: "عميل بلا رقم" } });
  assert.ok(r.id);
  assert.equal((await all(db, "crm_contacts")).length, 1);
  assert.equal((await all(db, "crm_contact_points")).length, 0);
  const [opp] = await all(db, "opp_opportunities");
  assert.equal(opp.stage_id, STAGE);
  assert.equal(opp.owner_agent_id, "ali");
});

test("notes become a note on the ticket; only this organization's labels are attached", async () => {
  const { fn, db } = setup();
  const r = await fn({ data: { stageId: STAGE, name: "علي", phone: "+90 532 000 00 00", notes: "طلب عرض سعر", labelIds: [LABEL, FOREIGN_LABEL] } });
  const notes = await all(db, "opp_notes");
  assert.equal(notes.length, 1);
  assert.deepEqual([notes[0].body, notes[0].opportunity_id, notes[0].organization_id], ["طلب عرض سعر", r.id, "org-a"]);
  const links = await all(db, "opp_label_links");
  assert.deepEqual(links.map((l) => l.label_id), [LABEL]);
  assert.equal((await all(db, "crm_contact_points")).length, 1);
});

test("the same number reuses the customer; a number that is too short is refused", async () => {
  const { fn, db } = setup();
  await fn({ data: { stageId: STAGE, name: "علي", phone: "905320000000" } });
  await fn({ data: { stageId: STAGE, name: "علي ثانية", phone: "+90 532 000 00 00" } });
  assert.equal((await all(db, "crm_contacts")).length, 1);
  assert.equal((await all(db, "opp_opportunities")).length, 2);
  assert.throws(() => fn({ data: { stageId: STAGE, name: "x", phone: "12" } }), /رقم هاتف صحيحاً/);
});
