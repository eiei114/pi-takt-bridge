import assert from "node:assert/strict";
import test from "node:test";

const { buildEnqueuePrompt, normalizeAcpUpdate } = await import("../lib/takt-acp-client.ts");

test("enqueue uses TAKT's ACP /go task instruction", () => {
  assert.equal(buildEnqueuePrompt("  Add a status widget  "), "/go Add a status widget");
});

test("ACP message updates are normalized without parsing stdout", () => {
  const message = normalizeAcpUpdate({
    sessionId: "session-1",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Task queued" },
    },
  });
  assert.deepEqual(message, {
    sessionId: "session-1",
    kind: "agent_message_chunk",
    text: "Task queued",
  });

  const tool = normalizeAcpUpdate({
    sessionId: "session-1",
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      status: "completed",
    },
  });
  assert.equal(tool.status, "completed");
});
