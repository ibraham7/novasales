/**
 * Overlapping meetings on one day are drawn side by side in columns (like Clinova): meetings that overlap, directly or
 * through a chain, form a group; inside a group each meeting takes the first free column, and the group's width is split
 * evenly. Pure: times in, column positions out.
 */
export type LayoutItem = { id: string; startMs: number; endMs: number };
export type Placed = { col: number; cols: number };

export function layoutDay(items: LayoutItem[]): Map<string, Placed> {
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs || a.id.localeCompare(b.id));
  const out = new Map<string, Placed>();
  let group: { id: string; col: number }[] = [];
  let colEnds: number[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    for (const g of group) out.set(g.id, { col: g.col, cols: Math.max(1, colEnds.length) });
    group = []; colEnds = []; groupEnd = -Infinity;
  };
  for (const item of sorted) {
    if (item.startMs >= groupEnd) flush();
    let col = colEnds.findIndex((end) => end <= item.startMs);
    if (col === -1) { col = colEnds.length; colEnds.push(item.endMs); } else colEnds[col] = item.endMs;
    group.push({ id: item.id, col });
    groupEnd = Math.max(groupEnd, item.endMs);
  }
  flush();
  return out;
}

/** Vertical position of a block in a day column (px): top from the first visible minute, with a minimum readable height. */
export function blockGeometry(startMin: number, endMin: number, firstMin: number, pxPerHour: number, minHeight = 22) {
  const top = ((Math.max(startMin, firstMin) - firstMin) / 60) * pxPerHour;
  const height = Math.max(minHeight, ((endMin - Math.max(startMin, firstMin)) / 60) * pxPerHour);
  return { top, height };
}
