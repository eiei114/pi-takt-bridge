import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Runtime-v1 (.takt/runtime.yaml) patching for per-step model selection.
 *
 * TAKT contract (issue #1136): `version: 1` + optional `provider` section with
 * `defaults`, `profiles`, and `targets`. Target keys are `<workflow>/<step>`
 * (qualified) or `<step>`; assignments reference a named profile — inline
 * provider/model in targets is not part of the schema. Project values win
 * over `~/.takt/runtime.yaml`, so the bridge only ever edits the project file
 * and preserves unrelated entries.
 */

export interface StepModelSelection {
  targetKey: string;
  /** Fully qualified Pi model reference, e.g. openai-codex/gpt-5-codex. */
  modelRef: string;
}

interface RuntimeProviderFile {
  version: 1;
  companion?: { enabled?: boolean };
  provider?: {
    defaults?: { profile?: string; ladder?: string[] };
    profiles?: Record<string, Record<string, unknown>>;
    targets?: {
      personas?: Record<string, unknown>;
      tags?: Record<string, unknown>;
      steps?: Record<string, unknown>;
      internal_agents?: Record<string, unknown>;
      companions?: Record<string, unknown>;
    };
    auto_routing?: Record<string, unknown>;
  };
}

/** Deterministic profile name for a Pi model selection. */
export function bridgeProfileName(modelRef: string): string {
  const sanitized = modelRef.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `bridge-${sanitized}`;
}

export function runtimeYamlPath(cwd: string): string {
  return join(cwd, ".takt", "runtime.yaml");
}

export function readRuntimeYaml(cwd: string): RuntimeProviderFile | undefined {
  const filePath = runtimeYamlPath(cwd);
  if (!existsSync(filePath)) {
    return undefined;
  }
  const raw = parseYaml(readFileSync(filePath, "utf8"));
  if (raw === null || raw === undefined) {
    return undefined;
  }
  assertRuntimeShape(raw);
  return raw as RuntimeProviderFile;
}

function assertRuntimeShape(value: unknown): void {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    (value as Record<string, unknown>).version !== 1
  ) {
    throw new Error(".takt/runtime.yaml is not a version: 1 runtime file; refusing to merge");
  }
}

/**
 * Merge step model selections into the project runtime file and write it.
 *
 * - Profiles are generated deterministically (`bridge-<model>`) and replaced
 *   wholesale on name collision, matching TAKT's own merge semantics.
 * - Existing targets.steps entries for other workflows are preserved;
 *   selections overwrite same-key entries.
 * - `provider.defaults` must exist once the section is active (schema rule).
 *   When neither project nor an explicit default exists the first generated
 *   profile becomes the default so untargeted steps keep a Pi assignment.
 */
export function applyStepModelSelections(
  cwd: string,
  workflowName: string,
  selections: readonly StepModelSelection[],
  now = new Date(),
): { path: string; profiles: string[]; updatedTargets: number } {
  if (selections.length === 0) {
    throw new Error("No step model selections to apply");
  }

  const doc: RuntimeProviderFile = readRuntimeYaml(cwd) ?? { version: 1 };
  doc.provider ??= {};
  doc.provider.profiles ??= {};
  doc.provider.targets ??= {};
  doc.provider.targets.steps ??= {};

  const appliedProfiles = new Set<string>();
  for (const selection of selections) {
    const profileName = bridgeProfileName(selection.modelRef);
    doc.provider.profiles[profileName] = { provider: "pi", model: selection.modelRef };
    appliedProfiles.add(profileName);
    doc.provider.targets.steps[qualifiedTarget(workflowName, selection.targetKey)] = {
      profile: profileName,
    };
  }

  // Keep the schema's "active section requires defaults" invariant satisfied.
  if (doc.provider.defaults?.profile === undefined && doc.provider.defaults?.ladder === undefined) {
    doc.provider.defaults = { ...doc.provider.defaults, profile: [...appliedProfiles][0] };
  }

  mkdirSync(join(cwd, ".takt"), { recursive: true });

  const header = [
    "# Per-step model assignments managed by pi-takt-bridge (/takt:models).",
    `# Last updated: ${now.toISOString()}`,
    "# Manual entries below are preserved; bridge-generated profiles start with 'bridge-'.",
    "",
  ];

  writeFileSync(runtimeYamlPath(cwd), `${header.join("\n")}${stringifyYaml(doc)}`, "utf8");
  return {
    path: runtimeYamlPath(cwd),
    profiles: [...appliedProfiles],
    updatedTargets: selections.length,
  };
}

function qualifiedTarget(workflowName: string, targetKey: string): string {
  // Selections already carry "<workflow>/<step>" keys from step extraction.
  return targetKey.includes("/") ? targetKey : `${workflowName}/${targetKey}`;
}
