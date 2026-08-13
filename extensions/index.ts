import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { formatGreeting, type GreetingMode } from "../lib/greeting.ts";
import { StringEnum } from "@earendil-works/pi-ai";

const greetParameters = Type.Object({
  name: Type.String({ description: "Name to greet" }),
  mode: StringEnum(["short", "friendly"] as const, {
    description: "Greeting style. Prefer short unless the user asks for more warmth.",
  }),
});

type GreetParams = {
  name: string;
  mode: GreetingMode;
};

function normalizeGreetArgs(args: unknown): GreetParams {
  if (!args || typeof args !== "object") {
    return args as GreetParams;
  }

  const input = args as {
    name?: string;
    mode?: GreetingMode;
    greetingStyle?: GreetingMode;
  };

  if (input.greetingStyle && input.mode === undefined) {
    return { name: input.name ?? "Pi", mode: input.greetingStyle };
  }

  return args as GreetParams;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("template-info", {
    description: "Show TypeScript template information",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) {
        ctx.ui.notify("TypeScript-first Pi package template loaded.", "info");
      }
    },
  });

  pi.registerTool({
    name: "template_greet",
    label: "Template Greet",
    description: "Return a typed greeting from the Pi package template",
    promptSnippet: "template_greet: return a typed greeting from the template package",
    promptGuidelines: [
      "Use template_greet only when testing this template package or greeting the user.",
    ],
    parameters: greetParameters,
    prepareArguments: normalizeGreetArgs,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }], details: {} };
      }

      const message = formatGreeting(params);

      return {
        content: [{ type: "text", text: message }],
        details: { message, mode: params.mode },
      };
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("template_greet "));
      text += theme.fg("accent", `name=${args.name}`);
      text += theme.fg("dim", ` mode=${args.mode}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as { message: string; mode: string } | undefined;
      const content = result.content[0];
      const message =
        details?.message ?? (content?.type === "text" ? content.text : "");

      let text = theme.fg("success", "→ ") + theme.fg("text", message);
      if (expanded && details) {
        text += `\n${theme.fg("dim", `mode: ${details.mode}`)}`;
      }
      return new Text(text, 0, 0);
    },
  });
}