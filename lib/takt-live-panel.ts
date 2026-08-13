import { CURSOR_MARKER, matchesKey, type Component } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Terminal } from "@xterm/headless";
import { TaktRunController } from "./takt-run-controller.ts";


const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 30;

/** Show the live terminal screen produced by a real TAKT PTY. */
export async function showTaktLivePanel(
  ctx: ExtensionContext,
  runner: TaktRunController,
  onClose?: (close: () => void) => void,
): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui" || !runner.hasSession) {
    return;
  }

  ctx.ui.notify("TAKT live screen: Ctrl+Shift+T returns to Pi; Ctrl+C stops TAKT.", "info");
  await ctx.ui.custom<void>(
    (tui, _theme, _keybindings, done) => {
      onClose?.(() => done(undefined));
      const view = new TaktLiveTerminalView(runner, tui, () => done(undefined));
      return view;
    },
    {
      overlay: true,
      overlayOptions: {
        width: "100%",
        maxHeight: "100%",
        anchor: "top-left",
        margin: 0,
      },
    },
  );
}

class TaktLiveTerminalView implements Component {
  private readonly runner: TaktRunController;
  private readonly tui: { requestRender(): void };
  private readonly done: () => void;
  private readonly unsubscribe: () => void;
  private lastWidth = 0;
  private lastRows = 0;

  constructor(
    runner: TaktRunController,
    tui: { requestRender(): void },
    done: () => void,
  ) {
    this.runner = runner;
    this.tui = tui;
    this.done = done;
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
      return ["TAKT terminal is not available."];
    }
    return renderTaktTerminal(terminal);
  }

  invalidate(): void {
    // The terminal buffer is read directly on every render. This method exists
    // to satisfy Component and to document that cached output is not used.
  }

  handleInput(data: string): void {
    if (matchesKey(data, "shift+ctrl+t") || matchesKey(data, "ctrl+shift+t")) {
      this.done();
      return;
    }
    if (matchesKey(data, "ctrl+c")) {
      void this.runner.stop();
      return;
    }
    // Escape and every other key are passed through so TAKT keeps its normal
    // interactive behavior. Ctrl+Shift+T is the Pi-side detach key.
    this.runner.write(data);
  }

  dispose(): void {
    this.unsubscribe();
  }
}

export function renderTaktTerminal(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  const cursorRow = buffer.cursorY;
  const cursorColumn = buffer.cursorX;

  for (let row = 0; row < terminal.rows; row += 1) {
    const line = buffer.getLine(row);
    lines.push(renderLine(line as unknown as TerminalLine | undefined, terminal.cols, row === cursorRow ? cursorColumn : -1));
  }
  return lines;
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
