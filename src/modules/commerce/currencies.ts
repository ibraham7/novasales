const COMMON = [
  "USD",
  "TRY",
  "SYP",
  "EUR",
  "SAR",
  "AED",
  "GBP",
  "QAR",
  "KWD",
  "JOD",
  "EGP",
  "IQD",
  "LBP",
  "MAD",
  "TND",
  "DZD",
  "YER",
  "OMR",
  "BHD",
];
const supported =
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : COMMON;
export const CURRENCY_CODES = [...new Set([...COMMON, ...supported])];
export function currencyName(code: string) {
  try {
    return `${new Intl.DisplayNames(["ar"], { type: "currency" }).of(code)} (${code})`;
  } catch {
    return code;
  }
}
export function inventoryValues(
  products: {
    currency: string;
    price: number;
    sales_stock_batches?: { quantity: number; expires_on: string | null }[];
  }[],
  today = new Date().toISOString().slice(0, 10),
) {
  const totals: Record<string, number> = {};
  for (const p of products) {
    const stock = (p.sales_stock_batches ?? [])
      .filter((b) => !b.expires_on || b.expires_on >= today)
      .reduce((sum, b) => sum + Number(b.quantity), 0);
    totals[p.currency] = (totals[p.currency] ?? 0) + stock * Number(p.price);
  }
  return totals;
}

export function currencyTotals(rows: any[], key: string): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows)
    for (const [currency, value] of Object.entries(row[key] ?? {}))
      totals[currency] = (totals[currency] ?? 0) + Number(value);
  return totals;
}
