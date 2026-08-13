import { execFile as execFileCallback } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { TaktRunMeta, TaktRunSnapshot, TaktSummary, TaktTaskItem, TaktStatus } from "./takt-types.ts";

const execFile = promisify(execFileCallback);
const MAX_LIST_OUTPUT = 1_000_000;

export interface TaktStateOptions {
  command?: string;
  now?: number;
}

export function parseRunMeta(value: unknown): TaktRunMeta | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const status = value.status;
  if (!isPersistedStatus(status)) {
    return undefined;
  }

  const requiredStrings = [
    "task",
    "workflow",
    "runSlug",
    "runRoot",
    "reportDirectory",
    "contextDirectory",
    "logsDirectory",
    "startTime",
  ];
  if (requiredStrings.some((key) => typeof value[key] !== "string" || value[key] === "")) {
    return undefined;
  }

  const result: TaktRunMeta = {
    task: value.task as string,
    workflow: value.workflow as string,
    runSlug: value.runSlug as string,
    runRoot: value.runRoot as string,
    reportDirectory: value.reportDirectory as string,
    contextDirectory: value.contextDirectory as string,
    logsDirectory: value.logsDirectory as string,
    status,
    startTime: value.startTime as string,
  };

  for (const key of ["reason", "endTime", "currentStep", "updatedAt"] as const) {
    if (typeof value[key] === "string") {
      result[key] = value[key] as string;
    }
  }
  if (isNonNegativeInteger(value.iterations)) {
    result.iterations = value.iterations;
  }
  if (isNonNegativeInteger(value.currentIteration)) {
    result.currentIteration = value.currentIteration;
  }
  if (value.phase === 1 || value.phase === 2 || value.phase === 3) {
    result.phase = value.phase;
  }
  if (isRecord(value.failure) && typeof value.failure.step === "string" && typeof value.failure.error === "string") {
    result.failure = { step: value.failure.step, error: value.failure.error };
  }

  return result;
}

export function classifyRunStatus(
  meta: Pick<TaktRunMeta, "status">,
  ownerPid?: number,
): TaktStatus {
  if (meta.status !== "running") {
    return meta.status;
  }
  if (ownerPid !== undefined && !isProcessAlive(ownerPid)) {
    return "stale";
  }
  return "running";
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function snapshotRun(meta: TaktRunMeta, ownerPid?: number): TaktRunSnapshot {
  const status = classifyRunStatus(meta, ownerPid);
  return {
    slug: meta.runSlug,
    task: meta.task,
    workflow: meta.workflow,
    status,
    ...(meta.startTime ? { startTime: meta.startTime } : {}),
    ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
    ...(meta.currentStep ? { currentStep: meta.currentStep } : {}),
    ...(meta.currentIteration !== undefined ? { currentIteration: meta.currentIteration } : {}),
    ...(meta.phase !== undefined ? { phase: meta.phase } : {}),
    ...(meta.reason ? { reason: meta.reason } : {}),
    ...(meta.failure ? { failure: meta.failure.error } : {}),
  };
}

export function readRunSnapshots(cwd: string, taskItems: TaktTaskItem[] = []): TaktRunSnapshot[] {
  const runsDirectory = resolve(cwd, ".takt", "runs");
  if (!existsSync(runsDirectory)) {
    return [];
  }

  const snapshots: TaktRunSnapshot[] = [];
  for (const entry of readdirSync(runsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const metaPath = resolve(runsDirectory, entry.name, "meta.json");
    try {
      const meta = parseRunMeta(JSON.parse(readFileSync(metaPath, "utf8")));
      if (!meta || meta.runSlug !== entry.name) {
        continue;
      }
      const ownerPid = findOwnerPid(meta, taskItems);
      snapshots.push(snapshotRun(meta, ownerPid));
    } catch {
      // A run can be observed while TAKT is replacing meta.json. Ignore it
      // for this poll and let the next refresh reconcile it.
    }
  }

  return snapshots.sort(compareRuns);
}

export async function readTaktSummary(cwd: string, options: TaktStateOptions = {}): Promise<TaktSummary> {
  const taskItems = await readTaskItems(cwd, options.command);
  const runs = readRunSnapshots(cwd, taskItems);
  const pending = taskItems.filter((item) => item.kind === "pending").length;
  const queueRunning = taskItems.filter((item) => item.kind === "running").length;
  const queueBlocked = taskItems.filter((item) => item.kind === "blocked" || item.kind === "exceeded").length;
  const queueFailed = taskItems.filter((item) => item.kind === "failed").length;
  const queueCompleted = taskItems.filter((item) => item.kind === "completed").length;
  const failedRun = runs.find((run) => run.status === "failed" || run.status === "stale");

  return {
    cwd,
    runs,
    running: Math.max(queueRunning, runs.filter((run) => run.status === "running").length),
    pending,
    blocked: queueBlocked + runs.filter((run) => run.status === "blocked").length,
    failed: queueFailed + runs.filter((run) => run.status === "failed").length,
    completed: queueCompleted + runs.filter((run) => run.status === "completed").length,
    stale: runs.filter((run) => run.status === "stale").length,
    ...(failedRun?.failure || failedRun?.reason ? { lastError: failedRun.failure ?? failedRun.reason } : {}),
  };
}

export async function readTaskItems(cwd: string, command = "takt"): Promise<TaktTaskItem[]> {
  try {
    const { stdout } = await execFile(resolveCommand(command), ["list", "--non-interactive", "--format", "json"], {
      cwd,
      windowsHide: true,
      maxBuffer: MAX_LIST_OUTPUT,
    });
    const parsed: unknown = JSON.parse(stdout);
    if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) {
      return [];
    }
    return parsed.tasks.filter(isTaskItem);
  } catch {
    return [];
  }
}

export function resolveCommand(command: string): string {
  if (process.platform !== "win32" || /[\\/]/.test(command) || /\.(?:cmd|exe|bat)$/i.test(command)) {
    return command;
  }
  return `${command}.cmd`;
}

export function usesWindowsShell(command: string): boolean {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
}

function findOwnerPid(meta: TaktRunMeta, taskItems: TaktTaskItem[]): number | undefined {
  const match = taskItems.find((item) =>
    item.kind === "running" &&
    item.ownerPid !== undefined &&
    (item.data?.task === meta.task || item.content === meta.task || item.summary === meta.task),
  );
  return match?.ownerPid;
}

function compareRuns(left: TaktRunSnapshot, right: TaktRunSnapshot): number {
  const leftActive = left.status === "running" || left.status === "starting" || left.status === "stale";
  const rightActive = right.status === "running" || right.status === "starting" || right.status === "stale";
  if (leftActive !== rightActive) {
    return leftActive ? -1 : 1;
  }
  return (right.startTime ?? "").localeCompare(left.startTime ?? "");
}

function isPersistedStatus(value: unknown): value is TaktRunMeta["status"] {
  return value === "running" || value === "completed" || value === "aborted" || value === "failed";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTaskItem(value: unknown): value is TaktTaskItem {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
