/** A column's share of all tickets as text: «25%», «<1%» when there are some but under one percent, «0%» for none. */
export function sharePercent(count: number, total: number): string {
  if (!total || !count) return "0%";
  const pct = Math.min(100, (count / total) * 100);
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}
