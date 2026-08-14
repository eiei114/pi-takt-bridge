import {
  CURSOR_MARKER,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type { Terminal } from "@xterm/headless";
import {
  formatTaktExecStage,
  shouldOverlayPromptPreview,
  type TaktExecStage,
} from "./takt-exec-stage.ts";
import {
  formatTaktInputModeLine,
  type TaktInputMode,
} from "./takt-input-mode.ts";
import { formatTaktLastExit, type TaktSummary } from "./takt-types.ts";

const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 30;
const MAX_WIDGET_ROWS = 10;
const MAX_PROJECT_ROWS = 8;
const MAX_STACK_ROWS = 30;

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
  }
}

export function renderTaktProjectStack(
  projects: readonly TaktProjectWidgetEntry[],
  width: number,
  inputMode: TaktInputMode = "pi",
): string[] {
  const columns = normalizeWidgetWidth(width);
  const visibleProjects = [...projects]
    .filter((project) =>
      project.runner?.hasSession ||
      hasObservedActivity(project.summary) ||
      (project.stage !== undefined && project.stage !== "idle"))
    .sort(compareProjectActivity);
  const lines: string[] = [`input: ${formatTaktInputModeLine(inputMode)}`];
  let shownProjects = 0;

  for (const project of visibleProjects) {
    const runner = project.runner;
    const panel = [projectHeader(project)];
    if (shouldOverlayPromptPreview(project.stage) && project.promptPreview) {
      panel.push(...renderPromptOverlay(project));
    } else if (runner?.terminal) {
      runner.resize(columns, terminalRows());
      panel.push(...visibleWidgetLines(renderTaktTerminal(runner.terminal), MAX_PROJECT_ROWS - 1));
    } else if (project.summary) {
      panel.push(...renderObservedProject(project.summary));
    } else {
      panel.push("waiting for TAKT activity...");
    }

    if (lines.length + panel.length > MAX_STACK_ROWS) {
      break;
    }
    lines.push(...panel);
    shownProjects += 1;
  }

  if (visibleProjects.length === 0) {
    return fitTaktWidgetLines([
      `input: ${formatTaktInputModeLine(inputMode)}`,
      "TAKT projects: no active sessions.",
    ], columns);
  }
  if (shownProjects < visibleProjects.length) {
    const more = `… ${visibleProjects.length - shownProjects} more TAKT projects`;
    if (lines.length >= MAX_STACK_ROWS) {
      lines[MAX_STACK_ROWS - 1] = more;
    } else {
      lines.push(more);
    }
  }
  return fitTaktWidgetLines(lines, columns);
}

/** Keep custom widget output inside Pi's terminal-width invariant. */
export function fitTaktWidgetLines(lines: readonly string[], width: number): string[] {
  const columns = normalizeWidgetWidth(width);
  return lines.map((line) => truncateToWidth(line, columns));
}

function projectHeader(project: TaktProjectWidgetEntry): string {
  const runner = project.runner;
  const state = runner?.isRunning ? "● live" : runner?.hasSession ? "■ finished" : "◌ observed";
  const stage = project.stage && project.stage !== "idle"
    ? ` · stage:${formatTaktExecStage(project.stage)}`
    : "";
  return `TAKT [${project.label}] ${state}${stage} · ${project.cwd}`;
}

function renderPromptOverlay(project: TaktProjectWidgetEntry): string[] {
  const preview = project.promptPreview?.trim() || "(prompt body omitted)";
  return [
    `stage: ${formatTaktExecStage(project.stage ?? "pasting")}`,
    "prompt preview:",
    ...preview.split("\n").slice(0, MAX_PROJECT_ROWS - 3),
  ];
}

function renderObservedProject(summary: TaktSummary): string[] {
  const lines = [
    `status: ${summary.status}`,
    `counts: ${summary.running} running · ${summary.pending} pending · ${summary.blocked} blocked`,
  ];
  if (summary.pid !== undefined) {
    lines.push(`pid: ${summary.pid}`);
  }
  if (summary.stage) {
    lines.push(`stage: ${summary.stage}`);
  }
  if (summary.lastExit) {
    lines.push(`lastExit: ${formatTaktLastExit(summary.lastExit)}`);
  }
  const run = summary.runs[0];
  if (run) {
    lines.push(`↳ ${run.sessionStatus}: ${run.task}${run.currentStep ? ` · ${run.currentStep}` : ""}`);
  }
  lines.push("↳ external TAKT session: raw PTY screen unavailable");
  return lines.slice(0, MAX_PROJECT_ROWS - 1);
}

function hasObservedActivity(summary: TaktSummary | undefined): boolean {
  return summary !== undefined && (
    summary.running > 0 ||
    summary.pending > 0 ||
    summary.blocked > 0 ||
    summary.failed > 0 ||
    summary.stale > 0
  );
}

function compareProjectActivity(left: TaktProjectWidgetEntry, right: TaktProjectWidgetEntry): number {
  return projectActivityScore(right) - projectActivityScore(left) || left.label.localeCompare(right.label);
}

function projectActivityScore(project: TaktProjectWidgetEntry): number {
  if (project.runner?.isRunning) return 4;
  if (project.runner?.hasSession) return 3;
  if (project.summary?.running) return 2;
  if (project.summary && hasObservedActivity(project.summary)) return 1;
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
