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
- Detect external project activity through `.takt` state with status-only cards.
- Keep the queue/run reconciliation overlay as an optional diagnostic view.
