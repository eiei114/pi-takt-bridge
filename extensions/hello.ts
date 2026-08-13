import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

interface TemplateStatusEntry {
  message: string;
  timestamp: number;
}

export default function (pi: ExtensionAPI) {
  let injectTemplateHint = true;
  let turnCount = 0;

  pi.registerEntryRenderer<TemplateStatusEntry>("template-status", (entry, { expanded }, theme) => {
    const data = entry.data ?? { message: "Template status", timestamp: Date.now() };
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(`${theme.fg("accent", "[template]")} ${data.message}`, 0, 0));
    if (expanded) {
      box.addChild(new Text(theme.fg("dim", new Date(data.timestamp).toLocaleString()), 0, 0));
    }
    return box;
  });

  // Fires once when a Pi session starts (new or resumed).
  pi.on("session_start", async (_event, ctx) => {
    turnCount = 0;
    if (ctx.hasUI) {
      ctx.ui.setStatus("template", "Pi template loaded");
    }
  });

  // Fires before each agent turn, after the system prompt is assembled.
  // Return { systemPrompt } to append teaching context without blocking the turn.
  pi.on("before_agent_start", async (event) => {
    if (!injectTemplateHint) {
      return undefined;
    }
    injectTemplateHint = false;

    return {
      systemPrompt:
        event.systemPrompt +
        "\n\n[pi-extension-template] Event handlers in extensions/hello.ts are active. Type ?template for help, or try /template-dashboard and /template-layout.",
    };
  });

  // Fires when the user submits input, before the agent processes it.
  // Return { action: "handled" } to short-circuit the agent for simple commands.
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") {
      return { action: "continue" };
    }

    if (event.text.trim() === "?template") {
      if (ctx.hasUI) {
        ctx.ui.notify(
          "Pi extension template loaded. Try /template-hello, /template-dashboard, /template-layout, /template-skill-info, or inspect tool_call / tool_result logs.",
          "info",
        );
      }
      return { action: "handled" };
    }

    return { action: "continue" };
  });

  pi.on("turn_start", async (_event, ctx) => {
    turnCount += 1;
    if (ctx.hasUI) {
      ctx.ui.setStatus("template", `Turn ${turnCount}...`);
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("template", `Turn ${turnCount} complete`);
    }
  });

  // Fires when tool execution begins. Use alongside tool_call when you need both
  // lifecycle logging and argument mutation/blocking hooks.
  pi.on("tool_execution_start", async (event) => {
    console.log(`[pi-extension-template] tool_execution_start: ${event.toolName} (${event.toolCallId})`);
    return undefined;
  });

  // Fires before a built-in or extension tool executes. Non-blocking logging only.
  pi.on("tool_call", async (event) => {
    console.log(`[pi-extension-template] tool_call: ${event.toolName} (${event.toolCallId})`);
    return undefined;
  });

  // Fires after a tool finishes. Logs outcome; extensions may also return content/details overrides.
  pi.on("tool_result", async (event) => {
    const status = event.isError ? "error" : "ok";
    console.log(`[pi-extension-template] tool_result: ${event.toolName} ${status} (${event.toolCallId})`);
    return undefined;
  });

  pi.on("tool_execution_end", async (event) => {
    const status = event.isError ? "error" : "ok";
    console.log(`[pi-extension-template] tool_execution_end: ${event.toolName} ${status} (${event.toolCallId})`);
    return undefined;
  });

  pi.on("session_shutdown", async () => {
    turnCount = 0;
  });

  pi.registerCommand("template-hello", {
    description: "Show a hello message from this Pi package template",
    handler: async (args, ctx) => {
      const name = args.trim() || "Pi";
      if (ctx.hasUI) {
        ctx.ui.notify(`Hello, ${name}!`, "info");
      }
    },
  });

  pi.registerCommand("template-status", {
    description: "Append a TUI-only status card that is not sent to the LLM",
    handler: async (args) => {
      pi.appendEntry<TemplateStatusEntry>("template-status", {
        message: args.trim() || "Template package loaded",
        timestamp: Date.now(),
      });
    },
  });
}