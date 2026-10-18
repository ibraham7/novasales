import type { AttributeDefinition, AttributeValue } from "./product-attributes";
import { activeGroups, combinations, comboKey, comboLabel, emptyComboStock, type OptionsDraft } from "./product-options.ts";

/**
 * Stock of an existing product edited from the product dialog: the quantity of each stock row, its
 * batches, and new option values (لون جديد) that add new stock rows. Changes are applied with the
 * existing stock actions (new property values, new stock rows, received batches, batch corrections).
 */
export type StockBatch = { id: string; variant_id: string; batch_code: string; expires_on: string | null; quantity: number };
export type StockVariant = { id: string; label: string; attributes: Record<string, AttributeValue>; is_default: boolean };
export type StockProduct = { sales_product_variants?: StockVariant[]; sales_stock_batches?: StockBatch[] };
export type NewBatchDraft = { key: string; variantId: string; batchCode: string; expiresOn: string; quantity: string };
export type StockEdits = {
  /** New quantity of an existing batch, by batch id. */
  batches: Record<string, string>;
  /** Quantity for a stock row without batches yet, by variant id. */
  variants: Record<string, string>;
  /** Extra batches added under ⚙. */
  newBatches: NewBatchDraft[];
};
export const EMPTY_STOCK_EDITS: StockEdits = { batches: {}, variants: {}, newBatches: [] };

const first = (value: AttributeValue | undefined) => (Array.isArray(value) ? value[0] : value);
const optionDefinition = (definitions: AttributeDefinition[], id: string) =>
  definitions.find((d) => d.id === id && d.scope === "variant" && (d.kind === "select" || d.kind === "multiselect"));

/** Stock rows with options (not the plain «أساسي» row). */
export function optionVariants(product: StockProduct) {
  return (product.sales_product_variants ?? []).filter((v) => !v.is_default && Object.keys(v.attributes ?? {}).length > 0);
}

/** The product's current options (اللون: أحمر، أسود) taken from its stock rows; the key is the property id. */
export function existingOptionGroups(product: StockProduct, definitions: AttributeDefinition[]) {
  const groups = new Map<string, { key: string; name: string; values: string[] }>();
  for (const variant of optionVariants(product))
    for (const [id, raw] of Object.entries(variant.attributes)) {
      const definition = optionDefinition(definitions, id);
      const value = first(raw);
      if (!definition || value === undefined || value === "") continue;
      const group = groups.get(id) ?? { key: id, name: definition.name, values: [] };
      if (!group.values.includes(String(value))) group.values.push(String(value));
      groups.set(id, group);
    }
  return [...groups.values()];
}

/** Stock rows to create: combinations of the options that include at least one newly added value. */
export function newCombinations(draft: OptionsDraft, product: StockProduct, definitions: AttributeDefinition[]) {
  const existing = existingOptionGroups(product, definitions);
  const groups = activeGroups(draft.groups);
  if (!groups.length) return [];
  if (existing.length && groups.some((g) => !existing.some((e) => e.name === g.name)))
    throw new Error("هذا المنتج له خيارات؛ أضف قيمًا جديدة للخيارات الموجودة بدل خيار جديد");
  const isNew = (groupIndex: number, value: string) => {
    const old = existing.find((e) => e.name === groups[groupIndex].name);
    return !old || !old.values.includes(value);
  };
  return combinations(draft.groups).filter((values) => values.some((value, index) => isNew(index, value)));
}

const quantityOf = (text: string) => {
  const quantity = Number(text);
  if (!text.trim() || !Number.isFinite(quantity) || quantity < 0 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6)
    throw new Error("الكمية يجب أن تكون رقمًا موجبًا بثلاث خانات عشرية كحد أقصى");
  return quantity;
};

export type StockPlan = {
  /** New stock rows: their option values by option name, and their first batch if a quantity was given. */
  variants: { key: string; label: string; values: Record<string, string>; extraAttributes: Record<string, AttributeValue>; batches: { batchCode: string; expiresOn: string | null; quantity: number }[] }[];
  receive: { variantId: string; batchCode: string; expiresOn: string | null; quantity: number }[];
  adjust: { batchId: string; delta: number }[];
};

/** Turns the edits into stock actions. Batch numbers left empty get B1, B2… not yet used by the product. */
export function stockPlan(draft: OptionsDraft, edits: StockEdits, product: StockProduct, definitions: AttributeDefinition[]): StockPlan {
  const batches = product.sales_stock_batches ?? [];
  const used = new Set([
    ...batches.map((b) => b.batch_code),
    ...edits.newBatches.map((b) => b.batchCode.trim()).filter(Boolean),
    ...Object.values(draft.stock).flatMap((s) => [s.batchCode, ...s.extraBatches.map((b) => b.batchCode)].map((c) => c.trim()).filter(Boolean)),
  ]);
  let next = 1;
  const autoCode = () => {
    while (used.has(`B${next}`)) next++;
    used.add(`B${next}`);
    return `B${next++}`;
  };
  const plan: StockPlan = { variants: [], receive: [], adjust: [] };

  for (const [batchId, text] of Object.entries(edits.batches)) {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) continue;
    const delta = Math.round((quantityOf(text) - Number(batch.quantity)) * 1000) / 1000;
    if (delta) plan.adjust.push({ batchId, delta });
  }
  for (const [variantId, text] of Object.entries(edits.variants)) {
    if (!text.trim()) continue;
    const quantity = quantityOf(text);
    if (quantity > 0) plan.receive.push({ variantId, batchCode: autoCode(), expiresOn: null, quantity });
  }
  for (const b of edits.newBatches) {
    if (!b.quantity.trim()) continue;
    const quantity = quantityOf(b.quantity);
    if (quantity > 0) plan.receive.push({ variantId: b.variantId, batchCode: b.batchCode.trim() || autoCode(), expiresOn: b.expiresOn || null, quantity });
  }

  const groups = activeGroups(draft.groups);
  for (const values of newCombinations(draft, product, definitions)) {
    const key = comboKey(values);
    const stock = draft.stock[key] ?? emptyComboStock();
    if (!stock.included) continue;
    const rowBatches = [
      { batchCode: stock.batchCode, expiresOn: stock.expiresOn, quantity: stock.quantity },
      ...stock.extraBatches,
    ]
      .filter((b) => b.quantity.trim() && quantityOf(b.quantity) > 0)
      .map((b) => ({ batchCode: b.batchCode.trim() || autoCode(), expiresOn: b.expiresOn || null, quantity: quantityOf(b.quantity) }));
    plan.variants.push({
      key,
      label: comboLabel(values),
      values: Object.fromEntries(groups.map((g, i) => [g.name, values[i]])),
      extraAttributes: stock.extraAttributes,
      batches: rowBatches,
    });
  }
  return plan;
}

/** Whether the plan changes anything. */
export const hasStockChanges = (plan: StockPlan) => plan.variants.length + plan.receive.length + plan.adjust.length > 0;
