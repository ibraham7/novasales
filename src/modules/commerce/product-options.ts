import type { AttributeDefinition, AttributeValue } from "./product-attributes";
import type { InitialBatchDraft, InitialVariantDraft } from "./initial-stock";

/**
 * Shopify-style options for a new product: the user lists option names and values
 * (اللون: أحمر، أسود — المقاس: S، M) and every combination becomes a stock variant.
 * Options are stored as variant-scope "select" properties, reusing an existing one by name.
 */
export type OptionGroup = { key: string; name: string; values: string[] };
export type ComboStock = {
  included: boolean;
  quantity: string;
  batchCode: string;
  expiresOn: string;
  extraBatches: InitialBatchDraft[];
  extraAttributes: Record<string, AttributeValue>;
};
export type OptionsDraft = { groups: OptionGroup[]; stock: Record<string, ComboStock> };
export type AttributeSave = {
  groupKey: string;
  id?: string;
  name: string;
  kind: AttributeDefinition["kind"];
  scope: AttributeDefinition["scope"];
  isPriceFloor: boolean;
  options: string[];
};

export const MAX_OPTION_GROUPS = 3;
export const EMPTY_OPTIONS: OptionsDraft = { groups: [], stock: {} };
export const emptyComboStock = (): ComboStock => ({
  included: true,
  quantity: "",
  batchCode: "",
  expiresOn: "",
  extraBatches: [],
  extraAttributes: {},
});

const normalize = (value: string) => value.trim().replace(/\s+/g, " ");

/** Groups that have a name and at least one value, with values trimmed and de-duplicated. */
export function activeGroups(groups: OptionGroup[]) {
  return groups
    .map((g) => ({ ...g, name: normalize(g.name), values: [...new Set(g.values.map(normalize).filter(Boolean))] }))
    .filter((g) => g.name && g.values.length);
}

/** Every combination of option values, e.g. [[أحمر,S],[أحمر,M],[أسود,S],[أسود,M]]. No options → one empty combination. */
export function combinations(groups: OptionGroup[]): string[][] {
  return activeGroups(groups).reduce<string[][]>(
    (combos, group) => combos.flatMap((combo) => group.values.map((value) => [...combo, value])),
    [[]],
  );
}

export const comboKey = (values: string[]) => (values.length ? values.join("\u0001") : "__single__");
export const comboLabel = (values: string[]) => (values.length ? values.join(" / ") : "أساسي");

/** Variant-scope single-choice properties that can serve as an option (اللون، المقاس…). */
export function optionDefinitions(definitions: AttributeDefinition[]) {
  return definitions.filter((d) => d.scope === "variant" && (d.kind === "select" || d.kind === "multiselect"));
}

/** Checks the options and lists the properties to create or extend before saving the product. */
export function attributeSaves(draft: OptionsDraft, definitions: AttributeDefinition[]): AttributeSave[] {
  const named = draft.groups.filter((g) => normalize(g.name) || g.values.some((v) => normalize(v)));
  for (const g of named) {
    if (!normalize(g.name)) throw new Error("اكتب اسم الخيار (مثل اللون أو المقاس) أو احذفه");
    if (!g.values.some((v) => normalize(v))) throw new Error(`أضف قيمة واحدة على الأقل للخيار «${normalize(g.name)}» أو احذفه`);
  }
  const groups = activeGroups(draft.groups);
  const names = groups.map((g) => g.name);
  if (new Set(names).size !== names.length) throw new Error("اسم الخيار مكرر؛ استخدم كل اسم مرة واحدة");
  return groups.map((group) => {
    const existing = definitions.find((d) => normalize(d.name) === group.name);
    if (!existing)
      return { groupKey: group.key, name: group.name, kind: "select", scope: "variant", isPriceFloor: false, options: group.values };
    if (existing.scope !== "variant" || !["select", "multiselect"].includes(existing.kind))
      throw new Error(`الاسم «${group.name}» مستخدم لمواصفة أخرى؛ اختر اسمًا مختلفًا للخيار`);
    return {
      groupKey: group.key,
      id: existing.id,
      name: existing.name,
      kind: existing.kind,
      scope: existing.scope,
      isPriceFloor: existing.is_price_floor,
      options: [...new Set([...existing.options, ...group.values])],
    };
  });
}

/**
 * Builds the variants for the existing initial-stock payload. Quantities without a batch number get
 * B1, B2… (batch numbers only need to be unique within the product); extra batches are kept as typed.
 */
export function toInitialVariants(
  draft: OptionsDraft,
  attributeIds: Map<string, string>,
  definitions: AttributeDefinition[],
): InitialVariantDraft[] {
  const groups = activeGroups(draft.groups);
  const combos = combinations(draft.groups);
  const typedCodes = new Set(
    Object.values(draft.stock).flatMap((s) => [s.batchCode, ...s.extraBatches.map((b) => b.batchCode)].map((c) => c.trim()).filter(Boolean)),
  );
  let next = 1;
  const autoCode = () => {
    while (typedCodes.has(`B${next}`)) next++;
    return `B${next++}`;
  };
  const variants: InitialVariantDraft[] = [];
  for (const values of combos) {
    const key = comboKey(values);
    const stock = draft.stock[key] ?? emptyComboStock();
    if (!stock.included) continue;
    const hasStock = !!stock.quantity.trim() || stock.extraBatches.length > 0;
    // A product without options and without stock is a service or stockless product, as before.
    if (!groups.length && !hasStock && !Object.keys(stock.extraAttributes).length) continue;
    const attributes: Record<string, AttributeValue> = { ...stock.extraAttributes };
    groups.forEach((group, index) => {
      const id = attributeIds.get(group.key);
      if (!id) throw new Error(`تعذر حفظ الخيار «${group.name}»`);
      const kind = definitions.find((d) => d.id === id)?.kind;
      attributes[id] = kind === "multiselect" ? [values[index]] : values[index];
    });
    const batches: InitialBatchDraft[] = [];
    if (stock.quantity.trim())
      batches.push({ key: `${key}-main`, batchCode: stock.batchCode.trim() || autoCode(), expiresOn: stock.expiresOn, quantity: stock.quantity });
    batches.push(...stock.extraBatches.map((b) => ({ ...b, batchCode: b.batchCode.trim() || autoCode() })));
    variants.push({ key, label: comboLabel(values), attributes, batches });
  }
  return variants;
}
