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
| `/takt:profile:add [name]` | Save a named folder and optional exec preset once |
| `/takt:profile [name]` | List saved project profiles |
| `/takt:profile:remove [name]` | Remove a saved project profile |
| `/takt:start [path]` | Confirm and start pending tasks in the selected folder |
| `/takt:clear [path]` | Clear the selected project's previous TAKT exec session |
| `/takt:exec [path]` | Start a fresh interactive `takt exec` PTY in a selected folder |
| `/takt:send [path]` | Paste multiline input into a bridge-owned interactive TAKT session |
| `/takt:mode [pi\|takt\|pi-auto]` | Cycle or set dual-input mode (`Ctrl+Alt+T`) |
| `/takt:stop [path]` | Confirm and interrupt a TAKT process started by Pi |
| `/takt:status` | Open the optional diagnostic state overlay |

The bundled `takt-pi-runner` Agent Skill calls the `takt_exec_prompt` tool for
the common issue-body → `/go` flow. It uses the `pi-docs` profile by default,
prefers a concise prompt, replaces a running bridge-owned session when needed,
clears the old session, starts a fresh preset, submits `/go`, and switches to
`pi-auto`. Raw output stays in the stacked Pi widget; long pastes show a
truncated preview while `stage` is `pasting` / `sending_go`. Agents can also use
`takt_stop` and `takt_set_mode` for recovery. `takt_read_screen` reports
`live`, `stale`, `completed`, or `unknown` with PID, stage, and last exit when
available. If the tool or profile is missing, the skill reports the configuration
error instead of guessing a path.

After a session is live, dual input modes let you keep talking to TAKT without
leaving Pi:

- `pi` (default): editor stays on Pi; use `/takt:send` or tools
- `takt`: keys go to the active bridge-owned PTY; `Esc` returns to `pi`
- `pi-auto`: entered automatically after a successful `takt_exec_prompt`; Pi can
  inspect with `takt_read_screen` and send follow-ups with `takt_send_input`
  (destructive input still confirms)

The current Pi folder plus registered folders are monitored. Active project
screens are stacked above the normal Pi editor, with the most active project
first. Bridge-owned PTYs show raw TAKT output. A TAKT process started in another
terminal can be detected from its `.takt` state, but its original PTY cannot be
attached safely; that project is shown as an external status card instead.
The bridge only stops PTYs it created, and bounded stop failures are reported
instead of retried indefinitely.

Default mode keeps Pi focused. Use `/takt:mode` or `Ctrl+Alt+T` when you want
direct TAKT focus or Pi-auto follow-ups.
Registered folders and named profiles are saved outside the vault in the user
config directory. A profile makes a folder path optional for every command:

```text
/takt:profile:add pi-docs
# enter C:\Users\Keisu\Projects\OSS\takt and pi-docs once
/takt:clear pi-docs
/takt:exec pi-docs
```

Profile names also work with an `@` prefix. An Agent Skill alone cannot change
the child process working directory, so the bridge uses a persistent profile
instead of silently guessing a path.

## Configuration

The bridge uses `takt-acp` and `takt` from `PATH`. Override the executable names
when needed with `TAKT_ACP_COMMAND` and `TAKT_COMMAND`. No Pi provider setting
is changed by this package.

See [`docs/usage.md`](docs/usage.md) and
[`docs/architecture.md`](docs/architecture.md) for the current boundaries and
known limitations.
