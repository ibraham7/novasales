import { test } from "node:test";
import assert from "node:assert/strict";
import { MESSAGE_VARIABLES, first, renderMessage, unknownVariables, wordingCount } from "../src/modules/workflow/send/template.ts";

const vars = { name: "أحمد علي", first_name: "أحمد", phone: "905321112233", stage: "عرض سعر", assignee: "مياسة", source: "إنستغرام", org: "نوفا", value: "1,500 USD" };

test("variables are filled from the customer, the ticket and the organization", () => {
  assert.equal(renderMessage("مرحباً {name}، معك {assignee} من {org}. وصلنا طلبك ({stage}).", vars), "مرحباً أحمد علي، معك مياسة من نوفا. وصلنا طلبك (عرض سعر).");
  assert.equal(renderMessage("{first_name} قيمة عرضك {value}", vars), "أحمد قيمة عرضك 1,500 USD");
});

test("the older double-brace names still work", () => {
  assert.equal(renderMessage("مرحباً {{contact_name}} معك {{agent_name}} من {{department_name}}", vars), "مرحباً أحمد علي معك مياسة من نوفا");
});

test("a choice picks one option; different recipients can get different words, and every option can appear", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) seen.add(renderMessage("{مرحباً|أهلاً|هلا} {first_name}", vars, () => (i % 3) / 3 + 0.01));
  assert.deepEqual([...seen].sort(), ["أهلاً أحمد", "مرحباً أحمد", "هلا أحمد"].sort());
  assert.equal(renderMessage("{أ|ب}", {}, () => 0.999), "ب");
  assert.equal(renderMessage("{أ|ب}", {}, () => 0), "أ");
});

test("a variable with no value is left empty, never shown as a placeholder; spaces are tidied", () => {
  assert.equal(renderMessage("مرحباً {name}، معك {assignee} من {org}", { name: "سارة" }), "مرحباً سارة، معك من");
  const out = renderMessage("أهلاً {first_name} {name}!", {});
  assert.ok(!out.includes("{"));
  assert.equal(renderMessage("سطر {phone} \nسطر ثانٍ", {}), "سطر\nسطر ثانٍ");
});

test("unknown variables are reported (for the save-time check); choices and known names are not", () => {
  assert.deepEqual(unknownVariables("مرحباً {name} {nmae} {{oops}} {a|b}"), ["nmae", "oops"]);
  assert.deepEqual(unknownVariables("{مرحباً|أهلاً} {first_name} {{contact_name}}"), []);
  for (const key of Object.keys(MESSAGE_VARIABLES)) assert.deepEqual(unknownVariables(`{${key}}`), []);
});

test("how many wordings a template can produce, and the first name helper", () => {
  assert.equal(wordingCount("{مرحباً|أهلاً} يا {name} {شكراً|تسلم|ممنون}"), 6);
  assert.equal(wordingCount("بدون خيارات {name}"), 1);
  assert.equal(first("  أحمد   علي "), "أحمد");
  assert.equal(first(null), "");
});
