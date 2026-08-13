import xterm from "@xterm/headless";
import { spawn as spawnPty, type IPty } from "node-pty";
import type { Terminal as XtermTerminal } from "@xterm/headless";
import { killWindowsProcessTree } from "./process-control.ts";
import { resolveCommand } from "./takt-state.ts";

const { Terminal } = xterm;

export interface TaktRunControllerOptions {
  cwd: string;
  command?: string;
  args?: string[];
  cols?: number;
  rows?: number;
  onScreenChange?: () => void;
  onExit?: (result: { code: number; signal: number | undefined }) => void;
}

/**
 * Runs TAKT in a real pseudo-terminal and keeps an xterm-compatible screen
 * buffer. A pipe is not enough here: TAKT changes its output and input
 * behavior when stdout/stdin are TTYs.
 */
export class TaktRunController {
  private pty: IPty | undefined;
  private lastPty: IPty | undefined;
  private terminalInstance: XtermTerminal | undefined;
  private exitPromise: Promise<{ code: number; signal: number | undefined }> | undefined;
  private resolveExit: ((result: { code: number; signal: number | undefined }) => void) | undefined;
  private readonly options: TaktRunControllerOptions;
  private readonly screenListeners = new Set<() => void>();

  constructor(options: TaktRunControllerOptions) {
    this.options = options;
  }

  get isRunning(): boolean {
    return this.pty !== undefined;
  }

  get hasSession(): boolean {
    return this.terminalInstance !== undefined;
  }

  get terminal(): XtermTerminal | undefined {
    return this.terminalInstance;
  }

  subscribe(listener: () => void): () => void {
    this.screenListeners.add(listener);
    return () => this.screenListeners.delete(listener);
  }

  async start(args = this.options.args ?? ["run"]): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.terminalInstance?.dispose();
    const cols = this.options.cols ?? 120;
    const rows = this.options.rows ?? 30;
    const terminal = new Terminal({
      cols,
      rows,
      scrollback: 2_000,
      convertEol: false,
      allowProposedApi: true,
    });
    const command = resolveCommand(this.options.command ?? process.env.TAKT_COMMAND ?? "takt");
    const ptyCommand = createPtyCommand(command, args);

    let pty: IPty;
    try {
      pty = spawnPty(ptyCommand.file, ptyCommand.args, {
        cwd: this.options.cwd,
        cols,
        rows,
        name: "xterm-256color",
        env: {
          ...process.env,
          TERM: "xterm-256color",
          FORCE_COLOR: "1",
        },
        ...(process.platform !== "win32" ? { encoding: "utf8" } : {}),
        // winpty is more reliable than ConPTY for a nested Windows terminal
        // and still provides the TTY semantics TAKT needs.
        ...(process.platform === "win32" ? { useConpty: false } : {}),
      });
    } catch (error) {
      terminal.dispose();
      throw error;
    }

    this.terminalInstance = terminal;
    this.pty = pty;
    this.lastPty = pty;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });

    pty.onData((data) => {
      terminal.write(data, () => this.notifyScreenChange());
    });
    pty.onExit(({ exitCode, signal }) => {
      const result = { code: exitCode, signal };
      if (this.pty === pty) {
        this.pty = undefined;
        this.resolveExit?.(result);
        this.resolveExit = undefined;
        this.notifyScreenChange();
        this.options.onExit?.(result);
        disposePty(pty);
      }
    });
  }

  write(data: string): void {
    if (!data || !this.pty) {
      return;
    }
    this.pty.write(data);
  }

  async waitForExit(): Promise<{ code: number; signal: number | undefined } | undefined> {
    return this.exitPromise;
  }

  private notifyScreenChange(): void {
    this.options.onScreenChange?.();
    for (const listener of this.screenListeners) {
      listener();
    }
  }

  resize(cols: number, rows: number): void {
    const safeCols = Math.max(1, Math.floor(cols));
    const safeRows = Math.max(1, Math.floor(rows));
    if (this.terminalInstance && (this.terminalInstance.cols !== safeCols || this.terminalInstance.rows !== safeRows)) {
      this.terminalInstance.resize(safeCols, safeRows);
    }
    try {
      this.pty?.resize(safeCols, safeRows);
    } catch {
      // The process may have exited between render and resize.
    }
  }

  async stop(): Promise<void> {
    const pty = this.pty;
    const exitPromise = this.exitPromise;
    if (!pty || !exitPromise) {
      return;
    }

    try {
      // Writing Ctrl-C follows the same path as pressing Ctrl-C in the
      // terminal and works for both Windows winpty and Unix PTYs.
      pty.write("\u0003");
    } catch {
      // Fall through to the process-tree fallback below.
    }

    if (await settles(exitPromise, 1_500)) {
      return;
    }

    if (this.pty === pty) {
      if (process.platform === "win32") {
        await killWindowsProcessTree(pty.pid);
      } else {
        try {
          pty.kill("SIGKILL");
        } catch {
          // Best effort; the exit event reconciles state when possible.
        }
      }
    }
    await settles(exitPromise, 1_500);
  }

  async dispose(): Promise<void> {
    await this.stop();
    if (this.lastPty) {
      disposePty(this.lastPty);
    }
    this.lastPty = undefined;
    this.terminalInstance?.dispose();
    this.terminalInstance = undefined;
  }
}

function createPtyCommand(command: string, args: string[]): { file: string; args: string[] } {
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    const commandLine = [command, ...args].map(quoteWindowsArg).join(" ");
    return {
      file: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", commandLine],
    };
  }
  return { file: command, args };
}

function quoteWindowsArg(value: string): string {
  if (/^[A-Za-z0-9_./\\:-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

async function settles<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

function disposePty(pty: IPty): void {
  try {
    const destroyable = pty as IPty & { destroy?: () => void };
    if (destroyable.destroy) {
      destroyable.destroy();
    } else {
      pty.kill();
    }
  } catch {
    try {
      pty.kill();
    } catch {
      // Best effort cleanup for PTY handles after the child has exited.
    }
  }

  if (process.platform === "win32") {
    // node-pty's winpty path does not always dispose its conout worker when a
    // process exits naturally. Close that internal worker/socket so a short
    // `takt clear` or `takt exec` does not keep the Pi process alive.
    const internal = pty as unknown as {
      _agent?: { _conoutSocketWorker?: { dispose(): void } };
      _socket?: { destroy(): void };
    };
    try {
      internal._agent?._conoutSocketWorker?.dispose();
      internal._socket?.destroy();
    } catch {
      // Best effort cleanup; the public PTY lifecycle remains authoritative.
    }
  }
}
