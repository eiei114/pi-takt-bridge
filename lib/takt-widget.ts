import type { TaktRunSnapshot, TaktSummary } from "./takt-types.ts";

const DEFAULT_WIDTH = 96;

export function renderTaktWidget(summary: TaktSummary, width = DEFAULT_WIDTH): string[] | undefined {
  const hasSomethingToShow = summary.running + summary.pending + summary.blocked + summary.failed + summary.stale > 0;
  if (!hasSomethingToShow) {
    return undefined;
  }

  const marker = summary.stale > 0 || summary.failed > 0 ? "⚠" : "●";
  const lines = [
    `TAKT ${marker} ${summary.running} running · ${summary.pending} pending · ${summary.blocked} blocked`,
  ];

  const activeRuns = summary.runs.filter((run) => run.status === "running" || run.status === "stale").slice(0, 2);
  for (const run of activeRuns) {
    lines.push(renderRunLine(run, width));
  }
  if (summary.failed > 0 && summary.lastError) {
    lines.push(`↳ failed: ${truncate(summary.lastError, Math.max(20, width - 12))}`);
  }
  return lines;
}

export function renderTaktDetails(summary: TaktSummary): string[] {
  const lines = [
    "TAKT status",
    `project: ${summary.cwd}`,
    `running: ${summary.running}`,
    `pending: ${summary.pending}`,
    `blocked: ${summary.blocked}`,
    `failed: ${summary.failed}`,
    `completed: ${summary.completed}`,
  ];

  if (summary.runs.length === 0) {
    lines.push("runs: none");
  } else {
    lines.push("runs:");
    for (const run of summary.runs.slice(0, 8)) {
      const step = run.currentStep ? ` · step ${run.currentStep}` : "";
      lines.push(`- ${run.status}: ${run.task}${step}`);
    }
  }
  if (summary.lastError) {
    lines.push(`last error: ${summary.lastError}`);
  }
  return lines;
}

function renderRunLine(run: TaktRunSnapshot, width: number): string {
  const step = run.currentStep ? ` · ${run.currentStep}` : "";
  const prefix = `↳ ${run.status}: `;
  return prefix + truncate(`${run.task}${step}`, Math.max(24, width - prefix.length));
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return "…";
  }
  return `${value.slice(0, maxLength - 1)}…`;
}
