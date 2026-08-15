import assert from "node:assert/strict";
import test from "node:test";

const xterm = await import("@xterm/headless");
const { visibleWidth } = await import("@earendil-works/pi-tui");
const { createTaktLiveWidget, createTaktProjectStackWidget, renderTaktProjectStack, renderTaktTerminal } = await import("../lib/takt-live-panel.ts");
const Terminal = xterm.default?.Terminal ?? xterm.Terminal;

test("live widget renders the PTY screen instead of raw cursor escapes", async () => {
  const terminal = new Terminal({ cols: 24, rows: 4, allowProposedApi: true });
  await new Promise((resolve) => {
    terminal.write("\u001b[31mRED\u001b[0m\r\nplain\u001b[2;5Hcursor", resolve);
  });

  const lines = renderTaktTerminal(terminal);
  assert.match(lines[0], /RED/);
  assert.match(lines[1], /plai/);
  assert.ok(lines.some((line) => line.includes("\u001b[")));
  assert.ok(!lines.some((line) => line.includes("\u001b[2;5H")));
  terminal.dispose();
});

test("live widget keeps Pi focus and shows the current TAKT screen", async () => {
  const terminal = new Terminal({ cols: 24, rows: 20, allowProposedApi: true });
  await new Promise((resolve) => terminal.write("first\r\nsecond", resolve));
  let listener;
  const runner = {
    terminal,
    subscribe(callback) {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    resize() {},
  };
  const widget = createTaktLiveWidget(runner, { requestRender() {} });

  const lines = widget.render(24);
  assert.ok(lines.some((line) => line.includes("first")));
  assert.ok(lines.some((line) => line.includes("second")));
  assert.ok(!lines.some((line) => line.includes("\u001b_pi:c\u0007")));
  assert.equal(typeof listener, "function");
  widget.dispose();
  terminal.dispose();
});

test("project stack keeps live screens and external project status together", async () => {
  const liveTerminal = new Terminal({ cols: 30, rows: 8, allowProposedApi: true });
  await new Promise((resolve) => liveTerminal.write("repo-a live output", resolve));
  const liveRunner = {
    terminal: liveTerminal,
    hasSession: true,
    isRunning: true,
    resize() {},
  };
  const observedSummary = {
    cwd: "C:/repo-b",
    status: "live",
    running: 1,
    pending: 0,
    blocked: 0,
    failed: 0,
    completed: 0,
    stale: 0,
    runs: [{ slug: "run-b", task: "repo-b task", workflow: "default", status: "running", sessionStatus: "live" }],
  };

  const lines = renderTaktProjectStack([
    { id: "b", label: "repo-b", cwd: "C:/repo-b", summary: observedSummary },
    { id: "a", label: "repo-a", cwd: "C:/repo-a", runner: liveRunner },
  ], 30);

  assert.ok(lines[0]?.includes("input:") && lines[0]?.includes("[pi]"));
  assert.ok(lines.findIndex((line) => line.includes("[repo-a]")) < lines.findIndex((line) => line.includes("[repo-b]")));
  assert.ok(lines.some((line) => line.includes("repo-a live output")));
  assert.ok(lines.some((line) => line.includes("external TAKT session")));

  const autoLines = renderTaktProjectStack([
    { id: "a", label: "repo-a", cwd: "C:/repo-a", runner: liveRunner },
  ], 30, "pi-auto");
  assert.ok(autoLines[0]?.includes("[pi-auto]"));
  liveTerminal.dispose();
});

test("project stack keeps requesting renders while a live PTY screen changes", async () => {
  const terminal = new Terminal({ cols: 30, rows: 8, allowProposedApi: true });
  const runner = {
    terminal,
    hasSession: true,
    isRunning: true,
    resize() {},
    subscribe() {
      return () => {};
    },
  };
  const source = {
    getProjects() {
      return [{ id: "live", label: "live", cwd: "C:/live", runner, stage: "running" }];
    },
    getInputMode() {
      return "pi-auto";
    },
    subscribe() {
      return () => {};
    },
  };
  let renders = 0;
  let widget;
  const frames = [];
  widget = createTaktProjectStackWidget(source, {
    requestRender() {
      renders += 1;
      frames.push(widget.render(30));
    },
  });

  await new Promise((resolve) => terminal.write("live output", resolve));
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.ok(renders > 0);
  assert.ok(frames.some((frame) => frame.some((line) => line.includes("live output"))));

  widget.dispose();
  const rendersAfterDispose = renders;
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(renders, rendersAfterDispose);
  terminal.dispose();
});

test("project stack shows input mode even with no active sessions", () => {
  const lines = renderTaktProjectStack([], 40, "takt");
  assert.equal(lines[0], "input: pi | [takt] | pi-auto");
  assert.ok(lines.some((line) => line.includes("no active sessions")));
});

test("project stack hides quiet observed pending activity after the inactivity TTL", () => {
  const now = Date.parse("2026-08-14T01:00:00.000Z");
  const project = {
    id: "pending",
    label: "pending",
    cwd: "C:/pending",
    summary: {
      cwd: "C:/pending",
      status: "completed",
      running: 0,
      pending: 1,
      blocked: 0,
      failed: 0,
      completed: 0,
      stale: 0,
      activityAt: "2026-08-14T00:00:00.000Z",
      runs: [],
    },
  };

  const lines = renderTaktProjectStack([project], 80, "pi", { now });
  assert.ok(lines.every((line) => !line.includes("[pending]")));
  assert.ok(lines.some((line) => line.includes("no active sessions")));
});

test("project stack keeps fresh observed pending activity visible", () => {
  const now = Date.parse("2026-08-14T01:00:00.000Z");
  const lines = renderTaktProjectStack([{
    id: "pending",
    label: "pending",
    cwd: "C:/pending",
    summary: {
      cwd: "C:/pending",
      status: "completed",
      running: 0,
      pending: 1,
      blocked: 0,
      failed: 0,
      completed: 0,
      stale: 0,
      activityAt: "2026-08-14T00:45:00.000Z",
      runs: [],
    },
  }], 80, "pi", { now });

  assert.ok(lines.some((line) => line.includes("[pending]")));
  assert.ok(lines.some((line) => line.includes("0 running · 1 pending · 0 blocked · 0 failed · 0 stale")));
});

test("project stack hides bridge sessions after stop, failure, or natural completion", () => {
  const runner = {
    terminal: undefined,
    hasSession: true,
    isRunning: false,
    resize() {},
  };

  for (const stage of ["stopped", "failed", "completed"]) {
    const lines = renderTaktProjectStack([
      { id: "finished", label: "finished", cwd: "C:/finished", runner, stage },
    ], 40);
    assert.ok(lines.every((line) => !line.includes("[finished]")));
    assert.ok(lines.some((line) => line.includes("no active sessions")));
  }
});

test("project stack keeps a live PTY when only a historical run is completed", () => {
  const lines = renderTaktProjectStack([
    {
      id: "finished",
      label: "finished",
      cwd: "C:/finished",
      runner: {
        terminal: undefined,
        hasSession: true,
        isRunning: true,
        resize() {},
      },
      stage: "running",
      summary: {
        cwd: "C:/finished",
        status: "completed",
        running: 0,
        pending: 0,
        blocked: 0,
        failed: 0,
        completed: 1,
        stale: 0,
        runs: [{
          slug: "finished-run",
          task: "finished task",
          workflow: "default",
          status: "completed",
          sessionStatus: "completed",
        }],
      },
    },
  ], 40);

  assert.ok(lines.some((line) => line.includes("[finished]")));
});

test("project stack shows only the current project while TAKT is preparing", () => {
  const runner = {
    terminal: undefined,
    hasSession: true,
    isRunning: true,
    resize() {},
  };
  const lines = renderTaktProjectStack([
    { id: "other", label: "other", cwd: "C:/other", runner },
    { id: "current", label: "current", cwd: "C:/current", isCurrent: true, runner },
  ], 60);

  assert.ok(lines.some((line) => line.includes("[current]")));
  assert.ok(lines.some((line) => line.includes("preparing")));
  assert.ok(lines.every((line) => !line.includes("[other]")));
});

test("project stack overlays long prompt previews while pasting", async () => {
  const liveTerminal = new Terminal({ cols: 40, rows: 8, allowProposedApi: true });
  await new Promise((resolve) => liveTerminal.write("HUGE PASTED BODY SHOULD BE HIDDEN", resolve));
  const liveRunner = {
    terminal: liveTerminal,
    hasSession: true,
    isRunning: true,
    resize() {},
  };
  const lines = renderTaktProjectStack([
    {
      id: "a",
      label: "takt",
      cwd: "C:/repo",
      runner: liveRunner,
      stage: "pasting",
      promptPreview: "## Issue #1331\n…(12 more lines, 900 chars)\n## Done",
    },
  ], 40);
  assert.ok(lines.some((line) => line.includes("stage:pasting")));
  assert.ok(lines.some((line) => line.includes("prompt preview:")));
  assert.ok(lines.some((line) => line.includes("Issue #1331")));
  assert.ok(!lines.some((line) => line.includes("HUGE PASTED BODY SHOULD BE HIDDEN")));
  liveTerminal.dispose();
});

test("project stack truncates long paths to the Pi widget width", () => {
  const width = 51;
  const lines = renderTaktProjectStack([
    {
      id: "long-path",
      label: "pi-docs",
      cwd: "C:/Users/Keisu/Projects/OSS/takt",
      summary: {
        cwd: "C:/Users/Keisu/Projects/OSS/takt",
        status: "live",
        running: 1,
        pending: 0,
        blocked: 0,
        failed: 0,
        completed: 0,
        stale: 0,
        runs: [{ slug: "run", task: "docs", workflow: "default", status: "running", sessionStatus: "live" }],
      },
    },
  ], width);

  assert.ok(lines.length > 0);
  for (const [index, line] of lines.entries()) {
    assert.ok(visibleWidth(line) <= width, `line ${index} exceeds ${width}: ${visibleWidth(line)} columns`);
  }
});
