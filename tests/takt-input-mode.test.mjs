import assert from "node:assert/strict";
import test from "node:test";
import {
  cycleTaktInputMode,
  formatTaktInputModeLine,
  isDestructiveTaktAutoInput,
  parseTaktInputMode,
} from "../lib/takt-input-mode.ts";

test("cycleTaktInputMode rotates pi → takt → pi-auto → pi", () => {
  assert.equal(cycleTaktInputMode("pi"), "takt");
  assert.equal(cycleTaktInputMode("takt"), "pi-auto");
  assert.equal(cycleTaktInputMode("pi-auto"), "pi");
});

test("parseTaktInputMode accepts mode names and cycle aliases", () => {
  assert.equal(parseTaktInputMode(""), "cycle");
  assert.equal(parseTaktInputMode("next"), "cycle");
  assert.equal(parseTaktInputMode("pi-auto"), "pi-auto");
  assert.equal(parseTaktInputMode("nope"), undefined);
});

test("formatTaktInputModeLine states where keys go in plain words", () => {
  assert.match(formatTaktInputModeLine("pi"), /typing in Pi/);
  assert.match(formatTaktInputModeLine("takt"), /typing into TAKT/);
  assert.match(formatTaktInputModeLine("pi-auto"), /Autopilot/);
});

test("isDestructiveTaktAutoInput gates clear/stop style follow-ups", () => {
  assert.equal(isDestructiveTaktAutoInput("/go"), false);
  assert.equal(isDestructiveTaktAutoInput("looks good, continue"), false);
  assert.equal(isDestructiveTaktAutoInput("/clear"), true);
  assert.equal(isDestructiveTaktAutoInput("please takt clear"), true);
  assert.equal(isDestructiveTaktAutoInput("abort\u0003"), true);
});
