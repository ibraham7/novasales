import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { audienceFromRows, normalizeCampaignPhone, parseCsv, readXlsx } from "../src/modules/campaigns/audience-file.ts";

test("phone numbers are cleaned to international digits", () => {
  assert.equal(normalizeCampaignPhone("+966 50 123 4567"), "966501234567");
  assert.equal(normalizeCampaignPhone("00966501234567"), "966501234567");
  assert.equal(normalizeCampaignPhone("٩٦٦٥٠١٢٣٤٥٦٧"), "966501234567");
  assert.equal(normalizeCampaignPhone("0501234567", "966"), "966501234567");
  assert.equal(normalizeCampaignPhone("0501234567"), null);
  assert.equal(normalizeCampaignPhone("123"), null);
  assert.equal(normalizeCampaignPhone("9665012345678901234"), null);
});

test("CSV with quotes, semicolons and a header", () => {
  const rows = parseCsv('﻿الاسم;الهاتف\n"علي; الأول";+90 555 111 2233\r\nمنى;905551112234\n');
  assert.deepEqual(rows, [["الاسم", "الهاتف"], ["علي; الأول", "+90 555 111 2233"], ["منى", "905551112234"]]);
  assert.deepEqual(audienceFromRows(rows).rows, [
    { phone: "905551112233", name: "علي; الأول" },
    { phone: "905551112234", name: "منى" },
  ]);
});

test("a pasted list without a header finds the phone column", () => {
  const result = audienceFromRows(parseCsv("966501111111\n966501111112\n966501111111\nabc"));
  assert.deepEqual(result.rows.map((r) => r.phone), ["966501111111", "966501111112"]);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.invalid, ["abc"]);
});

test("an Excel file: first sheet, numbers, duplicates, local and invalid numbers", async () => {
  const file = readFileSync(new URL("./fixtures/campaign-audience.xlsx", import.meta.url));
  const table = await readXlsx(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  assert.deepEqual(table[0], ["الاسم", "رقم الجوال", "ملاحظة"]);
  const result = audienceFromRows(table, "966");
  assert.deepEqual(result.rows, [
    { phone: "966501234567", name: "أحمد & شركاه" },
    { phone: "966501234568", name: "سارة" },
    { phone: "966501234569", name: "محلي" },
    { phone: "966501234570", name: "رقم عربي" },
  ]);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.invalid, ["123"]);
});

import { campaignPacing, retryDelayMinutes } from "../src/modules/campaigns/pacing.ts";

test("sending is spread over the minute with a random gap", () => {
  const twenty = campaignPacing(20, () => 0.5);
  assert.equal(twenty.gapMs(), 3000);
  assert.equal(twenty.batch, 17);
  const slow = campaignPacing(5, () => 0);
  assert.equal(slow.batch, 5);
  assert.equal(slow.gapMs(), 9000);
  const fast = campaignPacing(1000, () => 1);
  assert.equal(fast.batch, 21);
  assert.equal(fast.gapMs(), 3125);
  // A run never takes much longer than a minute.
  for (const perMinute of [1, 5, 20, 60, 1000]) {
    const p = campaignPacing(perMinute, () => 1);
    assert.ok((p.batch - 1) * p.gapMs() <= 65000, `${perMinute}/min`);
  }
});

test("protection limits wait instead of failing the recipient", () => {
  assert.equal(retryDelayMinutes("hourly_cap"), 15);
  assert.equal(retryDelayMinutes("daily_cap"), 60);
  assert.equal(retryDelayMinutes("observation_window"), 60);
  assert.equal(retryDelayMinutes("no_phone"), null);
  assert.equal(retryDelayMinutes(undefined), null);
});

import { looksLikeLid } from "../src/modules/campaigns/audience-file.ts";

test("WhatsApp internal ids are told apart from phone numbers", () => {
  assert.equal(looksLikeLid("136391484780684"), true);
  assert.equal(looksLikeLid("15551234567"), false);
  assert.equal(looksLikeLid("905516886988"), false);
  assert.equal(looksLikeLid("447876137354"), false);
});
