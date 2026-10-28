export type CaptionDefinition = {
  id: string;
  name: string;
  kind: string;
  scope: string;
  is_archived?: boolean;
  is_price_floor?: boolean;
};

// Prices and costs (money properties, the minimum sale price) are internal and never go to the customer.
const isCustomerFacing = (d: CaptionDefinition) => !d.is_archived && !d.is_price_floor && d.kind !== "money";

function captionValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join("، ");
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  return value == null ? "" : String(value).trim();
}

/**
 * The product message the customer reads: name, description, its specifications (fabric…), the
 * options still in stock (sizes, colours), price. The SKU is an internal code and is left out.
 */
export function formatProductCaption(product: any, definitions: CaptionDefinition[], today = new Date().toISOString().slice(0, 10)) {
  const defs = new Map(definitions.filter(isCustomerFacing).map((d) => [d.id, d]));
  const specs = Object.entries(product.attributes ?? {})
    .map(([id, value]) => {
      const def = defs.get(id);
      const text = captionValue(value);
      return def && text ? `▫️ ${def.name}: ${text}` : null;
    })
    .filter(Boolean);

  // Option values of the variants that still have a sellable batch, in the order they were defined.
  const inStock = new Set(
    (product.sales_stock_batches ?? [])
      .filter((b: any) => Number(b.quantity) > 0 && (!b.expires_on || b.expires_on >= today))
      .map((b: any) => b.variant_id),
  );
  const optionValues = new Map<string, string[]>();
  for (const variant of product.sales_product_variants ?? []) {
    if (!inStock.has(variant.id)) continue;
    for (const [id, value] of Object.entries(variant.attributes ?? {})) {
      if (!defs.has(id)) continue;
      const list = optionValues.get(id) ?? [];
      for (const v of Array.isArray(value) ? value : [value]) {
        const text = captionValue(v);
        if (text && !list.includes(text)) list.push(text);
      }
      optionValues.set(id, list);
    }
  }
  const options = [...optionValues]
    .filter(([, values]) => values.length)
    .map(([id, values]) => `▫️ ${defs.get(id)!.name}: ${values.join("، ")}`);

  return [
    `📦 ${product.name}`,
    product.description?.trim() || null,
    ...specs,
    ...options,
    `💰 السعر: ${Number(product.price)} ${product.currency}`,
    "✅ متوفر الآن",
  ]
    .filter(Boolean)
    .join("\n");
}
