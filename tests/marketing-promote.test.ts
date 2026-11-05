import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { promoteProspects } from "../src/modules/marketing/promote-core.ts";

const ORG = "org-1";
const prospect = (id: string, extra: any = {}) => ({ id, organization_id: ORG, name: `جهة ${id}`, phone_e164: `90532000000${id}`, status: "replied", emails: [], socials: {}, ...extra });

test("replied businesses become CRM leads, existing contacts are linked, and nobody who opted out is moved", async () => {
  const db = fakeDb({
    ob_prospects: [
      prospect("1", { emails: ["a@x.com"] }),
      prospect("2"),
      prospect("3", { status: "opted_out" }),
      prospect("4", { status: "review" }),
      prospect("5", { phone_e164: null }),
      prospect("6", { promoted_contact_id: "c-old" }),
    ],
    crm_contact_points: [{ organization_id: ORG, identifier: "905320000002", contact_id: "contact-2" }],
    crm_leads: [],
    ob_suppressions: [],
  });
  const saved: any[] = [];
  const result = await promoteProspects(db, ORG, ["1", "2", "3", "4", "5", "6"], async (input) => {
    saved.push(input);
    return { id: "lead-x", contact_id: input.contactId ? (input.contactId as string) : "contact-new" };
  });
  assert.deepEqual({ ...result, failed: result.failed.length }, { promoted: 1, linked: 1, already: 1, blocked: 1, noPhone: 1, notReady: 1, failed: 0 });
  assert.equal(saved[0].contactName, "جهة 1");
  assert.equal(saved[0].email, "a@x.com");
  assert.equal(saved[0].phone, "905320000001");
  assert.equal(saved[1].contactId, "contact-2");
  const byId = Object.fromEntries(db.tables.ob_prospects.map((p: any) => [p.id, p]));
  assert.deepEqual([byId["1"].status, byId["1"].promoted_contact_id], ["converted", "contact-new"]);
  assert.deepEqual([byId["2"].status, byId["2"].promoted_contact_id], ["converted", "contact-2"]);
  assert.equal(byId["4"].status, "review");
});

test("a CRM refusal is reported for that business and the others still move", async () => {
  const db = fakeDb({ ob_prospects: [prospect("1"), prospect("2")], crm_contact_points: [], crm_leads: [], ob_suppressions: [] });
  let n = 0;
  const result = await promoteProspects(db, ORG, ["1", "2"], async () => {
    if (++n === 1) throw new Error("لا تملك صلاحية حفظ العميل المحتمل");
    return { id: "l", contact_id: "c" };
  });
  assert.equal(result.promoted, 1);
  assert.deepEqual(result.failed, [{ name: "جهة 1", error: "لا تملك صلاحية حفظ العميل المحتمل" }]);
  assert.equal(db.tables.ob_prospects[0].status, "replied");
});
