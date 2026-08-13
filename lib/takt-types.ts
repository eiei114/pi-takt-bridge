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
  running: number;
  pending: number;
  blocked: number;
  failed: number;
  completed: number;
  stale: number;
  lastError?: string;
}
