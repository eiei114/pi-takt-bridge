import assert from "node:assert/strict";
import test from "node:test";

const {
  formatTaktExecStage,
  shouldOverlayPromptPreview,
  summarizeTaktPrompt,
} = await import("../lib/takt-exec-stage.ts");

test("summarizeTaktPrompt keeps short prompts intact", () => {
  assert.equal(summarizeTaktPrompt("short task"), "short task");
});

test("summarizeTaktPrompt truncates long multiline prompts", () => {
  const prompt = [
    "## Issue #1331",
    "",
    "## Purpose",
    "line a",
    "line b",
    "line c",
    "line d",
    "## Done",
  ].join("\n");
  const preview = summarizeTaktPrompt(prompt, { headLines: 2, tailLines: 1, maxChars: 240 });
  assert.match(preview, /Issue #1331/);
  assert.match(preview, /more lines/);
  assert.match(preview, /## Done/);
  assert.ok(!preview.includes("line c"));
});

test("overlay stages cover paste and /go only", () => {
  assert.equal(shouldOverlayPromptPreview("pasting"), true);
  assert.equal(shouldOverlayPromptPreview("sending_go"), true);
  assert.equal(shouldOverlayPromptPreview("running"), false);
  assert.equal(shouldOverlayPromptPreview("waiting_prompt"), false);
  assert.equal(formatTaktExecStage("clearing"), "clearing");
});
