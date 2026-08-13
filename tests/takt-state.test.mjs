import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { classifyRunStatus, parseRunMeta, readRunSnapshots, resolveCommand, usesWindowsShell } = await import("../lib/takt-state.ts");

const validMeta = {
  task: "Add the bridge",
  workflow: "default",
  runSlug: "add-the-bridge",
  runRoot: ".takt/runs/add-the-bridge",
  reportDirectory: ".takt/runs/add-the-bridge/reports",
  contextDirectory: ".takt/runs/add-the-bridge/context",
  logsDirectory: ".takt/runs/add-the-bridge/logs",
  status: "running",
  startTime: "2026-08-13T00:00:00.000Z",
  currentStep: "implement",
  updatedAt: "2026-08-13T00:01:00.000Z",
};

test("parseRunMeta accepts TAKT metadata and rejects incomplete records", () => {
  const parsed = parseRunMeta(validMeta);
  assert.equal(parsed?.runSlug, "add-the-bridge");
  assert.equal(parsed?.currentStep, "implement");
  assert.equal(parseRunMeta({ ...validMeta, status: "unknown" }), undefined);
  assert.equal(parseRunMeta({ task: "missing required fields" }), undefined);
});

test("classifyRunStatus marks a running record stale only with a dead owner pid", () => {
  assert.equal(classifyRunStatus({ status: "completed" }), "completed");
  assert.equal(classifyRunStatus({ status: "running" }), "running");
  assert.equal(classifyRunStatus({ status: "running" }, 0), "stale");
});

test("readRunSnapshots ignores partial metadata and preserves active-first ordering", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-takt-bridge-state-"));
  const runs = join(cwd, ".takt", "runs");
  mkdirSync(join(runs, "active"), { recursive: true });
  mkdirSync(join(runs, "done"), { recursive: true });
  mkdirSync(join(runs, "partial"), { recursive: true });
  writeFileSync(join(runs, "active", "meta.json"), JSON.stringify({ ...validMeta, runSlug: "active" }));
  writeFileSync(
    join(runs, "done", "meta.json"),
    JSON.stringify({ ...validMeta, runSlug: "done", status: "completed", endTime: validMeta.updatedAt }),
  );
  writeFileSync(join(runs, "partial", "meta.json"), "{");

  const snapshots = readRunSnapshots(cwd);
  assert.deepEqual(snapshots.map((run) => run.slug), ["active", "done"]);
  assert.equal(snapshots[0].status, "running");
});

test("resolveCommand uses npm shims on Windows without changing explicit paths", () => {
  const resolved = resolveCommand("takt");
  if (process.platform === "win32") {
    assert.equal(resolved, "takt.cmd");
  } else {
    assert.equal(resolved, "takt");
  }
  assert.match(resolveCommand("C:/tools/takt"), /C:\/tools\/takt$/);
  assert.equal(usesWindowsShell("takt.cmd"), process.platform === "win32");
});
