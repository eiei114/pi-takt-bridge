import assert from "node:assert/strict";
import test from "node:test";

const xterm = await import("@xterm/headless");
const { createTaktLiveWidget, renderTaktTerminal } = await import("../lib/takt-live-panel.ts");
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
