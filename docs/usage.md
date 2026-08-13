# Usage

## Queue a task

1. Run `/takt:enqueue [path]` in Pi. Omit the path for the current Pi project.
2. Enter the task description.
3. The extension sends `/go <task>` through `takt-acp` with
   `defaultAction: "enqueue"`.
4. TAKT writes the pending task using its own worktree defaults.

The bridge does not write `.takt/tasks.yaml` itself. ACP is the control
boundary for task creation.

## Start and stop

`/takt:start` asks for confirmation, then starts `takt run` in the selected
project inside a PTY. Pass an absolute folder path to target another registered
or unregistered project, for example `/takt:start C:\\work\\repo`. TAKT owns
task execution and worktree creation. The live widget shows the same terminal
output that a normal `takt run` terminal shows, including intermediate output.
`/takt:stop [path]` sends Ctrl-C and uses a bounded force-kill fallback when the
child does not exit.

`/takt:project C:\\work\\repo` registers a folder for recurring detection. The
registry is stored in the user config directory, not in the vault. The current
Pi folder is always included.

### Named project profiles

Use a profile when a project is used repeatedly. Register the path and default
exec preset once:

```text
/takt:profile:add pi-docs
```

Enter `C:\\Users\\Keisu\\Projects\\OSS\\takt` as the folder and `pi-docs` as
the optional preset. Later, the profile name resolves to that folder for all
project-targeting commands:

```text
/takt:clear pi-docs
/takt:exec pi-docs
/takt:send pi-docs
/takt:status pi-docs
```

`/takt:profile` lists saved profiles and `/takt:profile:remove pi-docs` removes
the alias without removing the watched project folder. Profile data lives in
the user config directory. The bridge never searches arbitrary directories or
silently selects a similarly named repository. `@pi-docs` is accepted as an
explicit alias form.

## Agent Skill automation

The package includes `takt-pi-runner`. When the user asks Pi to execute an issue
through TAKT, the skill calls `takt_exec_prompt` with the exact task body. The
tool resolves the named profile, runs `takt clear`, starts a fresh
`takt exec <preset>`, submits the body as a bracketed paste, then submits
`/go`. It returns after submission while the live raw PTY remains visible in
the Pi project stack.

Force the skill with `/skill:takt-pi-runner <task body>`. If the bridge tool or
profile is unavailable, the skill stops with a configuration report; it never
falls back to a guessed cwd, direct shell `takt exec`, or another provider.

The extension only controls child processes it started. A `takt run` or
`takt exec` process started in another terminal is observed through `.takt`
metadata once it creates a run, but Pi cannot safely attach to that terminal's
raw PTY. Such a project is shown as an external status card and is never killed
by Pi.

## Interactive `takt exec`

`/takt:clear [path]` optionally clears the previous project exec session first.
Then `/takt:exec [path]` starts a fresh `takt exec` process in a selected project.
The command intentionally does not pass `--continue`. Use `/takt:send [path]`
to open Pi's multiline editor and send the issue body or `/go` explicitly to
that project. The bridge uses terminal bracketed-paste markers, so newlines stay
inside one TAKT input; submit the issue body first, then send `/go`. This keeps
normal Pi input focused on Pi while preserving the raw TAKT PTY screen above it.

## Live widget and diagnostics

`/takt` starts a run in the current project if no terminal session exists, or
shows the current stack. `/takt:live` shows the stack without starting a new
process. The widget is placed above the normal Pi editor, so Pi and multiple
TAKT projects stay visible together. It uses `node-pty` plus an xterm-compatible
headless buffer so ANSI cursor movement, clear-screen sequences, colors, and
progress updates are rendered as a screen rather than dumped as broken escape
codes. Each panel is capped to the latest visible lines to preserve Pi's editor
space.

The widget does not capture keyboard focus or forward input. Use
`/takt:send` for explicit interactive input and `/takt:stop` to stop TAKT. When
a bridge-owned child exits, its final widget contents stay on screen and Pi
sends a success/error notification with the exit code.

`/takt:status` remains available as an optional diagnostic overlay. It is not
the execution view and is not polled into the live output widget.

The `running`, `pending`, `blocked`, `failed`, and `completed` counts are
reconciled from both sources. A running metadata record is marked `stale` only
when a matching TAKT task exposes an owner PID that is no longer alive.
