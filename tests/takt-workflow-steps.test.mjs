import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  collectSelectableSteps,
  listWorkflowNames,
  resolveWorkflowFile,
  resetTaktRootCache,
} = await import("../lib/takt-workflow-steps.ts");

function makeProject() {
  return mkdtempSync(join(tmpdir(), "pi-takt-bridge-steps-"));
}

const SIMPLE_WORKFLOW = [
  "name: simple",
  "description: test workflow",
  "max_steps: 10",
  "initial_step: develop",
  "steps:",
  "  - name: develop",
  "    kind: agent",
  "    instruction: build it",
  "  - name: review",
  "    kind: agent",
  "    provider: anthropic",
  "    model: claude-opus-4-8",
  "    instruction: review it",
  "  - name: gate",
  "    kind: system",
  "",
].join("\n");

test("collectSelectableSteps extracts agent steps and marks pinned models", async () => {
  const project = makeProject();
  const workflows = join(project, ".takt", "workflows");
  mkdirSync(workflows, { recursive: true });
  writeFileSync(join(workflows, "simple.yaml"), SIMPLE_WORKFLOW);

  const { root, steps } = await collectSelectableSteps(project, "simple");
  assert.equal(root.layer, "project");
  assert.deepEqual(steps.map((step) => step.stepName), ["develop", "review"]);
  assert.ok(steps.every((step) => step.targetKey === `simple/${step.stepName}`));
  assert.equal(steps[0].pinnedInline, false);
  assert.equal(steps[1].pinnedInline, true);
});

test("collectSelectableSteps expands one level of workflow_call and flags unresolved calls", async () => {
  const project = makeProject();
  const workflows = join(project, ".takt", "workflows");
  mkdirSync(workflows, { recursive: true });
  writeFileSync(join(workflows, "root.yaml"), [
    "name: root",
    "steps:",
    "  - name: develop",
    "    kind: workflow_call",
    "    call: sub-core",
    "  - name: missing-call",
    "    kind: workflow_call",
    "    call: not-anywhere",
  ].join("\n"));
  writeFileSync(join(workflows, "sub-core.yaml"), [
    "name: sub-core",
    "steps:",
    "  - name: plan",
    "    kind: agent",
    "  - name: inner-system",
    "    kind: system",
  ].join("\n"));

  const { steps } = await collectSelectableSteps(project, "root");
  // The resolvable call expands into the called workflow's own agent steps.
  assert.deepEqual(
    steps.filter((step) => step.unresolvedCall === undefined).map((step) => step.targetKey),
    ["sub-core/plan"],
  );
  assert.equal(steps[0].nested, true);
  // The unresolvable call stays visible as an explicit marker.
  const unresolved = steps.find((step) => step.unresolvedCall !== undefined);
  assert.equal(unresolved?.unresolvedCall, "not-anywhere");
});

test("resolveWorkflowFile prefers project over user and builtin layers", async () => {
  const project = makeProject();
  const fakeTaktRoot = join(project, "takt-root");
  const builtinDir = join(fakeTaktRoot, "builtins", "en", "workflows");
  mkdirSync(builtinDir, { recursive: true });
  mkdirSync(join(project, ".takt", "workflows"), { recursive: true });
  writeFileSync(join(builtinDir, "dual.yaml"), "name: dual\nsteps: []\n");
  writeFileSync(join(project, ".takt", "workflows", "dual.yml"), "name: dual\nsteps: []\n");
  resetTaktRootCache();
  try {
    const resolved = await resolveWorkflowFile(project, "dual", join(fakeTaktRoot, "bin", "takt"));
    assert.equal(resolved?.layer, "project");
    assert.ok(resolved?.path.endsWith("dual.yml"));

    const builtin = await resolveWorkflowFile(project, "missing-project-flow", join(fakeTaktRoot, "bin", "takt"));
    assert.equal(builtin?.layer, undefined);
    writeFileSync(join(builtinDir, "flow-builtin.yaml"), "name: flow-builtin\nsteps: []\n");
    const builtinHit = await resolveWorkflowFile(project, "flow-builtin", join(fakeTaktRoot, "bin", "takt"));
    assert.equal(builtinHit?.layer, "builtin");
  } finally {
    resetTaktRootCache();
    rmSync(project, { recursive: true, force: true });
  }
});

test("listWorkflowNames merges layers with project precedence", async () => {
  const project = makeProject();
  try {
    const workflows = join(project, ".takt", "workflows");
    mkdirSync(workflows, { recursive: true });
    writeFileSync(join(workflows, "mine.yaml"), "name: mine\nsteps: []\n");
    const names = await listWorkflowNames(project);
    const mine = names.find((entry) => entry.name === "mine");
    assert.equal(mine?.layer, "project");
    // Builtin names appear only when a real TAKT install is discoverable; the
    // assertion here just guards the shape of the returned entries.
    assert.ok(names.every((entry) => entry.name.length > 0));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
