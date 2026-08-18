import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, accessSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts", "ensure-node-pty-helpers.mjs");

test("ensure-node-pty-helpers makes spawn-helper executable", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-bridge-pty-helper-"));
  const helperDir = join(root, "node_modules", "node-pty", "prebuilds", "darwin-arm64");
  mkdirSync(helperDir, { recursive: true });
  const helperPath = join(helperDir, "spawn-helper");
  writeFileSync(helperPath, "#!/bin/sh\necho ok\n", "utf8");
  chmodSync(helperPath, 0o644);

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /chmod \+x on 1 spawn-helper/);
  assert.doesNotThrow(() => accessSync(helperPath, constants.X_OK));
});

test("ensure-node-pty-helpers no-ops when node-pty is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-bridge-pty-helper-missing-"));
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, "");
});

test("repo node-pty spawn-helper is executable after ensure script", () => {
  const helperPath = join(
    repoRoot,
    "node_modules",
    "node-pty",
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
  if (!existsSync(helperPath)) {
    return;
  }
  chmodSync(helperPath, 0o644);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotThrow(() => accessSync(helperPath, constants.X_OK));
});
