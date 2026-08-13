import assert from "node:assert/strict";
import test from "node:test";
import { formatTaktPastedInput } from "../lib/takt-run-controller.ts";

test("formatTaktPastedInput preserves multiline TAKT prompts as one bracketed paste", () => {
  assert.equal(
    formatTaktPastedInput("line one\r\nline two\rline three"),
    "\u001b[200~line one\nline two\nline three\u001b[201~\r",
  );
});

test("formatTaktPastedInput appends one terminal submit", () => {
  assert.equal(formatTaktPastedInput("/go"), "\u001b[200~/go\u001b[201~\r");
});
