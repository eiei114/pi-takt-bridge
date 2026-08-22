import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";

const {
  applyStepModelSelections,
  bridgeProfileName,
  readRuntimeYaml,
  runtimeYamlPath,
} = await import("../lib/takt-runtime-yaml.ts");

function makeProject() {
  return mkdtempSync(join(tmpdir(), "pi-takt-bridge-runtime-"));
}

const SELECTIONS = [
  { targetKey: "root/develop", modelRef: "openai-codex/gpt-5-codex" },
  { targetKey: "sub-core/plan", modelRef: "anthropic/claude-opus-4-8" },
];

test("bridgeProfileName is deterministic and filesystem safe", () => {
  assert.equal(bridgeProfileName("openai-codex/gpt-5.6-luna:max"), "bridge-openai-codex-gpt-5-6-luna-max");
  assert.equal(bridgeProfileName("openai-codex/gpt-5.6-luna:max"), bridgeProfileName("openai-codex//gpt-5.6-luna::max"));
});

test("applyStepModelSelections creates runtime.yaml with defaults when absent", () => {
  const project = makeProject();
  try {
    const result = applyStepModelSelections(project, "root", SELECTIONS);
    assert.equal(result.updatedTargets, 2);

    const doc = parseYaml(readFileSync(runtimeYamlPath(project), "utf8"));
    assert.equal(doc.version, 1);
    assert.ok(doc.provider.defaults.profile.startsWith("bridge-"));
    assert.deepEqual(doc.provider.profiles["bridge-openai-codex-gpt-5-codex"], {
      provider: "pi",
      model: "openai-codex/gpt-5-codex",
    });
    assert.deepEqual(doc.provider.targets.steps["root/develop"].profile, "bridge-openai-codex-gpt-5-codex");
    assert.deepEqual(doc.provider.targets.steps["sub-core/plan"].profile, "bridge-anthropic-claude-opus-4-8");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("applyStepModelSelections preserves unrelated entries and overwrites same keys", () => {
  const project = makeProject();
  try {
    const taktDir = join(project, ".takt");
    mkdirSync(taktDir, { recursive: true });
    writeFileSync(join(taktDir, "runtime.yaml"), [
      "version: 1",
      "provider:",
      "  defaults:",
      "    profile: default",
      "  profiles:",
      "    default:",
      "      provider: pi",
      "      model: openai-codex/gpt-5.6-luna:max",
      "    mine:",
      "      provider: cursor",
      "      model: composer-2.5",
      "  targets:",
      "    steps:",
      "      root/develop:",
      "        profile: mine",
      "      other/keep:",
      "        profile: default",
    ].join("\n"));

    applyStepModelSelections(project, "root", [
      { targetKey: "root/review", modelRef: "anthropic/claude-haiku-4-5" },
    ]);

    const doc = readRuntimeYaml(project);
    assert.equal(doc?.provider?.defaults.profile, "default"); // untouched
    assert.ok(doc?.provider?.profiles.default); // global-style profile kept
    assert.ok(doc?.provider?.profiles.mine);
    // Entries from other workflows survive untouched...
    assert.equal(doc?.provider?.targets.steps["other/keep"].profile, "default");
    // ...and so do earlier per-step selections for the same workflow.
    assert.equal(doc?.provider?.targets.steps["root/develop"].profile, "mine");
    // The new selection lands alongside them.
    assert.ok(doc?.provider?.targets.steps["root/review"].profile.startsWith("bridge-"));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("readRuntimeYaml rejects files that are not version 1", () => {
  const project = makeProject();
  try {
    const taktDir = join(project, ".takt");
    mkdirSync(taktDir, { recursive: true });
    writeFileSync(join(taktDir, "runtime.yaml"), "version: 2\nprovider: {}\n");
    assert.throws(() => readRuntimeYaml(project), /version: 1/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
