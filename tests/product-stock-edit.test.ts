import { test } from "node:test";
import assert from "node:assert/strict";
import { existingOptionGroups, newCombinations, stockPlan, EMPTY_STOCK_EDITS } from "../src/modules/commerce/product-stock-edit.ts";
import { emptyComboStock } from "../src/modules/commerce/product-options.ts";

const color = { id: "c", name: "اللون", kind: "select" as const, scope: "variant" as const, options: ["أحمر", "أسود"], is_price_floor: false };
const size = { id: "s", name: "المقاس", kind: "multiselect" as const, scope: "variant" as const, options: ["S", "M"], is_price_floor: false };
const product = {
  sales_product_variants: [
    { id: "d", label: "أساسي", attributes: {}, is_default: true },
    { id: "v1", label: "أحمر / S", attributes: { c: "أحمر", s: ["S"] }, is_default: false },
    { id: "v2", label: "أسود / S", attributes: { c: "أسود", s: ["S"] }, is_default: false },
  ],
  sales_stock_batches: [
    { id: "b1", variant_id: "v1", batch_code: "B1", expires_on: null, quantity: 5 },
    { id: "b2", variant_id: "v2", batch_code: "B2", expires_on: null, quantity: 3 },
  ],
};

test("existing options come from the stock rows", () => {
  assert.deepEqual(existingOptionGroups(product, [color, size]), [
    { key: "c", name: "اللون", values: ["أحمر", "أسود"] },
    { key: "s", name: "المقاس", values: ["S"] },
  ]);
});

test("a new value adds only the combinations that include it", () => {
  const draft = { groups: [{ key: "c", name: "اللون", values: ["أحمر", "أسود", "أخضر"] }, { key: "s", name: "المقاس", values: ["S"] }], stock: {} };
  assert.deepEqual(newCombinations(draft, product, [color, size]), [["أخضر", "S"]]);
});

test("a brand new option is refused for a product that already has options", () => {
  const draft = { groups: [{ key: "x", name: "السعة", values: ["64GB"] }], stock: {} };
  assert.throws(() => newCombinations(draft, product, [color, size]), /أضف قيمًا جديدة/);
});

test("quantities become corrections, received batches and new stock rows with free batch numbers", () => {
  const draft = {
    groups: [{ key: "c", name: "اللون", values: ["أحمر", "أسود", "أخضر"] }, { key: "s", name: "المقاس", values: ["S"] }],
    stock: { ["أخضر\u0001S"]: { ...emptyComboStock(), quantity: "4" } },
  };
  const plan = stockPlan(draft, { ...EMPTY_STOCK_EDITS, batches: { b1: "8", b2: "3" }, variants: { d: "2" } }, product, [color, size]);
  assert.deepEqual(plan.adjust, [{ batchId: "b1", delta: 3 }]);
  assert.deepEqual(plan.receive, [{ variantId: "d", batchCode: "B3", expiresOn: null, quantity: 2 }]);
  assert.deepEqual(plan.variants, [
    { key: "أخضر\u0001S", label: "أخضر / S", values: { اللون: "أخضر", المقاس: "S" }, extraAttributes: {}, batches: [{ batchCode: "B4", expiresOn: null, quantity: 4 }] },
  ]);
});

test("a negative quantity is refused", () => {
  assert.throws(() => stockPlan({ groups: [], stock: {} }, { ...EMPTY_STOCK_EDITS, batches: { b1: "-1" } }, product, [color]), /رقمًا موجبًا/);
});
