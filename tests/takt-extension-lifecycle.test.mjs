import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import register from "../extensions/index.ts";

const DEAD_OWNER_PID = "999999999";

function createContext(cwd) {
  const notifications = [];
  const widgetUpdates = [];
  return {
    cwd,
    mode: "tui",
    hasUI: true,
    notifications,
    widgetUpdates,
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
      setStatus() {},
      setWidget(key, widget, options) {
        widgetUpdates.push({ key, widget, options });
      },
      onTerminalInput() {
        return () => {};
      },
      select: async () => undefined,
      confirm: async () => true,
      input: async () => undefined,
      editor: async () => undefined,
      custom: async () => undefined,
    },
  };
}

function loadExtension() {
  const tools = new Map();
  const events = new Map();
  const pi = {
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    on(name, handler) {
      events.set(name, handler);
    },
    registerCommand() {},
    registerShortcut() {},
  };
  register(pi);
  return { tools, events };
}

async function invoke(tools, name, params, context) {
  return tools.get(name).execute("test-call", params, undefined, () => {}, context);
}

function writeProfile(configRoot, cwd) {
  const directory = join(configRoot, "pi-takt-bridge");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "profiles.json"),
    JSON.stringify({ version: 1, profiles: [{ name: "pi-docs", cwd, preset: "default" }] }),
    "utf8",
  );
}

function createTaktCommand(directory) {
  const nodeScript = join(directory, "fake-takt.mjs");
  writeFileSync(nodeScript, [
    'import { appendFileSync } from "node:fs";',
    "const logPath = process.env.TEST_TAKT_LOG;",
    "const [operation, preset] = process.argv.slice(2);",
    "const event = (value) => appendFileSync(logPath, `${value}\\n`);",
    "if (operation === \"list\") {",
    "  const taskMode = process.env.TEST_TASK_MODE;",
    "  const tasks = taskMode === \"external\" || taskMode === \"stale\"",
    "    ? [{ kind: \"running\", ownerPid: Number(process.env.TEST_OWNER_PID), stage: \"external-stage\" }]",
    "    : [];",
    "  process.stdout.write(JSON.stringify({ tasks }) + \"\\n\");",
    "  process.exit(0);",
    "}",
    "if (operation === \"clear\") {",
    "  event(\"clear\");",
    "  if (process.env.TEST_CLEAR_MODE === \"fail\") process.exit(7);",
    "  process.exit(0);",
    "}",
    "if (operation !== \"exec\") process.exit(2);",
    "event(`exec:${preset}`);",
    "process.on(\"exit\", (code) => event(`exit:${preset}:${code}`));",
    "process.on(\"SIGINT\", () => { event(`signal:${preset}`); process.exit(130); });",
    "process.stdout.write(\"Assistant>\\r\\n\");",
    "process.stdin.setEncoding(\"utf8\");",
    "process.stdin.on(\"data\", (data) => {",
    "  event(`input:${preset}:${data.includes(\"/go\") ? \"go\" : \"body\"}`);",
    "  if (preset === \"second\" && data.includes(\"/go\")) {",
    "    event(\"natural:second\");",
    "    process.exit(0);",
    "  }",
    "});",
  ].join("\n"), "utf8");

  const quote = (value) => `"${value.replaceAll('"', '\\"')}"`;
  if (process.platform === "win32") {
    const command = join(directory, "fake-takt.cmd");
    writeFileSync(command, `@echo off\r\n@${quote(process.execPath)} ${quote(nodeScript)} %*\r\n`, "utf8");
    return command;
  }
  const command = join(directory, "fake-takt.sh");
  writeFileSync(command, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(nodeScript)} "$@"\n`, "utf8");
  chmodSync(command, 0o755);
  return command;
}

function configureEnvironment(root, command, logPath, taskMode) {
  const previous = new Map([
    ["APPDATA", process.env.APPDATA],
    ["XDG_CONFIG_HOME", process.env.XDG_CONFIG_HOME],
    ["TAKT_CONFIG_DIR", process.env.TAKT_CONFIG_DIR],
    ["TAKT_COMMAND", process.env.TAKT_COMMAND],
    ["TEST_TAKT_LOG", process.env.TEST_TAKT_LOG],
    ["TEST_TASK_MODE", process.env.TEST_TASK_MODE],
    ["TEST_OWNER_PID", process.env.TEST_OWNER_PID],
    ["TEST_CLEAR_MODE", process.env.TEST_CLEAR_MODE],
  ]);
  process.env.APPDATA = root;
  process.env.XDG_CONFIG_HOME = root;
  process.env.TAKT_CONFIG_DIR = root;
  process.env.TAKT_COMMAND = command;
  process.env.TEST_TAKT_LOG = logPath;
  process.env.TEST_TASK_MODE = taskMode;
  process.env.TEST_OWNER_PID = taskMode === "stale" ? DEAD_OWNER_PID : String(process.pid);
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condition did not settle within ${timeoutMs}ms`);
}

function logLines(path) {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
}

test("extension replaces owned exec and starts again after natural exit", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-bridge-extension-"));
  const project = join(root, "project");
  mkdirSync(project);
  const logPath = join(root, "events.log");
  const command = createTaktCommand(root);
  writeProfile(root, project);
  const restoreEnvironment = configureEnvironment(root, command, logPath, "none");
  const { tools, events } = loadExtension();
  const context = createContext(project);

  try {
    const first = await invoke(tools, "takt_exec_prompt", {
      profile: "pi-docs",
      prompt: "first body",
      preset: "first",
    }, context);
    assert.equal(first.details.replaced, false);

    const second = await invoke(tools, "takt_exec_prompt", {
      profile: "pi-docs",
      prompt: "second body",
      clear: false,
      replace: true,
      preset: "second",
    }, context);
    assert.equal(second.details.replaced, true);

    const completed = await waitFor(async () => {
      const result = await invoke(tools, "takt_read_screen", { rows: 4 }, context);
      return result.details.status === "completed" ? result.details : undefined;
    });
    assert.equal(completed.stage, "completed");
    assert.equal(completed.lastExit.code, 0);
    assert.equal(typeof completed.pid, "number");

    const third = await invoke(tools, "takt_exec_prompt", {
      profile: "pi-docs",
      prompt: "third body",
      preset: "third",
    }, context);
    assert.equal(third.details.replaced, false);

    const lines = logLines(logPath);
    const firstClear = lines.indexOf("clear");
    const firstExec = lines.indexOf("exec:first");
    const firstExit = lines.indexOf("exit:first:130");
    const secondClear = lines.indexOf("clear", firstExit + 1);
    const secondExec = lines.indexOf("exec:second");
    const secondExit = lines.indexOf("exit:second:0");
    const thirdClear = lines.indexOf("clear", secondExit + 1);
    const thirdExec = lines.indexOf("exec:third");
    assert.ok(firstClear >= 0 && firstClear < firstExec);
    assert.ok(firstExec < firstExit && firstExit < secondClear && secondClear < secondExec);
    assert.ok(secondExec < secondExit && secondExit < thirdClear && thirdClear < thirdExec);
  } finally {
    await events.get("session_shutdown")?.({ reason: "quit" }, context);
    restoreEnvironment();
  }
});

test("stopping a bridge-owned PTY clears the live widget", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-bridge-stop-widget-"));
  const project = join(root, "project");
  mkdirSync(project);
  const logPath = join(root, "events.log");
  const command = createTaktCommand(root);
  writeProfile(root, project);
  const restoreEnvironment = configureEnvironment(root, command, logPath, "none");
  const { tools, events } = loadExtension();
  const context = createContext(project);

  try {
    await invoke(tools, "takt_exec_prompt", {
      profile: "pi-docs",
      prompt: "stop and clear widget",
      clear: false,
      preset: "first",
    }, context);
    assert.ok(context.widgetUpdates.some((update) => update.widget !== undefined));

    const result = await invoke(tools, "takt_stop", { profile: "pi-docs" }, context);
    assert.equal(result.details.stopped, true);
    assert.equal(context.widgetUpdates.at(-1)?.widget, undefined);
  } finally {
    await events.get("session_shutdown")?.({ reason: "quit" }, context);
    restoreEnvironment();
  }
});

test("project setup registers a profile and materializes a project-local preset", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-bridge-project-setup-extension-"));
  const project = join(root, "project");
  const logPath = join(root, "events.log");
  const command = createTaktCommand(root);
  mkdirSync(project);
  mkdirSync(join(root, "exec", "presets"), { recursive: true });
  writeFileSync(join(root, "exec", "presets", "pi-docs.yaml"), "name: pi-docs\nworkers: []\n", "utf8");
  const restoreEnvironment = configureEnvironment(root, command, logPath, "none");
  const { tools, events } = loadExtension();
  const context = createContext(project);

  try {
    const result = await invoke(tools, "takt_project_setup", {
      profile: "bridge",
      cwd: project,
      preset: "pi-docs",
    }, context);
    assert.equal(result.details.profile, "bridge");
    assert.equal(result.details.presetSource, "global");
    assert.equal(existsSync(join(project, ".takt", "exec", "presets", "pi-docs.yaml")), true);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "pi-takt-bridge", "profiles.json"), "utf8")).profiles, [
      { name: "bridge", cwd: project, preset: "pi-docs" },
    ]);
  } finally {
    await events.get("session_shutdown")?.({ reason: "quit" }, context);
    restoreEnvironment();
  }
});

test("extension cleans up a failed clear before reporting the error", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-bridge-clear-failure-"));
  const project = join(root, "project");
  mkdirSync(project);
  const logPath = join(root, "events.log");
  const command = createTaktCommand(root);
  writeProfile(root, project);
  const restoreEnvironment = configureEnvironment(root, command, logPath, "none");
  process.env.TEST_CLEAR_MODE = "fail";
  const { tools, events } = loadExtension();
  const context = createContext(project);

  try {
    await assert.rejects(
      () => invoke(tools, "takt_exec_prompt", {
        profile: "pi-docs",
        prompt: "clear must fail",
        preset: "never-started",
      }, context),
      /takt clear failed in/,
    );
    const lines = logLines(logPath);
    assert.equal(lines.includes("clear"), true);
    assert.equal(lines.some((line) => line.startsWith("exec:")), false);
  } finally {
    await events.get("session_shutdown")?.({ reason: "quit" }, context);
    restoreEnvironment();
  }
});

test("extension replaces an observed stale session instead of blocking fresh exec", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-bridge-stale-"));
  const project = join(root, "project");
  mkdirSync(project);
  const logPath = join(root, "events.log");
  const command = createTaktCommand(root);
  writeProfile(root, project);
  const restoreEnvironment = configureEnvironment(root, command, logPath, "stale");
  const { tools, events } = loadExtension();
  const context = createContext(project);

  try {
    const observed = await invoke(tools, "takt_read_screen", { rows: 4 }, context);
    assert.equal(observed.details.status, "stale");

    const started = await invoke(tools, "takt_exec_prompt", {
      profile: "pi-docs",
      prompt: "replace stale",
      clear: false,
      preset: "second",
    }, context);
    assert.equal(started.details.replaced, false);

    assert.equal(logLines(logPath).includes("exec:second"), true);
  } finally {
    await events.get("session_shutdown")?.({ reason: "quit" }, context);
    restoreEnvironment();
  }
});

test("extension rejects exec when task metadata reports an external live session", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-takt-bridge-external-"));
  const project = join(root, "project");
  mkdirSync(project);
  const logPath = join(root, "events.log");
  const command = createTaktCommand(root);
  writeProfile(root, project);
  const restoreEnvironment = configureEnvironment(root, command, logPath, "external");
  const { tools, events } = loadExtension();
  const context = createContext(project);

  try {
    const observed = await invoke(tools, "takt_read_screen", { rows: 4 }, context);
    assert.equal(observed.details.status, "live");
    assert.equal(observed.details.stage, "external-stage");
    assert.equal(observed.details.pid, process.pid);

    const stopResult = await invoke(tools, "takt_stop", { profile: "pi-docs" }, context);
    assert.equal(stopResult.details.stopped, false);
    assert.equal(stopResult.details.cwd, project);

    await assert.rejects(
      () => invoke(tools, "takt_exec_prompt", {
        profile: "pi-docs",
        prompt: "must not start",
        clear: false,
        preset: "blocked",
      }, context),
      /external live session/,
    );
    assert.equal(logLines(logPath).some((line) => line.startsWith("exec:")), false);
  } finally {
    await events.get("session_shutdown")?.({ reason: "quit" }, context);
    restoreEnvironment();
  }
});
