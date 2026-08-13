# Changelog

## Unreleased

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

## [0.2.0] - 2026-08-12

### Added

- Add generated-package review guardrails for release/version consistency and npm tarball/document link integrity.
- Add a schema-derived runtime config contract example with paired valid, missing, wrong-type, empty, and extra-field tests.

## [0.1.8] - 2026-08-11

### Changed

- Align the repository README with the public Pi extension README contract: standard community, CI, publish, npm, license, Pi package, Trusted Publishing, and funding badges plus canonical user-facing sections.
- Add the Discord community badge to `scaffold/package-readme.md` so CLI-generated packages start with the same badge set as maintained Pi extensions.
- Make the GitHub Template checklist copy the canonical scaffold README before placeholder replacement, giving the secondary setup path the same public README contract.
- Add sync tests that prevent required badges, funding links, canonical README sections, or workspace version metadata from drifting.

## [0.1.7] - 2026-07-20

### Added

- `create-pi-extension` interactive scaffold CLI with template copy, placeholder replacement, `git init`, and `bun install`.
- CLI smoke tests for unscoped and scoped package names.
- Repository README documents Primary (`bunx create-pi-extension`) and Secondary (`gh repo create --template`) start paths.
- `docs/template-checklist.md` splits Primary vs Secondary setup flows.
- CI `pack:check` validates the published `create-pi-extension` tarball (includes bundled `template/`).

### Changed

- Guard all example extension `ctx.ui` calls with `ctx.hasUI` so headless/RPC sessions stay safe (DOT-784, DOT-815).
- Refreshed extension examples to match current Pi 0.80.x docs: lifecycle events (`tool_execution_*`, `session_shutdown`), TUI-only custom entries (`appendEntry` + `registerEntryRenderer`), `ctx.hasUI` guards, and inline `pi.registerTool()` with `prepareArguments()` compatibility shims.
- Updated `docs/examples.md` and `docs/typescript.md` to document the refreshed patterns.
- Publish workflow now targets `create-pi-extension` in the monorepo: runs `sync:template`, validates CI, and publishes only `packages/create-pi-extension` through npm Trusted Publishing.
- Release docs updated for `create-pi-extension` Trusted Publisher settings and monorepo publish path.
- Template sync copies `scaffold/package-readme.md` into the bundled template instead of the repository README.

### Fixed

- CI now runs `sync:template` before CLI scaffold tests so the gitignored template bundle exists in clean checkouts.

## [0.1.6] - 2026-07-08

### Fixed

- Package metadata now points to the real GitHub repository so npm Trusted Publishing provenance validation can match this repo.

## [0.1.5] - 2026-07-07

### Fixed

- Publish workflow now checks the public npm registry API before OIDC setup so reruns for already-published versions exit green and skip `npm publish` intentionally.

### Changed

- Release docs and template checklist now describe canonical publish handoff and rerun behavior.
- Added `docs/publish-rerun-rollout.md` for downstream template consumers.

## [0.1.3] - 2026-06-19

### Changed

- CONTRIBUTING now reminds maintainers to run `npm pack --dry-run` after changing which `docs/` files ship in the package.

### Fixed

- README License section no longer ends with a literal `\n` placeholder.

## [0.1.2] - 2026-06-04

### Changed

- README and `docs/template-checklist.md` now follow the Pi OSS minimal-docs policy: `docs/` is optional, with explicit post-generation cleanup for template bootstrap docs.
- Template bootstrap docs (`github-template.md`, `repository-settings.md`, `typescript.md`) are labeled for delete-or-merge after setup.

## [0.1.1] - 2026-06-01

### Changed

- Publish workflow now supports npm publishing on merged package version bumps in addition to tags, releases, and manual dispatch.
- Publish workflow now installs a current npm CLI so npm Trusted Publishing OIDC is supported.
- CI and publish workflow commands no longer include literal trailing `\\n` text.

## [0.1.0] - 2026-05-29

### Added

- Initial Pi package template.
- Example extension, Agent Skill, prompt, and theme.
- CI and npm Trusted Publishing workflow.
