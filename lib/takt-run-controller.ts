import { spawn, type ChildProcess } from "node:child_process";
import { stopChild } from "./process-control.ts";
import { resolveCommand, usesWindowsShell } from "./takt-state.ts";

export interface TaktRunControllerOptions {
  cwd: string;
  command?: string;
  onOutput?: (line: string) => void;
  onExit?: (result: { code: number | null; signal: NodeJS.Signals | null }) => void;
}

export class TaktRunController {
  private child: ChildProcess | undefined;
  private readonly options: TaktRunControllerOptions;
  private outputBuffer = "";

  constructor(options: TaktRunControllerOptions) {
    this.options = options;
  }

  get isRunning(): boolean {
    return this.child !== undefined && this.child.exitCode === null && !this.child.killed;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    const command = resolveCommand(this.options.command ?? process.env.TAKT_COMMAND ?? "takt");
    const child = spawn(command, ["run"], {
      cwd: this.options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: usesWindowsShell(command),
    });
    this.child = child;
    this.outputBuffer = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.consumeOutput(chunk));
    child.stderr?.on("data", (chunk: string) => this.consumeOutput(chunk));

    child.once("close", (code, signal) => {
      if (this.child === child) {
        this.child = undefined;
      }
      this.flushOutput();
      this.options.onExit?.({ code, signal });
    });

    try {
      await waitForSpawn(child);
    } catch (error) {
      this.child = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = undefined;
      return;
    }

    await stopChild(child, "SIGINT", 1_500);
    if (this.child === child && child.exitCode !== null) {
      this.child = undefined;
    }
  }

  private consumeOutput(chunk: string): void {
    this.outputBuffer += chunk;
    const lines = this.outputBuffer.split(/\r?\n/);
    this.outputBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        this.options.onOutput?.(line.trim());
      }
    }
  }

  private flushOutput(): void {
    if (this.outputBuffer.trim()) {
      this.options.onOutput?.(this.outputBuffer.trim());
    }
    this.outputBuffer = "";
  }
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      child.off("spawn", onSpawn);
      child.off("error", onError);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}
