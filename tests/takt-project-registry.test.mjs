import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { dedupeProjectPaths, loadProjectPaths, normalizeProjectPath, saveProjectPaths } = await import("../lib/takt-project-registry.ts");

test("project registry normalizes and deduplicates folder paths", () => {
  const base = mkdtempSync(join(tmpdir(), "pi-takt-bridge-projects-"));
  const nested = join(base, "repo");
  const paths = dedupeProjectPaths([nested, `"${nested}"`]);
  assert.deepEqual(paths, [nested]);
  assert.equal(normalizeProjectPath(".", base), base);
});

test("project registry persists only normalized project paths", () => {
  const base = mkdtempSync(join(tmpdir(), "pi-takt-bridge-projects-"));
  const registry = join(base, "config", "projects.json");
  const repo = join(base, "repo");
  saveProjectPaths([repo, repo], registry);
  assert.deepEqual(loadProjectPaths(registry), [repo]);
  assert.match(readFileSync(registry, "utf8"), /"version": 1/);
});
