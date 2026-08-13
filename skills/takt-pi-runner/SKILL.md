---
name: takt-pi-runner
description: Execute issue and development tasks through TAKT using Pi-only agents, a named project profile, and the Pi stacked raw-output widget. Use whenever the user says to run a task with TAKT, gives a TAKT exec prompt, mentions pi-docs, asks to paste an issue into TAKT, or wants TAKT to proceed without manually typing project paths, clear, exec, and /go commands.
---

# TAKT Pi Runner

Run TAKT through the `pi-takt-bridge` tool. The bridge owns the PTY, project
cwd, preset, prompt submission, and `/go`; this keeps raw TAKT output visible
above the normal Pi editor.

## Default workflow

1. Treat the user's task body as the exact TAKT prompt. Preserve Markdown,
   code fences, issue numbers, file paths, and constraints. Do not summarize or
   rewrite it.
2. Use the named profile `pi-docs` unless the user explicitly names another
   profile.
3. Call `takt_exec_prompt` exactly once with:

   ```json
   {
     "profile": "pi-docs",
     "prompt": "<the exact user task body>",
     "clear": true,
     "sendGo": true
   }
   ```

4. Let the tool return after the prompt and `/go` are submitted. TAKT's raw
   live screen remains in the Pi project stack; do not start a second TAKT
   process or claim that the task is complete.

## Rules

- All TAKT agents, workers, reviewers, replans, and loop judges must use Pi
  when the task asks for Pi-only execution. Preserve that requirement exactly.
- Never use shell `takt exec`, `cd`, or a manually typed absolute path when
  `takt_exec_prompt` is available. The named profile is the path boundary.
- Do not use `--continue`. The default tool flow clears the old session and
  starts a fresh `takt exec <preset>`.
- Do not send the task body and `/go` through separate ad-hoc mechanisms. The
  tool uses bracketed paste and submits them in order.
- If `takt_exec_prompt` is missing, the bridge runtime is not initialized, or
  the profile is missing, stop. Report the exact missing configuration; do not
  guess a repository path or fall back to Claude/Codex/direct shell execution.
- If the user explicitly requests a different profile, pass that profile name
  and keep the task body unchanged.

## Explicit invocation

Users can force this skill with:

```text
/skill:takt-pi-runner <task body>
```

The text after the command is the task body. Use the same default profile and
tool call unless the user includes an explicit `profile: <name>` instruction.
