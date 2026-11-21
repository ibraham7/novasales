/** Money on the sales board: sort choices, per-currency totals and how amounts are written. Pure, so it is tested without a browser. */
export const BOARD_SORTS = ["newest", "oldest", "value_desc", "value_asc", "manual"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];
export const BOARD_SORT_LABELS: Record<BoardSort, string> = {
  newest: "الأحدث أولاً",
  oldest: "الأقدم أولاً",
  value_desc: "الأعلى قيمة أولاً",
  value_asc: "الأقل قيمة أولاً",
  manual: "ترتيبي اليدوي",
};
export const isBoardSort = (value: unknown): value is BoardSort => (BOARD_SORTS as readonly unknown[]).includes(value);

export type Totals = Record<string, number>;

/** Adds up tickets' values by currency. Tickets without a positive value count for nothing. */
export function sumByCurrency(items: { value?: number | string | null; currency?: string | null }[], fallbackCurrency = "USD"): Totals {
  const totals: Totals = {};
  for (const item of items) {
    const amount = Number(item.value ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const currency = item.currency || fallbackCurrency;
    totals[currency] = (totals[currency] ?? 0) + amount;
  }
  return totals;
}

/** «12,400 USD»: whole numbers when whole, two decimals otherwise. */
export function formatMoney(amount: number, currency: string): string {
  const text = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  return `${text} ${currency}`;
}

/** «12,400 USD · 5,000 TRY», biggest first; empty text when there is nothing to show. */
export function formatTotals(totals: Totals | undefined | null): string {
  return Object.entries(totals ?? {})
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" · ");
}

/** What a person typed into a value box → a number ≥ 0, or null when it is not a usable amount. Arabic digits and «,» are fine; empty is 0. */
export function parseAmount(text: string): number | null {
  const cleaned = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[,٬\s]/g, "")
    .replace(/٫/g, ".");
  if (!cleaned) return 0;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n <= 1e12 ? n : null;
}

/**
 * The column's new order (top to bottom) when `draggedId` is dropped on `targetId`, above or below it.
 * `columnIds` is the column as shown now (the dragged card may already be in it, or come from another column).
 * Returns null when nothing changes (dropped on itself, or the target is not in the column).
 */
export function placeInColumn(columnIds: string[], draggedId: string, targetId: string, after: boolean): string[] | null {
  if (draggedId === targetId) return null;
  const without = columnIds.filter((id) => id !== draggedId);
  const at = without.indexOf(targetId);
  if (at < 0) return null;
  without.splice(after ? at + 1 : at, 0, draggedId);
  const same = without.length === columnIds.length && without.every((id, i) => id === columnIds[i]);
  return same ? null : without;
}

/**
 * A column's tickets with the ones that have a new (unread) message first, the latest message on top; the
 * others follow in the order they came in. Keeps the input untouched.
 */
export function floatUnreadFirst<T extends { unread_count?: number | null; last_message_at?: string | null }>(items: T[]): T[] {
  const unread = items.filter((o) => Number(o.unread_count ?? 0) > 0);
  if (!unread.length) return items;
  unread.sort((a, b) => String(b.last_message_at ?? "").localeCompare(String(a.last_message_at ?? "")));
  const first = new Set<T>(unread);
  return [...unread, ...items.filter((o) => !first.has(o))];
}
