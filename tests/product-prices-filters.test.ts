import test from "node:test";
import assert from "node:assert/strict";
import {
  minimumPrice,
  validateSalePrice,
  validateAttributes,
  type AttributeDefinition,
} from "../src/modules/commerce/product-attributes.ts";
import { filterProducts, EMPTY_PRODUCT_FILTERS } from "../src/modules/commerce/product-filters.ts";
const defs: AttributeDefinition[] = [
  {
    id: "color",
    name: "اللون",
    kind: "select",
    scope: "variant",
    options: ["خمري", "أزرق"],
    is_price_floor: false,
  },
  {
    id: "size",
    name: "المقاس",
    kind: "number",
    scope: "variant",
    options: [],
    is_price_floor: false,
  },
  {
    id: "cost",
    name: "سعر التصنيع",
    kind: "money",
    scope: "product",
    options: [],
    is_price_floor: true,
  },
  {
    id: "date",
    name: "تاريخ التوريد",
    kind: "date",
    scope: "product",
    options: [],
    is_price_floor: false,
  },
];
const today = "2026-09-30";
function product(id: string, price: number, cost: number, combinations: any[], currency = "USD") {
  return {
    id,
    name: id,
    price,
    currency,
    attributes: { cost, date: "2026-09-20" },
    sales_product_variants: combinations.map((v, i) => ({
      id: `${id}-${i}`,
      attributes: { color: v[0], size: v[1] },
    })),
    sales_stock_batches: combinations.map((v, i) => ({
      variant_id: `${id}-${i}`,
      quantity: v[2],
      expires_on: v[3] ?? null,
    })),
  };
}
const rows = [
  product("غير مطابق", 100, 70, [
    ["خمري", 4, 5],
    ["أزرق", 7, 9],
  ]),
  product("مطابق", 80, 60, [["خمري", 7, 2]]),
  product("نفد", 50, 40, [["خمري", 7, 0]]),
  product("منتهي", 60, 30, [["خمري", 7, 6, "2026-09-01"]]),
];
test("color and size must match a single available variant; expired/zero stock cannot match", () => {
  const filters = {
    ...EMPTY_PRODUCT_FILTERS,
    attributes: { color: { values: ["خمري"] }, size: { min: "7", max: "7" } },
  };
  assert.deepEqual(
    filterProducts(rows, defs, filters, "", today).map((p) => p.id),
    ["مطابق"],
  );
});
test("sale price and named cost field sort independently; missing cost sorts last", () => {
  const missing = { ...rows[0], id: "بدون تكلفة", attributes: {} };
  assert.deepEqual(
    filterProducts(
      [...rows, missing],
      defs,
      { ...EMPTY_PRODUCT_FILTERS, sort: "money:cost:asc" },
      "",
      today,
    ).map((p) => p.id),
    ["منتهي", "نفد", "مطابق", "غير مطابق", "بدون تكلفة"],
  );
  assert.deepEqual(
    filterProducts(rows, defs, { ...EMPTY_PRODUCT_FILTERS, sort: "price-desc" }, "", today).map(
      (p) => p.price,
    ),
    [100, 80, 60, 50],
  );
});
test("numeric, price, date bounds and currency filters combine without currency conversion", () => {
  const other = product("ليرة", 2, 1, [["خمري", 7, 8]], "TRY");
  const filters = {
    ...EMPTY_PRODUCT_FILTERS,
    currency: "USD",
    priceMin: "70",
    priceMax: "90",
    attributes: { cost: { min: "50", max: "65" }, date: { min: "2026-09-10", max: "2026-09-30" } },
  };
  assert.deepEqual(
    filterProducts([...rows, other], defs, filters, "", today).map((p) => p.id),
    ["مطابق"],
  );
  assert.deepEqual(
    filterProducts(
      [rows[0], other],
      defs,
      { ...EMPTY_PRODUCT_FILTERS, sort: "price-asc" },
      "",
      today,
    ).map((p) => p.id),
    ["غير مطابق", "ليرة"],
  );
});
test("named price floor permits discounted prices at/above cost and refuses below cost/base overflow", () => {
  const floor = minimumPrice({ cost: 1000 }, defs);
  assert.equal(floor, 1000);
  validateSalePrice(1000, 10000, floor);
  validateSalePrice(5000, 10000, floor);
  assert.throws(() => validateSalePrice(999, 10000, floor));
  assert.throws(() => validateSalePrice(10001, 10000, floor));
  validateAttributes({ cost: 1000, date: "2026-09-20" }, defs, "product");
  assert.throws(() => validateAttributes({ cost: -1 }, defs, "product"));
  assert.throws(() => validateAttributes({ color: "خمري" }, defs, "product"));
  assert.throws(() => validateAttributes({ date: "2026-02-30" }, defs, "product"));
});
