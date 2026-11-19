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
const L1 = "00000000-0000-0000-0000-0000000000b1";
const L2 = "00000000-0000-0000-0000-0000000000b2";
const FOREIGN = "00000000-0000-0000-0000-0000000000b3";

function setup(allowed = true) {
  const access = { organizationId: "org-a", userId: "ali", permissions: [] };
  const db: any = fakeDb({
    opp_opportunities: [{ id: OPP, organization_id: "org-a", contact_id: "c1", owner_agent_id: "ali", department_id: null, deleted_at: null }],
    crm_contacts: [{ id: "c1", organization_id: "org-a", display_name: "قديم", full_name: "قديم" }, { id: "c2", organization_id: "org-a", display_name: "آخر", full_name: "آخر" }],
    crm_contact_points: [
      { id: "p1", organization_id: "org-a", contact_id: "c1", channel_type: "whatsapp", identifier: "905320000000", is_primary: true },
      { id: "p2", organization_id: "org-a", contact_id: "c2", channel_type: "whatsapp", identifier: "905550000000", is_primary: true },
    ],
    opp_labels: [{ id: L1, organization_id: "org-a", name: "عاجل", color: "#eb5a46" }, { id: L2, organization_id: "org-a", name: "مهم", color: "#f2d600" }, { id: FOREIGN, organization_id: "org-b", name: "x", color: "#000000" }],
    opp_label_links: [{ opportunity_id: OPP, label_id: L1, organization_id: "org-a" }],
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
    "@/platform/rbac/data-scope.server": { canAccessOpportunityRow: () => allowed },
    "./contacts.server": { normalizePhone: (p: string) => p.replace(/\D/g, "") },
  } });
  return { get: exports.getTicketQuickEdit, save: exports.saveTicketQuickEdit, db };
}
const rows = async (db: any, table: string) => (await db.from(table).select("*")).data as any[];

test("the window loads the customer's name, number and labels", async () => {
  const { get } = setup();
  const r = await get({ data: { opportunityId: OPP } });
  assert.equal(r.name, "قديم");
  assert.equal(r.phone, "905320000000");
  assert.deepEqual([...r.labelIds], [L1]);
});

test("saving changes the name and number, swaps the labels and adds a note", async () => {
  const { save, db } = setup();
  await save({ data: { opportunityId: OPP, name: "اسم جديد", phone: "+90 533 111 22 33", labelIds: [L2, FOREIGN], note: "اتصلت به اليوم" } });
  const [c1] = (await rows(db, "crm_contacts")).filter((c) => c.id === "c1");
  assert.deepEqual([c1.display_name, c1.full_name], ["اسم جديد", "اسم جديد"]);
  assert.equal((await rows(db, "crm_contact_points")).find((p) => p.id === "p1").identifier, "905331112233");
  // the old label is gone, the new one is on, another organization's label is ignored
  assert.deepEqual((await rows(db, "opp_label_links")).map((l) => l.label_id), [L2]);
  const notes = await rows(db, "opp_notes");
  assert.deepEqual([notes.length, notes[0].body, notes[0].opportunity_id], [1, "اتصلت به اليوم", OPP]);
});

test("a number that belongs to another customer is refused and nothing changes", async () => {
  const { save, db } = setup();
  await assert.rejects(save({ data: { opportunityId: OPP, name: "اسم جديد", phone: "905550000000", labelIds: [L2] } }), /عميل آخر/);
  assert.equal((await rows(db, "crm_contacts")).find((c) => c.id === "c1").display_name, "قديم");
  assert.deepEqual((await rows(db, "opp_label_links")).map((l) => l.label_id), [L1]);
});

test("an empty number leaves the current one; a ticket outside the user's scope is refused", async () => {
  const { save, db } = setup();
  await save({ data: { opportunityId: OPP, name: "فقط الاسم", labelIds: [L1] } });
  assert.equal((await rows(db, "crm_contact_points")).find((p) => p.id === "p1").identifier, "905320000000");
  assert.equal((await rows(db, "opp_notes")).length, 0);
  const denied = setup(false);
  await assert.rejects(denied.save({ data: { opportunityId: OPP, name: "x", labelIds: [] } }), /غير موجودة أو غير مسموحة/);
  assert.equal((await rows(denied.db, "crm_contacts")).find((c) => c.id === "c1").display_name, "قديم");
});
