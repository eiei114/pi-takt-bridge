import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import register from "../extensions/index.ts";

function loadTools() {
  const tools = new Map();
  const pi = {
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    on() {},
    registerCommand() {},
    registerShortcut() {},
  };
  register(pi);
  return tools;
}

test("fresh Pi runtime publishes all TAKT control tools and replace schema", () => {
  const tools = loadTools();

  assert.deepEqual([...tools.keys()].sort(), [
    "takt_exec_prompt",
    "takt_project_setup",
    "takt_read_screen",
    "takt_send_input",
    "takt_set_mode",
    "takt_stop",
  ]);
  assert.equal(tools.get("takt_exec_prompt").parameters.properties.replace.type, "boolean");
  assert.equal(tools.get("takt_project_setup").parameters.properties.cwd.type, "string");
  assert.equal(tools.get("takt_project_setup").parameters.properties.copyGlobalPreset.type, "boolean");
});

test("fresh Pi loader exposes the executable tool schema", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-takt-bridge-pi-runtime-"));
  const loaded = await discoverAndLoadExtensions(["./extensions/index.ts"], process.cwd(), agentDir);

  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const tools = loaded.extensions[0].tools;
  assert.deepEqual([...tools.keys()].sort(), [
    "takt_exec_prompt",
    "takt_project_setup",
    "takt_read_screen",
    "takt_send_input",
    "takt_set_mode",
    "takt_stop",
  ]);
  const execTool = tools.get("takt_exec_prompt").definition;
  assert.equal(execTool.parameters.type, "object");
  assert.equal(execTool.parameters.properties.replace.type, "boolean");
  assert.ok(execTool.parameters.required.includes("prompt"));
  const setupTool = tools.get("takt_project_setup").definition;
  assert.equal(setupTool.parameters.properties.cwd.type, "string");
  assert.equal(setupTool.parameters.properties.copyGlobalPreset.type, "boolean");
});

test("a second fresh extension registration publishes the same tool contract", () => {
  const first = loadTools();
  const second = loadTools();

  assert.deepEqual([...second.keys()].sort(), [...first.keys()].sort());
  assert.deepEqual(
    second.get("takt_exec_prompt").parameters.properties.replace,
    first.get("takt_exec_prompt").parameters.properties.replace,
  );
});
