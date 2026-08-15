# Changelog

## 0.1.0 - Unreleased

- Hide quiet external pending/blocked/failed/stale cards after 30 minutes and
  show all queue counts, without deleting TAKT task or run data.
- Add `takt_enqueue_task` and the `takt-pi-task-planner` Skill for a confirmed
  Pi-side planning → ACP queue flow that does not start execution.
- Add `takt-pi-orchestrator` as the TAKT front door for intake, setup, and
  routing to the planner or runner Skills.
- Clear the stacked live widget when a bridge-owned TAKT process exits or is
  stopped; final lifecycle diagnostics remain available through status tools.
- Clear the live widget when a bridge-tracked interactive exec run completes
  before its long-lived `takt exec` prompt process exits; ignore historical
completed runs and PTY silence as completion signals.
- Show only the current project as a compact preparing card when startup has
  no active TAKT counts, instead of retaining multiple idle project panels.
- Add `takt_project_setup` and `/takt:project:init` to create project-local
  `.takt` scaffolding, copy one selected global exec preset without copying
  runtime state, and register a reusable project profile idempotently.
- Ignore removed folders when loading the project registry so stale entries do
  not prevent a fresh runtime from starting.
- Add `takt_stop` and `takt_set_mode` tools so agents can recover without
  shell `taskkill` or manual `/takt:stop` / mode commands.
- Add `replace` to `takt_exec_prompt` (default true) to reconcile, stop, wait,
  dispose, and replace a running bridge-owned session before clear/exec/submit;
  `replace: true` always performs the clear step.
- Reconcile natural PTY exits and expose `live`, `stale`, `completed`, or
  `unknown` status with PID, stage, and last exit diagnostics; completed/stale
  state no longer blocks the next bridge-owned exec.
- Keep clear-session failures bounded and clean up their bridge-owned PTY before
  returning the timeout or exit error.
- Add fresh-runtime contract and natural-exit regression coverage for the five
  Pi tools and controller lifecycle.
- Track exec stages (`clearing` -> `waiting_prompt` -> `pasting` -> `sending_go` ->
  `running`, `completed`, plus stop/fail states) in tool updates,
  `takt_read_screen`, and the stacked widget header.
- Overlay a truncated prompt preview during `pasting` / `sending_go` so long
  issue bodies do not look like a frozen widget.
- Keep the bridge-owned live widget repainting at a short interval while a PTY
  is active, so in-place TAKT output remains visible even when host-side screen
  events are coalesced.
- Switch to `pi-auto` automatically after a successful `takt_exec_prompt`
  submit; abort/failure paths always stop the child PTY before returning.
- Update `takt-pi-runner` Skill for replace/stop recovery and concise prompts.
- Add ACP-first TAKT task enqueueing.
- Add worktree-safe `takt run` PTY process control.
- Add stacked live ANSI terminal widgets for multiple project folders.
- Add explicit `takt clear` before fresh exec when requested.
- Add fresh `takt exec` PTY launch and explicit multiline input sending.
- Add persistent named project profiles for path-free repeated commands.
- Add bundled `takt-pi-runner` Skill and `takt_exec_prompt` tool for exact
  issue-body → `/go` submission through the Pi PTY widget.
- Clamp every live-panel line to Pi's current terminal width so narrow
  terminals do not crash during rendering.
- Wait for the live `Assistant>` prompt before pasting, then send `/go`
  after a short settle instead of a 600s assistant-response wait.
- Stop the bridge-owned TAKT PTY when `takt_exec_prompt` fails mid-submit
  so orphan processes do not block retries.
- Add dual input modes cycled by `Ctrl+Alt+T` / `/takt:mode`:
  `pi` (default), `takt` (direct PTY focus), and `pi-auto`.
- Add `takt_read_screen` and `takt_send_input` tools for pi-auto follow-ups,
  with confirmation for destructive auto input.
- Detect external project activity through `.takt` state with status-only cards.
- Keep the queue/run reconciliation overlay as an optional diagnostic view.
