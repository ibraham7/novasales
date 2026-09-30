export function variantStock(product: any, today = new Date().toISOString().slice(0, 10)) {
  return (product.sales_product_variants ?? []).map((variant: any) => ({
    ...variant,
    quantity: (product.sales_stock_batches ?? [])
      .filter(
        (batch: any) =>
          batch.variant_id === variant.id && (!batch.expires_on || batch.expires_on >= today),
      )
      .reduce((sum: number, batch: any) => sum + Number(batch.quantity), 0),
  }));
}
export function attributeStock(
  product: any,
  definitions: { id: string; name: string }[],
  today = new Date().toISOString().slice(0, 10),
) {
  const variants = variantStock(product, today);
  return definitions.flatMap((def) => {
    const totals = new Map<string, number>();
    for (const variant of variants) {
      const raw = variant.attributes?.[def.id];
      if (raw === undefined || raw === null) continue;
      // Multiple tags describe the same variant; each tag shows matching stock, not additive units.
      for (const value of Array.isArray(raw) ? raw : [raw])
        totals.set(String(value), (totals.get(String(value)) ?? 0) + variant.quantity);
    }
    return totals.size
      ? [{ ...def, values: [...totals].map(([value, quantity]) => ({ value, quantity })) }]
      : [];
  });
}
