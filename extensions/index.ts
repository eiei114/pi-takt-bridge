import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";
import { readTaktSummary } from "../lib/takt-state.ts";
import { TaktAcpClient } from "../lib/takt-acp-client.ts";
import { createTaktLiveWidget } from "../lib/takt-live-panel.ts";
import { TaktRunController } from "../lib/takt-run-controller.ts";
import { renderTaktDetails } from "../lib/takt-widget.ts";

const WIDGET_KEY = "pi-takt-bridge-live";

async function showStatus(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  const summary = await readTaktSummary(ctx.cwd);
  const lines = renderTaktDetails(summary);
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
  private context: ExtensionContext | undefined;
  private liveWidgetVisible = false;

  constructor(cwd: string) {
    this.acp = new TaktAcpClient({ cwd });
    this.runner = new TaktRunController({
      cwd,
      onExit: ({ code }) => {
        const context = this.context;
        if (!context?.hasUI) {
          return;
        }
        const outcome = code === 0 ? "finished" : "exited with errors";
        context.ui.notify(`TAKT ${outcome} (exit ${code}).`, code === 0 ? "info" : "error");
      },
    });
  }

  attach(context: ExtensionContext): void {
    this.context = context;
  }

  async enqueueTask(task: string): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    try {
      await this.acp.enqueue(task);
      context.ui.notify("TAKT task queued (worktree run).", "info");
    } catch (error) {
      context.ui.notify(`TAKT enqueue failed: ${errorMessage(error)}`, "error");
    }
  }

  async runOrAttach(): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    if (this.runner.hasSession) {
      await this.showLive(context);
      return;
    }
    await this.startPending();
  }

  async startPending(): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    if (this.runner.isRunning) {
      await this.showLive(context);
      return;
    }

    const confirmed = await context.ui.confirm(
      "Start TAKT",
      "Run all pending TAKT tasks in a live terminal? Each task keeps TAKT's worktree setting.",
    );
    if (!confirmed) {
      return;
    }

    try {
      await this.runner.start();
      await this.showLive(context);
    } catch (error) {
      context.ui.notify(`TAKT start failed: ${errorMessage(error)}`, "error");
    }
  }

  showLive(context = this.context): void {
    if (!context?.hasUI) {
      return;
    }
    if (!this.runner.hasSession) {
      context.ui.notify("No TAKT terminal session. Use /takt:start first.", "info");
      return;
    }
    if (this.liveWidgetVisible) {
      return;
    }

    context.ui.setWidget(
      WIDGET_KEY,
      (tui) => createTaktLiveWidget(this.runner, tui),
      { placement: "aboveEditor" },
    );
    this.liveWidgetVisible = true;
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
      "Send Ctrl-C to the live TAKT process? The current task may be marked aborted.",
    );
    if (!confirmed) {
      return;
    }

    await this.runner.stop();
    context.ui.notify("TAKT stop requested.", "info");
  }

  async shutdown(): Promise<void> {
    this.context?.ui.setWidget(WIDGET_KEY, undefined);
    this.liveWidgetVisible = false;
    await this.acp.close();
    await this.runner.dispose();
    this.context = undefined;
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
    description: "Run or attach to the live TAKT terminal",
    handler: async (_args, _context) => {
      await runtime?.runOrAttach();
    },
  });

  pi.registerCommand("takt:live", {
    description: "Attach to the live TAKT terminal",
    handler: async (_args, _context) => {
      await runtime?.showLive();
    },
  });

  pi.registerCommand("takt:status", {
    description: "Open the TAKT diagnostic status overlay",
    handler: async (_args, context) => {
      await showStatus(context);
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
    description: "Start all pending TAKT tasks in the live terminal",
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

}
