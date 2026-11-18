import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { hidePreset, listHiddenPresets, restorePresets } from "../src/modules/marketing/presets-core.ts";
import { PRESETS } from "../src/modules/marketing/filters.ts";

const UNIQUE = { ob_hidden_presets: ["organization_id", "preset_id"] };
const first = PRESETS[0].id;
const second = PRESETS[1].id;

test("an organization can remove a ready-made template, and it is listed as removed for that organization only", async () => {
  const db = fakeDb({}, UNIQUE);
  await hidePreset(db, "org-1", "user-1", first);
  await hidePreset(db, "org-2", "user-2", second);
  assert.deepEqual(await listHiddenPresets(db, "org-1"), [first]);
  assert.deepEqual(await listHiddenPresets(db, "org-2"), [second]);
  assert.deepEqual(await listHiddenPresets(db, "org-3"), []);
});

test("removing the same template twice keeps one record, and a template that does not exist is refused", async () => {
  const db = fakeDb({}, UNIQUE);
  await hidePreset(db, "org-1", "user-1", first);
  await hidePreset(db, "org-1", "user-2", first);
  assert.equal(db.tables.ob_hidden_presets.length, 1);
  await assert.rejects(hidePreset(db, "org-1", "user-1", "made-up"), /غير موجود/);
  assert.equal(db.tables.ob_hidden_presets.length, 1);
});

test("restoring brings back only this organization's removed templates", async () => {
  const db = fakeDb({}, UNIQUE);
  await hidePreset(db, "org-1", "u", first);
  await hidePreset(db, "org-1", "u", second);
  await hidePreset(db, "org-2", "u", first);
  assert.equal(await restorePresets(db, "org-1"), 2);
  assert.deepEqual(await listHiddenPresets(db, "org-1"), []);
  assert.deepEqual(await listHiddenPresets(db, "org-2"), [first], "another organization keeps its own choice");
  for (const call of db.calls.filter((c) => c.table === "ob_hidden_presets" && c.op !== "upsert"))
    assert.ok(call.filters.some(([op, col]) => op === "eq" && col === "organization_id"), `${call.op} without organization filter`);
});

test("a stored id of a template that was later removed from the app is not listed", async () => {
  const db = fakeDb({ ob_hidden_presets: [{ organization_id: "org-1", preset_id: "gone-from-the-app" }, { organization_id: "org-1", preset_id: first }] }, UNIQUE);
  assert.deepEqual(await listHiddenPresets(db, "org-1"), [first]);
});
