import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatTable } from "../../lib/format-table.ts";
import { defaultPackageLayoutConfig } from "./lib/config.ts";
import { getPackageResourceRows } from "./lib/stats.ts";

const config = defaultPackageLayoutConfig;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus(config.statusLabel, config.title);
    }
  });

  pi.registerCommand("template-layout", {
    description: "Show Pi package resource layout from a multi-file extension",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      const rows = getPackageResourceRows();
      const tableLines = formatTable(rows, [
        { header: "Kind", render: (row) => row.kind },
        { header: "Path", render: (row) => row.path },
        { header: "Examples", render: (row) => row.examples },
      ]);

      const widgetLines = [config.title, "", ...tableLines];
      if (config.showSkillHint) {
        widgetLines.push("", "Skills: static skills/ dir + extensions/skill-bridge via resources_discover");
      }

      ctx.ui.setWidget("template-layout", widgetLines, { placement: "belowEditor" });
      ctx.ui.notify("Package layout shown below the editor. Clear with /template-layout-clear.", "info");
    },
  });

  pi.registerCommand("template-layout-clear", {
    description: "Clear the package layout widget",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      ctx.ui.setWidget("template-layout", undefined);
    },
  });
}
