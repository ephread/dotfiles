export function sidebarParts(root) {
  let rail = root?.id === "sidebar" ? root : undefined;
  let stack = root?.id === "sidebar-lists" ? root : undefined;
  for (const child of root?.children ?? []) {
    const found = sidebarParts(child);
    rail ??= found.rail;
    stack ??= found.stack;
    if (rail && stack) break;
  }
  return { rail, stack };
}

// The sidebar's stages, the same in every Nacre sidebar mod (nacre-chrome, nacre-spaces, nacre-agents, t3-inbox),
// by the sidebar's width in layout px: Full (>= FULL) everything; Medium (COMPACT..FULL) no secondary labels
// (the header's "Herdr", the Inbox's state words); Compact (RAIL..COMPACT) one line a row, no times, branch
// lines or header icons; Rail (< RAIL) icons, disks and counts only.
export const RAIL = 90, COMPACT = 200, FULL = 240; // RAIL: only the collapsed widths (76 on macOS, 44 elsewhere)
// The width as drawn now: the Inbox's measured size, which follows a drag of the sidebar's edge frame by frame
// (layout()'s px is the saved size and catches up only later); before the first measure, the sidebar's in the layout.
export function sidebarWidth(view, root) {
  return view.width ?? sidebarParts(root).rail?.size?.px ?? Infinity;
}
