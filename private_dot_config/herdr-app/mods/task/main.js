// T3-style tasks on Herdr spaces.
//
// New task (props: { space }): pick the space, write the task, pick the agent, and where it runs: this checkout
// or a new worktree. A worktree is always the whole repo; the task opens in the same subfolder the space is in
// (a task from iOS, in mobile/ios, opens in <worktree>/ios). New worktrees are trusted for mise, and when the
// repo has a `worktree-setup` mise task it runs first, in a visible terminal of the new space; the agent starts
// once it succeeds.
//
// Scripted (props: { space, task, argv, where?, branch?, start: true }): starts at once, no typing.
//
// Finish (props: { finish: spaceId }): a task in a worktree is done: open a PR, remove the worktree, or keep it.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, spaces, panes, exec, home, appHome, readTextFile, shared, knownAgents, run, notify, checking } from "herdr";

const base = (p) => (p ?? "").replace(/\/+$/, "").split("/").pop();
const tilde = (p, h) => (h && p?.startsWith(h) ? "~" + p.slice(h.length) : p ?? "");
// A branch from the task's first words: "Fix the login bug" -> "fix-the-login-bug".
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 6).join("-").slice(0, 48);

// Where a space is now: its first terminal's folder (as the Spaces sidebar and git use it), else where it began.
function placeOf(s) {
  const tabs = new Set((s?.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s?.folder || "";
}

async function git(cwd, args, on) {
  const r = await exec("git", ["-C", cwd, ...args], { on, timeout: 120000 });
  return { ok: r.code === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

// `herdr-app do`, for what a command made (run() returns nothing).
async function herdr(command, args) {
  const r = await exec("herdr-app", ["do", command, JSON.stringify(args)], { timeout: 30000 });
  let out = {};
  try { out = JSON.parse(r.stdout); } catch {}
  if (r.code !== 0 || out.error) throw new Error(out.error || r.stderr.trim() || `${command} failed`);
  return out;
}

const SETUP_MARK = "__herdr_setup=";

export default class Task extends View {
  init(_props, cx) {
    this.finishing = Boolean(props()?.finish);
    this.error = "";
    this.busy = false;
    this.step = "";
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (this.finishing) return this.initFinish(cx);

    const all = spaces();
    this.spaceId = (all.find((s) => s.id === props()?.space) ?? all.find((s) => s.active) ?? all[0])?.id ?? null;
    this.agents = null; // loading
    this.agentAt = 0;
    this.where = "worktree"; // or "here"
    this.branchEdited = false;
    this.task = InputState.new({ placeholder: "What should the agent do?" });
    this.branch = InputState.new({ placeholder: "branch name" });
    this.task.on("change", (_e, cx) => {
      if (!this.branchEdited) this.branch.set_value(slug(this.task.value()));
      this.error = "";
      cx.notify();
    });
    this.task.on("submit", (_e, cx) => this.start(cx));
    this.branch.on("change", (_e, cx) => { this.branchEdited = this.branch.value() !== slug(this.task.value()); this.error = ""; cx.notify(); });
    this.branch.on("submit", (_e, cx) => this.start(cx));
    this.task.focus();
    // Scripted: props { space, task, argv, where?, branch?, start: true } fills the form and starts at once.
    const p = props() ?? {};
    if (p.start && p.task && p.argv) {
      this.agents = [{ key: "custom", name: p.argv[0], run: p.argv }];
      this.task.set_value(p.task);
      this.branch.set_value(p.branch || slug(p.task));
      if (p.where === "here") this.where = "here";
      cx.spawn(async (cx) => this.start(cx));
      return;
    }
    if (checking()) { this.agents = []; return; }
    cx.spawn(async (cx) => {
      try {
        const known = await knownAgents({ on: this.space()?.machine ?? null });
        this.agents = known.filter((a) => a.installed); // most picked first
      } catch (e) { this.agents = []; this.error = `Couldn't list agents: ${e}`; }
      cx.notify();
    });
  }

  space() { return spaces().find((s) => s.id === (this.spaceId ?? props()?.finish)); }
  close() { closeOverlay(props().overlay); }

  // ---- New task --------------------------------------------------------------------------------------------

  start(cx) {
    if (this.busy) return;
    const s = this.space(), agent = this.agents?.[this.agentAt], task = this.task.value().trim();
    if (!s) { this.error = "Pick a space."; return cx.notify(); }
    if (!agent) { this.error = this.agents ? "No installed agent found." : "Still looking for agents…"; return cx.notify(); }
    if (!task) { this.error = "Write the task first."; return cx.notify(); }
    const branch = this.branch.value().trim();
    if (this.where === "worktree" && !branch) { this.error = "Give the worktree a branch name."; return cx.notify(); }
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (this.where === "here") {
          run("tab.new", { space: s.id, folder: placeOf(s) || undefined, argv: agent.run, task });
        } else {
          await this.inWorktree(s, agent, task, branch, (step) => { this.step = step; cx.notify(); });
        }
        this.busy = false;
        this.close();
      } catch (e) {
        this.busy = false;
        this.step = "";
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  async inWorktree(s, agent, task, branch, say) {
    const on = s.machine ?? null, cwd = placeOf(s);
    say("Reading the repository…");
    const top = await git(cwd, ["rev-parse", "--show-toplevel"], on);
    if (!top.ok) throw new Error(`${tilde(cwd, home())} is not in a git repository.`);
    const prefix = (await git(cwd, ["rev-parse", "--show-prefix"], on)).out.replace(/\/+$/, "");
    const common = (await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on)).out;
    const mainRoot = common.endsWith("/.git") ? common.slice(0, -5) : common.replace(/\.git$/, "");
    const repo = base(mainRoot);

    // A branch already checked out somewhere gets that worktree; else a new one, from where the space is.
    const listing = (await git(top.out, ["worktree", "list", "--porcelain"], on)).out.split("\n\n");
    const existing = listing.map((b) => ({ path: /^worktree (.+)$/m.exec(b)?.[1], branch: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] }))
      .find((w) => w.branch === branch);
    let wt = existing?.path;
    if (!wt) {
      // Herdr's own worktree preference (settings.json worktrees.directory), as its worktree dialog reads it.
      const raw = await readTextFile(`${appHome()}/settings.json`).catch(() => null);
      let root = (raw ? JSON.parse(raw) : {})?.worktrees?.directory || "~/.herdr/worktrees";
      const h = on ? (await exec("sh", ["-c", 'printf %s "$HOME"'], { on })).stdout.trim() : home();
      root = root.replace(/^~(?=\/|$)/, h);
      wt = `${root.replace(/\/+$/, "")}/${repo}/${branch.replace(/\//g, "-")}`;
      const known = (await git(top.out, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], on)).ok;
      say(`Creating the worktree ${branch}…`);
      const add = await git(top.out, known ? ["worktree", "add", wt, branch] : ["worktree", "add", "-b", branch, wt], on);
      if (!add.ok) throw new Error(add.err || "git worktree add failed");
    }
    const target = prefix ? `${wt}/${prefix}` : wt;

    // mise trusts config files by path: trust the new checkout's (the subfolder's and the root's).
    say("Trusting mise config…");
    try { await exec("mise", ["trust", "--all", "--yes", "--quiet"], { cwd: target, on }); } catch {}

    let hasSetup = false;
    try { hasSetup = (await exec("mise", ["tasks", "info", "worktree-setup"], { cwd: target, on })).code === 0; } catch {}
    const machine = on ? { machine: on } : {};
    if (!hasSetup) {
      say("Starting the agent…");
      await herdr("space.new", { folder: target, argv: agent.run, task, ...machine });
      return;
    }

    say("Running worktree-setup… (see the new space)");
    const shell = on ? "sh" : "zsh";
    const made = await herdr("space.new", {
      folder: target, name: undefined, ...machine,
      argv: [shell, on ? "-lc" : "-ic", `mise run worktree-setup; echo "${SETUP_MARK}$?"; exec ${shell} -i`],
    });
    // Poll its screen: hc wait (3s at a time) for the mark, then read the exit code.
    const deadline = Date.now() + 15 * 60 * 1000;
    let code = null;
    while (code === null && Date.now() < deadline) {
      const screen = (await exec("hc", ["read", made.terminal, "--lines", "400"], { timeout: 20000 })).stdout;
      const m = [...screen.matchAll(new RegExp(`${SETUP_MARK}(\\d+)`, "g"))].pop();
      if (m) code = Number(m[1]);
      else await exec("hc", ["wait", made.terminal, "--output", SETUP_MARK, "--timeout", "3"], { timeout: 20000 }).catch(() => {});
    }
    if (code === null) throw new Error("worktree-setup is still running after 15 minutes; start the agent by hand when it's done.");
    if (code !== 0) throw new Error(`worktree-setup failed (exit ${code}). Its terminal stays open in the new space.`);
    say("Starting the agent…");
    await herdr("tab.new", { space: made.space, folder: target, argv: agent.run, task });
  }

  // ---- Finish ----------------------------------------------------------------------------------------------

  initFinish(cx) {
    this.choiceAt = 0;
    this.prIcon = "icons/git.svg";
    if (!checking()) cx.spawn(async (cx) => {
      const own = await readTextFile(`${appHome()}/mods/task/icons/github.svg`).catch(() => null);
      if (own) { this.prIcon = "mods/task/icons/github.svg"; cx.notify(); }
    });
    this.confirming = false;
    this.facts = null;
    if (checking()) return;
    cx.spawn(async (cx) => {
      const s = this.space(), on = s?.machine ?? null, cwd = placeOf(s);
      try {
        const top = (await git(cwd, ["rev-parse", "--show-toplevel"], on)).out;
        const common = (await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on)).out;
        const mainRoot = common.endsWith("/.git") ? common.slice(0, -5) : common;
        const branch = (await git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"], on)).out || null;
        const dirty = (await git(top, ["status", "--porcelain"], on)).out !== "";
        // Every space open inside this worktree (its root, ios/, …): removing it closes them all.
        const inside = spaces().filter((x) => (x.machine ?? null) === on && (placeOf(x) === top || placeOf(x).startsWith(top + "/")));
        this.facts = { top, mainRoot, branch, dirty, inside, linked: top !== mainRoot };
      } catch (e) { this.error = String(e); }
      cx.notify();
    });
  }

  choices() {
    return [
      { id: "pr", icon: this.prIcon, label: "Open a pull request", hint: "pushes the branch, then gh pr create --web" },
      { id: "remove", icon: "mods/nacre-spaces/git-fork.svg", label: "Remove the worktree", hint: "closes its spaces, deletes the checkout, and the branch if merged" },
      { id: "keep", icon: null, label: "Keep it", hint: "nothing changes" },
    ];
  }

  choose(id, cx) {
    const f = this.facts, s = this.space();
    if (!f || this.busy) return;
    if (id === "keep") return this.close();
    if (id === "pr") {
      run("tab.new", { space: s.id, folder: f.top, argv: [s.machine ? "sh" : "zsh", s.machine ? "-lc" : "-ic", "git push -u origin HEAD && gh pr create --web; exec ${SHELL:-sh} -i"] });
      return this.close();
    }
    if (!this.confirming) { this.confirming = true; return cx.notify(); }
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const on = s.machine ?? null;
      for (const x of f.inside) run("space.close", { id: x.id, confirmed: true });
      const rm = await git(f.mainRoot, ["worktree", "remove", ...(f.dirty ? ["--force"] : []), f.top], on);
      if (!rm.ok) { this.busy = false; this.error = rm.err || "git worktree remove failed"; return cx.notify(); }
      let kept = "";
      if (f.branch) {
        const del = await git(f.mainRoot, ["branch", "-d", f.branch], on);
        if (!del.ok) kept = ` The branch ${f.branch} stays: it isn't merged.`;
      }
      notify({ title: "Worktree removed", body: `${tilde(f.top, home())} is gone.${kept}`, level: "success" });
      this.close();
    });
  }

  // ---- Drawing ---------------------------------------------------------------------------------------------

  // Drawn as Herdr's own dialogs (prompt, confirm): 18 in, a 15px title with Esc, 11.5px labels 16 above and 7 below,
  // 36px inputs, 32px buttons at the bottom right; sized by its content.
  chip(id, selected, content, onClick) {
    const t = theme();
    return h_flex().id(id).h(30).px(10).gap(6).items_center().rounded(8).cursor_pointer().text_size(12.8)
      .border_1().border_color(selected ? t.accent : t.input).bg(selected ? t.selected : t.raised)
      .text_color(selected ? t.foreground : t.muted).hover((s) => s.opacity(0.88)).on_click(onClick).children(content);
  }

  disk(id) {
    const t = theme(), d = (shared("space.disks") ?? {})[id];
    return div().size(7).flex_none().rounded(3.5).bg(d?.color ?? t.dim).when(Boolean(d?.ring), (x) => x.border(1).border_color(t.foreground));
  }

  label(text) {
    return div().pt(16).pb(7).text_size(11.5).text_color(theme().dim).child(text);
  }

  field(state) {
    const t = theme();
    return Input.new(state).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground);
  }

  title(text) {
    const t = theme();
    return h_flex().items_center().child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(text))
      .child(div().text_size(11).text_color(t.dim).child("Esc"));
  }

  button(id, text, kind, action) {
    const t = theme();
    const bg = kind === "primary" ? t.solid : kind === "danger" ? t.ansi1 : t.raised;
    const fg = kind === "primary" ? t.solid_foreground : kind === "danger" ? "#ffffff" : t.foreground;
    return h_flex().id(id).h(32).px(14).flex_none().items_center().rounded(8).border_1().border_color(kind === "secondary" ? t.input : bg).bg(bg)
      .text_color(fg).text_size(12.5).font_medium().cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action).child(text);
  }

  // The bottom row: what's happening (or the error) on the left, the buttons on the right.
  actions(buttons) {
    const t = theme();
    return h_flex().pt(20).gap(8).items_center()
      .child(h_flex().flex_1().min_w(0).gap(6).items_center().text_size(12)
        .when(this.busy, (el) => el.text_color(t.dim).child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)).child(div().truncate().child(this.step || "Working…")))
        .when(!this.busy && Boolean(this.error), (el) => el.text_color(t.blocked).child(div().child(this.error))))
      .children(buttons);
  }

  render() {
    return this.finishing ? this.renderFinish() : this.renderNew();
  }

  renderNew() {
    const t = theme(), wt = (shared("space.git") ?? {});
    const roots = spaces().filter((s) => !wt[s.id]?.linked);
    return v_flex().id("task").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e) => { if (e.key === "escape") this.close(); })
      .child(this.title("New task"))
      .child(this.label("Space"))
      .child(h_flex().flex_wrap().gap(6).children(roots.map((s) =>
        this.chip(`sp-${s.id}`, s.id === this.spaceId, [this.disk(s.id), div().child((shared("space.disks") ?? {})[s.id]?.name ?? s.name)], (_e, cx) => { this.spaceId = s.id; cx.notify(); }))))
      .child(this.label("Task"))
      .child(this.field(this.task))
      .child(this.label("Agent"))
      .child(this.agents === null ? div().h(30).text_color(t.dim).child("…")
        : h_flex().flex_wrap().gap(6).children(this.agents.map((a, i) =>
          this.chip(`ag-${a.key}`, i === this.agentAt, [...(a.icon ? [a.tint ? svg(a.icon).size(14).flex_none().text_color(a.color ?? t.foreground) : image(a.icon).size(14).flex_none()] : []), div().child(a.name)],
            (_e, cx) => { this.agentAt = i; cx.notify(); }))))
      .child(this.label("Runs in"))
      .child(h_flex().gap(6)
        .child(this.chip("where-wt", this.where === "worktree", [svg("mods/nacre-spaces/git-fork.svg").size(14).flex_none(), div().child("New worktree")], (_e, cx) => { this.where = "worktree"; cx.notify(); }))
        .child(this.chip("where-here", this.where === "here", [div().child("This checkout")], (_e, cx) => { this.where = "here"; cx.notify(); })))
      .when(this.where === "worktree", (el) => el.child(this.label("Branch")).child(this.field(this.branch)))
      .child(this.actions([
        this.button("task-cancel", "Cancel", "secondary", () => this.close()),
        this.button("task-start", "Start task", "primary", (_e, cx) => this.start(cx)),
      ]));
  }

  renderFinish() {
    const t = theme(), s = this.space(), f = this.facts;
    const title = `Done with ${f ? base(f.top) : s?.name ?? "this task"}?`;
    const body = !f ? (this.error ? "" : "…")
      : !f.linked ? "This space is the repository's main checkout, not a worktree."
      : this.confirming
        ? `Closes ${f.inside.length === 1 ? "its space" : `${f.inside.length} spaces (${f.inside.map((x) => x.name).join(", ")})`}, ends their terminals, and deletes ${tilde(f.top, home())}.${f.dirty ? " It has uncommitted changes: they will be lost." : ""}`
        : `${tilde(f.top, home())}${f.branch ? ` on ${f.branch}` : ""}`;
    return v_flex().id("task-finish").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return this.close();
        if (this.confirming) return;
        const list = this.choices();
        if (e.key === "down") { this.choiceAt = Math.min(list.length - 1, this.choiceAt + 1); cx.notify(); }
        if (e.key === "up") { this.choiceAt = Math.max(0, this.choiceAt - 1); cx.notify(); }
        if (e.key === "enter") this.choose(list[this.choiceAt].id, cx);
      })
      .child(this.title(title))
      .child(div().pt(8).text_size(13).text_color(f?.dirty && this.confirming ? t.blocked : t.muted).child(body))
      .when(Boolean(f?.linked) && !this.confirming, (el) => el.child(v_flex().pt(14).gap(2).children(this.choices().map((c, i) =>
        h_flex().id(`fin-${c.id}`).px(10).py(7).gap(10).items_center().rounded(8).cursor_pointer().when(i === this.choiceAt, (x) => x.bg(t.selected)).hover((x) => x.bg(t.hover))
          .on_click((_e, cx) => { this.choiceAt = i; this.choose(c.id, cx); })
          .child(h_flex().size(16).flex_none().items_center().justify_center().when(Boolean(c.icon), (x) => x.child(svg(c.icon).size(16).text_color(c.id === "remove" ? t.ansi1 : t.muted))))
          .child(v_flex().min_w(0)
            .child(div().text_size(13).text_color(c.id === "remove" ? t.ansi1 : t.foreground).child(c.label))
            .child(div().text_size(11.5).text_color(t.dim).child(c.hint)))))))
      .child(this.actions(this.confirming
        ? [this.button("fin-back", "Back", "secondary", (_e, cx) => { this.confirming = false; cx.notify(); }),
           this.button("fin-remove", "Remove worktree", "danger", (_e, cx) => this.choose("remove", cx))]
        : [this.button("fin-close", "Close", "secondary", () => this.close())]));
  }
}
