import { test } from "node:test";
import assert from "node:assert/strict";
import { stockCatalog } from "../src/modules/commerce/stock-catalog.ts";
test("lots remain separate, sorted by expiry; expired and empty lots are excluded", () => {
  const rows = stockCatalog([
    {
      id: "product",
      name: "Product",
      sales_product_variants: [{ id: "v", label: "16GB" }],
      sales_stock_batches: [
        {
          id: "late",
          variant_id: "v",
          quantity: 20,
          batch_code: "B",
          expires_on: "2999-02-01",
          created_at: "2026-01-01",
        },
        {
          id: "early",
          variant_id: "v",
          quantity: 20,
          batch_code: "A",
          expires_on: "2999-01-01",
          created_at: "2026-01-01",
        },
        {
          id: "expired",
          variant_id: "v",
          quantity: 2,
          batch_code: "C",
          expires_on: "2000-01-01",
          created_at: "2026-01-01",
        },
        {
          id: "empty",
          variant_id: "v",
          quantity: 0,
          batch_code: "D",
          expires_on: null,
          created_at: "2026-01-01",
        },
      ],
    },
  ]);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["early", "late"],
  );
  assert.deepEqual(
    rows.map((r) => r.sales_inventory.quantity),
    [20, 20],
  );
  assert.ok(rows.every((r) => r.sourceProductId === "product" && r.batchId === r.id));
  assert.match(rows[0].name, /16GB.*A.*الأقرب/);
});
