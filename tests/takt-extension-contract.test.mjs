import assert from "node:assert/strict";
import test from "node:test";
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
    "takt_read_screen",
    "takt_send_input",
    "takt_set_mode",
    "takt_stop",
  ]);
  assert.equal(tools.get("takt_exec_prompt").parameters.properties.replace.type, "boolean");
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
