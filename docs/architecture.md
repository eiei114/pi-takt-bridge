# Architecture

```text
Pi command / shortcut
        │
        ├── takt-acp (stdio, ACP) ── enqueue task
        │
        └── takt run (child process) ── TAKT worktree execution
                         │
                  .takt/tasks + .takt/runs/meta.json
                         │
                   poll + reconcile → read-only widget
```

## Boundaries

- ACP is the primary protocol for enqueueing and future live events.
- The CLI is used only for the public `takt run` execution entry point and
  queue reconciliation.
- `.takt/runs/*/meta.json` is the persistent run state source. NDJSON logs are
  intentionally reserved for the details view in the next phase.
- The widget has no action keys. Commands and the overlay own controls.
- A run is not assumed to be singular; the summary is derived from all run
  records in the project.

The bridge does not import TAKT private modules. This keeps the package
compatible with global TAKT installations and makes version drift visible at
the public ACP/CLI boundary.
