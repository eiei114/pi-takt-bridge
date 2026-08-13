# Architecture

```text
Pi command / project path
        │
        ├── project registry ── current cwd + registered repo/folder paths
        │                         │
        │                         └── `.takt` metadata polling for external runs
        │
        ├── takt-acp (stdio, ACP) ── enqueue in selected project
        │
        └── node-pty → `takt run` / `takt exec` in selected project
                         │
              ANSI/TTY output → xterm headless screen buffer
                         │
              Pi stacked project live widget
```

## Boundaries

- ACP is the primary protocol for enqueueing.
- Public TAKT CLI commands are used through a PTY so TAKT sees a real terminal
  and keeps its normal screen behavior.
- `.takt/runs/*/meta.json` is the persistent run state source. NDJSON logs are
  a diagnostic source; they are not used to replace the live terminal output.
- Each bridge-owned project has one PTY/xterm screen. Projects are rendered as
  a single stacked widget above the normal Pi editor, with active projects first.
- External project processes can be detected from `.takt` metadata, but their
  original PTY is not attachable safely. They use a status card; only
  bridge-owned projects show raw output.
- Pi input is not forwarded implicitly. `/takt:send` is the explicit input seam;
  `/takt:stop` owns stopping bridge children. Normal Pi shortcuts remain normal
  Pi shortcuts.
- A run is not assumed to be singular; the summary is derived from all run
  records in the project when the optional diagnostic overlay is requested.

The bridge does not import TAKT private modules. This keeps the package
compatible with global TAKT installations and makes version drift visible at
the public ACP/CLI boundary.
