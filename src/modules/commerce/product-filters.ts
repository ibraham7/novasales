import type { AttributeDefinition } from "./product-attributes";
export type AttributeFilter = { values?: string[]; text?: string; min?: string; max?: string };
export type ProductFilters = {
  currency: string;
  sort: string;
  availableOnly: boolean;
  priceMin: string;
  priceMax: string;
  attributes: Record<string, AttributeFilter>;
};
export const EMPTY_PRODUCT_FILTERS: ProductFilters = {
  currency: "",
  sort: "default",
  availableOnly: false,
  priceMin: "",
  priceMax: "",
  attributes: {},
};
const lower = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase();
function matches(value: unknown, filter: AttributeFilter, kind: string) {
  if (value === undefined || value === null) return false;
  const values = Array.isArray(value) ? value : [value];
  if (filter.values?.length && !values.some((v) => filter.values!.includes(String(v))))
    return false;
  if (filter.text?.trim() && !values.some((v) => lower(v).includes(lower(filter.text))))
    return false;
  for (const bound of ["min", "max"] as const)
    if (filter[bound]?.trim()) {
      const actual = kind === "date" ? String(value) : Number(value);
      const limit = kind === "date" ? filter[bound]! : Number(filter[bound]);
      if (
        (typeof actual === "number" && !Number.isFinite(actual)) ||
        (bound === "min" ? actual < limit : actual > limit)
      )
        return false;
    }
  return true;
}
export function filterProducts(
  products: any[],
  definitions: AttributeDefinition[],
  filters: ProductFilters,
  search = "",
  today = new Date().toISOString().slice(0, 10),
) {
  const active = Object.entries(filters.attributes).filter(
    ([, f]) => f.values?.length || f.text?.trim() || f.min?.trim() || f.max?.trim(),
  );
  const productFilters = active.filter(
    ([id]) => definitions.find((d) => d.id === id)?.scope === "product",
  );
  const variantFilters = active.filter(
    ([id]) => definitions.find((d) => d.id === id)?.scope === "variant",
  );
  const hasStock = (p: any, v?: any) =>
    (p.sales_stock_batches ?? []).some(
      (b: any) =>
        Number(b.quantity) > 0 &&
        (!b.expires_on || b.expires_on >= today) &&
        (!v || b.variant_id === v.id),
    );
  const result = products.filter((p) => {
    if (
      search.trim() &&
      !lower(
        [
          p.name,
          p.sku,
          p.description,
          ...Object.values(p.attributes ?? {}),
          ...(p.sales_product_variants ?? []).flatMap((v: any) => [
            v.label,
            ...Object.values(v.attributes ?? {}),
          ]),
        ].join(" "),
      ).includes(lower(search))
    )
      return false;
    if (filters.currency && p.currency !== filters.currency) return false;
    if (filters.availableOnly && !hasStock(p)) return false;
    if (filters.priceMin !== "" && Number(p.price) < Number(filters.priceMin)) return false;
    if (filters.priceMax !== "" && Number(p.price) > Number(filters.priceMax)) return false;
    if (
      !productFilters.every(([id, f]) =>
        matches(p.attributes?.[id], f, definitions.find((d) => d.id === id)!.kind),
      )
    )
      return false;
    // All variant predicates must match the same currently available combination.
    if (
      variantFilters.length &&
      !(p.sales_product_variants ?? []).some(
        (v: any) =>
          hasStock(p, v) &&
          variantFilters.every(([id, f]) =>
            matches(v.attributes?.[id], f, definitions.find((d) => d.id === id)!.kind),
          ),
      )
    )
      return false;
    return true;
  });
  if (filters.sort === "default") return result;
  // Never compare amounts in different currencies without an exchange-rate model.
  if (new Set(result.map((p) => p.currency)).size > 1) return result;
  const [field, id, direction] =
    filters.sort === "price-asc"
      ? ["price", "", "asc"]
      : filters.sort === "price-desc"
        ? ["price", "", "desc"]
        : filters.sort.split(":");
  if (
    field !== "price" &&
    !definitions.some((d) => d.id === id && d.scope === "product" && d.kind === "money")
  )
    return result;
  const amount = (p: any) =>
    field === "price"
      ? Number(p.price)
      : typeof p.attributes?.[id] === "number"
        ? p.attributes[id]
        : null;
  return [...result].sort((a, b) => {
    const av = amount(a),
      bv = amount(b);
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    return direction === "desc" ? bv - av : av - bv;
  });
}
