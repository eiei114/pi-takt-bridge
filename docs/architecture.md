# Architecture

```text
Pi command / project path
        │
        ├── project registry ── current cwd + registered repo/folder paths
        │                         │
        │                         └── `.takt` metadata polling for external runs
        │
        ├── profile registry ── explicit alias → project cwd + exec preset
        │
        ├── takt_exec_prompt tool ── replace? → clear → fresh exec → prompt → `/go` → pi-auto
        ├── takt_stop / takt_set_mode tools ── agent recovery without shell/taskkill
        │
        ├── takt-acp (stdio, ACP) ── enqueue in selected project
        │
        └── node-pty → `takt run` / `takt exec` in selected project
                         │
              ANSI/TTY output → xterm headless screen buffer
                         │
              Pi stacked project live widget
```

## Boundaries

- ACP is the primary protocol for enqueueing.
- Public TAKT CLI commands are used through a PTY so TAKT sees a real terminal
  and keeps its normal screen behavior.
- `.takt/runs/*/meta.json` is the persistent run state source. NDJSON logs are
  a diagnostic source; they are not used to replace the live terminal output.
- Each bridge-owned project has one PTY/xterm screen. Projects are rendered as
  a single stacked widget above the normal Pi editor, with active projects first.
- Named profiles persist an explicit alias, project cwd, and optional exec preset
  in the user config directory. The bridge does not scan arbitrary folders or
  silently guess a similarly named repository.
- The bundled Agent Skill uses `takt_exec_prompt` for the exact prompt
  submission flow; shell execution is not used as a substitute because it
  would hide the child PTY from the Pi widget.
- External project processes can be detected from `.takt` metadata, but their
  original PTY is not attachable safely. They use a status card; only
  bridge-owned projects show raw output.
- Default input mode is `pi`: input is not forwarded implicitly. `/takt:send`
  remains the explicit seam, and `/takt:stop` owns stopping bridge children.
- Optional dual-input modes cycle with a shortcut: `pi` → `takt` (human types
  into the active bridge-owned PTY) → `pi-auto` (Pi may send allowed follow-ups).
  A successful `takt_exec_prompt` enters `pi-auto` automatically. Destructive
  auto actions still require confirmation. External status cards are never
  writable.
- Exec progress is tracked as stages and shown in tool updates, `takt_read_screen`,
  and the widget header. During paste stages the widget overlays a truncated
  prompt preview instead of the full raw body.
- A run is not assumed to be singular; the summary is derived from all run
  records in the project when the optional diagnostic overlay is requested.

The bridge does not import TAKT private modules. This keeps the package
compatible with global TAKT installations and makes version drift visible at
the public ACP/CLI boundary.
