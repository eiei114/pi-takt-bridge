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

function createContext(cwd) {
  const notifications = [];
  return {
    cwd,
    mode: "tui",
    hasUI: true,
    notifications,
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
      setStatus() {},
      setWidget() {},
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
    "  const tasks = process.env.TEST_TASK_MODE === \"external\"",
    "    ? [{ kind: \"running\", ownerPid: Number(process.env.TEST_OWNER_PID), stage: \"external-stage\" }]",
    "    : [];",
    "  process.stdout.write(JSON.stringify({ tasks }) + \"\\n\");",
    "  process.exit(0);",
    "}",
    "if (operation === \"clear\") {",
    "  event(\"clear\");",
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
    ["TAKT_COMMAND", process.env.TAKT_COMMAND],
    ["TEST_TAKT_LOG", process.env.TEST_TAKT_LOG],
    ["TEST_TASK_MODE", process.env.TEST_TASK_MODE],
    ["TEST_OWNER_PID", process.env.TEST_OWNER_PID],
  ]);
  process.env.APPDATA = root;
  process.env.XDG_CONFIG_HOME = root;
  process.env.TAKT_COMMAND = command;
  process.env.TEST_TAKT_LOG = logPath;
  process.env.TEST_TASK_MODE = taskMode;
  process.env.TEST_OWNER_PID = String(process.pid);
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
      clear: false,
      preset: "first",
    }, context);
    assert.equal(first.details.replaced, false);

    const second = await invoke(tools, "takt_exec_prompt", {
      profile: "pi-docs",
      prompt: "second body",
      clear: false,
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
      clear: false,
      preset: "third",
    }, context);
    assert.equal(third.details.replaced, false);

    const lines = logLines(logPath);
    assert.ok(lines.indexOf("exit:first:130") < lines.indexOf("exec:second"));
    assert.ok(lines.indexOf("exit:second:0") < lines.indexOf("exec:third"));
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
