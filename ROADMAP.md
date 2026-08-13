# Roadmap

## Phase 0 — current

- ACP handshake and enqueue path
- Worktree-preserving `takt run` PTY and live Pi project stack widget
- Registered multi-project folders with external `.takt` state detection
- Fresh `takt exec` PTY and explicit multiline `/takt:send` input
- Persistent `.takt/runs/*/meta.json` reconciliation
- Optional diagnostic overlay and live widget start/stop commands

## Phase 1 — next

- PTY resize, mouse/scrollback, and alternate-screen polish
- NDJSON detail view linked from the diagnostic overlay
- Better task/run matching and stale-process diagnostics
- Windows process integration tests
- Safe raw-output capture/attach protocol for externally started TAKT sessions

## Phase 2 — later

- Explicit worktree selection and per-task start
- Direct execution only when an isolated workspace is explicit
- Optional ACP-backed live execution updates
