import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadTaktProfiles,
  normalizeProfileName,
  saveTaktProfiles,
} from "../lib/takt-profile-registry.ts";

test("profile registry normalizes names and project paths", () => {
  assert.equal(normalizeProfileName("@Pi-Docs"), "pi-docs");

  const root = mkdtempSync(join(tmpdir(), "pi-takt-profile-"));
  const file = join(root, "profiles.json");
  saveTaktProfiles([
    { name: "@Pi-Docs", cwd: root, preset: " pi-docs " },
    { name: "PI-DOCS", cwd: join(root, "duplicate") },
  ], file);

  assert.deepEqual(loadTaktProfiles(file), [
    { name: "pi-docs", cwd: root, preset: "pi-docs" },
  ]);
});

test("profile registry skips malformed entries and persists portable JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-profile-"));
  const file = join(root, "profiles.json");
  writeFileSync(file, JSON.stringify({
    version: 1,
    profiles: [
      { name: "valid", cwd: root, preset: "pi-docs" },
      { name: "bad name", cwd: root },
      { cwd: root },
    ],
  }));

  assert.deepEqual(loadTaktProfiles(file), [
    { name: "valid", cwd: root, preset: "pi-docs" },
  ]);
  assert.match(readFileSync(file, "utf8"), /valid/);
});
