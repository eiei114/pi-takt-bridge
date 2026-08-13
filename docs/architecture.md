# Architecture

```text
Pi command / shortcut
        │
        ├── takt-acp (stdio, ACP) ── enqueue task
        │
        └── node-pty → takt run ── TAKT worktree execution
                         │
              ANSI/TTY output + input forwarding
                         │
                 xterm headless screen buffer
                         │
                    Pi live terminal panel
```

## Boundaries

- ACP is the primary protocol for enqueueing.
- The CLI is used through a PTY for the public `takt run` execution entry point
  so TAKT sees a real terminal and keeps its normal screen behavior.
- `.takt/runs/*/meta.json` is the persistent run state source. NDJSON logs are
  a diagnostic source; they are not used to replace the live terminal output.
- The live panel is a terminal screen, not a parsed status summary. Input is
  forwarded to the PTY, except `Ctrl+Shift+T` (detach) and `Ctrl+C` (stop).
- A run is not assumed to be singular; the summary is derived from all run
  records in the project when the optional diagnostic overlay is requested.

The bridge does not import TAKT private modules. This keeps the package
compatible with global TAKT installations and makes version drift visible at
the public ACP/CLI boundary.
