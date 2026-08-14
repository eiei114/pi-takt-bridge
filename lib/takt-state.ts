import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnCommand } from "./process-control.ts";
import type {
  TaktLastExit,
  TaktRunMeta,
  TaktRunSnapshot,
  TaktSessionStatus,
  TaktSummary,
  TaktTaskItem,
  TaktStatus,
} from "./takt-types.ts";

const MAX_LIST_OUTPUT = 1_000_000;
const TASK_LIST_ARGS = ["list", "--non-interactive", "--format", "json"] as const;
const REQUIRED_META_STRING_FIELDS = [
  "task",
  "workflow",
  "runSlug",
  "runRoot",
  "reportDirectory",
  "contextDirectory",
  "logsDirectory",
  "startTime",
] as const;
const OPTIONAL_META_STRING_FIELDS = ["reason", "endTime", "currentStep", "updatedAt", "stage"] as const;
const TASK_TEXT_FIELDS = ["name", "content", "summary", "stage"] as const;

export interface TaktStateOptions {
  command?: string;
  now?: number;
}

export function parseRunMeta(value: unknown): TaktRunMeta | undefined {
  if (!isRecord(value) || !isPersistedStatus(value.status)) {
    return undefined;
  }
  if (REQUIRED_META_STRING_FIELDS.some((key) => !isNonEmptyString(value[key]))) {
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
    status: value.status,
    startTime: value.startTime as string,
  };

  for (const key of OPTIONAL_META_STRING_FIELDS) {
    if (isNonEmptyString(value[key])) {
      result[key] = value[key];
    }
  }
  const ownerPid = parsePid(value.ownerPid);
  if (ownerPid !== undefined) {
    result.ownerPid = ownerPid;
  }
  const pid = parsePid(value.pid);
  if (pid !== undefined) {
    result.pid = pid;
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
  const lastExit = parseLastExit(value.lastExit);
  if (lastExit) {
    result.lastExit = lastExit;
  }
  if (isRecord(value.failure) && isNonEmptyString(value.failure.step) && isNonEmptyString(value.failure.error)) {
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

export function classifySessionStatus(
  meta: Pick<TaktRunMeta, "status"> & Partial<Pick<TaktRunMeta, "ownerPid" | "pid">>,
  ownerPid?: number,
): TaktSessionStatus {
  if (meta.status !== "running") {
    return "completed";
  }
  const pid = ownerPid ?? meta.ownerPid ?? meta.pid;
  if (pid === undefined) {
    return "unknown";
  }
  return isProcessAlive(pid) ? "live" : "stale";
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
  const pid = ownerPid ?? meta.ownerPid ?? meta.pid;
  const status = classifyRunStatus(meta, pid);
  const sessionStatus = classifySessionStatus(meta, pid);
  const stage = meta.stage ?? meta.currentStep;
  return {
    slug: meta.runSlug,
    task: meta.task,
    workflow: meta.workflow,
    status,
    sessionStatus,
    ...(pid !== undefined ? { pid } : {}),
    ...(stage ? { stage } : {}),
    ...(meta.lastExit ? { lastExit: meta.lastExit } : {}),
    ...(meta.startTime ? { startTime: meta.startTime } : {}),
    ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
    ...(meta.currentStep ? { currentStep: meta.currentStep } : {}),
    ...(meta.currentIteration !== undefined ? { currentIteration: meta.currentIteration } : {}),
    ...(meta.phase !== undefined ? { phase: meta.phase } : {}),
    ...(meta.reason ? { reason: meta.reason } : {}),
    ...(meta.failure ? { failure: meta.failure.error } : {}),
  };
}

export function readRunSnapshots(cwd: string, taskItems: readonly TaktTaskItem[] = []): TaktRunSnapshot[] {
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
  const representativeRun = runs[0];
  const representativeTask = taskItems.find((item) => item.kind === "running");
  const status = deriveSummarySessionStatus(runs, taskItems);
  const pid = representativeRun?.pid ?? representativeTask?.ownerPid;
  const stage = representativeRun?.stage ?? representativeTask?.stage;
  const lastExit = representativeRun?.lastExit ?? representativeTask?.lastExit;

  return {
    cwd,
    runs,
    status,
    ...(pid !== undefined ? { pid } : {}),
    ...(stage ? { stage } : {}),
    ...(lastExit ? { lastExit } : {}),
    running: Math.max(queueRunning, runs.filter((run) => run.status === "running").length),
    pending,
    blocked: queueBlocked + runs.filter((run) => run.status === "blocked").length,
    failed: queueFailed + runs.filter((run) => run.status === "failed").length,
    completed: queueCompleted + runs.filter((run) => run.status === "completed").length,
    stale: runs.filter((run) => run.status === "stale").length,
    ...(failedRun?.failure || failedRun?.reason ? { lastError: failedRun.failure ?? failedRun.reason } : {}),
  };
}

export function deriveSummarySessionStatus(
  runs: readonly Pick<TaktRunSnapshot, "sessionStatus">[],
  taskItems: readonly TaktTaskItem[] = [],
): TaktSessionStatus {
  const statuses = [
    ...runs.map((run) => run.sessionStatus),
    ...taskItems.filter((item) => item.kind === "running").map(classifyTaskSessionStatus),
  ];
  if (statuses.includes("live")) {
    return "live";
  }
  if (statuses.includes("stale")) {
    return "stale";
  }
  if (statuses.includes("unknown")) {
    return "unknown";
  }
  if (statuses.includes("completed")) {
    return "completed";
  }
  return "unknown";
}

export async function readTaskItems(cwd: string, command?: string): Promise<TaktTaskItem[]> {
  const resolvedCommand = resolveCommand(command);
  const stdout = await runTaskList(resolvedCommand, cwd);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`TAKT task list returned invalid JSON: ${errorMessage(error)}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) {
    throw new Error("TAKT task list returned an invalid response shape");
  }
  return parsed.tasks.map(normalizeTaskItem).filter((item): item is TaktTaskItem => item !== undefined);
}

function runTaskList(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawnCommand>;
    try {
      child = spawnCommand(command, [...TASK_LIST_ARGS], {
        cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new Error(`TAKT task list could not start: ${errorMessage(error)}`));
      return;
    }

    let settled = false;
    let stdout = "";
    let stderr = "";
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > MAX_LIST_OUTPUT) {
        fail(new Error(`TAKT task list exceeded the ${MAX_LIST_OUTPUT}-byte output limit`));
        try {
          child.kill();
        } catch {
          // The owned task-list child is already exiting.
        }
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-500);
    });
    child.once("error", (error) => fail(new Error(`TAKT task list could not start: ${errorMessage(error)}`)));
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      if (code !== 0 || signal !== null) {
        const detail = stderr.trim();
        fail(new Error(
          `TAKT task list failed (exit ${code ?? signal ?? "unknown"})${detail ? `: ${detail}` : ""}`,
        ));
        return;
      }
      settled = true;
      resolve(stdout);
    });
  });
}

export function resolveCommand(command?: string): string {
  const selectedCommand = command ?? process.env.TAKT_COMMAND ?? "takt";
  if (process.platform !== "win32" || /[\\/]/.test(selectedCommand) || /\.(?:cmd|exe|bat)$/i.test(selectedCommand)) {
    return selectedCommand;
  }
  return `${selectedCommand}.cmd`;
}

export function usesWindowsShell(command: string): boolean {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
}

function findOwnerPid(meta: TaktRunMeta, taskItems: readonly TaktTaskItem[]): number | undefined {
  const match = taskItems.find((item) =>
    item.kind === "running" &&
    item.ownerPid !== undefined &&
    (item.data?.task === meta.task || item.content === meta.task || item.summary === meta.task),
  );
  return match?.ownerPid ?? meta.ownerPid ?? meta.pid;
}

function compareRuns(left: TaktRunSnapshot, right: TaktRunSnapshot): number {
  const leftActive = left.status === "running" || left.status === "starting" || left.status === "stale";
  const rightActive = right.status === "running" || right.status === "starting" || right.status === "stale";
  if (leftActive !== rightActive) {
    return leftActive ? -1 : 1;
  }
  return (right.startTime ?? "").localeCompare(left.startTime ?? "");
}

function classifyTaskSessionStatus(item: TaktTaskItem): TaktSessionStatus {
  if (item.ownerPid === undefined) {
    return "unknown";
  }
  return isProcessAlive(item.ownerPid) ? "live" : "stale";
}

function normalizeTaskItem(value: unknown): TaktTaskItem | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) {
    return undefined;
  }
  const item: TaktTaskItem = { kind: value.kind };
  for (const key of TASK_TEXT_FIELDS) {
    if (isNonEmptyString(value[key])) {
      item[key] = value[key];
    }
  }
  const ownerPid = parsePid(value.ownerPid);
  if (ownerPid !== undefined) {
    item.ownerPid = ownerPid;
  }
  if (isRecord(value.failure) && typeof value.failure.error === "string") {
    item.failure = { error: value.failure.error };
  }
  const lastExit = parseLastExit(value.lastExit);
  if (lastExit) {
    item.lastExit = lastExit;
  }
  if (isRecord(value.data) && typeof value.data.task === "string") {
    item.data = { task: value.data.task };
  }
  return item;
}

function parseLastExit(value: unknown): TaktLastExit | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: TaktLastExit = {};
  if (isInteger(value.code)) {
    result.code = value.code;
  }
  if (isInteger(value.signal)) {
    result.signal = value.signal;
  }
  return result.code !== undefined || result.signal !== undefined ? result : undefined;
}

function parsePid(value: unknown): number | undefined {
  return isPositiveInteger(value) ? value : undefined;
}

function isPersistedStatus(value: unknown): value is TaktRunMeta["status"] {
  return value === "running" || value === "completed" || value === "aborted" || value === "failed";
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
