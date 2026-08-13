import assert from "node:assert/strict";
import test from "node:test";

const xterm = await import("@xterm/headless");
const { visibleWidth } = await import("@earendil-works/pi-tui");
const { createTaktLiveWidget, renderTaktProjectStack, renderTaktTerminal } = await import("../lib/takt-live-panel.ts");
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
    running: 1,
    pending: 0,
    blocked: 0,
    failed: 0,
    completed: 0,
    stale: 0,
    runs: [{ slug: "run-b", task: "repo-b task", workflow: "default", status: "running" }],
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

test("project stack shows input mode even with no active sessions", () => {
  const lines = renderTaktProjectStack([], 40, "takt");
  assert.equal(lines[0], "input: pi | [takt] | pi-auto");
  assert.ok(lines.some((line) => line.includes("no active sessions")));
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
        running: 1,
        pending: 0,
        blocked: 0,
        failed: 0,
        completed: 0,
        stale: 0,
        runs: [{ slug: "run", task: "docs", workflow: "default", status: "running" }],
      },
    },
  ], width);

  assert.ok(lines.length > 0);
  for (const [index, line] of lines.entries()) {
    assert.ok(visibleWidth(line) <= width, `line ${index} exceeds ${width}: ${visibleWidth(line)} columns`);
  }
});
