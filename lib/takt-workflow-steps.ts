import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { spawnCommand } from "./process-control.ts";

/** Workflow layers TAKT resolves in project → user → builtin order. */
export type TaktWorkflowLayer = "project" | "user" | "builtin";

export interface ResolvedWorkflowFile {
  name: string;
  layer: TaktWorkflowLayer;
  path: string;
}

export interface WorkflowStepRef {
  /** Runtime target key written into runtime.yaml targets.steps. */
  targetKey: string;
  stepName: string;
  /** Engine-local workflow the step belongs to after expansion. */
  workflowName: string;
  kind: string;
  /** Step already pins provider/model inline in workflow YAML. */
  pinnedInline: boolean;
  /** True when the step came from expanding a workflow_call one level down. */
  nested: boolean;
  /** Set for unexpandable workflow_call steps; model selection is unavailable. */
  unresolvedCall?: string;
}

let cachedTaktRootPromise: Promise<string | undefined> | undefined;

export function resetTaktRootCache(): void {
  cachedTaktRootPromise = undefined;
}

/**
 * Locate the TAKT install root (the directory holding `builtins/`). Explicit
 * command paths are walked upward; bare commands fall back to the global npm
 * root, then to the command shim directory. Cached because install roots do
 * not change mid-session.
 */
export function resolveTaktInstallRoot(command = "takt"): Promise<string | undefined> {
  cachedTaktRootPromise ??= detectTaktInstallRoot(command).catch(() => undefined);
  return cachedTaktRootPromise;
}

async function detectTaktInstallRoot(command: string): Promise<string | undefined> {
  if (/[\\/]/.test(command)) {
    return findAncestorWithBuiltins(command);
  }
  const npmGlobalRoot = await runNpmRootG();
  if (npmGlobalRoot !== undefined && existsSync(join(npmGlobalRoot, "takt", "builtins"))) {
    return join(npmGlobalRoot, "takt");
  }
  const shimDir = await findCommandDirectory(command);
  if (shimDir !== undefined) {
    return findAncestorWithBuiltins(join(shimDir, command));
  }
  return undefined;
}

function findAncestorWithBuiltins(startPath: string): string | undefined {
  let current = startPath.replace(/[\\/]+$/, "");
  let lastSeparator = Math.max(current.lastIndexOf("/"), current.lastIndexOf("\\"));
  while (lastSeparator > 0) {
    current = current.slice(0, lastSeparator);
    if (existsSync(join(current, "builtins"))) {
      return current;
    }
    lastSeparator = Math.max(current.lastIndexOf("/"), current.lastIndexOf("\\"));
  }
  return undefined;
}

function runNpmRootG(): Promise<string | undefined> {
  return new Promise((resolvePromise) => {
    const resolved = process.platform === "win32" ? "npm.cmd" : "npm";
    let child: ReturnType<typeof spawnCommand>;
    try {
      child = spawnCommand(resolved, ["root", "-g"], {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolvePromise(undefined);
      return;
    }
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", () => resolvePromise(undefined));
    child.once("close", (code) => {
      const root = stdout.trim().split(/\r?\n/)[0];
      resolvePromise(code === 0 && root.length > 0 ? root : undefined);
    });
  });
}

function findCommandDirectory(command: string): Promise<string | undefined> {
  return new Promise((resolvePromise) => {
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    let child: ReturnType<typeof spawnCommand>;
    try {
      child = spawnCommand(lookup, [command], {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolvePromise(undefined);
      return;
    }
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", () => resolvePromise(undefined));
    child.once("close", () => {
      const firstLine = stdout.trim().split(/\r?\n/)[0];
      if (firstLine === undefined || firstLine.length === 0) {
        resolvePromise(undefined);
        return;
      }
      const separator = Math.max(firstLine.lastIndexOf("/"), firstLine.lastIndexOf("\\"));
      resolvePromise(separator > 0 ? firstLine.slice(0, separator) : undefined);
    });
  });
}

/** Resolve a workflow name against project, user-global, then builtin layers. */
export async function resolveWorkflowFile(
  cwd: string,
  name: string,
  taktCommand = "takt",
): Promise<ResolvedWorkflowFile | undefined> {
  const safeName = sanitizeWorkflowName(name);
  if (safeName.length === 0) {
    return undefined;
  }

  const projectPath = findWorkflowFileInDir(join(cwd, ".takt", "workflows"), safeName);
  if (projectPath !== undefined) {
    return { name: safeName, layer: "project", path: projectPath };
  }

  const userPath = findWorkflowFileInDir(join(homedir(), ".takt", "workflows"), safeName);
  if (userPath !== undefined) {
    return { name: safeName, layer: "user", path: userPath };
  }

  const taktRoot = await resolveTaktInstallRoot(taktCommand);
  if (taktRoot !== undefined) {
    for (const language of ["en", "ja"]) {
      const builtinPath = findWorkflowFileInDir(
        join(taktRoot, "builtins", language, "workflows"),
        safeName,
      );
      if (builtinPath !== undefined) {
        return { name: safeName, layer: "builtin", path: builtinPath };
      }
    }
  }
  return undefined;
}

/** List workflow names visible to TAKT: project + user layers, then builtin en/ja. */
export async function listWorkflowNames(
  cwd: string,
  taktCommand = "takt",
): Promise<Array<{ name: string; layer: TaktWorkflowLayer }>> {
  const found = new Map<string, TaktWorkflowLayer>();
  const collectDir = (dir: string, layer: TaktWorkflowLayer): void => {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) {
        continue;
      }
      found.set(entry.name.replace(/\.ya?ml$/i, ""), layer);
    }
  };

  collectDir(join(cwd, ".takt", "workflows"), "project");
  collectDir(join(homedir(), ".takt", "workflows"), "user");
  const taktRoot = await resolveTaktInstallRoot(taktCommand);
  if (taktRoot !== undefined) {
    for (const language of ["en", "ja"]) {
      collectDir(join(taktRoot, "builtins", language, "workflows"), "builtin");
    }
  }
  return [...found.entries()]
    .map(([name, layer]) => ({ name, layer }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function sanitizeWorkflowName(name: string): string {
  return name.trim().replace(/[\\/]/g, "");
}

function findWorkflowFileInDir(dir: string, name: string): string | undefined {
  for (const extension of [".yaml", ".yml"]) {
    const candidate = join(dir, `${name}${extension}`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Collect selectable steps for a workflow. Top-level workflow_call steps
 * expand exactly one level so nested steps stay individually addressable via
 * `<workflow>/<step>` runtime targets; deeper or unresolvable calls surface
 * as explicit `unresolvedCall` markers without blocking the rest.
 */
export async function collectSelectableSteps(
  cwd: string,
  workflowName: string,
  taktCommand = "takt",
): Promise<{ root: ResolvedWorkflowFile; steps: WorkflowStepRef[] }> {
  const root = await resolveWorkflowFile(cwd, workflowName, taktCommand);
  if (root === undefined) {
    throw new Error(
      `Workflow "${workflowName}" was not found in .takt/workflows, ~/.takt/workflows, or TAKT builtins`,
    );
  }

  const steps: WorkflowStepRef[] = [];
  const expandedCalls = new Set<string>();

  const processParsed = async (
    parsed: ParsedWorkflowFile,
    nested: boolean,
  ): Promise<void> => {
    for (const raw of parsed.steps) {
      if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
        continue;
      }
      const stepName = raw.name.trim();
      const kind = typeof raw.kind === "string" ? raw.kind : "agent";
      if (kind === "system") {
        continue;
      }
      const pinnedInline = raw.provider !== undefined || raw.model !== undefined;

      if (kind === "workflow_call") {
        const callTarget = typeof raw.call === "string" ? raw.call.trim() : "";
        if (!nested && callTarget.length > 0 && !expandedCalls.has(callTarget)) {
          expandedCalls.add(callTarget);
          const called = await resolveWorkflowFile(cwd, callTarget, taktCommand);
          if (called !== undefined) {
            await processParsed(parseWorkflowFile(called.path), true);
            continue;
          }
        }
        steps.push({
          targetKey: `${parsed.name}/${stepName}`,
          stepName,
          workflowName: parsed.name,
          kind,
          pinnedInline,
          nested,
          ...(callTarget.length > 0 ? { unresolvedCall: callTarget } : {}),
        });
        continue;
      }

      steps.push({
        targetKey: `${parsed.name}/${stepName}`,
        stepName,
        workflowName: parsed.name,
        kind,
        pinnedInline,
        nested,
      });
    }
  };

  await processParsed(parseWorkflowFile(root.path), false);

  // Nested expansion can duplicate step names when the same sub-workflow is
  // called twice; keep the first occurrence per runtime target key.
  const unique = new Map(steps.map((step) => [step.targetKey, step]));
  return { root, steps: [...unique.values()] };
}

interface ParsedWorkflowFile {
  name: string;
  steps: Array<Record<string, unknown>>;
}

function parseWorkflowFile(filePath: string): ParsedWorkflowFile {
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Workflow YAML could not be parsed (${filePath}): ${errorMessage(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Workflow file is not a mapping: ${filePath}`);
  }
  return {
    name: typeof parsed.name === "string" && parsed.name.trim().length > 0
      ? parsed.name.trim()
      : filePath,
    steps: Array.isArray(parsed.steps) ? parsed.steps.filter(isRecord) : [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
