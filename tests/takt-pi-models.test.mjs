import assert from "node:assert/strict";
import test from "node:test";

const {
  filterByFuzzyQuery,
  formatPiModelRef,
  fuzzyScore,
  parsePiModelList,
} = await import("../lib/takt-pi-models.ts");

const SAMPLE_OUTPUT = [
  "provider      model                       context  max-out  thinking  images",
  "anthropic     claude-opus-4-8             1M       128K     yes       yes   ",
  "cursor        auto                        200K     16.4K    no        yes   ",
  "openai-codex  gpt-5-codex                 400K     128K     yes       yes   ",
  "",
].join("\n");

test("parsePiModelList reads provider/model columns and skips headers", () => {
  assert.deepEqual(parsePiModelList(SAMPLE_OUTPUT), [
    { provider: "anthropic", model: "claude-opus-4-8" },
    { provider: "cursor", model: "auto" },
    { provider: "openai-codex", model: "gpt-5-codex" },
  ]);
});

test("parsePiModelList deduplicates repeated rows and tolerates empty output", () => {
  const duplicated = `${SAMPLE_OUTPUT}${SAMPLE_OUTPUT}`;
  assert.equal(parsePiModelList(duplicated).length, 3);
  assert.deepEqual(parsePiModelList(""), []);
});

test("formatPiModelRef joins provider and model", () => {
  assert.equal(formatPiModelRef({ provider: "openai-codex", model: "gpt-5-codex" }), "openai-codex/gpt-5-codex");
});

test("fuzzyScore ranks subsequence matches and rejects misses", () => {
  assert.equal(fuzzyScore("", "anything"), 1);
  assert.ok(fuzzyScore("opus", "anthropic/claude-opus-4-8") > 0);
  assert.equal(fuzzyScore("zzz", "anthropic/claude-opus-4-8"), 0);
});

test("filterByFuzzyQuery orders matches by score and caps results", () => {
  const items = [
    "anthropic/claude-haiku-4-5",
    "anthropic/claude-opus-4-8",
    "cursor/auto",
    "openai-codex/gpt-5-codex",
  ];
  const matches = filterByFuzzyQuery(items, "claude", (item) => item);
  assert.deepEqual(matches, [
    "anthropic/claude-opus-4-8",
    "anthropic/claude-haiku-4-5",
  ]);
  const capped = filterByFuzzyQuery(items, "", (item) => item, 2);
  assert.equal(capped.length, 2);
});
