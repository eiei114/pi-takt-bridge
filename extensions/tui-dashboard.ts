import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Box, Container, Loader, matchesKey, Text } from "@earendil-works/pi-tui";
import { formatTable } from "../lib/format-table.ts";

interface DashboardRow {
  component: string;
  role: string;
}

const DEMO_ROWS: DashboardRow[] = [
  { component: "Box", role: "Padded container with optional background" },
  { component: "Loader", role: "Animated spinner while content loads" },
  { component: "Text table", role: "Column-aligned rows via formatTable()" },
];

async function showDashboard(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  await ctx.ui.custom(
    (tui, theme, _kb, done) => {
      const container = new Container();
      const box = new Box(1, 1, (text) => theme.bg("toolPendingBg", text));
      const title = new Text(theme.fg("accent", theme.bold("Template TUI Dashboard")), 0, 0);
      const tableLines = formatTable(DEMO_ROWS, [
        { header: "Component", render: (row) => row.component },
        { header: "Role", render: (row) => row.role },
      ]);
      const table = new Text(tableLines.map((line) => theme.fg("text", line)).join("\n"), 0, 0);
      const footer = new Text(theme.fg("dim", "Press Enter or Esc to close"), 0, 0);
      const loader = new Loader(
        tui,
        (text) => theme.fg("accent", text),
        (text) => theme.fg("muted", text),
        "Composing dashboard…",
      );

      box.addChild(title);
      box.addChild(loader);
      container.addChild(box);

      loader.start();

      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        loader.stop();
        done(undefined);
      };

      timer = setTimeout(() => {
        if (closed) {
          return;
        }
        loader.stop();
        box.removeChild(loader);
        box.addChild(table);
        box.addChild(footer);
        tui.requestRender();
      }, 1200);

      return {
        render: (width: number) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
            close();
          }
        },
      };
    },
    { overlay: true },
  );
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("template-tui", "dashboard ready");
    }
  });

  pi.registerCommand("template-dashboard", {
    description: "Show composed TUI components (Box, Loader, table)",
    handler: async (_args, ctx) => {
      await showDashboard(ctx);
    },
  });
}
