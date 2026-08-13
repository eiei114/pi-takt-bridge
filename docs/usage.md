# Usage

## Queue a task

1. Run `/takt:enqueue` in Pi.
2. Enter the task description.
3. The extension sends `/go <task>` through `takt-acp` with
   `defaultAction: "enqueue"`.
4. TAKT writes the pending task using its own worktree defaults.

The bridge does not write `.takt/tasks.yaml` itself. ACP is the control
boundary for task creation.

## Start and stop

`/takt:start` asks for confirmation, then starts `takt run` in the current
project inside a PTY. TAKT owns task execution and worktree creation. The live
widget shows the same terminal output that a normal `takt run` terminal shows,
including intermediate output. `/takt:stop` sends Ctrl-C and uses a bounded
force-kill fallback when the child does not exit.

The extension only controls the child process it started. A `takt run` process
started in another terminal is observed through files but is not stopped by Pi.

## Live widget and diagnostics

`/takt` starts a run if no terminal session exists, or shows the current
session. `/takt:live` shows it without starting a new process. The widget is
placed above the normal Pi editor, so Pi and TAKT stay visible together. It uses
`node-pty` plus an xterm-compatible headless buffer so ANSI cursor movement,
clear-screen sequences, colors, and progress updates are rendered as a screen
rather than dumped as broken escape codes. The widget is capped to the latest
visible lines to preserve Pi's editor space.

The widget does not capture keyboard focus or forward input. Use
`/takt:stop` to stop TAKT. When the child exits, the final widget contents stay
on screen and Pi sends a success/error notification with the exit code.

`/takt:status` remains available as an optional diagnostic overlay. It is not
the execution view and is not polled into the live output widget.

The `running`, `pending`, `blocked`, `failed`, and `completed` counts are
reconciled from both sources. A running metadata record is marked `stale` only
when a matching TAKT task exposes an owner PID that is no longer alive.
