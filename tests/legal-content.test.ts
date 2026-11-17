import { test } from "node:test";
import assert from "node:assert/strict";
import { legalDoc, legalInfoFromEnv, missingLegalInfo, type LegalKind } from "../src/modules/legal/legal-content.ts";

const info = { company: "Acme Ltd", email: "privacy@acme.example", country: "Türkiye" };
const text = (kind: LegalKind, lang: "ar" | "en", i = info) =>
  legalDoc(kind, lang, i).sections.flatMap((s) => [s.heading, ...s.paragraphs]).join("\n");

test("the company details come from the environment and missing ones are reported", () => {
  assert.deepEqual(legalInfoFromEnv({ LEGAL_COMPANY_NAME: " Acme Ltd ", LEGAL_CONTACT_EMAIL: "a@b.example", LEGAL_COUNTRY: "TR" }), { company: "Acme Ltd", email: "a@b.example", country: "TR" });
  const none = legalInfoFromEnv({});
  assert.deepEqual(missingLegalInfo(none), ["company", "email", "country"]);
  assert.deepEqual(missingLegalInfo(info), []);
});

test("every page, in both languages, carries the company's name and contact and no leftover placeholder", () => {
  for (const kind of ["privacy", "terms", "deletion"] as const) {
    for (const lang of ["ar", "en"] as const) {
      const body = text(kind, lang);
      assert.ok(body.includes("privacy@acme.example"), `${kind}/${lang} has the contact email`);
      assert.ok(!/\[[^\]]+\]/.test(body), `${kind}/${lang} has no placeholder`);
    }
  }
  assert.ok(text("privacy", "en").includes("Acme Ltd"));
  assert.ok(text("terms", "ar").includes("Acme Ltd"));
});

test("without the details the pages show visible placeholders instead of blanks", () => {
  const body = text("privacy", "en", { company: null, email: null, country: null });
  assert.ok(body.includes("[Company name]"));
  assert.ok(body.includes("[contact email]"));
});

test("the privacy page says what Meta requires: no password seen, data kept apart per company, how to delete", () => {
  const ar = text("privacy", "ar");
  assert.ok(ar.includes("كلمة سر"));
  assert.ok(ar.includes("الفصل بين الشركات"));
  assert.ok(ar.includes("حذف البيانات"));
  const deletion = text("deletion", "en");
  assert.ok(deletion.includes("30 days"));
  assert.ok(deletion.includes("Disconnect"));
});
