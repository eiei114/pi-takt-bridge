export const RUN_STATUSES = [
  "queued",
  "starting",
  "running",
  "completed",
  "failed",
  "aborted",
  "blocked",
  "stale",
] as const;

export type TaktStatus = (typeof RUN_STATUSES)[number];
export type PersistedRunStatus = "running" | "completed" | "aborted" | "failed";

export const TAKT_SESSION_STATUSES = ["live", "stale", "completed", "unknown"] as const;
export type TaktSessionStatus = (typeof TAKT_SESSION_STATUSES)[number];

export interface TaktLastExit {
  code?: number;
  signal?: number;
}

export function formatTaktLastExit(lastExit: TaktLastExit): string {
  const code = lastExit.code !== undefined ? `code=${lastExit.code}` : "code=unknown";
  const signal = lastExit.signal !== undefined ? ` signal=${lastExit.signal}` : "";
  return `${code}${signal}`;
}

export interface TaktRunMeta {
  task: string;
  workflow: string;
  runSlug: string;
  runRoot: string;
  reportDirectory: string;
  contextDirectory: string;
  logsDirectory: string;
  status: PersistedRunStatus;
  startTime: string;
  ownerPid?: number;
  pid?: number;
  stage?: string;
  lastExit?: TaktLastExit;
  reason?: string;
  failure?: {
    step: string;
    error: string;
  };
  endTime?: string;
  iterations?: number;
  currentStep?: string;
  currentIteration?: number;
  phase?: 1 | 2 | 3;
  updatedAt?: string;
}

export interface TaktRunSnapshot {
  slug: string;
  task: string;
  workflow: string;
  status: TaktStatus;
  sessionStatus: TaktSessionStatus;
  pid?: number;
  stage?: string;
  lastExit?: TaktLastExit;
  startTime?: string;
  updatedAt?: string;
  currentStep?: string;
  currentIteration?: number;
  phase?: 1 | 2 | 3;
  reason?: string;
  failure?: string;
}

export interface TaktTaskItem {
  kind: string;
  name?: string;
  content?: string;
  summary?: string;
  ownerPid?: number;
  stage?: string;
  lastExit?: TaktLastExit;
  failure?: {
    error?: string;
  };
  data?: {
    task?: string;
  };
}

export interface TaktSummary {
  cwd: string;
  runs: TaktRunSnapshot[];
  status: TaktSessionStatus;
  pid?: number;
  stage?: string;
  lastExit?: TaktLastExit;
  running: number;
  pending: number;
  blocked: number;
  failed: number;
  completed: number;
  stale: number;
  lastError?: string;
}
