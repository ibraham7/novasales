import assert from "node:assert/strict";
import test from "node:test";
import { canOpenMarketing, emailRestrictionAllows, parseAllowedEmails } from "../src/modules/marketing/gate.ts";

test("the page opens for whoever may manage campaigns, and for a super admin", () => {
  assert.equal(canOpenMarketing(["cmp.campaigns.manage"], false), true);
  assert.equal(canOpenMarketing(["crm.leads.view", "cmp.campaigns.manage"], false), true);
  assert.equal(canOpenMarketing([], true), true);
});

test("a user without the permission does not get it, whatever their email", () => {
  assert.equal(canOpenMarketing(["opportunities.view_own", "messaging.send"], false), false);
  assert.equal(canOpenMarketing([], false), false);
  assert.equal(canOpenMarketing(null, false), false);
  assert.equal(canOpenMarketing(undefined, undefined), false);
});

test("an empty or missing email list holds nobody back", () => {
  assert.equal(emailRestrictionAllows("ali@x.com", undefined), true);
  assert.equal(emailRestrictionAllows("ali@x.com", ""), true);
  assert.equal(emailRestrictionAllows("ali@x.com", "  ,; "), true);
  assert.equal(emailRestrictionAllows(null, ""), true);
});

test("a filled email list restricts to the listed emails, ignoring case and spaces", () => {
  const raw = " Ali@X.com , other@y.com";
  assert.equal(emailRestrictionAllows("ali@x.COM", raw), true);
  assert.equal(emailRestrictionAllows("someone@x.com", raw), false);
  assert.equal(emailRestrictionAllows("", raw), false);
  assert.equal(emailRestrictionAllows(null, raw), false);
  assert.equal(parseAllowedEmails(raw).size, 2);
});
