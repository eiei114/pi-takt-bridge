import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text } from "@earendil-works/pi-tui";
import { readTaktSummary } from "../lib/takt-state.ts";
import { TaktAcpClient } from "../lib/takt-acp-client.ts";
import { TaktRunController } from "../lib/takt-run-controller.ts";
import { renderTaktDetails, renderTaktWidget } from "../lib/takt-widget.ts";
import type { TaktSummary } from "../lib/takt-types.ts";

const WIDGET_KEY = "pi-takt-bridge";
const REFRESH_INTERVAL_MS = 1_000;

async function showStatus(ctx: ExtensionContext, summary?: TaktSummary): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  const current = summary ?? (await readTaktSummary(ctx.cwd));
  const lines = renderTaktDetails(current);

  await ctx.ui.custom<void>(
    (_tui, theme, _keybindings, done) => {
      const text = new Text(
        lines.map((line) => theme.fg("text", line)).join("\n") +
          "\n\n" +
          theme.fg("dim", "Press Enter or Esc to close"),
        0,
        0,
      );

      return {
        render: (width: number) => text.render(width),
        invalidate: () => text.invalidate(),
        handleInput: (data: string) => {
          if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
            done();
          }
        },
      };
    },
    { overlay: true },
  );
}

class TaktBridgeRuntime {
  private readonly acp: TaktAcpClient;
  private readonly runner: TaktRunController;
  private readonly cwd: string;
  private context: ExtensionContext | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshing = false;
  private summary: TaktSummary | undefined;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.acp = new TaktAcpClient({ cwd });
    this.runner = new TaktRunController({ cwd });
  }

  attach(context: ExtensionContext): void {
    this.context = context;
    if (!context.hasUI) {
      return;
    }

    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
  }

  get currentSummary(): TaktSummary | undefined {
    return this.summary;
  }

  async enqueueTask(task: string): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    context.ui.setStatus(WIDGET_KEY, "TAKT: enqueueing…");
    try {
      await this.acp.enqueue(task);
      context.ui.notify("TAKT task queued (worktree run).", "info");
      await this.refresh();
    } catch (error) {
      context.ui.notify(`TAKT enqueue failed: ${errorMessage(error)}`, "error");
    } finally {
      context.ui.setStatus(WIDGET_KEY, undefined);
    }
  }

  async startPending(): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    if (this.runner.isRunning) {
      context.ui.notify("TAKT is already running.", "warning");
      return;
    }

    const confirmed = await context.ui.confirm(
      "Start TAKT",
      "Run all pending TAKT tasks? Each task keeps TAKT's worktree setting.",
    );
    if (!confirmed) {
      return;
    }

    try {
      await this.runner.start();
      context.ui.notify("TAKT run started.", "info");
      await this.refresh();
    } catch (error) {
      context.ui.notify(`TAKT start failed: ${errorMessage(error)}`, "error");
    }
  }

  async stopRunning(): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    if (!this.runner.isRunning) {
      context.ui.notify("No TAKT process is running from Pi.", "info");
      return;
    }

    const confirmed = await context.ui.confirm(
      "Stop TAKT",
      "Send an interrupt to the TAKT process? The current task may be marked aborted.",
    );
    if (!confirmed) {
      return;
    }

    await this.runner.stop();
    context.ui.notify("TAKT stop requested.", "info");
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      return;
    }

    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    this.refreshing = true;
    try {
      this.summary = await readTaktSummary(this.cwd);
      context.ui.setWidget(WIDGET_KEY, renderTaktWidget(this.summary));
    } finally {
      this.refreshing = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    const context = this.context;
    context?.ui.setWidget(WIDGET_KEY, undefined);
    await this.acp.close();
    await this.runner.stop();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function register(pi: ExtensionAPI): void {
  let runtime: TaktBridgeRuntime | undefined;

  pi.on("session_start", async (_event, context) => {
    await runtime?.shutdown();
    runtime = new TaktBridgeRuntime(context.cwd);
    runtime.attach(context);
  });

  pi.on("session_shutdown", async () => {
    await runtime?.shutdown();
    runtime = undefined;
  });

  pi.registerCommand("takt", {
    description: "Open the TAKT status overlay",
    handler: async (_args, context) => {
      await showStatus(context, runtime?.currentSummary);
    },
  });

  pi.registerCommand("takt:status", {
    description: "Open the TAKT status overlay",
    handler: async (_args, context) => {
      await showStatus(context, runtime?.currentSummary);
    },
  });

  pi.registerCommand("takt:enqueue", {
    description: "Queue a TAKT task through ACP without starting it",
    handler: async (_args, context) => {
      if (!context.hasUI || !runtime) {
        return;
      }
      const task = await context.ui.input("TAKT task", "Describe the task to queue");
      if (task?.trim()) {
        await runtime.enqueueTask(task.trim());
      }
    },
  });

  pi.registerCommand("takt:start", {
    description: "Start all pending TAKT tasks",
    handler: async (_args, _context) => {
      await runtime?.startPending();
    },
  });

  pi.registerCommand("takt:stop", {
    description: "Stop the TAKT process started by Pi",
    handler: async (_args, _context) => {
      await runtime?.stopRunning();
    },
  });

  pi.registerShortcut(Key.ctrlShift("t"), {
    description: "Open TAKT status",
    handler: async (context) => {
      await showStatus(context, runtime?.currentSummary);
    },
  });
}
