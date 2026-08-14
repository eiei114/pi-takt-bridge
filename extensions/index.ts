import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { matchesKey, Key, Text } from "@earendil-works/pi-tui";
import { TaktAcpClient } from "../lib/takt-acp-client.ts";
import {
  cycleTaktInputMode,
  describeTaktInputMode,
  formatTaktInputModeLine,
  isDestructiveTaktAutoInput,
  parseTaktInputMode,
  type TaktInputMode,
} from "../lib/takt-input-mode.ts";
import {
  createTaktProjectStackWidget,
  renderTaktTerminal,
  visibleWidgetLines,
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
import {
  formatTaktExecStage,
  shouldOverlayPromptPreview,
  summarizeTaktPrompt,
  type TaktExecStage,
} from "../lib/takt-exec-stage.ts";
import {
  formatTaktPastedInput,
  TaktRunController,
  terminalEndsWithText,
} from "../lib/takt-run-controller.ts";
import { readTaktSummary } from "../lib/takt-state.ts";
import { formatTaktLastExit, type TaktLastExit, type TaktSessionStatus, type TaktSummary } from "../lib/takt-types.ts";
import { renderTaktDetails } from "../lib/takt-widget.ts";

const WIDGET_KEY = "pi-takt-bridge-projects";
const STATUS_KEY = "pi-takt-bridge-input-mode";
const REFRESH_INTERVAL_MS = 2_000;
const TAKT_INPUT_PROMPT_TIMEOUT_MS = 15_000;
const TAKT_POST_PASTE_SETTLE_MS = 200;
const TAKT_LIFECYCLE_TIMEOUT_MS = 10_000;
const TAKT_AUTO_SCREEN_ROWS = 24;

const TAKT_EXEC_PROMPT_PARAMETERS = Type.Object({
  profile: Type.Optional(Type.String({ description: "Named TAKT profile; defaults to pi-docs" })),
  prompt: Type.String({ description: "Exact task or issue body to paste into TAKT" }),
  clear: Type.Optional(Type.Boolean({ description: "Run takt clear first; defaults to true" })),
  preset: Type.Optional(Type.String({ description: "Override the profile's exec preset" })),
  sendGo: Type.Optional(Type.Boolean({ description: "Submit /go after the body; defaults to true" })),
  replace: Type.Optional(Type.Boolean({
    description: "Stop a running bridge-owned session before starting; defaults to true",
  })),
});

const TAKT_STOP_PARAMETERS = Type.Object({
  profile: Type.Optional(Type.String({
    description: "Named TAKT profile or project path; defaults to the active running project",
  })),
});

const TAKT_SET_MODE_PARAMETERS = Type.Object({
  mode: Type.String({ description: "pi, takt, pi-auto, or cycle" }),
});

const TAKT_SEND_INPUT_PARAMETERS = Type.Object({
  text: Type.String({ description: "Exact text to paste into the active bridge-owned TAKT PTY" }),
  submit: Type.Optional(Type.Boolean({
    description: "Submit with bracketed paste + Enter; defaults to true",
  })),
});

const TAKT_READ_SCREEN_PARAMETERS = Type.Object({
  rows: Type.Optional(Type.Number({
    description: "Max trailing screen rows to return; defaults to 24",
  })),
});

type TaktBridgeStatus = Pick<TaktSummary, "status"> & Partial<Pick<TaktSummary, "pid" | "stage" | "lastExit">>;

async function showStatus(
  ctx: ExtensionContext,
  cwd = ctx.cwd,
  bridgeStatus?: TaktBridgeStatus,
): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  const summary = { ...await readTaktSummary(cwd), ...bridgeStatus };
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
  stage: TaktExecStage;
  promptPreview?: string;
}

class TaktBridgeRuntime implements TaktProjectStackSource {
  private readonly projects = new Map<string, ManagedProject>();
  private readonly profiles = new Map<string, TaktProjectProfile>();
  private readonly listeners = new Set<() => void>();
  private context: ExtensionContext | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private refreshInFlight = false;
  private liveWidgetVisible = false;
  private inputMode: TaktInputMode = "pi";
  private terminalInputUnsubscribe: (() => void) | undefined;
  private initialized = false;
  private initializePromise: Promise<void> | undefined;

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
      stage: project.stage,
      promptPreview: project.promptPreview,
    }));
  }

  getInputMode(): TaktInputMode {
    return this.inputMode;
  }

  getProjectStatus(cwd: string): TaktBridgeStatus | undefined {
    const project = this.projects.get(projectPathKey(cwd));
    if (!project) {
      return undefined;
    }
    const snapshot = projectSessionSnapshot(project);
    return {
      status: snapshot.status,
      ...(snapshot.pid !== undefined ? { pid: snapshot.pid } : {}),
      ...(snapshot.stage ? { stage: snapshot.stage } : {}),
      ...(snapshot.lastExit ? { lastExit: snapshot.lastExit } : {}),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  attach(context: ExtensionContext): void {
    this.context = context;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.initializeOnce();
    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = undefined;
    }
  }

  private async initializeOnce(): Promise<void> {
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
      void this.refreshProjects().catch((error) => {
        this.context?.ui.notify(`TAKT status refresh failed: ${errorMessage(error)}`, "warning");
      });
    }, REFRESH_INTERVAL_MS);
    this.refreshTimer.unref?.();
    this.initialized = true;
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
    if (blocksNewExecution(project.summary)) {
      await this.showLive();
      context.ui.notify(externalSessionError(project).message, "warning");
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
      project.runner.reconcile();
      if (project.runner.hasSession) {
        await project.runner.dispose();
      }
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
    if (blocksNewExecution(project.summary)) {
      await this.showLive();
      context.ui.notify(externalSessionError(project).message, "warning");
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
      project.runner.reconcile();
      if (project.runner.hasSession) {
        await project.runner.stop();
        await project.runner.waitForExit(TAKT_LIFECYCLE_TIMEOUT_MS);
        await project.runner.dispose();
      }
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
    project.runner.reconcile();
    if (project.runner.isRunning || blocksNewExecution(project.summary)) {
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
      if (project.runner.hasSession) {
        await project.runner.dispose();
      }
      await project.runner.start(["clear"]);
      const result = await project.runner.waitForExit(TAKT_LIFECYCLE_TIMEOUT_MS);
      if (!result) {
        throw new Error(`takt clear did not report an exit in ${project.label}`);
      }
      await project.runner.dispose();
      context.ui.notify(
        `TAKT clear ${result.code === 0 ? "finished" : "failed"} for ${project.label}.`,
        result.code === 0 ? "info" : "error",
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
      (candidate) => candidate.runner.isRunning,
    );
    if (!project?.runner.isRunning) {
      return;
    }
    const text = await context.ui.editor(`Input for ${project.label}`, "");
    if (text === undefined || !text.trim()) {
      return;
    }
    project.runner.write(formatTaktPastedInput(text));
    context.ui.notify(`Input sent to TAKT ${project.label}.`, "info");
  }

  async cycleOrSetInputMode(args = ""): Promise<TaktInputMode> {
    const parsed = parseTaktInputMode(args);
    if (!parsed) {
      this.context?.ui.notify(
        "Unknown TAKT input mode. Use pi, takt, pi-auto, or cycle.",
        "warning",
      );
      return this.inputMode;
    }
    if (parsed === "cycle") {
      return this.cycleInputMode();
    }
    return this.setInputMode(parsed);
  }

  async cycleInputMode(): Promise<TaktInputMode> {
    let next = cycleTaktInputMode(this.inputMode);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (next === "pi" || this.activeRunningProject()) {
        return this.setInputMode(next);
      }
      next = cycleTaktInputMode(next);
    }
    this.context?.ui.notify("No running bridge-owned TAKT session; staying in pi mode.", "warning");
    return this.setInputMode("pi");
  }

  async setInputMode(mode: TaktInputMode, options: { quiet?: boolean } = {}): Promise<TaktInputMode> {
    const context = this.context;
    if ((mode === "takt" || mode === "pi-auto") && !this.activeRunningProject()) {
      if (!options.quiet) {
        context?.ui.notify(`Cannot enter ${mode} mode without a running bridge-owned TAKT session.`, "warning");
      }
      mode = "pi";
    }

    this.clearTerminalInputCapture();
    this.inputMode = mode;

    if (mode === "takt" && context?.hasUI) {
      this.terminalInputUnsubscribe = context.ui.onTerminalInput((data) => this.handleTaktFocusInput(data));
    }

    this.syncInputModeStatus();
    this.notifyProjects();
    await this.showLive(false);
    if (!options.quiet && context?.hasUI) {
      context.ui.notify(`TAKT input mode: ${mode} — ${describeTaktInputMode(mode)}`, "info");
    }
    return this.inputMode;
  }

  readActiveScreen(rows = TAKT_AUTO_SCREEN_ROWS): {
    mode: TaktInputMode;
    project?: string;
    cwd?: string;
    status: TaktSessionStatus;
    pid?: number;
    running: boolean;
    stage: string;
    lastExit?: TaktLastExit;
    lines: string[];
  } {
    const project = this.activeRunningProject() ?? this.activeSessionProject() ?? this.activeObservedProject();
    if (!project) {
      return { mode: this.inputMode, status: "unknown", running: false, stage: "idle", lines: [] };
    }
    const maxRows = Math.max(1, Math.min(80, Math.floor(rows || TAKT_AUTO_SCREEN_ROWS)));
    const snapshot = projectSessionSnapshot(project);
    const lines = shouldUsePromptOverlay(project)
      ? [
          `stage: ${formatTaktExecStage(project.stage)}`,
          "prompt preview:",
          ...(project.promptPreview ?? "(prompt body omitted)").split("\n"),
        ]
      : project.runner.terminal
        ? visibleWidgetLines(renderTaktTerminal(project.runner.terminal), maxRows)
        : project.summary
          ? renderSummaryScreen(project.summary)
          : [];
    return {
      mode: this.inputMode,
      project: project.label,
      cwd: project.cwd,
      status: snapshot.status,
      ...(snapshot.pid !== undefined ? { pid: snapshot.pid } : {}),
      running: project.runner.isRunning,
      stage: snapshot.stage ?? "idle",
      ...(snapshot.lastExit ? { lastExit: snapshot.lastExit } : {}),
      lines,
    };
  }

  async sendAutoInput(
    text: string,
    options: { submit?: boolean } = {},
  ): Promise<{ project: string; cwd: string; submitted: boolean }> {
    const context = this.context;
    if (!context?.hasUI) {
      throw new Error("TAKT bridge requires an interactive Pi UI");
    }
    if (this.inputMode !== "pi-auto") {
      throw new Error("takt_send_input requires pi-auto mode. Use /takt:mode pi-auto or Ctrl+Alt+T.");
    }
    if (!text.trim()) {
      throw new Error("TAKT auto input must not be empty");
    }

    const project = this.activeRunningProject();
    if (!project) {
      await this.setInputMode("pi", { quiet: true });
      throw new Error("No running bridge-owned TAKT session for pi-auto input");
    }

    if (isDestructiveTaktAutoInput(text)) {
      const confirmed = await context.ui.confirm(
        "Confirm TAKT auto input",
        `Send potentially destructive input to ${project.label}?\n\n${text}`,
      );
      if (!confirmed) {
        throw new Error("Destructive TAKT auto input cancelled");
      }
    }

    const shouldSubmit = options.submit !== false;
    project.runner.write(shouldSubmit ? formatTaktPastedInput(text) : text);
    context.ui.notify(`Pi-auto sent input to TAKT ${project.label}.`, "info");
    this.notifyProjects();
    return { project: project.label, cwd: project.cwd, submitted: shouldSubmit };
  }

  async executePrompt(
    profileName = "pi-docs",
    prompt: string,
    options: { clear?: boolean; preset?: string; sendGo?: boolean; replace?: boolean } = {},
    signal?: AbortSignal,
    onUpdate?: (message: string) => void,
  ): Promise<{ profile: string; cwd: string; preset: string; sentGo: boolean; replaced: boolean }> {
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
    const replace = options.replace !== false;
    let replaced = false;
    let preserveExistingSession = false;

    try {
      project.runner.reconcile();
      if (!project.runner.isRunning && blocksNewExecution(project.summary)) {
        throw externalSessionError(project);
      }
      if (project.runner.isRunning && !replace) {
        preserveExistingSession = true;
        throw new Error(`TAKT is already running in ${project.label}; stop it before starting another exec.`);
      }

      if (replace || project.runner.hasSession) {
        const wasRunning = project.runner.isRunning;
        if (wasRunning) {
          this.setProjectStage(project, "stopping", onUpdate, `Stopping running TAKT in ${project.label} for replace…`);
        }
        await project.runner.stop();
        await project.runner.waitForExit(TAKT_LIFECYCLE_TIMEOUT_MS);
        await waitUntilNotRunning(project.runner, signal, TAKT_LIFECYCLE_TIMEOUT_MS);
        await project.runner.dispose();
        replaced = wasRunning;
        if (wasRunning) {
          this.setProjectStage(project, "stopped", onUpdate, `Stopped TAKT in ${project.label}.`);
        }
      }

      await this.refreshProject(project);
      if (blocksNewExecution(project.summary)) {
        throw externalSessionError(project);
      }

      if (options.clear !== false) {
        this.setProjectStage(project, "clearing", onUpdate, `Clearing previous TAKT session in ${project.label}…`);
        await project.runner.start(["clear"]);
        const clearResult = await project.runner.waitForExit(TAKT_LIFECYCLE_TIMEOUT_MS);
        if (!clearResult) {
          throw new Error(`takt clear did not report an exit in ${project.label}`);
        }
        if (clearResult.code !== 0) {
          throw new Error(`takt clear failed in ${project.label} (exit ${clearResult.code})`);
        }
        await project.runner.dispose();
        throwIfAborted(signal);
      }

      this.setProjectStage(project, "starting", onUpdate, `Starting takt exec ${preset} in ${project.label}…`);
      await project.runner.start(["exec", preset]);
      await this.showLive(false);

      this.setProjectStage(project, "waiting_prompt", onUpdate, `Waiting for Assistant> in ${project.label}…`);
      await waitForTaktInputPrompt(project.runner, signal, TAKT_INPUT_PROMPT_TIMEOUT_MS);
      throwIfAborted(signal);

      project.promptPreview = summarizeTaktPrompt(prompt);
      this.setProjectStage(project, "pasting", onUpdate, `Pasting prompt into ${project.label}…`);
      project.runner.write(formatTaktPastedInput(prompt));

      const shouldSendGo = options.sendGo !== false && !prompt.trim().endsWith("/go");
      if (shouldSendGo) {
        // Do not wait for an assistant reply before /go. A long
        // prompt-transition wait deadlocks when TAKT stays on Assistant>
        // or hangs mid-response, leaving an orphan process with no run.
        this.setProjectStage(project, "sending_go", onUpdate, `Sending /go to ${project.label}…`);
        await delay(TAKT_POST_PASTE_SETTLE_MS);
        throwIfAborted(signal);
        if (!project.runner.isRunning) {
          const result = await project.runner.waitForExit();
          throw new Error(`takt exec exited before /go (exit ${result?.code ?? "unknown"})`);
        }
        project.runner.write(formatTaktPastedInput("/go"));
      }

      this.setProjectStage(project, "running", onUpdate, `TAKT running in ${project.label}.`);
      await this.setInputMode("pi-auto", { quiet: true });
      context.ui.notify(
        `TAKT prompt submitted to ${project.label}${shouldSendGo ? " with /go" : ""}. Input mode: pi-auto. Raw output remains in the Pi widget.`,
        "info",
      );
      this.notifyProjects();
      return { profile: profile.name, cwd: project.cwd, preset, sentGo: shouldSendGo, replaced };
    } catch (error) {
      if (preserveExistingSession) {
        throw error;
      }

      const aborted = Boolean(signal?.aborted);
      const needsCleanup = project.runner.isRunning || project.runner.hasSession;
      try {
        if (project.runner.isRunning) {
          this.setProjectStage(
            project,
            "stopping",
            onUpdate,
            `Stopping TAKT in ${project.label} after ${aborted ? "cancel" : "prompt submission failure"}…`,
          );
        }
        await project.runner.stop();
        await project.runner.waitForExit(TAKT_LIFECYCLE_TIMEOUT_MS);
        await waitUntilNotRunning(project.runner, undefined, TAKT_LIFECYCLE_TIMEOUT_MS);
        if (project.runner.hasSession) {
          await project.runner.dispose();
        }
      } catch (cleanupError) {
        this.setProjectStage(project, "failed");
        throw new Error(`${errorMessage(error)}; TAKT cleanup failed: ${errorMessage(cleanupError)}`);
      }
      if (needsCleanup) {
        this.setProjectStage(project, aborted ? "stopped" : "failed");
      }
      throw error;
    }
  }

  async stopActive(
    args = "",
    options: { confirm?: boolean } = {},
  ): Promise<{ project?: string; cwd?: string; stopped: boolean }> {
    const context = this.context;
    if (!context?.hasUI) {
      throw new Error("TAKT bridge requires an interactive Pi UI");
    }

    const project = args.trim()
      ? this.ensureProject(this.resolveTargetPath(args, context.cwd))
      : this.activeRunningProject();
    project?.runner.reconcile();
    if (!project?.runner.isRunning) {
      return { project: project?.label, cwd: project?.cwd, stopped: false };
    }

    if (options.confirm) {
      const confirmed = await context.ui.confirm(
        "Stop TAKT",
        `Send Ctrl-C to ${project.label}? The current task may be marked aborted.`,
      );
      if (!confirmed) {
        return { project: project.label, cwd: project.cwd, stopped: false };
      }
    }

    this.setProjectStage(project, "stopping");
    try {
      await project.runner.stop();
      await project.runner.waitForExit(TAKT_LIFECYCLE_TIMEOUT_MS);
      await waitUntilNotRunning(project.runner, undefined, TAKT_LIFECYCLE_TIMEOUT_MS);
    } catch (error) {
      this.setProjectStage(project, "failed");
      throw new Error(`TAKT stop failed for ${project.label}: ${errorMessage(error)}`);
    }
    this.setProjectStage(project, "stopped");
    if (this.inputMode !== "pi") {
      await this.setInputMode("pi", { quiet: true });
    }
    context.ui.notify(`TAKT stopped for ${project.label}.`, "info");
    return { project: project.label, cwd: project.cwd, stopped: true };
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

    await this.stopActive(project.cwd, { confirm: true });
  }

  private setProjectStage(
    project: ManagedProject,
    stage: TaktExecStage,
    onUpdate?: (message: string) => void,
    message?: string,
  ): void {
    project.stage = stage;
    if (stage !== "running" && stage !== "pasting" && stage !== "sending_go") {
      project.promptPreview = undefined;
    }
    if (message) {
      onUpdate?.(message);
    }
    this.notifyProjects();
  }

  async shutdown(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.clearTerminalInputCapture();
    this.inputMode = "pi";
    this.context?.ui.setStatus(STATUS_KEY, undefined);
    this.clearLiveWidget();
    const results = await Promise.allSettled(
      [...this.projects.values()].map((project) => shutdownManagedProject(project)),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [errorMessage(result.reason)] : [],
    );
    if (failures.length > 0) {
      throw new Error(`TAKT runtime shutdown incomplete: ${failures.join("; ")}`);
    }
    this.projects.clear();
    this.profiles.clear();
    this.initialized = false;
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
        if (project.stage !== "stopping" && project.stage !== "failed" && project.stage !== "stopped") {
          project.stage = code === 0 ? "completed" : "failed";
          project.promptPreview = undefined;
        }
        const outcome = code === 0 ? "finished" : "exited with errors";
        context.ui.notify(`TAKT ${project.label} ${outcome} (exit ${code}).`, code === 0 ? "info" : "error");
        if ((this.inputMode === "takt" || this.inputMode === "pi-auto") && !this.activeRunningProject()) {
          void this.setInputMode("pi", { quiet: true });
        } else {
          this.notifyProjects();
        }
      },
    });
    const project: ManagedProject = {
      id,
      cwd: normalized,
      label,
      acp,
      runner,
      stage: "idle",
    };
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
    const snapshot = project.runner.reconcile();
    if (snapshot.status === "completed") {
      const completedStage = project.stage === "stopping" ? "stopped" : "completed";
      if (project.stage !== "completed" && project.stage !== "stopped" && project.stage !== "failed") {
        this.setProjectStage(project, completedStage);
      }
    }
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

  private activeRunningProject(): ManagedProject | undefined {
    const running = [...this.projects.values()].filter((project) => project.runner.isRunning);
    if (running.length === 0) {
      return undefined;
    }
    const current = this.context ? this.projects.get(projectPathKey(this.context.cwd)) : undefined;
    if (current?.runner.isRunning) {
      return current;
    }
    return running.sort((left, right) => left.label.localeCompare(right.label))[0];
  }

  private activeSessionProject(): ManagedProject | undefined {
    return this.activeRunningProject()
      ?? [...this.projects.values()].find((project) => project.runner.hasSession);
  }

  private activeObservedProject(): ManagedProject | undefined {
    const current = this.context ? this.projects.get(projectPathKey(this.context.cwd)) : undefined;
    if (current?.summary) {
      return current;
    }
    return [...this.projects.values()].find((project) => project.summary !== undefined);
  }

  private handleTaktFocusInput(data: string): { consume: boolean } {
    if (matchesKey(data, "escape")) {
      void this.setInputMode("pi");
      return { consume: true };
    }

    const project = this.activeRunningProject();
    if (!project) {
      void this.setInputMode("pi", { quiet: true });
      this.context?.ui.notify("TAKT focus ended because no bridge-owned session is running.", "warning");
      return { consume: true };
    }

    project.runner.write(data);
    return { consume: true };
  }

  private clearTerminalInputCapture(): void {
    this.terminalInputUnsubscribe?.();
    this.terminalInputUnsubscribe = undefined;
  }

  private syncInputModeStatus(): void {
    const context = this.context;
    if (!context?.hasUI) {
      return;
    }
    context.ui.setStatus(
      STATUS_KEY,
      this.inputMode === "pi" ? undefined : `takt input: ${formatTaktInputModeLine(this.inputMode)}`,
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

function blocksNewExecution(summary: TaktSummary | undefined): boolean {
  if (!summary) {
    return false;
  }
  if (summary.status === "live") {
    return true;
  }
  if (summary.status === "unknown") {
    return summary.running > 0;
  }
  return false;
}

function externalSessionError(project: ManagedProject): Error {
  const status = project.summary?.status;
  if (!status) {
    throw new Error(`TAKT summary is unavailable for ${project.label}`);
  }
  return new Error(`TAKT has an external ${status} session in ${project.label}; Pi will not start a duplicate.`);
}

function projectSessionSnapshot(project: ManagedProject): {
  status: TaktSessionStatus;
  pid?: number;
  stage?: string;
  lastExit?: TaktLastExit;
} {
  const runner = project.runner;
  if (runner.status === "stale") {
    return {
      status: "stale",
      stage: project.stage,
      ...(runner.pid !== undefined ? { pid: runner.pid } : {}),
    };
  }
  if (runner.isRunning) {
    return {
      status: "live",
      stage: project.stage,
      ...(runner.pid !== undefined ? { pid: runner.pid } : {}),
    };
  }
  if (runner.lastExit || runner.status === "completed") {
    return {
      status: "completed",
      stage: project.stage,
      ...(runner.pid !== undefined ? { pid: runner.pid } : {}),
      ...(runner.lastExit ? { lastExit: runner.lastExit } : {}),
    };
  }
  if (project.summary) {
    return {
      status: project.summary.status,
      ...(project.summary.stage ? { stage: project.summary.stage } : {}),
      ...(project.summary.pid !== undefined ? { pid: project.summary.pid } : {}),
      ...(project.summary.lastExit ? { lastExit: project.summary.lastExit } : {}),
    };
  }
  return { status: "unknown", stage: project.stage };
}

function renderSummaryScreen(summary: TaktSummary): string[] {
  return [
    `status: ${summary.status}`,
    ...(summary.pid !== undefined ? [`pid: ${summary.pid}`] : []),
    ...(summary.stage ? [`stage: ${summary.stage}`] : []),
    ...(summary.lastExit ? [`lastExit: ${formatTaktLastExit(summary.lastExit)}`] : []),
    `running: ${summary.running}`,
    `pending: ${summary.pending}`,
    `completed: ${summary.completed}`,
    `stale: ${summary.stale}`,
  ];
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

async function shutdownManagedProject(project: ManagedProject): Promise<void> {
  const failures: unknown[] = [];
  try {
    await project.acp.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await project.runner.dispose();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new Error(failures.map(errorMessage).join("; "));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("TAKT prompt execution cancelled");
  }
}

function shouldUsePromptOverlay(project: ManagedProject): boolean {
  return shouldOverlayPromptPreview(project.stage) && Boolean(project.promptPreview?.trim());
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntilNotRunning(
  runner: TaktRunController,
  signal?: AbortSignal,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (runner.isRunning && Date.now() < deadline) {
    throwIfAborted(signal);
    await delay(50);
  }
  if (runner.isRunning) {
    throw new Error(`TAKT process did not stop within ${timeoutMs / 1_000} seconds`);
  }
}

async function waitForTaktInputPrompt(
  runner: TaktRunController,
  signal: AbortSignal | undefined,
  timeoutMs = TAKT_INPUT_PROMPT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    if (!runner.isRunning) {
      const result = await runner.waitForExit();
      throw new Error(`takt exec exited before input (exit ${result?.code ?? "unknown"})`);
    }
    if (terminalEndsWithText(runner.terminal, "Assistant>")) {
      return;
    }
    await delay(50);
  }
  throw new Error(`takt exec did not reach the Assistant> input prompt within ${timeoutMs / 1_000} seconds`);
}

export default function register(pi: ExtensionAPI): void {
  let runtime: TaktBridgeRuntime | undefined;
  const getRuntime = async (context: ExtensionContext): Promise<TaktBridgeRuntime> => {
    if (!runtime) {
      runtime = new TaktBridgeRuntime(context.cwd);
    }
    runtime.attach(context);
    await runtime.initialize();
    return runtime;
  };

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
    async execute(_toolCallId, params, signal, onUpdate, context) {
      const activeRuntime = await getRuntime(context);
      const result = await activeRuntime.executePrompt(
        params.profile?.trim() || "pi-docs",
        params.prompt,
        {
          clear: params.clear,
          preset: params.preset,
          sendGo: params.sendGo,
          replace: params.replace,
        },
        signal,
        (message) => onUpdate?.({ content: [{ type: "text", text: message }], details: {} }),
      );
      return {
        content: [{
          type: "text",
          text: `TAKT started: ${result.profile} (${result.preset})\n${result.cwd}\nreplaced: ${result.replaced}\nsentGo: ${result.sentGo}\nmode: pi-auto`,
        }],
        details: result,
        terminate: true,
      };
    },
  });

  pi.registerTool({
    name: "takt_stop",
    label: "TAKT Stop",
    description: "Stop the active bridge-owned TAKT PTY without an interactive confirmation prompt.",
    promptSnippet: "Stop a stuck or running bridge-owned TAKT session before retrying",
    promptGuidelines: [
      "Use takt_stop when TAKT is already running and you need a clean restart.",
      "Prefer takt_exec_prompt with replace:true for one-shot restart+submit flows.",
      "Do not shell out to taskkill or takt stop when this tool is available.",
    ],
    parameters: TAKT_STOP_PARAMETERS,
    async execute(_toolCallId, params, _signal, _onUpdate, context) {
      const activeRuntime = await getRuntime(context);
      const result = await activeRuntime.stopActive(params.profile?.trim() || "", { confirm: false });
      return {
        content: [{
          type: "text",
          text: result.stopped
            ? `TAKT stopped: ${result.project}\n${result.cwd}`
            : `TAKT was not running${result.project ? `: ${result.project}` : ""}`,
        }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "takt_set_mode",
    label: "TAKT Set Mode",
    description: "Cycle or set TAKT input mode: pi, takt, or pi-auto.",
    promptSnippet: "Switch Pi/TAKT input mode for follow-up control",
    promptGuidelines: [
      "takt_exec_prompt already switches to pi-auto after a successful submit.",
      "Use takt_set_mode when you need an explicit mode change outside that flow.",
    ],
    parameters: TAKT_SET_MODE_PARAMETERS,
    async execute(_toolCallId, params, _signal, _onUpdate, context) {
      const activeRuntime = await getRuntime(context);
      const mode = await activeRuntime.cycleOrSetInputMode(params.mode);
      return {
        content: [{ type: "text", text: `TAKT input mode: ${mode}` }],
        details: { mode },
      };
    },
  });

  pi.registerTool({
    name: "takt_read_screen",
    label: "TAKT Read Screen",
    description: "Read the current bridge-owned TAKT live screen for pi-auto follow-up decisions.",
    promptSnippet: "Inspect the live TAKT widget screen while pi-auto mode is active",
    promptGuidelines: [
      "Use takt_read_screen before sending follow-up input in pi-auto mode.",
      "Only the active bridge-owned TAKT PTY is visible; external status cards are not raw screens.",
    ],
    parameters: TAKT_READ_SCREEN_PARAMETERS,
    async execute(_toolCallId, params, _signal, _onUpdate, context) {
      const activeRuntime = await getRuntime(context);
      const screen = activeRuntime.readActiveScreen(params.rows);
      const header = [
        `mode: ${screen.mode}`,
        screen.project ? `project: ${screen.project}` : "project: none",
        screen.cwd ? `cwd: ${screen.cwd}` : undefined,
        `status: ${screen.status}`,
        screen.pid !== undefined ? `pid: ${screen.pid}` : undefined,
        `running: ${screen.running}`,
        `stage: ${screen.stage}`,
        screen.lastExit ? `lastExit: ${formatTaktLastExit(screen.lastExit)}` : undefined,
      ].filter(Boolean);
      return {
        content: [{
          type: "text",
          text: `${header.join("\n")}\n\n${screen.lines.join("\n") || "(empty screen)"}`,
        }],
        details: screen,
      };
    },
  });

  pi.registerTool({
    name: "takt_send_input",
    label: "TAKT Send Input",
    description: "Send follow-up text to the active bridge-owned TAKT PTY while pi-auto mode is enabled.",
    promptSnippet: "Send allowed TAKT follow-up input during pi-auto mode",
    promptGuidelines: [
      "Only use takt_send_input after /takt:mode pi-auto or the Ctrl+Alt+T cycle lands on pi-auto.",
      "Read the live screen with takt_read_screen first when deciding what to send.",
      "Keep auto input short. Destructive commands require an interactive confirmation.",
      "Do not use this tool to replace takt_exec_prompt for the initial clear → exec → /go flow.",
    ],
    parameters: TAKT_SEND_INPUT_PARAMETERS,
    async execute(_toolCallId, params, _signal, _onUpdate, context) {
      const activeRuntime = await getRuntime(context);
      const result = await activeRuntime.sendAutoInput(params.text, { submit: params.submit });
      return {
        content: [{
          type: "text",
          text: `TAKT auto input sent to ${result.project}${result.submitted ? " (submitted)" : ""}\n${result.cwd}`,
        }],
        details: result,
      };
    },
  });

  pi.on("session_start", async (_event, context) => {
    const previousRuntime = runtime;
    if (previousRuntime) {
      try {
        await previousRuntime.shutdown();
      } catch (error) {
        previousRuntime.attach(context);
        context.ui.notify(
          `TAKT previous runtime retained because shutdown is incomplete: ${errorMessage(error)}`,
          "error",
        );
        return;
      }
    }

    const nextRuntime = new TaktBridgeRuntime(context.cwd);
    nextRuntime.attach(context);
    runtime = nextRuntime;
    await nextRuntime.initialize();
  });

  pi.on("session_shutdown", async (_event, context) => {
    const activeRuntime = runtime;
    if (!activeRuntime) {
      return;
    }
    try {
      await activeRuntime.shutdown();
      runtime = undefined;
    } catch (error) {
      activeRuntime.attach(context);
      context.ui.notify(
        `TAKT runtime retained because shutdown is incomplete: ${errorMessage(error)}`,
        "error",
      );
    }
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
        await showStatus(context, cwd, runtime?.getProjectStatus(cwd));
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

  pi.registerCommand("takt:mode", {
    description: "Cycle or set TAKT input mode: pi, takt, or pi-auto",
    handler: async (args, _context) => {
      await runtime?.cycleOrSetInputMode(args);
    },
  });

  pi.registerCommand("takt:stop", {
    description: "Stop a TAKT process started by Pi",
    handler: async (args, _context) => {
      await runtime?.stopRunning(args);
    },
  });

  pi.registerShortcut(Key.ctrlAlt("t"), {
    description: "Cycle TAKT input mode (pi → takt → pi-auto)",
    handler: async () => {
      await runtime?.cycleInputMode();
    },
  });

}
