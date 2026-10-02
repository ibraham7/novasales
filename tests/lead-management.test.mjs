import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { normalizeLeadPhone, readLeadRows, paginateLeads } from "../src/modules/crm/lead-data.ts";
const source = fs
  .readFileSync(new URL("../src/modules/crm/lead-input.ts", import.meta.url), "utf8")
  .replace(
    /["']@\/lib\/validation["']/g,
    JSON.stringify(new URL("../src/lib/validation.ts", import.meta.url).href),
  )
  .replace(
    /["']\.\/lead-data["']/g,
    JSON.stringify(new URL("../src/modules/crm/lead-data.ts", import.meta.url).href),
  );
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
}).outputText;
const { leadCreateSchema, leadUpdateSchema } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
test("lead inputs normalize names and phone numbers and reject incomplete/malformed contact data", () => {
  assert.equal(normalizeLeadPhone("٠٠٩٠ (٥٥٥) ٥٥٥-٥٥٥٥"), "+905555555555");
  assert.equal(
    leadCreateSchema.parse({ contactName: "  محمد  ", phone: " +90 555 555 5555 ", email: "" })
      .contactName,
    "محمد",
  );
  assert.equal(leadCreateSchema.parse({ contactName: "Test", phone: "" }).phone, "");
  assert.equal(leadCreateSchema.safeParse({ contactName: "   " }).success, false);
  assert.equal(leadCreateSchema.safeParse({ contactName: "Test", phone: "abc123" }).success, false);
  assert.equal(
    leadCreateSchema.safeParse({ contactName: "Test", email: "invalid" }).success,
    false,
  );
  assert.equal(
    leadCreateSchema.safeParse({ contactName: "Test", status: "converted" }).success,
    false,
  );
  assert.equal(
    leadUpdateSchema.safeParse({ leadId: "00000000-0000-0000-0000-000000000001", contactName: " " })
      .success,
    false,
  );
});
test("lead pagination reads beyond API caps and search candidates are never truncated before filtering", async () => {
  const dataset = Array.from({ length: 2403 }, (_, id) => ({ id }));
  const all = await readLeadRows(() => ({
    range: async (start, end) => ({
      data: dataset.slice(start, Math.min(end + 1, start + 137)),
      error: null,
    }),
  }));
  assert.equal(all.length, 2403);
  const page = paginateLeads(all, 97, 25);
  assert.equal(page.total, 2403);
  assert.deepEqual(
    page.rows.map((r) => r.id),
    [2400, 2401, 2402],
  );
});
test("lead fetch fails visibly rather than returning incomplete totals", async () => {
  await assert.rejects(
    readLeadRows(() => ({ range: async () => ({ data: null, error: { code: "failure" } }) })),
    /تعذر إتمام/,
  );
});
test("hidden custom fields preserve existing data and do not block the current editor with inaccessible required fields", async () => {
  const original = fs.readFileSync(
    new URL("../src/modules/crm/custom-fields.server.ts", import.meta.url),
    "utf8",
  );
  const mock = `let definitions=[];export function setDefinitions(value){definitions=value;}const query={select(){return this;},eq(){return this;},order(){return this;},then(resolve){return Promise.resolve({data:definitions,error:null}).then(resolve);}};const supabaseAdmin={from(){return query;}};`;
  const replaced = original.replace(/import \{ supabaseAdmin \} from ["'][^"']+["'];/, mock);
  const compiled = ts.transpileModule(replaced, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).outputText;
  const module = await import(
    "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
  );
  module.setDefinitions([
    {
      key: "secret",
      label: "Owner field",
      visibility: "owner",
      is_required: true,
      default_value: null,
      field_type: "text",
      validation: {},
      options: [],
    },
  ]);
  assert.deepEqual(
    await module.validateAndApplyCustomFields(
      "org",
      "lead",
      { secret: "injected" },
      { role: "agent" },
    ),
    {},
  );
  assert.deepEqual(
    await module.validateAndApplyCustomFields(
      "org",
      "lead",
      { secret: "injected" },
      { role: "agent", existing: { secret: "saved" } },
    ),
    { secret: "saved" },
  );
  await assert.rejects(
    module.validateAndApplyCustomFields("org", "lead", {}, { role: "owner" }),
    /مطلوب/,
  );
});
