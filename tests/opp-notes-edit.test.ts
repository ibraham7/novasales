import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { fakeDb } from "./helpers/fake-db.ts";

const source = readFileSync(new URL("../src/modules/crm/opportunity.functions.ts", import.meta.url), "utf8").replace(/import\("([^"]+)"\)/g, (_, path) => `Promise.resolve(__deps[${JSON.stringify(path)}])`);
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const OPP = "00000000-0000-0000-0000-0000000000c1";
const N_MINE = "00000000-0000-0000-0000-0000000000d1";
const N_OTHER = "00000000-0000-0000-0000-0000000000d2";
const N_FOREIGN = "00000000-0000-0000-0000-0000000000d3";

function setup(opts: { userId?: string; permissions?: string[]; isSuperAdmin?: boolean; allowed?: boolean } = {}) {
  const userId = opts.userId ?? "ali";
  const access = { organizationId: "org-a", userId, permissions: opts.permissions ?? ["crm.opportunities.update"], isSuperAdmin: !!opts.isSuperAdmin };
  const db: any = fakeDb({
    opp_opportunities: [{ id: OPP, organization_id: "org-a", owner_agent_id: "ali", department_id: null, deleted_at: null }],
    opp_notes: [
      { id: N_MINE, organization_id: "org-a", opportunity_id: OPP, author_id: "ali", body: "قديمة", created_at: "2026-11-19T10:00:00Z" },
      { id: N_OTHER, organization_id: "org-a", opportunity_id: OPP, author_id: "sara", body: "ملاحظة سارة", created_at: "2026-11-19T11:00:00Z" },
      { id: N_FOREIGN, organization_id: "org-b", opportunity_id: OPP, author_id: "ali", body: "مؤسسة ثانية", created_at: "2026-11-19T12:00:00Z" },
    ],
    profiles: [{ id: "ali", full_name: "علي" }, { id: "sara", full_name: "سارة" }],
  });
  const createServerFn = () => {
    let validate = (d: any) => d;
    const builder: any = { inputValidator(v: any) { validate = v; return builder; }, handler(fn: any) { return (args: any) => fn({ data: validate(args?.data ?? {}) }); } };
    return builder;
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (name: string) => (name === "@tanstack/react-start" ? { createServerFn } : { z }), __deps: {
    "@/platform/workspace/workspace.server": { supabaseAdmin: db, getWorkspace: async () => ({ organizationId: "org-a", userId }) },
    "@/platform/rbac/rbac.server": { requireAnyPermission: async () => access },
    "@/platform/rbac/data-scope.server": { canAccessOpportunityRow: () => opts.allowed ?? true },
  } });
  return { list: exports.listOppNotes, update: exports.updateOppNote, db };
}
const body = async (db: any, id: string) => (await db.from("opp_notes").select("*").eq("id", id)).data[0].body;

test("the author may edit their own note, and the text is saved", async () => {
  const { update, db } = setup();
  const r = await update({ data: { noteId: N_MINE, body: "  نص معدّل  " } });
  assert.equal(r.ok, true);
  assert.equal(await body(db, N_MINE), "نص معدّل");
});

test("someone else's note cannot be edited by an ordinary user, but a manager or super admin may", async () => {
  const user = setup();
  await assert.rejects(user.update({ data: { noteId: N_OTHER, body: "تغيير" } }), /أو المشرف/);
  assert.equal(await body(user.db, N_OTHER), "ملاحظة سارة");
  const manager = setup({ permissions: ["opportunities.manage"] });
  await manager.update({ data: { noteId: N_OTHER, body: "من المشرف" } });
  assert.equal(await body(manager.db, N_OTHER), "من المشرف");
  const admin = setup({ isSuperAdmin: true, permissions: [] });
  await admin.update({ data: { noteId: N_OTHER, body: "من المدير العام" } });
  assert.equal(await body(admin.db, N_OTHER), "من المدير العام");
});

test("another organization's note, a ticket outside the user's scope and an empty text are all refused", async () => {
  const a = setup();
  await assert.rejects(a.update({ data: { noteId: N_FOREIGN, body: "x" } }), /غير موجودة/);
  assert.equal(await body(a.db, N_FOREIGN), "مؤسسة ثانية");
  const outside = setup({ allowed: false });
  await assert.rejects(outside.update({ data: { noteId: N_MINE, body: "x" } }), /صلاحية/);
  assert.equal(await body(outside.db, N_MINE), "قديمة");
  assert.throws(() => a.update({ data: { noteId: N_MINE, body: "   " } }), /اكتب نص/);
});

test("the list says which notes the viewer may edit", async () => {
  const user = setup();
  const notes = await user.list({ data: { opportunityId: OPP } });
  const byId = Object.fromEntries(notes.map((n: any) => [n.id, n.can_edit]));
  assert.deepEqual([notes.length, byId[N_MINE], byId[N_OTHER]], [2, true, false]);
  const manager = setup({ permissions: ["opportunities.manage"] });
  assert.ok((await manager.list({ data: { opportunityId: OPP } })).every((n: any) => n.can_edit));
});
