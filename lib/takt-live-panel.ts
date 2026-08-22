import {
  CURSOR_MARKER,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type { Terminal } from "@xterm/headless";
import {
  type TaktExecStage,
} from "./takt-exec-stage.ts";
import {
  formatTaktInputModeLine,
  type TaktInputMode,
} from "./takt-input-mode.ts";
import { workflowLabel } from "./takt-progress.ts";
import {
  hasTaktSummaryActivity,
  type TaktRunSnapshot,
  type TaktSummary,
} from "./takt-types.ts";

const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 30;
const MAX_WIDGET_ROWS = 10;
const MAX_STACK_ROWS = 30;
const LIVE_WIDGET_REFRESH_INTERVAL_MS = 100;
const SPINNER_INTERVAL_MS = 120;

/** Braille spinner shown on actively operated sessions; still means alive. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function taktSpinnerFrame(nowMs: number): string {
  const safeNow = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
  return SPINNER_FRAMES[Math.floor(safeNow / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length];
}

export interface TaktLiveRunner {
  readonly terminal: Terminal | undefined;
  readonly hasSession: boolean;
  readonly isRunning: boolean;
  resize(columns: number, rows: number): void;
  subscribe(listener: () => void): () => void;
}

export interface TaktProjectWidgetEntry {
  id: string;
  label: string;
  cwd: string;
  isCurrent?: boolean;
  runner?: TaktLiveRunner;
  summary?: TaktSummary;
  stage?: TaktExecStage;
  promptPreview?: string;
}

export interface TaktProjectStackSource {
  getProjects(): readonly TaktProjectWidgetEntry[];
  getInputMode?(): TaktInputMode;
  subscribe(listener: () => void): () => void;
}

export interface TaktProjectStackRenderOptions {
  now?: number;
}

/** Create a non-capturing widget that keeps normal Pi visible and focused. */
export function createTaktLiveWidget(
  runner: TaktLiveRunner,
  tui: { requestRender(): void },
): Component & { dispose(): void } {
  return new TaktLiveTerminalWidget(runner, tui);
}

/** Create one stacked widget for all registered TAKT project folders. */
export function createTaktProjectStackWidget(
  source: TaktProjectStackSource,
  tui: { requestRender(): void },
): Component & { dispose(): void } {
  return new TaktProjectStackWidget(source, tui);
}

class TaktLiveTerminalWidget implements Component {
  private readonly runner: TaktLiveRunner;
  private readonly tui: { requestRender(): void };
  private readonly unsubscribe: () => void;
  private lastWidth = 0;
  private lastRows = 0;

  constructor(
    runner: TaktLiveRunner,
    tui: { requestRender(): void },
  ) {
    this.runner = runner;
    this.tui = tui;
    this.unsubscribe = runner.subscribe(() => {
      this.invalidate();
      this.tui.requestRender();
    });
  }

  render(width: number): string[] {
    const rows = terminalRows();
    const columns = Math.max(1, Math.floor(width || DEFAULT_COLUMNS));
    if (columns !== this.lastWidth || rows !== this.lastRows) {
      this.lastWidth = columns;
      this.lastRows = rows;
      this.runner.resize(columns, rows);
    }

    const terminal = this.runner.terminal;
    if (!terminal) {
      return fitTaktWidgetLines(["TAKT terminal is not available."], columns);
    }
    const lines = renderTaktTerminal(terminal);
    return fitTaktWidgetLines(visibleWidgetLines(lines), columns);
  }

  invalidate(): void {
    // The terminal buffer is read directly on every render. This method exists
    // to satisfy Component and to document that cached output is not used.
  }

  dispose(): void {
    this.unsubscribe();
  }
}

class TaktProjectStackWidget implements Component {
  private readonly source: TaktProjectStackSource;
  private readonly tui: { requestRender(): void };
  private readonly unsubscribe: () => void;
  private readonly refreshTimer: ReturnType<typeof setInterval>;

  constructor(
    source: TaktProjectStackSource,
    tui: { requestRender(): void },
  ) {
    this.source = source;
    this.tui = tui;
    this.unsubscribe = source.subscribe(() => {
      this.invalidate();
      this.tui.requestRender();
    });
    // PTY output can arrive while the terminal parser is still settling, and
    // some TAKT screens update in place without producing a source-level state
    // change. Keep the mounted live screen fresh even when that event is
    // coalesced or missed by the host UI.
    this.refreshTimer = setInterval(() => {
      if (!this.source.getProjects().some((project) => project.runner?.isRunning && project.runner.terminal)) {
        return;
      }
      this.invalidate();
      this.tui.requestRender();
    }, LIVE_WIDGET_REFRESH_INTERVAL_MS);
    this.refreshTimer.unref?.();
  }

  render(width: number): string[] {
    return renderTaktProjectStack(
      this.source.getProjects(),
      normalizeWidgetWidth(width),
      this.source.getInputMode?.() ?? "pi",
    );
  }

  invalidate(): void {
    // Projects and terminal buffers are read directly on every render.
  }

  dispose(): void {
    this.unsubscribe();
    clearInterval(this.refreshTimer);
  }
}

export function renderTaktProjectStack(
  projects: readonly TaktProjectWidgetEntry[],
  width: number,
  inputMode: TaktInputMode = "pi",
  options: TaktProjectStackRenderOptions = {},
): string[] {
  const columns = normalizeWidgetWidth(width);
  const now = options.now ?? Date.now();
  // The live widget is a session-owned view: only projects whose TAKT process
  // was launched from THIS Pi session render here. External activity stays
  // available through explicit diagnostics (/takt:status, /takt:sessions,
  // takt_read_screen).
  const displayableProjects = [...projects]
    .filter(hasOwnedRunner)
    .filter((project) => isDisplayableProject(project, now))
    .sort(compareProjectActivity);
  const currentIsPreparing = displayableProjects.some(isPreparingProject);
  const visibleProjects = currentIsPreparing
    ? displayableProjects.filter((project) => project.isCurrent)
    : displayableProjects;

  if (visibleProjects.length === 0) {
    return fitTaktWidgetLines([
      `input: ${formatTaktInputModeLine(inputMode)}`,
      "🎭 TAKT · no active strings",
    ], columns);
  }

  const lines: string[] = [
    `input: ${formatTaktInputModeLine(inputMode)}`,
    `🎭 TAKT · ${visibleProjects.length} string${visibleProjects.length === 1 ? "" : "s"}`,
  ];
  for (const project of visibleProjects) {
    if (lines.length >= MAX_STACK_ROWS - 1 && visibleProjects.indexOf(project) < visibleProjects.length - 1) {
      lines.push(`… ${visibleProjects.length - visibleProjects.indexOf(project)} more`);
      break;
    }
    lines.push(sessionRow(project, columns, now));
    const activeFile = activeFilePathLine(project);
    if (activeFile !== undefined && lines.length < MAX_STACK_ROWS - 1) {
      lines.push(activeFile);
    }
  }
  return fitTaktWidgetLines(lines, columns);
}

/** Dim `📄 path` sub-line under an actively operated session with a fresh hit. */
function activeFilePathLine(project: TaktProjectWidgetEntry): string | undefined {
  const run = findActiveRun(project.summary);
  if (!run || !isActiveRunState(run) || project.runner?.terminal === undefined) {
    return undefined;
  }
  const path = extractLatestFilePath(project.runner.terminal);
  return path !== undefined ? `└ 📄 ${path}` : undefined;
}

/** One compact row per session: spinner + status emoji + label + run state. */
function sessionRow(project: TaktProjectWidgetEntry, width: number, now: number): string {
  void width;
  const spin = taktSpinnerFrame(now);
  const run = findActiveRun(project.summary);
  // Auto-generated exec workflow names get long; cap them so the row stays readable.
  const workflow = run !== undefined ? truncateInline(workflowLabel(run), 22) : undefined;
  const workflowTag = workflow !== undefined ? ` · ${workflow}` : "";
  // Bridge lifecycle states that precede or wrap the actual TAKT run.
  if (project.stage === "clearing") {
    return `${spin} 🟡 ${project.label}${workflowTag} — clearing previous session`;
  }
  if (project.stage === "starting" || isPreparingProject(project)) {
    return `${spin} ⏳ ${project.label}${workflowTag} — starting…`;
  }
  if (project.stage === "waiting_prompt") {
    return `${spin} ⏳ ${project.label}${workflowTag} — waiting for prompt`;
  }
  if (project.stage === "pasting") {
    const chars = project.promptPreview?.length ?? 0;
    return `${spin} 📋 ${project.label}${workflowTag} — pasting prompt (${chars} chars)`;
  }
  if (project.stage === "sending_go") {
    return `${spin} 📨 ${project.label}${workflowTag} — sending /go`;
  }

  const failureText = run?.failure ?? run?.reason;
  if (run?.status === "stale" || run?.sessionStatus === "stale") {
    const detail = failureText ? ` · ${truncateInline(failureText, 40)}` : "";
    return `${spin} ⚠️  ${project.label}${workflowTag} — stale${detail}`;
  }

  if (run && isActiveRunState(run)) {
    return `${spin} 🟢 ${project.label}${workflowTag} ${stepMeter(run, now)} ${describeActiveRun(run)}`;
  }

  if (project.stage === "failed") {
    const detail = failureText ? ` · ${truncateInline(failureText, 44)}` : "";
    return `🔴 ${project.label}${workflowTag} ❌ failed${detail}`;
  }

  // Running without run metadata yet (or right after a lifecycle transition).
  if (project.runner?.isRunning) {
    return `${spin} 🟢 ${project.label}${workflowTag} — working`;
  }

  const finishedRun = project.summary?.runs.find((candidate) => candidate.status === "completed");
  const duration = finishedRun?.startTime && finishedRun?.endTime
    ? formatDuration(Date.parse(finishedRun.startTime), Date.parse(finishedRun.endTime))
    : undefined;
  return `✅ ${project.label}${workflowTag} — done${duration ? ` · ${duration}` : ""}`;
}

function describeActiveRun(run: TaktRunSnapshot): string {
  const steps = run.workflowSteps?.filter((step) => step.length > 0) ?? [];
  const currentIndex = run.currentStep ? steps.indexOf(run.currentStep) : -1;
  const position = currentIndex >= 0 ? ` ${currentIndex + 1}/${steps.length}` : "";
  const phaseSuffix = run.phase
    ? ` · p${run.phase}/3`
    : "";
  const iterationSuffix = run.currentIteration !== undefined ? ` i${run.currentIteration}` : "";
  const stepName = run.currentStep ?? "working";
  return `🔨 ${stepName}${position}${phaseSuffix}${iterationSuffix}`;
}

const STEP_METER_CELLS = 10;

/**
 * Sub-step progress meter: completed workflow steps fill cells fully and the
 * active step fills by its phase (execute → report → judge), so the bar moves
 * inside a step instead of only when steps change. The boundary cell pulses
 * with the spinner tick so an operated session visibly breathes.
 */
export function stepMeter(
  run: Pick<TaktRunSnapshot, "workflowSteps" | "currentStep" | "phase">,
  nowMs = Date.now(),
): string {
  const steps = run.workflowSteps?.filter((step) => step.length > 0) ?? [];
  if (steps.length === 0) {
    return "";
  }
  const currentIndex = run.currentStep ? steps.indexOf(run.currentStep) : -1;
  if (currentIndex < 0) {
    return "░".repeat(STEP_METER_CELLS);
  }
  const phaseFraction = ((run.phase ?? 1) - 1) / 3;
  const progress = (currentIndex + phaseFraction) / steps.length;
  const filled = Math.min(STEP_METER_CELLS - 1, Math.floor(progress * STEP_METER_CELLS));
  const pulse = Math.floor(Math.max(0, nowMs) / SPINNER_INTERVAL_MS) % 2 === 0 ? "▓" : "▒";
  return `${"█".repeat(filled)}${pulse}${"░".repeat(STEP_METER_CELLS - filled - 1)}`;
}

/** File-path-like token used to surface what the worker is touching right now. */
const FILE_PATH_PATTERN = /[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,6}/g;
const FILE_SCAN_ROWS = 60;

/**
 * Best-effort file-unit signal: scan the owned PTY screen backwards for the
 * most recent path-looking token. Heuristic and stateless; hidden whenever no
 * plausible path appears on screen.
 */
export function extractLatestFilePath(terminal: Terminal): string | undefined {
  const buffer = terminal.buffer.active;
  const startRow = Math.max(0, buffer.cursorY + 1 - FILE_SCAN_ROWS);
  for (let row = buffer.cursorY; row >= startRow; row -= 1) {
    const line = buffer.getLine(row);
    if (!line) {
      continue;
    }
    let text = "";
    for (let column = 0; column < terminal.cols; column += 1) {
      text += buffer.getLine(row)?.getCell(column)?.getChars() ?? "";
    }
    const matches = text.match(FILE_PATH_PATTERN);
    if (!matches || matches.length === 0) {
      continue;
    }
    const candidate = [...matches]
      .reverse()
      .find((path) => isPlausibleActivityPath(path));
    if (candidate !== undefined) {
      return truncateInline(candidate, 34);
    }
  }
  return undefined;
}

function isPlausibleActivityPath(path: string): boolean {
  if (/^(?:node_modules|\.git|\.takt)[\\/]/i.test(path)) {
    return false;
  }
  if (/^https?:$/i.test(path)) {
    return false;
  }
  // Widget chrome like pi-takt-marionette-refresh-error has no real extension.
  return /\.[A-Za-z0-9]{1,6}$/.test(path) && !path.endsWith(".png)") ;
}

function truncateInline(value: string, maxLength: number): string {
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(1, maxLength - 1))}…` : normalized;
}

function formatDuration(startMs: number, endMs: number): string {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return "";
  }
  const totalSeconds = Math.round((endMs - startMs) / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h${minutes % 60 > 0 ? ` ${minutes % 60}m` : ""}`;
}

function isActiveRunState(run: Pick<TaktRunSnapshot, "status" | "sessionStatus">): boolean {
  return run.status === "running" || run.sessionStatus === "live";
}

function isDisplayableProject(project: TaktProjectWidgetEntry, now: number): boolean {
  if (isTerminalProjectStage(project.stage)) {
    return false;
  }
  return Boolean(
    project.runner?.isRunning ||
    (!project.runner?.hasSession && project.stage !== undefined && project.stage !== "idle"),
  );
}

/** True when this Pi session owns the TAKT process behind the entry. */
function hasOwnedRunner(project: TaktProjectWidgetEntry): boolean {
  return Boolean(project.runner?.hasSession || project.runner?.isRunning);
}

function isTerminalProjectStage(stage: TaktExecStage | undefined): boolean {
  return stage === "stopped" || stage === "completed" || stage === "failed";
}

/** Keep custom widget output inside Pi's terminal-width invariant. */
export function fitTaktWidgetLines(lines: readonly string[], width: number): string[] {
  const columns = normalizeWidgetWidth(width);
  return lines.map((line) => truncateToWidth(line, columns));
}

function isPreparingProject(project: TaktProjectWidgetEntry): boolean {
  return Boolean(project.isCurrent && project.runner?.isRunning && !hasTaktSummaryActivity(project.summary));
}

function findActiveRun(summary: TaktSummary | undefined): TaktRunSnapshot | undefined {
  return summary?.runs.find((run) =>
    run.status === "running" || run.status === "stale" ||
    run.sessionStatus === "live" || run.sessionStatus === "stale",
  );
}

function compareProjectActivity(left: TaktProjectWidgetEntry, right: TaktProjectWidgetEntry): number {
  return projectActivityScore(right) - projectActivityScore(left) || left.label.localeCompare(right.label);
}

function projectActivityScore(project: TaktProjectWidgetEntry): number {
  if (project.runner?.isRunning) return 4;
  if (project.summary?.running) return 2;
  if (project.summary && hasTaktSummaryActivity(project.summary)) return 1;
  return 0;
}

export function renderTaktTerminal(terminal: Terminal, options: { showCursor?: boolean } = {}): string[] {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  const cursorRow = options.showCursor ? buffer.cursorY : -1;
  const cursorColumn = options.showCursor ? buffer.cursorX : -1;

  for (let row = 0; row < terminal.rows; row += 1) {
    const line = buffer.getLine(row);
    const rendered = renderLine(
      line as unknown as TerminalLine | undefined,
      terminal.cols,
      row === cursorRow ? cursorColumn : -1,
    );
    lines.push(truncateToWidth(rendered, Math.max(1, terminal.cols)));
  }
  return lines;
}

export function visibleWidgetLines(lines: string[], maxRows = MAX_WIDGET_ROWS): string[] {
  const lastContent = lines.reduce((last, line, index) => (stripTerminalSequences(line).trim() ? index : last), -1);
  if (lastContent < 0) {
    return lines.slice(0, maxRows);
  }
  const start = Math.max(0, lastContent - maxRows + 1);
  return lines.slice(start, Math.min(lines.length, start + maxRows));
}

function stripTerminalSequences(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "");
}

interface TerminalLine {
  getCell(column: number): TerminalCell | undefined;
}

function renderLine(line: TerminalLine | undefined, columns: number, cursorColumn: number): string {
  if (!line) {
    return `${" ".repeat(columns)}${cursorColumn >= 0 ? CURSOR_MARKER : ""}`;
  }

  let output = "";
  let previousStyle = "";
  for (let column = 0; column < columns; column += 1) {
    if (column === cursorColumn) {
      output += CURSOR_MARKER;
    }

    const current = line.getCell(column) ?? createBlankCell();
    const style = cellStyle(current);
    if (style !== previousStyle) {
      output += style ? `\u001b[${style}m` : "\u001b[0m";
      previousStyle = style;
    }

    const chars = current.getChars();
    output += chars || (current.getWidth() === 0 ? "" : " ");
  }

  if (cursorColumn >= columns) {
    output += CURSOR_MARKER;
  }
  if (previousStyle) {
    output += "\u001b[0m";
  }
  return output;
}

interface TerminalCell {
  getChars(): string;
  getWidth(): number;
  getFgColor(): number;
  getBgColor(): number;
  isFgRGB(): boolean;
  isBgRGB(): boolean;
  isFgPalette(): boolean;
  isBgPalette(): boolean;
  isBold(): number;
  isDim(): number;
  isItalic(): number;
  isUnderline(): number;
  isBlink(): number;
  isInverse(): number;
  isInvisible(): number;
  isStrikethrough(): number;
  isOverline(): number;
}

function createBlankCell(): TerminalCell {
  return {
    getChars: () => "",
    getWidth: () => 1,
    getFgColor: () => 0,
    getBgColor: () => 0,
    isFgRGB: () => false,
    isBgRGB: () => false,
    isFgPalette: () => false,
    isBgPalette: () => false,
    isBold: () => 0,
    isDim: () => 0,
    isItalic: () => 0,
    isUnderline: () => 0,
    isBlink: () => 0,
    isInverse: () => 0,
    isInvisible: () => 0,
    isStrikethrough: () => 0,
    isOverline: () => 0,
  };
}

function cellStyle(cell: TerminalCell): string {
  const codes: string[] = [];
  if (cell.isBold()) codes.push("1");
  if (cell.isDim()) codes.push("2");
  if (cell.isItalic()) codes.push("3");
  if (cell.isUnderline()) codes.push("4");
  if (cell.isBlink()) codes.push("5");
  if (cell.isInverse()) codes.push("7");
  if (cell.isInvisible()) codes.push("8");
  if (cell.isStrikethrough()) codes.push("9");
  if (cell.isOverline()) codes.push("53");
  if (cell.isFgPalette()) codes.push(`38;5;${cell.getFgColor()}`);
  else if (cell.isFgRGB()) codes.push(`38;2;${rgbRed(cell.getFgColor())};${rgbGreen(cell.getFgColor())};${rgbBlue(cell.getFgColor())}`);
  if (cell.isBgPalette()) codes.push(`48;5;${cell.getBgColor()}`);
  else if (cell.isBgRGB()) codes.push(`48;2;${rgbRed(cell.getBgColor())};${rgbGreen(cell.getBgColor())};${rgbBlue(cell.getBgColor())}`);
  return codes.join(";");
}

function rgbRed(color: number): number {
  return (color >> 16) & 0xff;
}

function rgbGreen(color: number): number {
  return (color >> 8) & 0xff;
}

function rgbBlue(color: number): number {
  return color & 0xff;
}

function terminalRows(): number {
  const rows = process.stdout.rows;
  return Math.max(4, Number.isInteger(rows) && rows > 0 ? rows : DEFAULT_ROWS);
}

function normalizeWidgetWidth(width: number): number {
  return Math.max(1, Math.floor(width || DEFAULT_COLUMNS));
}
