import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, nextCommand, openOverlay, closeOverlay, focused, settings } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's stages, the same in every Nacre sidebar mod (nacre-chrome, nacre-spaces, nacre-agents, t3-inbox),
// by the sidebar's width in layout px: Full (>= FULL) everything; Medium (COMPACT..FULL) no secondary labels
// (the header's "Herdr", the Inbox's state words); Compact (RAIL..COMPACT) one line a row, no times, branch
// lines or header icons; Rail (< RAIL) icons, disks and counts only.
const RAIL = 90, COMPACT = 200, FULL = 240; // RAIL: only the collapsed widths (76 on macOS, 44 elsewhere)
// The rail goes by the width, not a flag: dragging the sidebar's edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < RAIL; // the toggle's decision: the saved size
// The width as drawn now: the block's measured size, which follows a drag of the sidebar's edge frame by frame
// (layout()'s px is the saved size and catches up only later); before the first measure, the layout's.
// Every block in the sidebar is as wide as the sidebar. `measure(el)` goes on the mod's root.
function liveWidth(view) { return view.measuredW ?? find(layout(), "sidebar")?.size?.px ?? Infinity; }
function measure(view, el) {
  return el.on_size_change((size, cx) => {
    const w = size.width / (Number(settings()?.zoom) || 1);
    if (Math.round(w) === Math.round(view.measuredW ?? -1)) return;
    view.measuredW = w;
    cx.notify();
  });
}


// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class WorkspaceChrome extends View {
  // `nacre-chrome.switch` (keys.json): flips the sidebar's bottom between the Inbox and the Agents list.
  // Only the header copy answers; the footer is a copy of this mod too and would flip it back.
  init(_props, cx) {
    if (props()?.footer || props()?.footerMenu) return;
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        // `nacre-chrome.newtask`: the New task dialog, on the space in view (mods/task).
        if (c === "newtask") { openOverlay({ mod: "task", kind: "dialog", width: 520, props: { space: focused()?.space ?? null } }); continue; }
        if (c !== "switch") continue;
        const inbox = (find(layout(), "agents-stack")?.active ?? "inbox") === "inbox";
        run("layout.select", { stack: "agents-stack", child: inbox ? "agents" : "inbox" });
      }
    });
  }

  button(id, label, action) {
    const t = theme();
    return div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(8).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = liveWidth(this) < RAIL;
    // The footer's menu, when the rail has room only for the gear.
    if (props()?.footerMenu) {
      const item = (id, icon, label, action) => h_flex().id(id).h(28).px(8).gap(8).items_center().rounded(4).text_size(14)
        .text_color(t.foreground).hover(s => s.bg(t.hover)).cursor_pointer()
        .on_click(() => { closeOverlay(props().overlay); action(); })
        .child(svg(`mods/nacre-chrome/${icon}.svg`).size(16).flex_none().text_color(t.muted)).child(label);
      return v_flex().p(4).gap(0).bg(t.popover)
        .child(item("menu-settings", "settings", "Settings", () => run("app.settings")))
        .child(item("menu-machine", "plus", "Add machine", () => run("mod.open", { name: "machine-add" })));
    }
    if (props()?.footer) {
      // Icons only, side by side; the label is the tooltip.
      const icon = (id, name, label, dim, action) => h_flex().id(id).relative().size(28).flex_none().items_center().justify_center().rounded(7)
        .tooltip(label).text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/nacre-chrome/${name}.svg`).size(15));
      const ready = div().absolute().top(5).right(5).size(6).rounded_full().bg(t.accent);
      if (collapsed) return measure(this, h_flex().id("footer-root")).size_full().bg(t.chrome).border_t(1).border_color(t.border).items_center().justify_center()
        .child(icon("settings-menu", "settings", "Settings and machines", false,
          () => openOverlay({ mod: "nacre-chrome", kind: "popup", width: 180, height: 64, props: { footerMenu: true } }))
          .when(Boolean(updates().app.ready), el => el.child(ready)));
      return measure(this, h_flex().id("footer-root")).size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).gap(4).items_center()
        .child(icon("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(ready)))
        .child(icon("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    // As Herdr T3's sidebar header: no search, and Hide sidebar (cmd-b brings it back). The
    // Inbox/Agents switch is in those lists' own headers (their props.switch).
    // Shrinking, by what fits in the width as drawn: "Herdr" goes under Full, then the logo, then Search; Hide
    // sidebar stays until the rail. On macOS the window buttons take the first 76px (none in full screen).
    const W = liveWidth(this);
    const lights = window()?.platform === "macos" && !window()?.fullscreen;
    const left = collapsed ? 6 : lights ? 76 : 14, room = W - left - 8; // 8: the right padding
    const BTN = 28, LOGO = 20 + 8; // the logo and its gap
    const search = !collapsed && room >= 2 * BTN;
    const logo = collapsed ? !lights : room >= LOGO + (search ? 2 : 1) * BTN;
    return measure(this, h_flex().id("header-root")).size_full().bg(t.chrome).pl(left).pr(8).gap(0).items_center().text_size(14)
      .child(h_flex().flex_1().min_w(0).gap(8).items_center()
        .when(logo, el => el.child(image("frame/welcome/herdr.png").size(20).flex_none().rounded(5)))
        .when(logo && W >= FULL, el => el.child(div().truncate().font_medium().text_color(t.foreground).child("Herdr"))))
      .when(search, el => el.child(this.button("search", svg("mods/nacre-chrome/search-t3.svg").size(16), () => run("mod.open", { name: "picker" })).tooltip("Search")))
      .when(!collapsed, el => el.child(this.button("sidebar-toggle", svg("mods/nacre-chrome/panel-left.svg").size(16), () => run("layout.toggle", { id: "sidebar" })).tooltip("Hide sidebar")));
  }
}
