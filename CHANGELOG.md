# Changelog

## 0.1.0 - Unreleased

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
