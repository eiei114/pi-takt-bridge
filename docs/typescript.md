# TypeScript Guide

> **Template bootstrap doc.** Use while learning this template's TypeScript layout and dependency rules. Delete this file or summarize the policies you keep in README Development once setup is done, unless it still adds maintainer value.

This is a TypeScript-first Pi package template.

## Layout

```txt
extensions/*.ts      Pi extension entrypoints
lib/*.ts             Shared TypeScript helpers
skills/*/SKILL.md    Agent Skills
prompts/*.md         Prompt templates
themes/*.json        Themes
tests/*.test.mjs     Smoke tests
tests/*.test.ts      Optional TypeScript tests if you add a TS test runner
```

Pi loads TypeScript extensions directly, so no build step is required for normal use.

## Strict mode

`tsconfig.json` keeps `strict: true`. Prefer fixing types over loosening compiler options.

## Extension entrypoints

Two entrypoint styles are shown:

- `extensions/hello.ts`: single-file extension
- `extensions/index.ts`: index-style extension that imports shared code from `lib/`

For larger packages, keep entrypoints thin and put reusable logic in `lib/`.

Both files are listed explicitly under `pi.extensions` in `package.json`. Do not
"simplify" this to the directory shorthand `["./extensions"]`: Pi resolves a
manifest directory entry to its `index.ts`, so `hello.ts` (and its
`/template-hello` command) would silently fail to load. Listing each entry file
keeps every documented entrypoint active.

## TypeBox schemas

Use TypeBox schemas for custom tool parameters.

```ts
import { Type } from "typebox";

const parameters = Type.Object({
  name: Type.String({ description: "Name to greet" }),
});
```

## String enums

For string choices, use `StringEnum` from `@earendil-works/pi-ai`.

```ts
import { StringEnum } from "@earendil-works/pi-ai";

const mode = StringEnum(["short", "friendly"] as const, {
  description: "Greeting style",
});
```

This emits a JSON Schema `enum`, which is friendlier to model providers than a union of string literals.

## TUI availability (`ctx.hasUI`)

Extensions may run in headless or RPC-only sessions where `ctx.ui` is unavailable.
Guard every `ctx.ui` call with `ctx.hasUI` (or return early from command handlers when `!ctx.hasUI`).

```ts
pi.on("session_start", async (_event, ctx) => {
  if (ctx.hasUI) {
    ctx.ui.setStatus("my-ext", "ready");
  }
});
```

## Runtime dependencies vs peer dependencies

Pi bundles core packages for extension authors. Keep Pi-provided packages as `peerDependencies` and also install them as `devDependencies` for local typechecking.

Use `peerDependencies` for:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`
- `typebox`

Use `dependencies` for runtime packages your extension imports that Pi does not provide.

Use `devDependencies` for local-only tools such as TypeScript, test runners, and linters.

## Package contents

Control npm package contents with `package.json` `files`. Prefer this over `.npmignore` so the published package stays explicit.