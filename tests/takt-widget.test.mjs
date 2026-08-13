import assert from "node:assert/strict";
import test from "node:test";

const { renderTaktDetails, renderTaktWidget } = await import("../lib/takt-widget.ts");

const summary = {
  cwd: "C:/workspace",
  running: 2,
  pending: 3,
  blocked: 1,
  failed: 0,
  completed: 2,
  stale: 0,
  runs: [
    { slug: "one", task: "Implement ACP bridge", workflow: "default", status: "running", currentStep: "tests" },
    { slug: "two", task: "Update docs", workflow: "default", status: "running" },
  ],
};

test("widget renders a compact multi-run summary", () => {
  assert.deepEqual(renderTaktWidget(summary), [
    "TAKT ● 2 running · 3 pending · 1 blocked",
    "↳ running: Implement ACP bridge · tests",
    "↳ running: Update docs",
  ]);
});

test("idle widget is cleared and details remain available", () => {
  const idle = { ...summary, running: 0, pending: 0, blocked: 0, failed: 0, stale: 0, runs: [] };
  assert.equal(renderTaktWidget(idle), undefined);
  assert.deepEqual(renderTaktDetails(idle).slice(0, 7), [
    "TAKT status",
    "project: C:/workspace",
    "running: 0",
    "pending: 0",
    "blocked: 0",
    "failed: 0",
    "completed: 2",
  ]);
});

test("widget reports failures without embedding controls", () => {
  const failed = {
    ...summary,
    running: 0,
    pending: 0,
    blocked: 0,
    failed: 1,
    stale: 1,
    lastError: "provider unavailable",
    runs: [{ slug: "bad", task: "Retry me", workflow: "default", status: "stale" }],
  };
  const lines = renderTaktWidget(failed);
  assert.equal(lines[0], "TAKT ⚠ 0 running · 0 pending · 0 blocked");
  assert.match(lines.at(-1), /provider unavailable/);
  assert.ok(lines.every((line) => !line.includes("Enter") && !line.includes("retry")));
});
