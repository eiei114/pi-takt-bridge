import assert from "node:assert/strict";
import test from "node:test";

const {
  parseSessionMention,
  resolveSessionByMention,
} = await import("../lib/takt-session-mention.ts");

const SESSIONS = [
  { label: "marionette-playground", cwd: "C:/a" },
  { label: "marionette-playground2", cwd: "C:/b" },
  { label: "marionette-playground3", cwd: "C:/c" },
];

test("parseSessionMention extracts the @token and the rest of the message", () => {
  assert.deepEqual(parseSessionMention("@playground2 update the file"), { token: "playground2", rest: "update the file" });
  assert.deepEqual(parseSessionMention("plain message"), { rest: "plain message" });
  assert.deepEqual(parseSessionMention("  @pg  hello "), { token: "pg", rest: "hello" });
});

test("resolveSessionByMention prefers exact match then unique suffix/prefix", () => {
  assert.equal(resolveSessionByMention(SESSIONS, "marionette-playground2")?.cwd, "C:/b");
  // "playground2" matches only the suffixed session.
  assert.equal(resolveSessionByMention(SESSIONS, "playground2")?.cwd, "C:/b");
  // Ambiguous prefix resolves to nothing.
  assert.equal(resolveSessionByMention(SESSIONS, "ma"), undefined);
  assert.equal(resolveSessionByMention(SESSIONS, "nope"), undefined);
});
