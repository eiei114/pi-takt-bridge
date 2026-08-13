# pi-takt-bridge

Pi extension for running [TAKT](https://github.com/eiei114/takt) without
leaving the Pi TUI.

## Status

This is an early MVP. It deliberately uses TAKT's public `takt-acp` stdio
interface for enqueueing and runs the public `takt run` CLI inside a real PTY.
The live panel renders TAKT's terminal screen (including in-progress output,
ANSI control sequences, prompts, and the final exit notification) instead of
reducing execution to a status widget.

## Prerequisites

- Pi 0.83 or later
- TAKT 0.58 or later installed as the `takt` and `takt-acp` commands
- A configured TAKT provider/model

## Install

```text
pi install git:github.com/eiei114/pi-takt-bridge
```

For local development:

```text
pi -e C:/path/to/pi-takt-bridge/extensions/index.ts
```

## Commands

| Command | Purpose |
|---|---|
| `/takt` | Start or attach to the live TAKT terminal |
| `/takt:live` | Attach to the current live/final TAKT terminal screen |
| `/takt:enqueue` | Ask TAKT ACP to add a worktree task, without starting it |
| `/takt:start` | Confirm and start all pending tasks in the live terminal |
| `/takt:stop` | Confirm and interrupt the `takt run` process started by Pi |
| `/takt:status` | Open the optional diagnostic state overlay |
| `Ctrl+Shift+T` | Start/attach to the live TAKT screen; press it again to return |

While the live panel is focused, input is forwarded to TAKT as-is. `Escape` is
also forwarded to TAKT; use `Ctrl+Shift+T` to return to Pi and `Ctrl+C` to stop
the child. When TAKT exits, the final screen remains visible and Pi reports the
exit code.

## Configuration

The bridge uses `takt-acp` and `takt` from `PATH`. Override the executable names
when needed with `TAKT_ACP_COMMAND` and `TAKT_COMMAND`. No Pi provider setting
is changed by this package.

See [`docs/usage.md`](docs/usage.md) and
[`docs/architecture.md`](docs/architecture.md) for the current boundaries and
known limitations.
