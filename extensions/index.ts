import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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
import {
  loadTaktProfiles,
  normalizeProfileName,
  saveTaktProfiles,
  type TaktProjectProfile,
} from "../lib/takt-profile-registry.ts";
import { formatTaktPastedInput, TaktRunController } from "../lib/takt-run-controller.ts";
import { readTaktSummary } from "../lib/takt-state.ts";
import type { TaktSummary } from "../lib/takt-types.ts";
import { renderTaktDetails } from "../lib/takt-widget.ts";

const WIDGET_KEY = "pi-takt-bridge-projects";
const REFRESH_INTERVAL_MS = 2_000;

const TAKT_EXEC_PROMPT_PARAMETERS = Type.Object({
  profile: Type.Optional(Type.String({ description: "Named TAKT profile; defaults to pi-docs" })),
  prompt: Type.String({ description: "Exact task or issue body to paste into TAKT" }),
  clear: Type.Optional(Type.Boolean({ description: "Run takt clear first; defaults to true" })),
  preset: Type.Optional(Type.String({ description: "Override the profile's exec preset" })),
  sendGo: Type.Optional(Type.Boolean({ description: "Submit /go after the body; defaults to true" })),
});

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
  private readonly profiles = new Map<string, TaktProjectProfile>();
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
    for (const profile of loadTaktProfiles()) {
      this.profiles.set(profile.name, profile);
      try {
        this.ensureProject(profile.cwd);
      } catch {
        // Keep a bad saved profile from preventing Pi from starting.
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

    const profile = this.profileForArgument(args);
    const project = await this.selectProject(args, "Start TAKT exec in", (candidate) => !candidate.runner.isRunning);
    if (!project) {
      return;
    }
    if (!project.runner.hasSession && project.summary?.running) {
      await this.showLive();
      context.ui.notify(`TAKT is already running externally in ${project.label}; Pi will not start a duplicate.`, "warning");
      return;
    }
    const preset = profile?.preset ?? await context.ui.input("TAKT exec preset", "Optional preset, e.g. pi-docs");
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
    project.runner.write(formatTaktPastedInput(text));
    context.ui.notify(`Input sent to TAKT ${project.label}.`, "info");
  }

  async executePrompt(
    profileName = "pi-docs",
    prompt: string,
    options: { clear?: boolean; preset?: string; sendGo?: boolean } = {},
    signal?: AbortSignal,
    onUpdate?: (message: string) => void,
  ): Promise<{ profile: string; cwd: string; preset: string; sentGo: boolean }> {
    const context = this.context;
    if (!context?.hasUI) {
      throw new Error("TAKT bridge requires an interactive Pi UI");
    }
    if (!prompt.trim()) {
      throw new Error("TAKT prompt must not be empty");
    }
    throwIfAborted(signal);

    const profile = this.profiles.get(normalizeProfileName(profileName));
    if (!profile) {
      throw new Error(`TAKT profile not found: ${profileName}. Use /takt:profile:add ${profileName}.`);
    }
    const preset = options.preset?.trim() || profile.preset?.trim();
    if (!preset) {
      throw new Error(`TAKT profile has no exec preset: ${profile.name}. Pass preset or update the profile.`);
    }

    const project = this.ensureProject(profile.cwd);
    await this.refreshProject(project);
    if (project.runner.isRunning) {
      throw new Error(`TAKT is already running in ${project.label}; stop it before starting another exec.`);
    }
    if (project.summary?.running) {
      throw new Error(`TAKT is already running externally in ${project.label}; Pi will not start a duplicate.`);
    }

    if (options.clear !== false) {
      onUpdate?.(`Clearing previous TAKT session in ${project.label}…`);
      await project.runner.start(["clear"]);
      const clearResult = await project.runner.waitForExit();
      if (clearResult?.code !== 0) {
        throw new Error(`takt clear failed in ${project.label} (exit ${clearResult?.code ?? "unknown"})`);
      }
      throwIfAborted(signal);
    }

    onUpdate?.(`Starting takt exec ${preset} in ${project.label}…`);
    await project.runner.start(["exec", preset]);
    await this.showLive(false);
    await delay(250);
    if (!project.runner.isRunning) {
      const result = await project.runner.waitForExit();
      throw new Error(`takt exec exited before input (exit ${result?.code ?? "unknown"})`);
    }
    throwIfAborted(signal);

    project.runner.write(formatTaktPastedInput(prompt));
    const shouldSendGo = options.sendGo !== false && !prompt.trim().endsWith("/go");
    if (shouldSendGo) {
      await delay(120);
      project.runner.write(formatTaktPastedInput("/go"));
    }
    context.ui.notify(
      `TAKT prompt submitted to ${project.label}${shouldSendGo ? " with /go" : ""}. Raw output remains in the Pi widget.`,
      "info",
    );
    this.notifyProjects();
    return { profile: profile.name, cwd: project.cwd, preset, sentGo: shouldSendGo };
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

  async addProfile(args = ""): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    const nameArgument = args.trim().split(/\s+/)[0] ?? "";
    const rawName = nameArgument || await context.ui.input("TAKT profile name", "e.g. pi-docs");
    if (!rawName?.trim()) {
      return;
    }

    let name: string;
    try {
      name = normalizeProfileName(rawName);
    } catch (error) {
      context.ui.notify(`TAKT profile name failed: ${errorMessage(error)}`, "error");
      return;
    }

    const rawPath = await context.ui.input(
      `Folder for ${name}`,
      this.profiles.get(name)?.cwd ?? context.cwd,
    );
    if (!rawPath?.trim()) {
      return;
    }

    const current = this.profiles.get(name);
    const rawPreset = await context.ui.input(
      `Default exec preset for ${name}`,
      current?.preset ?? "Optional, e.g. pi-docs",
    );
    if (rawPreset === undefined) {
      return;
    }

    try {
      const cwd = normalizeProjectPath(rawPath, context.cwd);
      const preset = rawPreset.trim();
      this.profiles.set(name, { name, cwd, ...(preset ? { preset } : {}) });
      this.ensureProject(cwd);
      this.persistProfiles();
      this.persistProjects();
      await this.refreshProjects();
      context.ui.notify(
        `TAKT profile saved: ${name}\n${cwd}${preset ? `\npreset: ${preset}` : ""}\nUse /takt:exec ${name}.`,
        "info",
      );
    } catch (error) {
      context.ui.notify(`TAKT profile save failed: ${errorMessage(error)}`, "error");
    }
  }

  async listProfiles(): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }
    if (this.profiles.size === 0) {
      context.ui.notify("No TAKT profiles. Use /takt:profile:add <name> to create one.", "info");
      return;
    }
    const lines = [...this.profiles.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((profile) => `${profile.name} → ${profile.cwd}${profile.preset ? ` (preset: ${profile.preset})` : ""}`);
    context.ui.notify(lines.join("\n"), "info");
  }

  async removeProfile(args = ""): Promise<void> {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }

    let name = args.trim();
    if (!name) {
      const choices = [...this.profiles.keys()].sort();
      if (choices.length === 0) {
        context.ui.notify("No TAKT profiles to remove.", "info");
        return;
      }
      const selected = await context.ui.select("Remove TAKT profile", choices);
      if (!selected) {
        return;
      }
      name = selected;
    }

    let normalizedName: string;
    try {
      normalizedName = normalizeProfileName(name);
    } catch (error) {
      context.ui.notify(`TAKT profile name failed: ${errorMessage(error)}`, "error");
      return;
    }
    if (!this.profiles.delete(normalizedName)) {
      context.ui.notify(`TAKT profile not found: ${normalizedName}`, "info");
      return;
    }
    this.persistProfiles();
    context.ui.notify(`TAKT profile removed: ${normalizedName}. The project folder remains registered.`, "info");
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
    const linkedProfiles = [...this.profiles.values()]
      .filter((profile) => projectPathKey(profile.cwd) === project.id)
      .map((profile) => profile.name);
    if (linkedProfiles.length > 0) {
      context.ui.notify(
        `Remove linked TAKT profile first: ${linkedProfiles.join(", ")}. Use /takt:profile:remove.`,
        "warning",
      );
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
    this.profiles.clear();
    this.context = undefined;
  }

  resolveTargetPath(args: string, fallbackCwd = this.context?.cwd ?? process.cwd()): string {
    const profile = this.profileForArgument(args);
    return profile?.cwd ?? normalizeProjectPath(args, fallbackCwd);
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
        const project = this.ensureProject(this.resolveTargetPath(normalizedArgs, context.cwd));
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

  private profileForArgument(args: string): TaktProjectProfile | undefined {
    const trimmed = args.trim();
    if (!trimmed || /\s/.test(trimmed)) {
      return undefined;
    }
    try {
      return this.profiles.get(normalizeProfileName(trimmed));
    } catch {
      return undefined;
    }
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

  private persistProfiles(): void {
    try {
      saveTaktProfiles([...this.profiles.values()]);
    } catch (error) {
      this.context?.ui.notify(`TAKT profile registry save failed: ${errorMessage(error)}`, "warning");
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("TAKT prompt execution cancelled");
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default function register(pi: ExtensionAPI): void {
  let runtime: TaktBridgeRuntime | undefined;

  pi.registerTool({
    name: "takt_exec_prompt",
    label: "TAKT Exec Prompt",
    description: "Run a task through a named TAKT project profile, show raw output in the Pi widget, and submit /go.",
    promptSnippet: "Run an exact task prompt through a named TAKT profile with raw Pi TUI output",
    promptGuidelines: [
      "Use takt_exec_prompt when the user asks to execute an issue or task through TAKT with Pi agents.",
      "Pass the user's task body exactly as prompt; default profile pi-docs is explicit and must not be replaced by a guessed path.",
      "Do not shell out to takt exec when takt_exec_prompt is available; the tool owns the PTY and stacked Pi widget.",
      "If the tool reports a missing profile or extension, stop and report the missing configuration instead of guessing.",
    ],
    parameters: TAKT_EXEC_PROMPT_PARAMETERS,
    async execute(_toolCallId, params, signal, onUpdate) {
      const activeRuntime = runtime;
      if (!activeRuntime) {
        throw new Error("TAKT bridge runtime is not initialized; reload the extension and try again.");
      }
      const result = await activeRuntime.executePrompt(
        params.profile?.trim() || "pi-docs",
        params.prompt,
        {
          clear: params.clear,
          preset: params.preset,
          sendGo: params.sendGo,
        },
        signal,
        (message) => onUpdate?.({ content: [{ type: "text", text: message }], details: {} }),
      );
      return {
        content: [{ type: "text", text: `TAKT started: ${result.profile} (${result.preset})\n${result.cwd}` }],
        details: result,
        terminate: true,
      };
    },
  });

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
        const cwd = args.trim()
          ? runtime?.resolveTargetPath(args, context.cwd) ?? normalizeProjectPath(args, context.cwd)
          : context.cwd;
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

  pi.registerCommand("takt:profile:add", {
    description: "Create a named TAKT project profile with an optional exec preset",
    handler: async (args, _context) => {
      await runtime?.addProfile(args);
    },
  });

  pi.registerCommand("takt:profile:list", {
    description: "List named TAKT project profiles",
    handler: async (_args, _context) => {
      await runtime?.listProfiles();
    },
  });

  pi.registerCommand("takt:profile:remove", {
    description: "Remove a named TAKT project profile",
    handler: async (args, _context) => {
      await runtime?.removeProfile(args);
    },
  });

  pi.registerCommand("takt:profile", {
    description: "List named TAKT project profiles",
    handler: async (_args, _context) => {
      await runtime?.listProfiles();
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
