---
name: takt-pi-runner
description: Execute finalized issue and development tasks through TAKT using Pi-only agents, a named project profile, and the Pi stacked raw-output widget. Use after takt-pi-orchestrator routes an execution or recovery request, or when the user explicitly invokes takt-pi-runner. Do not trigger as the front door for generic TAKT requests or vague setup/planning; route those through takt-pi-orchestrator first.
---

# TAKT Pi Runner

Run TAKT through the `pi-takt-bridge` tool. The bridge owns the PTY, project
cwd, preset, prompt submission, and `/go`; this keeps raw TAKT output visible
above the normal Pi editor.

## Project bootstrap

Use `takt_project_setup` before the first run for a repository that is not yet
registered or does not have a project-local `.takt` directory. Pass the exact
target `cwd`, a stable `profile` name, and the intended `preset`:

```json
{
  "profile": "pi-takt-bridge",
  "cwd": "C:/Users/Keisu/Projects/OSS/pi-takt-bridge",
  "preset": "pi-docs",
  "copyGlobalPreset": true
}
```

This creates `.takt/exec/presets/` and `.takt/workflows/`, registers both the
project and named profile, and copies only the selected preset from the global
TAKT directory when the project does not already have it. It never copies
tasks, runs, sessions, logs, credentials, or other global runtime state.
The operation is idempotent. Use `overwrite: true` only when explicitly moving
an existing profile to a different folder.

For interactive setup, `/takt:project:init [profile]` performs the same setup
for the current Pi project. Use `/takt:project` or `/takt:profile:add` only for
manual registration or when the setup tool is unavailable.

## Default workflow

1. Prefer a concise TAKT prompt. Preserve issue numbers, file paths, constraints,
   and code fences. Long GitHub issue bodies may be shortened to the actionable
   scope (files to change, must/must-not, verification). The widget already
   truncates long pasted bodies during `pasting` / `sending_go`.
2. If the target profile/project is not ready, call `takt_project_setup` first.
3. Use the named profile `pi-docs` unless the user explicitly names another
   profile.
4. Call `takt_read_screen` first when a session may already be running.
5. Call `takt_exec_prompt` with:

   ```json
   {
     "profile": "pi-docs",
     "prompt": "<concise task body>",
     "clear": true,
     "sendGo": true,
     "replace": true
   }
   ```

5. Let the tool return after the prompt and `/go` are submitted. A successful
   submit switches input mode to `pi-auto` automatically. TAKT's raw live screen
   remains in the Pi project stack; do not start a second TAKT process or claim
   that the task is complete.

## Recovery

- If `takt_exec_prompt` reports an already-running session, call `takt_read_screen`
  first, then call it again with `replace: true` (the default) or call `takt_stop`
  first. Replacement reconciles, stops the bridge-owned PTY, waits, disposes,
  clears, and only then starts a fresh PTY.
- If the profile is missing, call `takt_project_setup` with the exact target cwd
  instead of editing `profiles.json` manually. If the setup tool is missing,
  report the runtime/package mismatch and stop.
- If the widget looks frozen, read `status:`, `pid:`, `stage:`, and `lastExit:`
  from `takt_read_screen` before assuming a hang. `pasting` / `sending_go`
  intentionally show a prompt preview; `live`, `stale`, `completed`, and
  `unknown` describe lifecycle ownership.
- Use `takt_set_mode` only when you need an explicit mode change outside the
  automatic post-submit `pi-auto` transition.
- Never use shell `taskkill`, `takt exec`, or absolute path guessing when the
  bridge tools are available.

## Rules

- All TAKT agents, workers, reviewers, replans, and loop judges must use Pi
  when the task asks for Pi-only execution. Preserve that requirement exactly.
- Never use shell `takt exec`, `cd`, or a manually typed absolute path when
  `takt_exec_prompt` is available. The named profile is the path boundary.
- Do not use `--continue`. The default tool flow clears the old session and
  starts a fresh `takt exec <preset>`.
- Do not send the task body and `/go` through separate ad-hoc mechanisms unless
  recovering inside an already-running `pi-auto` session with `takt_send_input`.
- If any required bridge tool is missing or its runtime is not initialized after
  a fresh Pi reload, stop. Report the exact tool name, profile name, and target
  cwd as a reload/package mismatch; do not use `taskkill`, Computer Use, guessed
  paths, or fall back to Claude/Codex/direct shell execution.
- If the user explicitly requests a different profile, pass that profile name
  and keep the chosen task body unchanged.

## Explicit invocation

Users can force this skill with:

```text
/skill:takt-pi-runner <task body>
```

The text after the command is the task body. Use the same default profile and
tool call unless the user includes an explicit `profile: <name>` instruction.
