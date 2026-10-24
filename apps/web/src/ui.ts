// Re-rendering helpers: panels redraw often (a running test updates every
// quarter second), and a redraw must not close what the user opened or jump
// a log they are reading.

/**
 * Runs `render` (which replaces the contents of `root`) and keeps
 * `<details data-key>` open or closed as the user left them, and the scroll
 * position of `[data-scroll]` elements (a log stays pinned to its end).
 */
export function preserving(root: HTMLElement, render: () => void): void {
  const state = new Map<string, boolean>();
  for (const d of root.querySelectorAll<HTMLDetailsElement>("details[data-key]")) state.set(d.dataset.key!, d.open);
  const scrolls = new Map<string, { top: number; atEnd: boolean }>();
  for (const e of root.querySelectorAll<HTMLElement>("[data-scroll]")) {
    scrolls.set(e.dataset.scroll!, { top: e.scrollTop, atEnd: e.scrollHeight - e.scrollTop - e.clientHeight < 8 });
  }
  render();
  for (const d of root.querySelectorAll<HTMLDetailsElement>("details[data-key]")) {
    const open = state.get(d.dataset.key!);
    if (open !== undefined && d.open !== open) d.open = open;
  }
  for (const e of root.querySelectorAll<HTMLElement>("[data-scroll]")) {
    const s = scrolls.get(e.dataset.scroll!);
    if (s) e.scrollTop = s.atEnd ? e.scrollHeight : s.top;
  }
}
