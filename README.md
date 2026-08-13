# pi-takt-bridge

Pi extension for queuing and monitoring [TAKT](https://github.com/eiei114/takt)
without leaving the Pi TUI.

## Status

This is an early MVP. It deliberately uses TAKT's public `takt-acp` stdio
interface for enqueueing and the public `takt run` CLI for worktree execution.
It does not import TAKT internals or parse stdout as its primary protocol.

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
| `/takt` or `/takt:status` | Open the current run/queue overlay |
| `/takt:enqueue` | Ask TAKT ACP to add a worktree task, without starting it |
| `/takt:start` | Confirm and start all pending tasks with `takt run` |
| `/takt:stop` | Confirm and interrupt the `takt run` process started by Pi |
| `Ctrl+Shift+T` | Open status |

The read-only widget appears above the editor while a task is queued or
running. It is cleared when the project is idle; controls stay in commands and
the status overlay rather than being hidden in widget text.

## Configuration

The bridge uses `takt-acp` and `takt` from `PATH`. Override the executable names
when needed with `TAKT_ACP_COMMAND` and `TAKT_COMMAND`. No Pi provider setting
is changed by this package.

See [`docs/usage.md`](docs/usage.md) and [`docs/architecture.md`](docs/architecture.md)
for the current boundaries and known limitations.
