import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Popover, Input } from "gpui-base";
import { spaces, machines, shared, run, props, openOverlay, layout } from "herdr";
import { projectMark } from "./project.js";
import { glow, tip } from "./tip.js";
import { stop, pressed, justClosed } from "./focus.js";
import { step, scrollList } from "./list.js";
import { FIRST } from "./row-model.js";
import { KEY, closedKey } from "./store.js";
import { openMenu } from "./menu.js";
import { sidebarWidth, RAIL, COMPACT } from "./sidebar.js";
import { button, radiusOf } from "./button.js";
import { trigger } from "./trigger.js";

// The space filter's rows, flush as T3's, and how many show before the list scrolls: the whole rows T3's 23rem holds.
const SCOPE_ROW = 32, SCOPE_SHOWN = 9;

// The disk's letter: dark on light fills, white on the rest, as the Spaces sidebar's numbers.
function letterOn(hex) {
  const h = String(hex).replace("#", "").slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#1b1f24a6" : "#ffffffbf";
}

export function inboxMatches(view) {
  const q = view.search.value().toLowerCase();
  return [{ id: null, name: "All spaces" }, ...spaces().filter((s) => s.id !== shared(KEY.home))].filter((s) => s.name.toLowerCase().includes(q));
}

// A click shows that space alone; shift-click adds or removes it and keeps the menu open, as in T3.
export function pickInboxSpace(view, s, shift, cx) {
  if (!s) return;
  view.scope = !s.id ? [] : !shift ? [s.id] : view.scope.includes(s.id) ? view.scope.filter((id) => id !== s.id) : [...view.scope, s.id];
  localStorage.setItem("scope", JSON.stringify(view.scope));
  // A new scope starts the settled tail over, as T3's does.
  view.limit = FIRST;
  if (!shift) view.scopeOpen = false;
  cx.notify();
}

export function inboxTop(view, t, model) {
  const { sp, ps, scope } = model;
  const lit = (id, color) => view.hot === id ? t.foreground : color;
  // Local change: a space's mark is its disk as the Spaces sidebar colors it (shared "space.disks"), lettered with the name's
  // first letter in semibold; T3's project mark only for a space the sidebar hasn't drawn.
  const avatar = (id, name, size) => {
    const disk = (shared("space.disks") ?? {})[id];
    if (!disk) return projectMark("mods/t3-inbox", sp.find((s) => s.id === id) ?? { name: name ?? "" }, size, t, ps);
    const letter = (disk.name ?? name ?? "").normalize("NFKC").match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "";
    // A worktree's disk is smaller, as on the Spaces rail, in the same box so names stay lined up.
    const d = (shared("space.git") ?? {})[id]?.linked ? Math.round(size * 0.75) : size;
    return h_flex().size(size).flex_none().items_center().justify_center()
      .child(h_flex().size(d).flex_none().rounded_full().bg(disk.color).items_center().justify_center()
        .when(disk.ring, (el) => el.border(1).border_color(t.input))
        .text_size(d * 0.6).font_semibold().line_height(`${d}px`).text_color(letterOn(disk.color)).child(letter));
  };
  // T3's top row: search on the left, then the space filter, new space and new tab.
  const asks = props()?.newMenu && machines().length > 1;
  const tool = (id, label, icon, closed, onOpen, action = undefined) => trigger(view, t, id, { icon: `mods/t3-inbox/icons/${icon}.svg`, label, closed, onOpen, action });
  // The filter shows what it filters to: one avatar, two overlapping, or the plain filter icon.
  const scoped = sp.filter((s) => scope.includes(s.id)), found = view.matches();
  const choice = (s, i) => {
    const on = s.id ? scope.includes(s.id) : scope.length === 0;
    // Selection is a check badge on the icon, as in T3.
    return h_flex().id(`scope-${s.id ?? "all"}`).h(SCOPE_ROW).px(8).gap(8).flex_none().items_center().rounded(4)
      .when(i === view.scopeAt, (el) => el.bg(t.selected))
      .on_hover((over, cx) => { if (over && view.scopeAt !== i) { view.scopeAt = i; cx.notify(); } })
      .role("button").accessibility_label(s.name)
      .on_click((e, cx) => view.pick(s, e.modifiers.shift, cx))
      // A space's row: the space's menu, as in Spaces; the list closes under it.
      .when(Boolean(s.id && props()?.menu), (el) => el.on_mouse_down("right", (_e, cx) => { view.scopeOpen = false; openMenu(view, "space", { id: s.id }, cx, props().menu); cx.notify(); }))
      .child(div().relative().flex_none()
        .child(s.id ? avatar(s.id, s.name, 16) : svg("mods/t3-inbox/icons/folder.svg").size(16).text_color(t.muted))
        // T3's ring is outside its 12px badge; a border here is inside, so 16 and 2 further out.
        .when(on, (el) => el.child(h_flex().absolute().right(-6).bottom(-6).size(16).rounded_full().bg(t.accent)
          .border(2).border_color(t.popover).items_center().justify_center()
          .child(svg("mods/t3-inbox/icons/check.svg").size(8).text_color("#ffffff")))))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.name));
  };
  // As T3's: from the button's left edge, 288 wide, out over the work column; radius 8 and rows' 4, inset 4 (its rounded-lg, rounded-sm, px-1).
  const filter = Popover.new("inbox-scope-menu").anchor("top_left").open(view.scopeOpen)
    .on_open_change((open, cx) => {
      view.scopeOpen = open;
      if (open) {
        view.scopeAt = 0;
        view.search.set_value("");
        view.search.focus();
      }
      cx.notify();
    })
    .trigger(stop(view, t, "inbox-scope", button(t, "inbox-scope", { size: "sm", hot: view.hot === "inbox-scope", on: view.scopeOpen,
      label: scoped.length ? `Filter by space: ${scoped.map((s) => s.name).join(", ")}` : "Filter by space",
      icon: scoped.length ? undefined : "mods/t3-inbox/icons/list-filter.svg" }).on_hover(glow(view, "inbox-scope"))
      .when(scoped.length > 0, el => el.child(scoped.length > 1
        // T3's second mark overlaps by 4 with a 2px ring of the sidebar's color.
        ? h_flex().children(scoped.slice(0, 2).map((s, i) => i === 0 ? avatar(s.id, s.name, 14)
          : h_flex().flex_none().ml(-6).rounded_full().border(2).border_color(t.chrome).child(avatar(s.id, s.name, 14))))
        : avatar(scoped[0].id, scoped[0].name, 16))), radiusOf("sm")))
    .content(v_flex().id("inbox-scope-panel").w(288).mt(4).p(4).rounded(8)
      .bg(t.popover).border_1().border_color(t.border).shadow_lg().text_size(14)
      .on_key_down((e, cx) => {
        const to = step(e, view.scopeAt, view.matches().length);
        if (to < 0) return;
        view.scopeAt = to;
        cx.stop_propagation();
        cx.notify();
      })
      // As T3's ComboboxSearchInput: 12 in and 10 down less the 1 it shifts up, a 26 field, 6 to the rule. Its text starts 20 from
      // the icon, 4 before the names, and inside the button's left edge as the panel hangs from it.
      .child(h_flex().mx(8).mt(5).h(33).pb(6).gap(4).flex_none().items_center().border_b_1().border_color(t.border)
        .child(svg("mods/t3-inbox/icons/search.svg").size(16).flex_none().text_color(t.dim))
        .child(Input.new(view.search).flex_1().h_full().text_size(14).text_color(t.foreground)))
      .child(div().pt(5).flex_none()
        .when(found.length > 0, (el) => el.child(scrollList(view, "inbox-scope-list", { count: found.length, row: SCOPE_ROW, at: view.scopeAt, height: Math.min(found.length, SCOPE_SHOWN) * SCOPE_ROW,
          draw: (i) => choice(found[i], i), wheeled: (keep) => { view.scopeAt = keep; } })))
        .when(found.length === 0, (el) => el.child(div().p(8).text_center().line_height("20px").text_color(t.dim).child("No matching spaces.")))));
  // T3's top group: 8 in and the search field 4 before its buttons, which touch. The right edge is the brand bar's above, so the two rows of icons line up.
  // Local change, shrinking as the Agents list's header (sidebar.js's stages): the label ellipsizes, its icon goes under
  // Compact, the buttons on the rail.
  const W = sidebarWidth(view, layout());
  // Local change: the Agents/Inbox switch always shows (alone, centred, on the rail); then New task, then Filter, then
  // the label, each only when it fits whole (8 padding a side, a 4 gap, 28 a button, 16 + ~40 the label).
  const sw = Boolean(props()?.switch);
  const switchButton = () => tool("inbox-switch", "Show agents", "bot", undefined, () => { run("layout.select", props().switch); return false; });
  if (W < RAIL) return h_flex().id("inbox-top").h(32).flex_none().items_center().justify_center().when(sw, (el) => el.child(switchButton()));
  const avail = W - 16 - 4, fit = (n) => avail >= n * 28;
  const newTask = fit((sw ? 1 : 0) + 1), filterOn = fit((sw ? 1 : 0) + 2);
  const n = (sw ? 1 : 0) + (newTask ? 1 : 0) + (filterOn ? 1 : 0), label = avail - n * 28 >= 56;
  const top = h_flex().id("inbox-top").h(32).px(8).gap(4).flex_none().items_center()
    // Local change: no Search here (it's in the sidebar header); the list's name, with the icon that switches to it,
    // laid out as the search field was (32 high, 8 in, 16px icon, 14px medium dim).
    .child(h_flex().id("inbox-title").flex_1().min_w(0).h(32).px(8).gap(8).items_center().text_size(14).font_medium().text_color(t.dim)
      .when(W >= COMPACT, (el) => el.child(svg("mods/t3-inbox/icons/inbox.svg").size(16).flex_none().text_color(t.dim)))
      .when(label, (el) => el.child(div().truncate().child("Inbox"))))
    .child(h_flex().flex_none().items_center()
    .when(filterOn, (el) => el.child(tip(view, t, "inbox-scope", "Filter by space", filter, { off: view.scopeOpen, hint: "Shift+click to pick several", below: true })))
    // Local change: New space and New tab go (the sidebar and tab bar have them); New task (mods/task) takes their place.
    .when(newTask, (el) => el.child(tool("inbox-new-task", "New task", "square-pen", undefined, () => { run("nacre-chrome.newtask"); return false; }, "nacre-chrome.newtask")))
    // Local addition: the layout's Inbox/Agents switch (props.switch = { stack, child }), in place of Herdr T3's header button.
    .when(sw, (el) => el.child(switchButton())));


  return top;
}
