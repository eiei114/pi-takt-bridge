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
project. TAKT owns task execution and worktree creation. `/takt:stop` sends an
interrupt and uses a bounded force-kill fallback when the child does not exit.

The extension only controls the child process it started. A `takt run` process
started in another terminal is observed through files but is not stopped by Pi.

## Widget and overlay

The widget polls `.takt/runs/*/meta.json` and `takt list --non-interactive
--format json`. It is read-only and is cleared for an idle project. `/takt` or
`Ctrl+Shift+T` opens a fuller snapshot.

The `running`, `pending`, `blocked`, `failed`, and `completed` counts are
reconciled from both sources. A running metadata record is marked `stale` only
when a matching TAKT task exposes an owner PID that is no longer alive.
