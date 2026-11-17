import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, nextCommand, openOverlay, closeOverlay, focused } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

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
    const collapsed = narrow();
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
      if (collapsed) return h_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).items_center().justify_center()
        .child(icon("settings-menu", "settings", "Settings and machines", false,
          () => openOverlay({ mod: "nacre-chrome", kind: "popup", width: 180, height: 64, props: { footerMenu: true } }))
          .when(Boolean(updates().app.ready), el => el.child(ready)));
      return h_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).gap(4).items_center()
        .child(icon("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(ready)))
        .child(icon("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    // As Herdr T3's sidebar header: no search, and Hide sidebar (cmd-b brings it back). The
    // Inbox/Agents switch is in those lists' own headers (their props.switch).
    // Shrinking (the sidebar's width, the same stages as the lists): "Herdr" goes when it no longer fits
    // (214 with the macOS window buttons), the buttons on the rail (under 160); the logo always stays,
    // but for the macOS rail, where the window buttons fill the row.
    const W = find(layout(), "sidebar")?.size?.px ?? Infinity;
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(8).gap(0).items_center().text_size(14)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .child(h_flex().flex_1().min_w(0).gap(8).items_center()
        .when(!(collapsed && window()?.platform === "macos"), el => el.child(image("frame/welcome/herdr.png").size(20).flex_none().rounded(5)))
        .when(W >= 214, el => el.child(div().truncate().font_medium().text_color(t.foreground).child("Herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/nacre-chrome/search-t3.svg").size(16), () => run("mod.open", { name: "picker" })).tooltip("Search"))
        .child(this.button("sidebar-toggle", svg("mods/nacre-chrome/panel-left.svg").size(16), () => run("layout.toggle", { id: "sidebar" })).tooltip("Hide sidebar")));
  }
}
