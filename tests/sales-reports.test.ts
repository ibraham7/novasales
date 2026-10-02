import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reportRows,
  reportWindow,
  filterReportData,
} from "../src/modules/commerce/reports-model.ts";

test("reports read every row despite lower API caps and reject partial results", async () => {
  const rows = Array.from({ length: 1403 }, (_, id) => ({ id }));
  assert.deepEqual(
    await reportRows(() => ({
      range: async (start: number) => ({ data: rows.slice(start, start + 137), error: null }),
    })),
    rows,
  );
  await assert.rejects(
    reportRows(() => ({
      range: async (start: number) => (start ? { error: true } : { data: [{ id: 1 }] }),
    })),
    /تعذر/,
  );
});

test("period includes start, excludes snapshot end, future and undated confirmations", () => {
  const window = reportWindow("7d", new Date("2026-10-03T10:00:00Z"));
  assert.equal(window.from, "2026-09-26T10:00:00.000Z");
  const orders = [window.from, window.to, "2026-10-04T10:00:00Z", null].map((confirmed_at, id) => ({
    id,
    status: "confirmed",
    confirmed_at,
  }));
  assert.deepEqual(
    filterReportData(orders, [], {}, window).orders.map((o) => o.id),
    [0],
  );
  assert.equal(reportWindow("all").from, null);
});

test("product filter counts only matching lines; combined filters retain currencies and exclude unrelated orders", () => {
  const order = {
    id: "o1",
    status: "confirmed",
    confirmed_at: "2026-10-01T12:00:00Z",
    department_id: "d1",
    sales_rep_user_id: "u1",
    currency: "TRY",
    total: 180,
    subtotal: 220,
    discount_total: 40,
  };
  const items = [
    {
      order_id: "o1",
      product_id: "p1",
      quantity: 2,
      list_unit_price: 30,
      sold_unit_price: 20,
      line_total: 40,
    },
    {
      order_id: "o1",
      product_id: "p2",
      quantity: 1,
      list_unit_price: 160,
      sold_unit_price: 140,
      line_total: 140,
    },
    { order_id: "outside", product_id: "p1", quantity: 50, line_total: 500 },
  ];
  const window = reportWindow("all", new Date("2026-10-03T00:00:00Z"));
  const result = filterReportData(
    [order, { ...order, id: "usd", currency: "USD" }],
    items,
    { productId: "p1", currency: "TRY", departmentId: "d1", repId: "u1" },
    window,
  );
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].total, 40);
  assert.equal(result.orders[0].discount_total, 20);
  assert.equal(result.items.length, 1);
  assert.equal(order.total, 180);
  assert.equal(filterReportData([order], items, { repId: "other" }, window).orders.length, 0);
  assert.equal(filterReportData([order], items, {}, window).orders[0].total, 180);
});
