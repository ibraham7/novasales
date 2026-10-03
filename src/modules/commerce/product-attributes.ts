export type AttributeDefinition = {
  id: string;
  name: string;
  kind: "text" | "select" | "multiselect" | "number" | "date" | "money" | "boolean" | "url" | "file";
  scope: "product" | "variant";
  options: string[];
  is_price_floor: boolean;
};
export type AttributeValue = string | number | boolean | string[];
export function validateAttributes(
  values: Record<string, AttributeValue>,
  definitions: AttributeDefinition[],
  scope: "product" | "variant",
) {
  for (const [id, value] of Object.entries(values)) {
    const def = definitions.find((d) => d.id === id && d.scope === scope);
    if (!def) throw new Error("الخاصية غير موجودة أو لا تنتمي لهذا النوع");
    let valid = false;
    if (def.kind === "number") valid = typeof value === "number" && Number.isFinite(value);
    if (def.kind === "money")
      valid = typeof value === "number" && Number.isFinite(value) && value >= 0;
    if (def.kind === "boolean") valid = typeof value === "boolean";
    if (def.kind === "url" || def.kind === "file") {
      try { const u = new URL(String(value)); valid = typeof value === "string" && ["http:", "https:"].includes(u.protocol); } catch { valid = false; }
    }
    if (def.kind === "text") valid = typeof value === "string" && !!value.trim();
    if (def.kind === "date")
      valid =
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value;
    if (def.kind === "select") valid = typeof value === "string" && def.options.includes(value);
    if (def.kind === "multiselect")
      valid =
        Array.isArray(value) &&
        value.length > 0 &&
        new Set(value).size === value.length &&
        value.every((v) => def.options.includes(v));
    if (!valid) throw new Error(`قيمة غير صالحة للخاصية: ${def.name}`);
  }
}
export function minimumPrice(
  values: Record<string, AttributeValue> = {},
  definitions: AttributeDefinition[],
) {
  return definitions
    .filter((d) => d.scope === "product" && d.kind === "money" && d.is_price_floor)
    .reduce(
      (floor, d) => Math.max(floor, typeof values[d.id] === "number" ? Number(values[d.id]) : 0),
      0,
    );
}
export function validateSalePrice(sold: number, list: number, floor: number) {
  if (!Number.isFinite(sold) || sold < floor)
    throw new Error(`لا يمكن البيع بأقل من الحد الأدنى ${floor}`);
  if (sold > list) throw new Error(`سعر البيع يجب ألا يتجاوز السعر الأساسي ${list}`);
}
