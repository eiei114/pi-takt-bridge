import assert from "node:assert/strict";
import test from "node:test";
import xterm from "@xterm/headless";
import {
  formatTaktPastedInput,
  terminalContainsText,
  terminalEndsWithText,
} from "../lib/takt-run-controller.ts";

const { Terminal } = xterm;

test("formatTaktPastedInput preserves multiline TAKT prompts as one bracketed paste", () => {
  assert.equal(
    formatTaktPastedInput("line one\r\nline two\rline three"),
    "\u001b[200~line one\nline two\nline three\u001b[201~\r",
  );
});

test("formatTaktPastedInput appends one terminal submit", () => {
  assert.equal(formatTaktPastedInput("/go"), "\u001b[200~/go\u001b[201~\r");
});

test("terminalContainsText finds the parsed TAKT input prompt", async () => {
  const terminal = new Terminal({ cols: 40, rows: 8, allowProposedApi: true, scrollback: 20 });
  await new Promise((resolve) => terminal.write("Preparing…\r\nAssistant> ", resolve));

  assert.equal(terminalContainsText(terminal, "Assistant>"), true);
  assert.equal(terminalEndsWithText(terminal, "Assistant>"), true);
  assert.equal(terminalContainsText(terminal, "Missing>"), false);
  terminal.dispose();
});

test("terminalEndsWithText ignores a previous Assistant> left in scrollback", async () => {
  const terminal = new Terminal({ cols: 40, rows: 8, allowProposedApi: true, scrollback: 20 });
  await new Promise((resolve) => {
    terminal.write("Assistant> \r\nworking on the task…\r\nmore output\r\n", resolve);
  });

  assert.equal(terminalContainsText(terminal, "Assistant>"), true);
  assert.equal(terminalEndsWithText(terminal, "Assistant>"), false);

  await new Promise((resolve) => terminal.write("Assistant> ", resolve));
  assert.equal(terminalEndsWithText(terminal, "Assistant>"), true);
  terminal.dispose();
});

test("terminalEndsWithText rejects a filled Assistant> input line", async () => {
  const terminal = new Terminal({ cols: 40, rows: 4, allowProposedApi: true });
  await new Promise((resolve) => terminal.write("Assistant> draft prompt", resolve));

  assert.equal(terminalContainsText(terminal, "Assistant>"), true);
  assert.equal(terminalEndsWithText(terminal, "Assistant>"), false);
  terminal.dispose();
});
