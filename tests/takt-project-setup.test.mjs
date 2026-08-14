import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { setupProjectLocalTakt } = await import("../lib/takt-project-setup.ts");

test("project setup creates local TAKT directories and copies only the selected global preset", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-bridge-project-setup-"));
  const project = join(root, "project");
  const globalTakt = join(root, "global-takt");
  const globalPreset = join(globalTakt, "exec", "presets", "pi-docs.yaml");
  mkdirSync(project);
  mkdirSync(join(globalTakt, "exec", "presets"), { recursive: true });
  writeFileSync(globalPreset, "name: pi-docs\nworkers: []\n", "utf8");

  const result = setupProjectLocalTakt({
    cwd: project,
    preset: "pi-docs",
    globalTaktDir: globalTakt,
  });

  assert.equal(result.presetSource, "global");
  assert.deepEqual(result.copiedFiles, [join(project, ".takt", "exec", "presets", "pi-docs.yaml")]);
  assert.equal(readFileSync(join(project, ".takt", "exec", "presets", "pi-docs.yaml"), "utf8"), readFileSync(globalPreset, "utf8"));
  assert.equal(existsSync(join(project, ".takt", "workflows")), true);
  const gitignore = readFileSync(join(project, ".takt", ".gitignore"), "utf8");
  assert.match(gitignore, /!exec\/presets\/\*\*/);
});

test("project setup is idempotent and does not overwrite a project-local preset", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-bridge-project-setup-idempotent-"));
  const project = join(root, "project");
  const globalTakt = join(root, "global-takt");
  mkdirSync(join(project, ".takt", "exec", "presets"), { recursive: true });
  mkdirSync(join(globalTakt, "exec", "presets"), { recursive: true });
  writeFileSync(join(project, ".takt", "exec", "presets", "pi-docs.yaml"), "name: pi-docs\nsource: project\n", "utf8");
  writeFileSync(join(globalTakt, "exec", "presets", "pi-docs.yaml"), "name: pi-docs\nsource: global\n", "utf8");

  const result = setupProjectLocalTakt({ cwd: project, preset: "pi-docs", globalTaktDir: globalTakt });

  assert.equal(result.presetSource, "project");
  assert.deepEqual(result.copiedFiles, []);
  assert.match(readFileSync(result.presetPath, "utf8"), /source: project/);
});

test("project setup reports a missing global preset without copying unrelated global state", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-bridge-project-setup-missing-"));
  const project = join(root, "project");
  mkdirSync(project);

  const result = setupProjectLocalTakt({
    cwd: project,
    preset: "missing",
    copyGlobalPreset: true,
    globalTaktDir: join(root, "global-takt"),
  });

  assert.equal(result.presetSource, "missing");
  assert.equal(result.copiedFiles.length, 0);
  assert.equal(existsSync(result.presetPath), false);
  assert.equal(result.warnings.length, 1);
  assert.equal(existsSync(join(project, ".takt", "tasks.yaml")), false);
});
