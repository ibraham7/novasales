import test from "node:test";
import assert from "node:assert/strict";
import {
  attributeSaves,
  combinations,
  comboKey,
  emptyComboStock,
  toInitialVariants,
  type OptionsDraft,
} from "../src/modules/commerce/product-options.ts";
import { initialStockPayload } from "../src/modules/commerce/initial-stock.ts";
import type { AttributeDefinition } from "../src/modules/commerce/product-attributes.ts";

const color: AttributeDefinition = { id: "color", name: "اللون", kind: "select", scope: "variant", options: ["أحمر"], is_price_floor: false };
const material: AttributeDefinition = { id: "material", name: "الخامة", kind: "text", scope: "product", options: [], is_price_floor: false };

const draft = (stock: OptionsDraft["stock"] = {}): OptionsDraft => ({
  groups: [
    { key: "g1", name: " اللون ", values: ["أحمر", "أسود", "أحمر", " "] },
    { key: "g2", name: "المقاس", values: ["S", "M"] },
  ],
  stock,
});

test("every combination of option values becomes a variant", () => {
  assert.deepEqual(combinations(draft().groups), [["أحمر", "S"], ["أحمر", "M"], ["أسود", "S"], ["أسود", "M"]]);
  assert.deepEqual(combinations([]), [[]]);
});

test("existing options are reused and extended, new ones are created as variant choices", () => {
  const saves = attributeSaves(draft(), [color, material]);
  assert.deepEqual(saves[0], { groupKey: "g1", id: "color", name: "اللون", kind: "select", scope: "variant", isPriceFloor: false, options: ["أحمر", "أسود"] });
  assert.deepEqual(saves[1], { groupKey: "g2", name: "المقاس", kind: "select", scope: "variant", isPriceFloor: false, options: ["S", "M"] });
});

test("incomplete, duplicate or clashing options are rejected", () => {
  assert.throws(() => attributeSaves({ groups: [{ key: "a", name: "", values: ["x"] }], stock: {} }, []), /اسم الخيار/);
  assert.throws(() => attributeSaves({ groups: [{ key: "a", name: "اللون", values: [] }], stock: {} }, []), /قيمة واحدة/);
  assert.throws(() => attributeSaves({ groups: [{ key: "a", name: "س", values: ["1"] }, { key: "b", name: "س", values: ["2"] }], stock: {} }, []), /مكرر/);
  assert.throws(() => attributeSaves({ groups: [{ key: "a", name: "الخامة", values: ["قطن"] }], stock: {} }, [material]), /مواصفة أخرى/);
  assert.deepEqual(attributeSaves({ groups: [{ key: "a", name: "", values: [] }], stock: {} }, []), []);
});

test("quantities become batches with automatic unique numbers, keeping typed numbers and extra batches", () => {
  const ids = new Map([["g1", "color"], ["g2", "size"]]);
  const defs = [color, { ...color, id: "size", name: "المقاس", options: ["S", "M"] }];
  const variants = toInitialVariants(
    draft({
      [comboKey(["أحمر", "S"])]: { ...emptyComboStock(), quantity: "5" },
      [comboKey(["أحمر", "M"])]: { ...emptyComboStock(), quantity: "3", batchCode: "B1", expiresOn: "2026-12-01" },
      [comboKey(["أسود", "S"])]: { ...emptyComboStock(), included: false },
      [comboKey(["أسود", "M"])]: {
        ...emptyComboStock(),
        extraBatches: [{ key: "x", batchCode: "", expiresOn: "", quantity: "2" }],
      },
    }),
    ids,
    defs,
  );
  assert.deepEqual(variants.map((v) => v.label), ["أحمر / S", "أحمر / M", "أسود / M"]);
  assert.deepEqual(variants[0].attributes, { color: "أحمر", size: "S" });
  assert.deepEqual(variants.map((v) => v.batches.map((b) => b.batchCode)), [["B2"], ["B1"], ["B3"]]);
  assert.equal(variants[1].batches[0].expiresOn, "2026-12-01");
  // The result passes the existing initial-stock validation unchanged.
  assert.equal(initialStockPayload(variants).length, 3);
});

test("a product without options and without quantity stays stockless; with quantity it gets one batch", () => {
  assert.deepEqual(toInitialVariants({ groups: [], stock: {} }, new Map(), []), []);
  const single = toInitialVariants({ groups: [], stock: { [comboKey([])]: { ...emptyComboStock(), quantity: "10" } } }, new Map(), []);
  assert.deepEqual(single.map((v) => [v.label, v.batches[0].batchCode, v.batches[0].quantity]), [["أساسي", "B1", "10"]]);
});

test("multi-choice options store the chosen value as a list", () => {
  const multi = { ...color, kind: "multiselect" as const };
  const variants = toInitialVariants({ groups: [{ key: "g", name: "اللون", values: ["أحمر"] }], stock: {} }, new Map([["g", "color"]]), [multi]);
  assert.deepEqual(variants[0].attributes, { color: ["أحمر"] });
});

import { specSaves, specValue, type SpecDraft } from "../src/modules/commerce/product-options.ts";
const spec = (patch: Partial<SpecDraft>): SpecDraft => ({ key: "s", name: "", kind: "select", values: [], scalar: "", isPriceFloor: false, ...patch });

test("a new list specification is a single or multiple choice depending on how many values it has", () => {
  assert.deepEqual(specSaves([spec({ name: "بلد الصنع", values: ["تركيا"] })], [])[0], { groupKey: "s", name: "بلد الصنع", kind: "select", scope: "product", isPriceFloor: false, options: ["تركيا"] });
  assert.equal(specSaves([spec({ name: "الخامة", values: ["قطن", "بوليستر"] })], [])[0].kind, "multiselect");
  const cost = specSaves([spec({ name: "التكلفة", kind: "money", scalar: "12", isPriceFloor: true })], [])[0];
  assert.deepEqual([cost.kind, cost.isPriceFloor, cost.options], ["money", true, []]);
});

test("existing specifications are reused with their type, and clashes are rejected", () => {
  const saves = specSaves([spec({ name: "الخامة", values: ["كتان"] })], [material, { ...material, id: "m2", name: "الخامة2" }].map((d) => d.id === "material" ? { ...d, kind: "multiselect" as const, options: ["قطن"] } : d));
  assert.deepEqual([saves[0].id, saves[0].options], ["material", ["قطن", "كتان"]]);
  assert.throws(() => specSaves([spec({ name: "اللون", values: ["أحمر"] })], [color]), /خيار له كمية/);
  assert.throws(() => specSaves([spec({ name: "س", values: ["1", "2"] })], [{ ...material, name: "س", kind: "select", options: [] }]), /قيمة واحدة/);
  assert.throws(() => specSaves([spec({ name: "اللون", values: ["x"] })], [], ["اللون"]), /مكرر/);
  assert.throws(() => specSaves([spec({ name: "الوزن", kind: "number" })], []), /أدخل قيمة/);
});

test("specification values take the shape of their property type", () => {
  const def = (kind: AttributeDefinition["kind"]): AttributeDefinition => ({ ...material, kind });
  assert.equal(specValue(spec({ values: ["قطن"] }), def("select")), "قطن");
  assert.deepEqual(specValue(spec({ values: ["قطن", "كتان"] }), def("multiselect")), ["قطن", "كتان"]);
  assert.equal(specValue(spec({ scalar: "2.5" }), def("number")), 2.5);
  assert.equal(specValue(spec({ scalar: "true" }), def("boolean")), true);
  assert.equal(specValue(spec({ scalar: " سنة " }), def("text")), "سنة");
});
