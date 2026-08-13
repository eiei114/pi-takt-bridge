# Examples

This template ships examples for each Pi package resource type and several extension API patterns.

These source files (`extensions/`, `skills/`, `prompts/`, `themes/`) are the **single source of truth**:
the `sync:template` script copies them into the `create-pi-extension` CLI bundle before publish.
To update what the CLI generates, edit these files and re-run `bun run sync:template`.
Scaffold a new project to get a copy of the latest examples:

```bash
bunx create-pi-extension my-pi-package
```

Then try the examples in your scaffolded project with `pi -e .`.

For a full walkthrough, see the [README](../README.md).

For maintainers, see [`docs/template-sync-checklist.md`](template-sync-checklist.md) for the sync procedure before publish.

## Extension

`extensions/hello.ts` registers:

- `/template-hello`
- `/template-status` (TUI-only custom entry via `appendEntry` + `registerEntryRenderer`)
- session, turn, and tool lifecycle event handlers
- a small session status indicator

Try it with:

```bash
pi -e .
```

Then run:

```txt
/template-hello YourName
/template-status Package ready
?template
```

## Agent Skill (package manifest)

`skills/example-skill/SKILL.md` demonstrates a minimal Agent Skill. Its
frontmatter uses the required `name` and `description` fields plus the optional
`license` field, following the Agent Skills spec that Pi validates against
(see `docs/skills.md`).

Replace it with your real workflow instructions.

## Agent Skill (extension `resources_discover`)

`extensions/skill-bridge/` contributes `template-skill-bridge` at runtime:

- `index.ts` returns `skillPaths` from the `resources_discover` event
- `SKILL.md` lives beside the extension entrypoint

Commands:

```txt
/template-skill-info
/skill:template-skill-bridge
```

Use this pattern when a skill should ship with an extension instead of the top-level `skills/` directory.

## Typed custom tool

`extensions/index.ts` registers:

- `/template-info`
- `template_greet` custom tool

The tool demonstrates:

- `pi.registerTool()` with TypeBox object parameters
- a string enum schema via `StringEnum`
- `prepareArguments()` for legacy argument compatibility before schema validation
- custom `renderCall` / `renderResult` rendering
- shared logic imported from `lib/greeting.ts`
- TUI `renderCall` / `renderResult` via `Text`

## TUI component composition

`extensions/tui-dashboard.ts` demonstrates composing `@earendil-works/pi-tui` primitives:

- `Box` for padded, themed containers
- `Loader` for spinner-style progress feedback
- column-aligned tables built with shared `lib/format-table.ts` and rendered via `Text`

Command:

```txt
/template-dashboard
```

`pi-tui` does not ship a dedicated `Table` or `Spinner` component; this example uses `Loader` for spinners and a small table formatter for aligned columns.

## Multi-file extension layout

`extensions/package-layout/` demonstrates a subdirectory extension with local modules:

- `lib/config.ts` — typed configuration defaults
- `lib/stats.ts` — resource metadata helpers
- imports from package-wide `lib/format-table.ts`

Commands:

```txt
/template-layout
/template-layout-clear
```

## Prompt template

`prompts/example.md` demonstrates a tiny prompt template with one positional
argument (`/example <topic>`). Pi expands templates with `$1`, `$@`, and
`${1:-default}` — it does not support Mustache-style `{{var}}` placeholders.

## Theme

`themes/example-theme.json` ships a complete, loadable dark theme as a starting
point. Pi requires every theme to define all 51 color tokens, so edit the
palette in place rather than trimming tokens. Remove `themes/` (and the
`pi.themes` manifest entry) if your package does not ship themes.

## Shared library helpers

| File | Purpose |
|---|---|
| `lib/greeting.ts` | Greeting helpers used by `template_greet` |
| `lib/format-table.ts` | Monospace table formatter for widgets and TUI examples |
| `lib/config-contract.ts` | Schema-derived runtime config validation with valid/invalid contract tests |
