# Pi Extension Template

[![Join dotfield.xyz on Discord](https://img.shields.io/badge/Join%20dotfield.xyz%20on%20Discord-5865F2?logo=discord&logoColor=white)](https://discord.gg/4945dXZVW5)

[![CI](https://github.com/eiei114/pi-extension-template/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-extension-template/actions/workflows/ci.yml)
[![Publish](https://github.com/eiei114/pi-extension-template/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-extension-template/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/create-pi-extension.svg)](https://www.npmjs.com/package/create-pi-extension)
[![npm downloads](https://img.shields.io/npm/dm/create-pi-extension.svg)](https://www.npmjs.com/package/create-pi-extension)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)
[![Trusted Publishing](https://img.shields.io/badge/npm-Trusted%20Publishing-blue.svg)](docs/release.md)
<a href="https://buymeacoffee.com/ekawano114m"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60"></a>

> Template for building Pi packages with extensions, Agent Skills, prompts, and themes.

## What this is

This repository is the **template source** for new Pi extension OSS projects. The published npm package is [`create-pi-extension`](https://www.npmjs.com/package/create-pi-extension), not the root `pi-extension-template` name.

## Features

- Interactive `create-pi-extension` CLI for scoped and unscoped package names.
- TypeScript-first examples for extensions, Agent Skills, prompts, themes, tools, and TUI components.
- GitHub Actions CI, npm Trusted Publishing, security policy, issue templates, and release automation.
- Canonical public README with standard badges, install paths, quick start, package contents, and security guidance.
- Canonical scaffold README shared by CLI-first generation and the GitHub Template setup checklist.

## Install

Create a new Pi extension package with the published CLI:

```bash
bunx create-pi-extension@latest my-pi-package
```

## Quick start

### Primary path (recommended)

Scaffold a new project with the CLI:

```bash
bunx create-pi-extension my-pi-package
```

The CLI copies the bundled template, replaces placeholders, removes bootstrap docs, and can run `git init` plus `bun install`. See [`docs/template-checklist.md`](docs/template-checklist.md) for the minimal follow-up checklist.

For a scoped package name:

```bash
bunx create-pi-extension @my-scope/my-pi-tool
```

### Secondary path: GitHub Template

Create a repository from this template when you prefer GitHub-first onboarding:

```bash
gh repo create OWNER/my-pi-package \
  --template eiei114/pi-extension-template \
  --clone
```

Then follow the **Secondary path** section in [`docs/template-checklist.md`](docs/template-checklist.md) for manual placeholder replacement, metadata, and post-generation cleanup.
That checklist first copies `scaffold/package-readme.md` to `README.md`, giving GitHub Template users the same standard badges and README structure as CLI-generated packages.

## Legacy npm package

Do **not** use `pi install npm:pi-extension-template` as the main onboarding path. Use **`create-pi-extension`** to scaffold a new project instead. The legacy root-package install will be removed from npm in a future release. After you publish your own extension, install it with `pi install npm:YOUR_PACKAGE_NAME` as documented in that project's README.

## Package contents

| Path | Purpose |
|---|---|
| Repository root | Template source (not published to npm) |
| `packages/create-pi-extension/` | Published scaffold CLI |
| `scaffold/` | Generated-package README source synced into the bundled template |
| `docs/` | Maintainer docs and template bootstrap guides |

## Development

```bash
npm install
npm run ci
```

`npm run ci` runs typecheck, `sync:template`, CLI scaffold tests, a `create-pi-extension` pack check, and template sync assertions.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/template-sync.md`](docs/template-sync.md).

## Release

Releases publish **`create-pi-extension`** to npm through Trusted Publishing. The root template source is not published.

See [`docs/release.md`](docs/release.md) for setup details.

## Docs

- [`docs/template-checklist.md`](docs/template-checklist.md) — Primary vs Secondary setup flows
- [`docs/template-sync.md`](docs/template-sync.md) — refresh `packages/create-pi-extension/template/` before CLI publish
- [`docs/template-sync-checklist.md`](docs/template-sync-checklist.md) — checklist for syncing and verifying the bundled template
- [`docs/examples.md`](docs/examples.md) — extension, skill, prompt, and theme examples
- [`docs/release.md`](docs/release.md) — Trusted Publishing and monorepo publish path
- [`ROADMAP.md`](ROADMAP.md) — current status, priorities, and the maintenance seed backlog

## Security

Pi packages can execute code with your local permissions. Review extensions before installing third-party packages.

For vulnerability reporting, see [`SECURITY.md`](SECURITY.md).

## Links

- npm (`create-pi-extension`): https://www.npmjs.com/package/create-pi-extension
- GitHub: https://github.com/eiei114/pi-extension-template
- Issues: https://github.com/eiei114/pi-extension-template/issues

## License

MIT
