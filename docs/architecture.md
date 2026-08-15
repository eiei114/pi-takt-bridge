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
        ├── takt_exec_prompt tool ── reconcile → idempotent stop (owned PTY only) → wait → dispose → clear → fresh exec → prompt → `/go` → pi-auto
        ├── takt_stop / takt_set_mode tools ── agent recovery without shell/taskkill
        │
        ├── takt_enqueue_task / takt-acp (stdio, ACP) ── enqueue confirmed task
        │
        └── node-pty → `takt run` / `takt exec` in selected project
                         │
              ANSI/TTY output → xterm headless screen buffer
                         │
              Pi stacked project live widget
```

## Boundaries

- ACP is the primary protocol for enqueueing.
- `takt_enqueue_task` is the agent-facing queue seam. It accepts a finalized
  task body, resolves an explicit profile/project, and stops after ACP creates
  the pending task. `takt-pi-orchestrator` is the front door that resolves
  intent and setup before handing off to `takt-pi-task-planner` for
  clarification or `takt-pi-runner` for execution/recovery.
- Public TAKT CLI commands are used through a PTY so TAKT sees a real terminal
  and keeps its normal screen behavior.
- `.takt/runs/*/meta.json` is the persistent run state source. NDJSON logs are
  a diagnostic source; they are not used to replace the live terminal output.
  Status views distinguish `live`, `stale`, `completed`, and `unknown`, and
  expose the observed PID, stage, and last exit when available.
- Each bridge-owned project has one PTY/xterm screen. Projects are rendered as
  a single stacked widget above the normal Pi editor, with active projects first.
- Named profiles persist an explicit alias, project cwd, and optional exec preset
  in the user config directory. The bridge does not scan arbitrary folders or
  silently guess a similarly named repository.
- `takt_project_setup` is the explicit bootstrap seam for new targets. It
  creates project-local `.takt/exec/presets` and `.takt/workflows`, registers
  the project/profile, and may copy only the selected global exec preset. It
  never copies run state, sessions, logs, tasks, or credentials.
- Project registry loading drops folders that no longer exist, preventing a
  stale registration from failing runtime initialization before the active
  project can be observed.
- The bundled Agent Skill uses `takt_exec_prompt` for the profile-bound prompt
  submission flow; shell execution is not used as a substitute because it would
  hide the child PTY from the Pi widget.
- External project processes can be detected from `.takt` metadata, but their
  original PTY is not attachable safely. They use a status card; only
  bridge-owned projects show raw output.
- Default input mode is `pi`: input is not forwarded implicitly. `/takt:send`
  remains the explicit seam, and `/takt:stop` owns stopping bridge children.
- Optional dual-input modes cycle with a shortcut: `pi` → `takt` (human types
  into the active bridge-owned PTY) → `pi-auto` (Pi may send allowed follow-ups).
  A successful `takt_exec_prompt` enters `pi-auto` automatically. Destructive
  auto actions still require confirmation. External status cards are never
  writable. Stop retries are bounded; a timeout is returned as an explicit
  bridge error instead of starting a second process.
- Exec progress is tracked as stages and shown in tool updates, `takt_read_screen`,
  and the widget header. Natural PTY exits reconcile the controller, retained
  screen session, stage, and last exit before another exec is allowed. For an
  interactive `takt exec`, the bridge also tracks the run slug created after
  submission and clears the live widget when that run reaches a terminal
  status; historical completed runs are not treated as the current run.
  When no active counts are observed during startup, only the current project
  renders a compact preparing card. During paste stages the widget overlays a
  truncated prompt preview instead of the full raw body.
- External pending, blocked, failed, and stale activity keeps its latest queue
  or run timestamp. Non-running cards disappear after 30 minutes without new
  activity, but the bridge never mutates `.takt/tasks.yaml` or run history as
  part of that display cleanup.
- A run is not assumed to be singular; the summary is derived from all run
  records in the project when the optional diagnostic overlay is requested.

The bridge does not import TAKT private modules. This keeps the package
compatible with global TAKT installations and makes version drift visible at
the public ACP/CLI boundary.
