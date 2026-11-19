// Agents in grouped or priority views; parents take their most urgent sub-agent's place.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, settings } from "herdr";

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

// Shrinking (the stages above): labels ellipsize; under Compact the header's icon and the rows' times go; on the rail
// the header goes and rows keep their program icon and state, groups their count.

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Drops what an agent puts before its title: a status glyph or spinner and the separator
// after it ("✦  Working", "⠋ - Thinking"), and Codex's blinking "[ ! ] " / "[ . ] " mark.
// Stops at an opening bracket or quote, so a title that starts with one ("[web] login") keeps it.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== (l?.terminal ?? l?.address) && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    try { this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}"); } catch { this.changed = {}; }
    if (!this.changed || typeof this.changed !== "object" || Array.isArray(this.changed)) this.changed = {};
    try { this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]"); } catch { this.pendingPins = []; }
    if (!Array.isArray(this.pendingPins)) this.pendingPins = [];
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  rank(a) {
    return RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(14)
      .child(div().px(8).pt(4).pb(6).text_size(12).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/nacre-agents/icons/${s.icon}.svg`).size(16).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(13)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = liveWidth(this) < RAIL;
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(12)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        // As the Inbox's rail: the program's icon, ringed in its state's colour (turning while it works, still when
        // it's blocked or done), the space's colour as a dot in the corner; centred, the name as the tooltip.
        const work = a.status === "working", loud = a.status === "blocked" || a.status === "done";
        const disk = (shared("space.disks") ?? {})[a.space];
        const ring = work ? svg("mods/nacre-agents/icons/ring-working.svg").absolute().top(1).left(1).size(24).text_color(t.working).spin(1100)
          : loud ? div().absolute().top(1).left(1).size(24).rounded(12).border(2).border_color(a.status === "blocked" ? t.blocked : t.done) : null;
        const cell = h_flex().relative().size(26).flex_none().items_center().justify_center()
          .when(Boolean(ring), (el) => el.child(ring))
          .child(pic ? div().flex_none().when(!work && !loud, (d) => d.opacity(0.7)).child(pic) : div().text_size(12).text_color(t.muted).child(String(i + 1)))
          .when(Boolean(disk), (el) =>
          // The space's dot at the corner, just outside the 24px ring (centres 17.7 apart, radii 12 + 4.5), so the two
        // never overlap and look the same whichever GPUI paints first (it doesn't keep code order for turning svgs).
        el.child(div().absolute().right(-4).bottom(-4).size(9)
          .child(svg("mods/nacre-agents/icons/dot.svg").absolute().top(0).left(0).size(9).text_color(t.chrome))
          .child(svg("mods/nacre-agents/icons/dot.svg").absolute().top(2).left(2).size(5).text_color(disk.color))));
        return h_flex().w_full().flex_none().justify_center().child(h_flex()
          .id(`ag-${a.address}`)
          .h(34)
          .w(32)
          .items_center()
          .justify_center()
          .rounded(7)
          .tooltip(label(a) || a.program?.name || a.address)
          .when(Boolean(a.focused), (el) => el.bg(t.selected))
          .when(!a.focused, (el) => el.hover((s) => s.bg(t.hover)))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(cell));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      // Compact (under COMPACT): the row keeps only its name, so it reads; the detail moves to the tooltip.
      const roomy = liveWidth(this) >= COMPACT, detailShown = full && Boolean(more) && roomy;
      // The space's colour as a thin bar on the leading edge, so whose agent it is reads at a glance.
      const disk = (shared("space.disks") ?? {})[a.space];
      return h_flex()
        .id(`ag-${a.address}`)
        .relative()
        .when(!roomy && full && Boolean(more), (el) => el.tooltip(`${name} · ${more}`))
        .when(Boolean(disk), (el) => el.child(div().absolute().left(1).top(8).h(14).w(3).rounded(1.5).bg(disk.color)))
        .px(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).max_w(detailShown ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(detailShown, el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(11).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when) && liveWidth(this) >= COMPACT, el => el.child(div().flex_none().text_size(12).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    // A group's mark, on the rail and in the headers: its state's icon (Needs you: alert, Done: check, Working: pulse,
    // Idle: moon; Pinned: the pin), or by space the space's disk; in the state's colour.
    const groupMark = (g, size) => {
      const kind = g.id === "pinned" ? "pinned" : byPriority ? (g.status ?? "idle") : "space";
      const color = t[g.status] ?? t.dim, disk = (shared("space.disks") ?? {})[g.members[0]?.space];
      return kind === "pinned" ? svg("mods/workspace-chrome/pin.svg").size(size).flex_none().text_color(color)
        : kind === "space" ? h_flex().size(size).flex_none().items_center().justify_center().child(div().size(8).rounded(4).bg(disk?.color ?? t.dim))
        : svg(`mods/nacre-agents/icons/state-${kind}.svg`).size(size).flex_none().text_color(color);
    };
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(12)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(groupMark(g, 13))
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    // On the rail a group is its state's icon and its count, in the state's colour (Needs you: alert, Done: check,
    // Working: pulse, Idle: moon; Pinned: the pin; by space: the space's disk); its name is the tooltip.
    const railHead = (g) => {
      const color = t[g.status] ?? t.dim, mark = groupMark(g, 13);
      return h_flex().w_full().h(22).mt(6).flex_none().items_center().justify_center()
        .child(h_flex().id(g.id).h(22).px(4).gap(3).items_center().rounded(6).tooltip(`${g.label || "Agents"} · ${g.members.length}`)
          .text_size(11).font_medium().text_color(color).child(mark).child(String(g.members.length)));
    };
    const rows = collapsed
      ? groups.flatMap((g) => [railHead(g), ...g.members.flatMap(withKids)])
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return measure(this, v_flex().id("agents-root"))
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(14)
      // The Inbox's top row, matched: 32 high, 8 in, a 16px icon and 14px medium dim label 8 in, then
      // touching 28px buttons with 16px Lucide icons, lit on hover (an svg takes no hover style, so it's state).
      // The Inbox/Agents switch always shows: alone and centred on the rail; then Sort and the label when they fit.
      .when(collapsed && Boolean(props()?.switch), (el) => {
        const lit = this.hot === "ag-switch" ? t.foreground : t.dim;
        return el.child(h_flex().id("ag-top").h(32).flex_none().items_center().justify_center()
          .child(h_flex().id("ag-switch").size(28).flex_none().items_center().justify_center().rounded(8)
            .hover((st) => st.bg(t.foreground + "0a")).tooltip("Show inbox")
            .on_hover((over, cx) => { if (over) this.hot = "ag-switch"; else if (this.hot === "ag-switch") this.hot = null; cx.notify(); })
            .on_click(() => run("layout.select", props().switch)).child(svg("mods/nacre-agents/icons/inbox.svg").size(16).text_color(lit))));
      })
      .when(!collapsed, (el) => {
        const lit = (id) => this.hot === id ? t.foreground : t.dim;
        const sw = Boolean(props()?.switch), avail = liveWidth(this) - 20, sortOn = avail >= ((sw ? 1 : 0) + 1) * 28;
        const n = (sw ? 1 : 0) + (sortOn ? 1 : 0);
        const tool = (id, icon, label, act) => h_flex().id(id).size(28).flex_none().items_center().justify_center().rounded(8)
          .hover((st) => st.bg(t.foreground + "0a")).tooltip(label)
          .on_hover((over, cx) => { if (over) this.hot = id; else if (this.hot === id) this.hot = null; cx.notify(); })
          .on_click(act).child(svg(`mods/nacre-agents/icons/${icon}.svg`).size(16).text_color(lit(id)));
        return el.child(h_flex().id("ag-top").h(32).px(8).gap(4).flex_none().items_center()
          .child(h_flex().flex_1().min_w(0).h(32).px(8).gap(8).items_center().text_size(14).font_medium().text_color(t.dim)
            .when(liveWidth(this) >= COMPACT, (h) => h.child(svg("mods/nacre-agents/icons/bot.svg").size(16).flex_none().text_color(t.dim)))
            // Only when it fits whole next to the buttons (16 padding + "Agents" ~48).
            .when(avail - n * 28 >= 64, (h) => h.child(div().truncate().child("Agents"))))
          .child(h_flex().flex_none().items_center()
            .when(sortOn, (row) => row.child(tool("ag-sort", sort.icon, `Sort agents: ${sort.label}`,
              () => openOverlay({ mod: "nacre-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))))
            .when(Boolean(props()?.switch), (row) => row.child(tool("ag-switch", "inbox", "Show inbox", () => run("layout.select", props().switch))))));
      })
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      // No scrollbar, as the Spaces and Inbox lists: a mod's bar can't be drawn like the terminals', so none.
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scroll().children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
