import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_KEYS, clip, safeInternalUrl } from "../src/modules/notifications/types.ts";
import { createRateLimiter } from "../src/modules/notifications/rate-limit.ts";

test("a notification link can only point inside the site", () => {
  assert.equal(safeInternalUrl("/leads"), "/leads");
  assert.equal(safeInternalUrl("/pipeline/abc?x=1#top"), "/pipeline/abc?x=1#top");
  for (const bad of ["https://evil.com", "//evil.com", "javascript:alert(1)", "\\\\evil", "/a\\b", "/a\nb", "evil.com/x", "", null, undefined])
    assert.equal(safeInternalUrl(bad as any), "/", String(bad));
  assert.equal(safeInternalUrl("x", "/dashboard"), "/dashboard");
  assert.equal(safeInternalUrl(`/${"a".repeat(500)}`).length, 300);
});

test("notification text is flattened and shortened", () => {
  assert.equal(clip("  عميل \n جديد  ", 50), "عميل جديد");
  assert.equal(clip("a".repeat(20), 10), `${"a".repeat(9)}…`);
  assert.equal(clip(null, 10), "");
});

test("every notification type has an Arabic label, description and group", () => {
  assert.ok(NOTIFICATION_TYPE_KEYS.length >= 7);
  for (const key of NOTIFICATION_TYPE_KEYS) {
    const type = NOTIFICATION_TYPES[key];
    assert.match(type.label, /[؀-ۿ]/);
    assert.ok(type.description && type.group);
  }
});

test("the rate limiter allows a burst then blocks until the window passes", () => {
  const limiter = createRateLimiter(3, 1000);
  assert.deepEqual([0, 1, 2, 3].map((i) => limiter.allow("a", 100 + i)), [true, true, true, false]);
  assert.equal(limiter.allow("b", 100), true);
  assert.equal(limiter.allow("a", 1101), true);
});
