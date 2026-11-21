import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, formatTotals, floatUnreadFirst, isBoardSort, parseAmount, placeInColumn, sumByCurrency } from "../src/modules/crm/board-money.ts";

test("totals are kept per currency; empty, zero and invalid values count for nothing", () => {
  const totals = sumByCurrency([{ value: 100, currency: "USD" }, { value: "250.5", currency: "USD" }, { value: 4000, currency: "TRY" }, { value: 0, currency: "USD" }, { value: null }, { value: -5, currency: "USD" }, { value: "abc" }]);
  assert.deepEqual(totals, { USD: 350.5, TRY: 4000 });
  assert.deepEqual(sumByCurrency([{ value: 10, currency: null }], "SAR"), { SAR: 10 });
});

test("amounts are written without noise: whole numbers plain, fractions with two decimals", () => {
  assert.equal(formatMoney(12400, "USD"), "12,400 USD");
  assert.equal(formatMoney(99.5, "USD"), "99.50 USD");
  assert.equal(formatTotals({ TRY: 5000, USD: 12400 }), "12,400 USD · 5,000 TRY");
  assert.equal(formatTotals({}), "");
  assert.equal(formatTotals({ USD: 0 }), "");
  assert.equal(formatTotals(undefined), "");
});

test("only the known sort choices are accepted", () => {
  for (const ok of ["newest", "oldest", "value_desc", "value_asc", "manual"]) assert.equal(isBoardSort(ok), true);
  assert.equal(isBoardSort("price"), false);
  assert.equal(isBoardSort(undefined), false);
});

test("a typed amount: digits in either script, thousands commas, empty means 0, anything else is refused", () => {
  assert.equal(parseAmount("1,250.5"), 1250.5);
  assert.equal(parseAmount("٣٥٠٠"), 3500);
  assert.equal(parseAmount("۱۲۰"), 120);
  assert.equal(parseAmount("٢٫٥"), 2.5);
  assert.equal(parseAmount("  "), 0);
  assert.equal(parseAmount("12abc"), null);
  assert.equal(parseAmount("-5"), null);
  assert.equal(parseAmount("1e5"), null);
});

test("dropping a card on another puts it above or below it; nothing changes when it would land where it is", () => {
  const column = ["a", "b", "c", "d"];
  assert.deepEqual(placeInColumn(column, "d", "b", false), ["a", "d", "b", "c"]);
  assert.deepEqual(placeInColumn(column, "a", "c", true), ["b", "c", "a", "d"]);
  assert.deepEqual(placeInColumn(column, "a", "d", true), ["b", "c", "d", "a"]);
  assert.deepEqual(placeInColumn(column, "d", "a", false), ["d", "a", "b", "c"]);
  // a card from another column lands at the chosen spot
  assert.deepEqual(placeInColumn(column, "x", "b", true), ["a", "b", "x", "c", "d"]);
  // no change
  assert.equal(placeInColumn(column, "b", "b", true), null);
  assert.equal(placeInColumn(column, "b", "a", true), null);
  assert.equal(placeInColumn(column, "a", "b", false), null);
  assert.equal(placeInColumn(column, "x", "missing", true), null);
});

test("tickets with a new message go to the top, the latest message first; the rest keep their order", () => {
  const items = [
    { id: "a", unread_count: 0, last_message_at: "2026-11-21T10:00:00Z" },
    { id: "b", unread_count: 2, last_message_at: "2026-11-21T08:00:00Z" },
    { id: "c", unread_count: 0, last_message_at: null },
    { id: "d", unread_count: 1, last_message_at: "2026-11-21T09:30:00Z" },
    { id: "e" },
  ];
  assert.deepEqual(floatUnreadFirst(items).map((o) => o.id), ["d", "b", "a", "c", "e"]);
  // nothing unread: the very same list comes back
  const calm = items.filter((o) => !o.unread_count);
  assert.equal(floatUnreadFirst(calm), calm);
  assert.deepEqual(items.map((o) => o.id), ["a", "b", "c", "d", "e"]);
});
