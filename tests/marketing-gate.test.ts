import assert from "node:assert/strict";
import test from "node:test";
import { isEmailAllowed, parseAllowedEmails } from "../src/modules/marketing/gate.ts";

test("empty or missing list allows nobody", () => {
  assert.equal(isEmailAllowed("ali@x.com", undefined), false);
  assert.equal(isEmailAllowed("ali@x.com", ""), false);
  assert.equal(isEmailAllowed("ali@x.com", "  ,; "), false);
});
test("matches only listed emails, ignoring case and spaces", () => {
  const raw = " Ali@X.com , other@y.com";
  assert.equal(isEmailAllowed("ali@x.COM", raw), true);
  assert.equal(isEmailAllowed("someone@x.com", raw), false);
  assert.equal(isEmailAllowed("", raw), false);
  assert.equal(isEmailAllowed(null, raw), false);
  assert.equal(parseAllowedEmails(raw).size, 2);
});
