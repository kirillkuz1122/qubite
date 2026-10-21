/** Где каретка относительно `box` — для меню. */
export function caretPoint(box: HTMLElement | null): { x: number; y: number } {
  const sel = window.getSelection();
  if (!box || !sel || sel.rangeCount === 0) return { x: 0, y: 0 };
  let r = sel.getRangeAt(0).getBoundingClientRect();
  if (r.height === 0) {
    const n = sel.anchorNode;
    const el = n instanceof Element ? n : n?.parentElement;
    if (el) r = el.getBoundingClientRect();
  }
  const b = box.getBoundingClientRect();
  return { x: Math.max(0, Math.min(r.left - b.left, b.width - 220)), y: r.bottom - b.top + 6 };
}
