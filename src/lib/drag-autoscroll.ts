/**
 * Scrolling while a card is dragged with the mouse. The browser does not scroll a list inside the page
 * for a dragged item, so the board does it: near the top or bottom edge of a column its list scrolls,
 * near the left or right edge of the board the board scrolls. Pure speed maths here, wiring in `startDragAutoscroll`.
 */

/**
 * Pixels to scroll per frame for a pointer at `pos` on an axis whose visible part runs from `start` to
 * `end`: negative near (or past) the start, positive near (or past) the end, 0 in the middle, faster the
 * closer to the edge. `zone` is how far in from each edge scrolling begins.
 */
export function edgeSpeed(pos: number, start: number, end: number, zone = 70, max = 22): number {
  if (end - start <= zone * 2) return 0; // too small a box to tell the edges apart
  const fromStart = pos - start;
  const fromEnd = end - pos;
  if (fromStart < zone) return -Math.round(Math.min(max, Math.max(2, ((zone - fromStart) / zone) * max)));
  if (fromEnd < zone) return Math.round(Math.min(max, Math.max(2, ((zone - fromEnd) / zone) * max)));
  return 0;
}

const CARD_TYPE = "text/opp-id";

/**
 * Starts watching card drags on the page; returns the function that stops it. While a card is dragged,
 * a frame loop scrolls the column list under the pointer (`[data-column-list]`) and the board (`[data-kanban-board]`).
 */
export function startDragAutoscroll(doc: Document = document): () => void {
  let pointer: { x: number; y: number } | null = null;
  let raf = 0;

  const tick = () => {
    if (!pointer) return;
    const { x, y } = pointer;
    // The column whose list is under the pointer horizontally (the pointer may be above or below the list itself).
    const lists = Array.from(doc.querySelectorAll<HTMLElement>("[data-column-list]"));
    const list = lists.find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right;
    });
    if (list) {
      const r = list.getBoundingClientRect();
      const dy = edgeSpeed(y, r.top, r.bottom);
      if (dy) list.scrollTop += dy;
    }
    const board = doc.querySelector<HTMLElement>("[data-kanban-board]");
    if (board) {
      const r = board.getBoundingClientRect();
      const dx = edgeSpeed(x, r.left, r.right, 80, 26);
      if (dx) board.scrollBy({ left: dx });
    }
    raf = requestAnimationFrame(tick);
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes(CARD_TYPE)) return;
    pointer = { x: e.clientX, y: e.clientY };
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    pointer = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  doc.addEventListener("dragover", onDragOver);
  doc.addEventListener("dragend", stop);
  doc.addEventListener("drop", stop);
  return () => {
    stop();
    doc.removeEventListener("dragover", onDragOver);
    doc.removeEventListener("dragend", stop);
    doc.removeEventListener("drop", stop);
  };
}
