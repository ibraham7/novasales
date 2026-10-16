import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatModels,
  dayRange,
  phoneAllowed,
  previousRange,
  productPerformance,
  redact,
  salesTotals,
  unitCost,
} from "../src/modules/serena/serena-model.ts";
import { runGemini } from "../src/modules/serena/gemini.server.ts";

const COST = "11111111-1111-4111-8111-111111111111";

test("date ranges are inclusive, default to 30 days and compare with the previous period", () => {
  const range = dayRange("2026-10-01", "2026-10-15");
  assert.equal(range.days, 15);
  assert.equal(range.fromIso, "2026-10-01T00:00:00.000Z");
  assert.equal(range.toIso, "2026-10-16T00:00:00.000Z");
  assert.deepEqual(
    { from: previousRange(range).from, to: previousRange(range).to },
    { from: "2026-09-16", to: "2026-09-30" },
  );
  assert.equal(dayRange(undefined, undefined, new Date("2026-10-16T10:00:00Z")).from, "2026-09-17");
  assert.equal(dayRange("bad", "2026-10-16").days, 30);
  assert.equal(dayRange("2020-01-01", "2026-10-16").days, 400, "at most 400 days");
});

const products = [
  { id: "long", name: "كلسات طويلة", price: 10, currency: "TRY", is_active: true, attributes: { [COST]: 6 } },
  { id: "short", name: "كلسات قصيرة", price: 8, currency: "TRY", is_active: true, attributes: {} },
  { id: "orange", name: "جرابات ملونة", price: 12, currency: "TRY", is_active: true, attributes: { [COST]: 5 } },
];
const orders = [
  { id: "o1", currency: "TRY", total: 95, discount_total: 5, contact_id: "c1", confirmed_at: "2026-10-02T09:00:00Z" },
  { id: "o2", currency: "TRY", total: 24, contact_id: "c2", confirmed_at: "2026-10-05T09:00:00Z" },
];
const items = [
  { order_id: "o1", product_id: "long", product_name: "كلسات طويلة", variant_label: "أسود", quantity: 8, list_unit_price: 10, sold_unit_price: 9, line_total: 72 },
  { order_id: "o1", product_id: "short", product_name: "كلسات قصيرة", quantity: 3, list_unit_price: 8, sold_unit_price: 8, line_total: 23 },
  { order_id: "o2", product_id: "long", product_name: "كلسات طويلة", variant_label: "أبيض", quantity: 2, list_unit_price: 10, sold_unit_price: 10, line_total: 20, attributes_snapshot: { [COST]: 7 } },
];

test("unit cost prefers the variant value, then the product value, and is unknown otherwise", () => {
  assert.equal(unitCost(COST, { attributes_snapshot: { [COST]: 7 } }, products[0]), 7);
  assert.equal(unitCost(COST, {}, products[0]), 6);
  assert.equal(unitCost(COST, {}, products[1]), null);
  assert.equal(unitCost(null, {}, products[0]), null);
});

test("sales totals report profit only for lines with a known cost, with the coverage", () => {
  const [totals] = salesTotals(orders, items, new Map(products.map((p) => [p.id, p])), COST);
  assert.equal(totals.revenue, 119);
  assert.equal(totals.orders, 2);
  assert.equal(totals.units, 13);
  assert.equal(totals.customers, 2);
  // Known cost: 8 × 6 + 2 × 7 = 62 on 92 of revenue.
  assert.equal(totals.profit, 30);
  assert.equal(totals.marginPercent, 32.6);
  assert.equal(totals.costCoveragePercent, 77.3);
  assert.equal(salesTotals(orders, items, new Map(), null)[0].profit, null, "no cost property, no profit");
});

test("product performance ranks sales, computes stock cover and lists unsold stock", () => {
  const stock = new Map([["long", 50], ["short", 0], ["orange", 30]]);
  const result = productPerformance({ orders, items, products, stock, days: 10, costAttributeId: COST });
  const long = result.sold[0];
  assert.equal(long.name, "كلسات طويلة");
  assert.equal(long.unitsSold, 10);
  assert.equal(long.revenue, 92);
  assert.equal(long.unitsPerDay, 1);
  assert.equal(long.daysOfStockLeft, 50);
  assert.equal(long.discountPercent, 8);
  assert.deepEqual(long.topVariants, [{ label: "أسود", units: 8 }, { label: "أبيض", units: 2 }]);
  assert.equal(long.profit, 30);
  assert.equal(result.sold[1].profit, null, "short socks have no cost");
  assert.deepEqual(result.unsold.map((p) => [p.name, p.stock, p.unitCost]), [["جرابات ملونة", 30, 5]]);
});

test("customer messages lose phone numbers, emails and links before reaching the AI provider", () => {
  assert.equal(
    redact("رقمي +90 555 123 45 67 وإيميلي a.b@x.com شوف https://x.co/p عندكم جرابات برتقالية؟"),
    "رقمي [رقم] وإيميلي [إيميل] شوف [رابط] عندكم جرابات برتقالية؟",
  );
  assert.equal(redact("بدي 3 قطع مقاس 42"), "بدي 3 قطع مقاس 42", "short numbers like sizes stay");
});

test("only allowed WhatsApp numbers reach Serena, with or without the country code", () => {
  const allowed = ["905551234567"];
  assert.ok(phoneAllowed("905551234567", allowed));
  assert.ok(phoneAllowed("5551234567", allowed));
  assert.ok(phoneAllowed("٩٠٥٥٥١٢٣٤٥٦٧", allowed), "Arabic digits");
  assert.ok(!phoneAllowed("905551234568", allowed));
  assert.ok(!phoneAllowed("4567", allowed));
  assert.ok(!phoneAllowed("905551234567", []));
});

test("chat models list Gemini text models with flash first", () => {
  const models = chatModels([
    { name: "models/gemini-pro-x", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-flash-y", displayName: "Gemini Flash Y", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-z", supportedGenerationMethods: ["embedContent"] },
    { name: "models/gemini-flash-image", supportedGenerationMethods: ["generateContent"] },
  ]);
  assert.deepEqual(models, [
    { id: "gemini-flash-y", label: "Gemini Flash Y" },
    { id: "gemini-pro-x", label: "gemini-pro-x" },
  ]);
});

test("Gemini tool loop runs the requested tools and returns the final text", async () => {
  const requests: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push({ url, key: (init.headers as Record<string, string>)["x-goog-api-key"], body });
    const reply =
      requests.length === 1
        ? { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "product_performance", args: { from: "2026-10-01" } }, thoughtSignature: "sig" }] }, finishReason: "STOP" }] }
        : { candidates: [{ content: { role: "model", parts: [{ text: "جيب كلسات طويلة." }] }, finishReason: "STOP" }] };
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  try {
    const calls: unknown[] = [];
    const result = await runGemini({
      apiKey: "test-key",
      model: "gemini-flash-y",
      system: "You are Serena",
      contents: [{ role: "user", parts: [{ text: "شو نجيب بكرا؟" }] }],
      tools: [{ name: "product_performance", description: "d", parameters: { type: "object", properties: {} } }],
      runTool: async (name, args) => (calls.push([name, args]), { sold: [] }),
    });
    assert.equal(result.text, "جيب كلسات طويلة.");
    assert.deepEqual(calls, [["product_performance", { from: "2026-10-01" }]]);
    assert.match(requests[0].url, /models\/gemini-flash-y:generateContent$/);
    assert.equal(requests[0].key, "test-key");
    assert.equal(requests[0].body.systemInstruction.parts[0].text, "You are Serena");
    assert.equal(requests[0].body.tools[0].functionDeclarations[0].name, "product_performance");
    // The model turn goes back unchanged (thought signature included), then the tool result.
    assert.equal(requests[1].body.contents[1].parts[0].thoughtSignature, "sig");
    assert.deepEqual(requests[1].body.contents[2].parts[0].functionResponse, { name: "product_performance", response: { result: { sold: [] } } });
  } finally {
    globalThis.fetch = original;
  }
});
