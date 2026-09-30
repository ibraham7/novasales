/** Each purchasable row represents one lot. IDs never combine different lots. */
export function stockCatalog(products: any[]) {
  const today = new Date().toISOString().slice(0, 10);
  return products.flatMap((p) => {
    const batches = [...(p.sales_stock_batches ?? [])]
      .filter((b) => Number(b.quantity) > 0 && (!b.expires_on || b.expires_on >= today))
      .sort(
        (a, b) =>
          (a.expires_on ?? "9999").localeCompare(b.expires_on ?? "9999") ||
          a.created_at.localeCompare(b.created_at) ||
          a.id.localeCompare(b.id),
      );
    return batches.map((b, index) => {
      const variant = (p.sales_product_variants ?? []).find((v: any) => v.id === b.variant_id);
      return {
        ...p,
        id: b.id,
        sourceProductId: p.id,
        batchId: b.id,
        name: `${p.name} — ${variant?.label ?? "أساسي"} — دفعة ${b.batch_code}${b.expires_on ? ` — صلاحية ${b.expires_on}` : ""}${index === 0 && b.expires_on ? " (الأقرب انتهاءً)" : ""}`,
        sales_inventory: { quantity: Number(b.quantity) },
      };
    });
  });
}
