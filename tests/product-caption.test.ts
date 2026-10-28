import { describe, expect, test } from "bun:test";
import { formatProductCaption, type CaptionDefinition } from "../src/modules/commerce/product-caption";

const defs: CaptionDefinition[] = [
  { id: "fabric", name: "القماش", kind: "text", scope: "product" },
  { id: "cost", name: "سعر التكلفة", kind: "money", scope: "product", is_price_floor: true },
  { id: "size", name: "مقاسات", kind: "select", scope: "variant" },
  { id: "hidden", name: "مخفية", kind: "text", scope: "product", is_archived: true },
];

const trench = {
  name: "ترانشكوت شتوي",
  description: "السعر شامل التوصيل",
  sku: "SL01",
  price: 2100,
  currency: "TRY",
  attributes: { fabric: "ترانش مطري مبطن كامل", cost: 900, hidden: "لا تظهر" },
  sales_product_variants: [
    { id: "v38", attributes: { size: "38" } },
    { id: "v40", attributes: { size: "40" } },
    { id: "v44", attributes: { size: "44" } },
  ],
  sales_stock_batches: [
    { variant_id: "v38", quantity: 1, expires_on: null },
    { variant_id: "v40", quantity: 2, expires_on: null },
    { variant_id: "v44", quantity: 0, expires_on: null },
  ],
};

describe("product caption sent to the customer", () => {
  const caption = formatProductCaption(trench, defs, "2026-10-28");

  test("shows the specifications and the sizes still in stock", () => {
    expect(caption).toContain("▫️ القماش: ترانش مطري مبطن كامل");
    expect(caption).toContain("▫️ مقاسات: 38، 40");
  });

  test("leaves out the SKU, costs, hidden properties and sold-out sizes", () => {
    expect(caption).not.toContain("SL01");
    expect(caption).not.toContain("SKU");
    expect(caption).not.toContain("سعر التكلفة");
    expect(caption).not.toContain("900");
    expect(caption).not.toContain("لا تظهر");
    expect(caption).not.toContain("44");
  });

  test("keeps name, description and price in order", () => {
    const lines = caption.split("\n");
    expect(lines[0]).toBe("📦 ترانشكوت شتوي");
    expect(lines[1]).toBe("السعر شامل التوصيل");
    expect(lines.at(-2)).toBe("💰 السعر: 2100 TRY");
  });

  test("an expired batch does not count as in stock", () => {
    const expired = formatProductCaption(
      { ...trench, sales_stock_batches: [{ variant_id: "v38", quantity: 3, expires_on: "2026-10-01" }] },
      defs,
      "2026-10-28",
    );
    expect(expired).not.toContain("مقاسات");
  });
});
