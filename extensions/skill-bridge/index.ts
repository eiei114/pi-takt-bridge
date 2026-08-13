import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const baseDir = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
  pi.on("resources_discover", () => ({
    skillPaths: [join(baseDir, "SKILL.md")],
  }));

  pi.registerCommand("template-skill-info", {
    description: "Explain how this extension contributes an Agent Skill",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      ctx.ui.notify(
        "Skill bridge active. Try /skill:template-skill-bridge or ask the agent to use the template skill.",
        "info",
      );
    },
  });
}
