# Changelog

## 0.1.0 - Unreleased

- Add `takt_stop` and `takt_set_mode` tools so agents can recover without
  shell `taskkill` or manual `/takt:stop` / mode commands.
- Add `replace` to `takt_exec_prompt` (default true) to reconcile, stop, wait,
  dispose, and replace a running bridge-owned session before clear/exec/submit.
- Reconcile natural PTY exits and expose `live`, `stale`, `completed`, or
  `unknown` status with PID, stage, and last exit diagnostics; completed/stale
  state no longer blocks the next bridge-owned exec.
- Add fresh-runtime contract and natural-exit regression coverage for the five
  Pi tools and controller lifecycle.
- Track exec stages (`clearing` -> `waiting_prompt` -> `pasting` -> `sending_go` ->
  `running`, `completed`, plus stop/fail states) in tool updates,
  `takt_read_screen`, and the stacked widget header.
- Overlay a truncated prompt preview during `pasting` / `sending_go` so long
  issue bodies do not look like a frozen widget.
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
