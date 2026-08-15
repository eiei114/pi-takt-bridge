---
name: takt-pi-orchestrator
description: "Act as the front door for TAKT in Pi: ask focused setup and intent questions, decide whether the request needs task planning, execution, or recovery, prepare the exact project/profile, then route to the specialized TAKT Skill. Use whenever the user mentions TAKT, the Pi TAKT bridge, queueing, running, setting up, or recovering a TAKT task. Do not start side effects before the route and target are clear."
---

# TAKT Pi Orchestrator

Start here for ambiguous or multi-step TAKT requests. Keep the first
conversation in Pi; use TAKT only after the target and intended lifecycle are
clear.

## Intake questions

Resolve only what is missing:

1. **Target** — exact repository/folder or an existing named profile. Never
   guess a path.
2. **Intent** — setup only, discuss and queue a pending task, execute now, or
   inspect/recover an existing session.
3. **Execution policy** — preset/profile, Pi-only provider constraint, worktree
   expectation, and whether external side effects are allowed.
4. **Task contract** — goal, scope, non-goals, acceptance criteria, and
   validation evidence when the request is implementation work.

Do not ask questions whose answers are already explicit in the user request or
project guidance. Do not create a task or start a process during intake.

## Route

| Resolved intent | Specialized path |
|---|---|
| Discuss requirements, then make a pending task | `takt-pi-task-planner` |
| Run an already finalized task/issue | `takt-pi-runner` |
| Inspect, stop, replace, or recover a session | `takt-pi-runner` recovery flow |
| Setup only | `takt_project_setup` and stop |

## Setup handoff

Once the route requires TAKT, call `takt_project_setup` with the exact target
cwd and a stable profile. Prefer the `pi-docs` preset unless the user names a
different one. Setup is idempotent and must not copy tasks, runs, sessions,
logs, or credentials. If the target is not exact, stop and ask rather than
guess.

After setup, automatically read the selected specialized Skill and continue in
the same conversation; do not make the human choose an internal Skill name.
Read `../takt-pi-task-planner/SKILL.md` for the planner route and
`../takt-pi-runner/SKILL.md` for the runner/recovery route.
The orchestrator does not replace the planner or runner instructions, and it
does not call `takt_exec_prompt` directly for a request that still needs
planning.

## Safety boundary

- Queueing requires a finalized body and user confirmation.
- Execution requires explicit intent to run; planning alone never runs.
- Preserve Pi-only/provider/worktree constraints exactly; do not invent them.
- Keep the handoff seamless. Briefly state the next step in human terms
  (`要件を詰めます`, `タスクとして積みます`, or `実行します`) without
  exposing internal routing mechanics unless useful.
