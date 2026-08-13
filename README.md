# pi-takt-bridge

Pi extension for running [TAKT](https://github.com/eiei114/takt) without
leaving the Pi TUI.

## Status

This is an early MVP. It deliberately uses TAKT's public `takt-acp` stdio
interface for enqueueing and runs public TAKT CLI commands inside real PTYs.
The live widget renders TAKT's terminal screen (including in-progress output,
ANSI control sequences, prompts, and the final exit notification) instead of
reducing bridge-owned execution to a status widget.

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
| `/takt` | Start or attach to the live TAKT widget |
| `/takt:live` | Show the current live/final TAKT widget |
| `/takt:enqueue [path]` | Ask TAKT ACP to add a worktree task in a selected folder |
| `/takt:project [path]` | Register another repo/folder for detection and stacked display |
| `/takt:project:remove [path]` | Stop watching a registered folder |
| `/takt:start [path]` | Confirm and start pending tasks in the selected folder |
| `/takt:clear [path]` | Clear the selected project's previous TAKT exec session |
| `/takt:exec [path]` | Start a fresh interactive `takt exec` PTY in a selected folder |
| `/takt:send [path]` | Paste multiline input into a bridge-owned interactive TAKT session |
| `/takt:stop [path]` | Confirm and interrupt a TAKT process started by Pi |
| `/takt:status` | Open the optional diagnostic state overlay |

The current Pi folder plus registered folders are monitored. Active project
screens are stacked above the normal Pi editor, with the most active project
first. Bridge-owned PTYs show raw TAKT output. A TAKT process started in another
terminal can be detected from its `.takt` state, but its original PTY cannot be
attached safely; that project is shown as an external status card instead.

Pi remains visible and keeps focus. Use `/takt:send` for explicit pasted input
to a bridge-owned `takt exec`; keyboard input is never forwarded implicitly.
Registered folders are saved outside the vault in the user config directory.

## Configuration

The bridge uses `takt-acp` and `takt` from `PATH`. Override the executable names
when needed with `TAKT_ACP_COMMAND` and `TAKT_COMMAND`. No Pi provider setting
is changed by this package.

See [`docs/usage.md`](docs/usage.md) and
[`docs/architecture.md`](docs/architecture.md) for the current boundaries and
known limitations.
