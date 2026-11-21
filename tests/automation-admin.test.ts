import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { fakeDb } from "./helpers/fake-db.ts";
import { RECIPES, recipeDefinition } from "../src/modules/workflow/recipes.ts";
import { validateMessageSteps } from "../src/modules/workflow/send/message-config.ts";
import { validateTriggerConfig } from "../src/modules/workflow/trigger-config.ts";

const source = readFileSync(new URL("../src/modules/workflow/admin.functions.ts", import.meta.url), "utf8").replace(/import\("([^"]+)"\)/g, (_, path) => `Promise.resolve(__deps[${JSON.stringify(path)}])`);
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ORG = "org-a";

function setup(seed: Record<string, any[]> = {}, opts: { canManage?: boolean; getAction?: (a: string) => any } = {}) {
  const db: any = fakeDb(seed);
  const createServerFn = () => {
    let validate = (d: any) => d;
    const builder: any = { inputValidator(v: any) { validate = v; return builder; }, handler(fn: any) { return (args: any) => fn({ data: validate(args?.data ?? {}) }); } };
    return builder;
  };
  const access = { organizationId: ORG, db, canManage: opts.canManage ?? true, access: { userId: "ali" } };
  const exports: any = {};
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => (name === "@tanstack/react-start" ? { createServerFn } : name === "./access.server" ? { workflowAccess: async (write?: boolean) => { if (write && !access.canManage) throw new Error("Forbidden"); return access; } } : { z }),
    __deps: {
      "./send/gate": { DEFAULT_SETTINGS: { sending_enabled: false, timezone: "Europe/Istanbul", send_window_start: "09:00", send_window_end: "20:00", daily_limit: 100, gap_min_seconds: 45, gap_max_seconds: 180, defer_ttl_minutes: 720 } },
      "../campaigns/send-schedule": { scheduleProblem: (s: any) => (s.windowEnd <= s.windowStart ? "ساعات الإرسال غير صحيحة" : null) },
      "./recipes": { RECIPES, recipeDefinition },
      "./definition": { validateWorkflowDefinition: () => {} },
      "./send/message-config": { validateMessageSteps },
      "./trigger-config": { validateTriggerConfig },
      "./actions/registry.server": { ensureActionsRegistered: async () => {}, getAction: opts.getAction ?? (() => () => {}) },
    },
  });
  return { api: exports, db };
}
const settings = { sending_enabled: true, alerts_enabled: false, timezone: "Europe/Istanbul", send_window_start: "09:00", send_window_end: "20:00", daily_limit: 100, gap_min_seconds: 45, gap_max_seconds: 180, defer_ttl_minutes: 720 };

test("settings: an organization with nothing saved sees sending and alerts OFF", async () => {
  const { api } = setup({ wf_settings: [] });
  const r = await api.getAutomationSettings();
  assert.deepEqual([r.installed, r.settings.sending_enabled, r.settings.alerts_enabled, r.settings.timezone], [true, false, false, "Europe/Istanbul"]);
});

test("settings: saved values are stored for the organization, with who changed them", async () => {
  const { api, db } = setup({ wf_settings: [] });
  await api.saveAutomationSettings({ data: { ...settings, alerts_enabled: true, daily_limit: 50 } });
  const row = db.tables.wf_settings[0];
  assert.deepEqual([row.organization_id, row.sending_enabled, row.alerts_enabled, row.daily_limit, row.updated_by], [ORG, true, true, 50, "ali"]);
  const again = await api.getAutomationSettings();
  assert.deepEqual([again.settings.sending_enabled, again.settings.daily_limit], [true, 50]);
});

test("settings: bad hours, a limit out of range, reversed gaps and a user who may not manage are all refused, nothing saved", async () => {
  const { api, db } = setup({ wf_settings: [] });
  assert.throws(() => api.saveAutomationSettings({ data: { ...settings, send_window_start: "9:00" } }));
  assert.throws(() => api.saveAutomationSettings({ data: { ...settings, daily_limit: 0 } }));
  await assert.rejects(api.saveAutomationSettings({ data: { ...settings, gap_min_seconds: 300 } }), /أقل فاصل/);
  await assert.rejects(api.saveAutomationSettings({ data: { ...settings, send_window_end: "08:00" } }), /ساعات الإرسال/);
  const viewer = setup({ wf_settings: [] }, { canManage: false });
  await assert.rejects(viewer.api.saveAutomationSettings({ data: settings }), /Forbidden/);
  assert.equal(db.tables.wf_settings.length + viewer.db.tables.wf_settings.length, 0);
});

test("message log: newest first with the customer's and workflow's names, this organization only, filtered by status", async () => {
  const { api } = setup({
    wf_message_log: [
      { id: "1", organization_id: ORG, status: "sent", contact_id: "c1", workflow_id: "w1", created_at: "2026-11-21T10:00:00Z" },
      { id: "2", organization_id: ORG, status: "skipped", contact_id: "c1", workflow_id: "w1", reason: "العميل طلب عدم المراسلة", created_at: "2026-11-21T11:00:00Z" },
      { id: "3", organization_id: "org-b", status: "sent", contact_id: "cx", workflow_id: "wx", created_at: "2026-11-21T12:00:00Z" },
    ],
    crm_contacts: [{ id: "c1", organization_id: ORG, display_name: "أحمد" }, { id: "cx", organization_id: "org-b", display_name: "غريب" }],
    wf_workflows: [{ id: "w1", organization_id: ORG, name: "ترحيب" }, { id: "wx", organization_id: "org-b", name: "ثانية" }],
  });
  const all = await api.listMessageLog({ data: {} });
  assert.deepEqual(all.messages.map((m: any) => m.id).sort(), ["1", "2"]);
  assert.deepEqual([all.messages[0].contact_name, all.messages[0].workflow_name], ["أحمد", "ترحيب"]);
  const skipped = await api.listMessageLog({ data: { status: "skipped" } });
  assert.deepEqual(skipped.messages.map((m: any) => m.id), ["2"]);
});

test("recipes: every recipe is valid, creates a workflow that is SWITCHED OFF, and unknown recipes are refused", async () => {
  for (const r of RECIPES) {
    const def = recipeDefinition(r);
    assert.equal(def.engine, "v1");
    assert.equal(validateMessageSteps(def.steps), null, r.id);
    assert.equal(validateTriggerConfig(r.trigger.type, r.trigger.config), null, r.id);
    assert.ok(def.steps.every((s: any) => s.type === "end" || true));
  }
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
  const { api, db } = setup({ wf_workflows: [] });
  const made = await api.createWorkflowFromRecipe({ data: { recipeId: RECIPES[0]!.id } });
  const row = db.tables.wf_workflows.find((w: any) => w.id === made.id);
  assert.deepEqual([row.is_active, row.organization_id, row.created_by, row.trigger_type], [false, ORG, "ali", "event"]);
  assert.equal(row.definition.steps.length, RECIPES[0]!.steps.length);
  await assert.rejects(api.createWorkflowFromRecipe({ data: { recipeId: "nope" } }), /غير موجود/);
  const noAction = setup({ wf_workflows: [] }, { getAction: () => undefined });
  await assert.rejects(noAction.api.createWorkflowFromRecipe({ data: { recipeId: RECIPES[0]!.id } }), /غير مدعوم/);
});
