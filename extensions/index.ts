import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";
import { TaktAcpClient } from "../lib/takt-acp-client.ts";
import {
  createTaktProjectStackWidget,
  type TaktProjectStackSource,
  type TaktProjectWidgetEntry,
} from "../lib/takt-live-panel.ts";
import {
  loadProjectPaths,
  normalizeProjectPath,
  projectPathKey,
  saveProjectPaths,
} from "../lib/takt-project-registry.ts";
import { TaktRunController } from "../lib/takt-run-controller.ts";
import { readTaktSummary } from "../lib/takt-state.ts";
import type { TaktSummary } from "../lib/takt-types.ts";
import { renderTaktDetails } from "../lib/takt-widget.ts";

const WIDGET_KEY = "pi-takt-bridge-projects";
const REFRESH_INTERVAL_MS = 2_000;

async function showStatus(ctx: ExtensionContext, cwd = ctx.cwd): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  const summary = await readTaktSummary(cwd);
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

interface ManagedProject {
  id: string;
  cwd: string;
  label: string;
  acp: TaktAcpClient;
  runner: TaktRunController;
  summary?: TaktSummary;
}

class TaktBridgeRuntime implements TaktProjectStackSource {
  private readonly projects = new Map<string, ManagedProject>();
  private readonly listeners = new Set<() => void>();
  private context: ExtensionContext | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private refreshInFlight = false;
  private liveWidgetVisible = false;

  constructor(cwd: string) {
    this.ensureProject(cwd);
  }

  getProjects(): readonly TaktProjectWidgetEntry[] {
    return [...this.projects.values()].map((project) => ({
      id: project.id,
      label: project.label,
      cwd: project.cwd,
      runner: project.runner,
      summary: project.summary,
    }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  attach(context: ExtensionContext): void {
    this.context = context;
  }

  async initialize(): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    for (const cwd of loadProjectPaths()) {
      try {
        this.ensureProject(cwd);
      } catch {
        // Keep a bad saved path from preventing Pi from starting.
      }
    }
    await this.refreshProjects();
    this.refreshTimer = setInterval(() => {
      void this.refreshProjects();
    }, REFRESH_INTERVAL_MS);
    this.refreshTimer.unref?.();
  }

  async enqueueTask(task: string, args = ""): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    const project = args.trim()
      ? await this.selectProject(args, "Enqueue TAKT task in", () => true)
      : this.currentProject();
    if (!project) {
      return;
    }
    try {
      await project.acp.enqueue(task);
      context.ui.notify(`TAKT task queued for ${project.label} (worktree run).`, "info");
      await this.refreshProject(project);
    } catch (error) {
      context.ui.notify(`TAKT enqueue failed: ${errorMessage(error)}`, "error");
    }
  }

  async runOrAttach(): Promise<void> {
    const project = this.currentProject();
    if (project.runner.hasSession) {
      await this.showLive();
      return;
    }
    await this.startPending("", project);
  }

  async startPending(args = "", selectedProject?: ManagedProject): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    const project = selectedProject ?? await this.selectProject(args, "Start TAKT in", () => true);
    if (!project) {
      return;
    }
    if (project.runner.isRunning) {
      await this.showLive();
      return;
    }
    if (!project.runner.hasSession && project.summary?.running) {
      await this.showLive();
      context.ui.notify(`TAKT is already running externally in ${project.label}; Pi will not start a duplicate.`, "warning");
      return;
    }

    const confirmed = await context.ui.confirm(
      "Start TAKT",
      `Run all pending tasks in ${project.label}?\n${project.cwd}\nTAKT keeps its worktree setting.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await project.runner.start();
      await this.showLive();
    } catch (error) {
      context.ui.notify(`TAKT start failed for ${project.label}: ${errorMessage(error)}`, "error");
    }
  }

  async startExec(args = ""): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    const project = await this.selectProject(args, "Start TAKT exec in", (candidate) => !candidate.runner.isRunning);
    if (!project) {
      return;
    }
    if (!project.runner.hasSession && project.summary?.running) {
      await this.showLive();
      context.ui.notify(`TAKT is already running externally in ${project.label}; Pi will not start a duplicate.`, "warning");
      return;
    }
    const preset = await context.ui.input("TAKT exec preset", "Optional preset, e.g. pi-docs");
    if (preset === undefined) {
      return;
    }
    const confirmed = await context.ui.confirm(
      "Start fresh TAKT exec",
      `Start a new exec process in ${project.label}? --continue is not used.\n${project.cwd}`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await project.runner.start(preset.trim() ? ["exec", preset.trim()] : ["exec"]);
      await this.showLive();
      context.ui.notify(`TAKT exec started for ${project.label}. Use /takt:send to paste input.`, "info");
    } catch (error) {
      context.ui.notify(`TAKT exec failed to start for ${project.label}: ${errorMessage(error)}`, "error");
    }
  }

  async clearSessions(args = ""): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    const project = await this.selectProject(args, "Clear TAKT session in", () => true);
    if (!project) {
      return;
    }
    if (project.runner.isRunning || project.summary?.running) {
      context.ui.notify(`TAKT is running in ${project.label}; stop it before clearing.`, "warning");
      return;
    }
    const confirmed = await context.ui.confirm(
      "Clear TAKT session",
      `Run takt clear in ${project.label}? This removes the previous exec session state.\n${project.cwd}`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await project.runner.start(["clear"]);
      const result = await project.runner.waitForExit();
      context.ui.notify(
        `TAKT clear ${result?.code === 0 ? "finished" : "failed"} for ${project.label}.`,
        result?.code === 0 ? "info" : "error",
      );
    } catch (error) {
      context.ui.notify(`TAKT clear failed for ${project.label}: ${errorMessage(error)}`, "error");
    }
  }

  async sendInput(args = ""): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    const project = await this.selectProject(
      args,
      "Send input to TAKT",
      (candidate) => candidate.runner.hasSession,
    );
    if (!project?.runner.hasSession) {
      return;
    }
    const text = await context.ui.editor(`Input for ${project.label}`, "");
    if (text === undefined || !text.trim()) {
      return;
    }
    const pastedText = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    project.runner.write(`\u001b[200~${pastedText}\u001b[201~\r`);
    context.ui.notify(`Input sent to TAKT ${project.label}.`, "info");
  }

  async addProject(args = ""): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    const rawPath = args.trim() || await context.ui.input("TAKT project folder", "Absolute repo or development folder path");
    if (!rawPath?.trim()) {
      return;
    }

    try {
      const cwd = normalizeProjectPath(rawPath, context.cwd);
      const project = this.ensureProject(cwd);
      this.persistProjects();
      await this.refreshProject(project);
      context.ui.notify(`TAKT project added: ${project.label}\n${project.cwd}`, "info");
      await this.showLive(false);
    } catch (error) {
      context.ui.notify(`TAKT project add failed: ${errorMessage(error)}`, "error");
    }
  }

  async removeProject(args = ""): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }
    const project = await this.selectProject(args, "Remove TAKT project", () => true);
    if (!project) {
      return;
    }
    if (project.runner.isRunning) {
      context.ui.notify("Stop the project before removing it.", "warning");
      return;
    }
    await project.acp.close();
    await project.runner.dispose();
    this.projects.delete(project.id);
    this.persistProjects();
    this.notifyProjects();
    if (!this.hasDisplayableProject()) {
      this.clearLiveWidget();
    }
    context.ui.notify(`TAKT project removed: ${project.label}.`, "info");
  }

  async showLive(notifyWhenEmpty = true): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }
    if (!this.hasDisplayableProject()) {
      if (this.liveWidgetVisible) {
        this.clearLiveWidget();
      }
      if (notifyWhenEmpty) {
        context.ui.notify("No active TAKT project. Use /takt:project to register another folder.", "info");
      }
      return;
    }
    if (this.liveWidgetVisible) {
      this.notifyProjects();
      return;
    }

    context.ui.setWidget(
      WIDGET_KEY,
      (tui) => createTaktProjectStackWidget(this, tui),
      { placement: "aboveEditor" },
    );
    this.liveWidgetVisible = true;
  }

  async stopRunning(args = ""): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    const project = await this.selectProject(
      args,
      "Stop TAKT in",
      (candidate) => candidate.runner.isRunning,
    );
    if (!project?.runner.isRunning) {
      return;
    }

    const confirmed = await context.ui.confirm(
      "Stop TAKT",
      `Send Ctrl-C to ${project.label}? The current task may be marked aborted.`,
    );
    if (!confirmed) {
      return;
    }

    await project.runner.stop();
    context.ui.notify(`TAKT stop requested for ${project.label}.`, "info");
  }

  async shutdown(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.clearLiveWidget();
    await Promise.all([...this.projects.values()].map(async (project) => {
      await project.acp.close();
      await project.runner.dispose();
    }));
    this.projects.clear();
    this.context = undefined;
  }

  private currentProject(): ManagedProject {
    const context = this.context;
    if (!context) {
      throw new Error("TAKT bridge is not attached to a Pi session");
    }
    return this.ensureProject(context.cwd);
  }

  private ensureProject(cwd: string): ManagedProject {
    const normalized = normalizeProjectPath(cwd);
    const id = projectPathKey(normalized);
    const existing = this.projects.get(id);
    if (existing) {
      return existing;
    }

    const label = normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? normalized;
    const acp = new TaktAcpClient({ cwd: normalized });
    const runner = new TaktRunController({
      cwd: normalized,
      onExit: ({ code }) => {
        const project = this.projects.get(id);
        const context = this.context;
        if (!project || !context?.hasUI) {
          return;
        }
        const outcome = code === 0 ? "finished" : "exited with errors";
        context.ui.notify(`TAKT ${project.label} ${outcome} (exit ${code}).`, code === 0 ? "info" : "error");
        this.notifyProjects();
      },
    });
    const project: ManagedProject = { id, cwd: normalized, label, acp, runner };
    runner.subscribe(() => this.notifyProjects());
    this.projects.set(id, project);
    return project;
  }

  private async refreshProjects(): Promise<void> {
    if (this.refreshInFlight) {
      return;
    }
    this.refreshInFlight = true;
    try {
      await Promise.all([...this.projects.values()].map((project) => this.refreshProject(project)));
      this.notifyProjects();
      await this.showLive(false);
    } finally {
      this.refreshInFlight = false;
    }
  }

  private async refreshProject(project: ManagedProject): Promise<void> {
    project.summary = await readTaktSummary(project.cwd);
  }

  private async selectProject(
    args: string,
    title: string,
    predicate: (project: ManagedProject) => boolean,
  ): Promise<ManagedProject | undefined> {
    const context = this.context;
    if (!context?.hasUI) {
      return undefined;
    }
    const normalizedArgs = args.trim();
    if (normalizedArgs) {
      try {
        const project = this.ensureProject(normalizeProjectPath(normalizedArgs, context.cwd));
        this.persistProjects();
        await this.refreshProject(project);
        return project;
      } catch (error) {
        context.ui.notify(`TAKT project path failed: ${errorMessage(error)}`, "error");
        return undefined;
      }
    }

    const candidates = [...this.projects.values()].filter(predicate);
    if (candidates.length === 0) {
      context.ui.notify("No matching TAKT project session.", "info");
      return undefined;
    }
    const current = this.projects.get(projectPathKey(context.cwd));
    if (candidates.length === 1 || (current && candidates.includes(current) && current.runner.isRunning)) {
      return current && candidates.includes(current) ? current : candidates[0];
    }

    const choices = candidates.map((project) => `${project.label} — ${project.cwd}`);
    const selected = await context.ui.select(title, choices);
    if (!selected) {
      return undefined;
    }
    return candidates[choices.indexOf(selected)];
  }

  private hasDisplayableProject(): boolean {
    return [...this.projects.values()].some((project) =>
      project.runner.hasSession || hasSummaryActivity(project.summary),
    );
  }

  private persistProjects(): void {
    try {
      saveProjectPaths([...this.projects.values()].map((project) => project.cwd));
    } catch (error) {
      this.context?.ui.notify(`TAKT project registry save failed: ${errorMessage(error)}`, "warning");
    }
  }

  private clearLiveWidget(): void {
    this.context?.ui.setWidget(WIDGET_KEY, undefined);
    this.liveWidgetVisible = false;
  }

  private notifyProjects(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function hasSummaryActivity(summary: TaktSummary | undefined): boolean {
  return summary !== undefined && (
    summary.running > 0 ||
    summary.pending > 0 ||
    summary.blocked > 0 ||
    summary.failed > 0 ||
    summary.stale > 0
  );
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
    await runtime.initialize();
  });

  pi.on("session_shutdown", async () => {
    await runtime?.shutdown();
    runtime = undefined;
  });

  pi.registerCommand("takt", {
    description: "Run or attach to stacked TAKT project terminals",
    handler: async (_args, _context) => {
      await runtime?.runOrAttach();
    },
  });

  pi.registerCommand("takt:live", {
    description: "Show live TAKT output from all active project folders",
    handler: async (_args, _context) => {
      await runtime?.showLive();
    },
  });

  pi.registerCommand("takt:status", {
    description: "Open the TAKT diagnostic status overlay",
    handler: async (args, context) => {
      try {
        const cwd = args.trim() ? normalizeProjectPath(args, context.cwd) : context.cwd;
        await showStatus(context, cwd);
      } catch (error) {
        context.ui.notify(`TAKT status path failed: ${errorMessage(error)}`, "error");
      }
    },
  });

  pi.registerCommand("takt:enqueue", {
    description: "Queue a TAKT task through ACP; pass a project path to target another folder",
    handler: async (args, context) => {
      if (!context.hasUI || !runtime) {
        return;
      }
      const task = await context.ui.input("TAKT task", "Describe the task to queue");
      if (task?.trim()) {
        await runtime.enqueueTask(task.trim(), args);
      }
    },
  });

  pi.registerCommand("takt:project", {
    description: "Register another repo or development folder for TAKT monitoring",
    handler: async (args, _context) => {
      await runtime?.addProject(args);
    },
  });

  pi.registerCommand("takt:project:remove", {
    description: "Remove a registered TAKT project folder",
    handler: async (args, _context) => {
      await runtime?.removeProject(args);
    },
  });

  pi.registerCommand("takt:start", {
    description: "Start pending TAKT tasks; pass a project path to target another folder",
    handler: async (args, _context) => {
      await runtime?.startPending(args);
    },
  });

  pi.registerCommand("takt:exec", {
    description: "Start a fresh interactive TAKT exec in a registered folder",
    handler: async (args, _context) => {
      await runtime?.startExec(args);
    },
  });

  pi.registerCommand("takt:clear", {
    description: "Run takt clear in a selected project before a fresh exec",
    handler: async (args, _context) => {
      await runtime?.clearSessions(args);
    },
  });

  pi.registerCommand("takt:send", {
    description: "Send pasted multiline input to a TAKT exec session",
    handler: async (args, _context) => {
      await runtime?.sendInput(args);
    },
  });

  pi.registerCommand("takt:stop", {
    description: "Stop a TAKT process started by Pi",
    handler: async (args, _context) => {
      await runtime?.stopRunning(args);
    },
  });

}
