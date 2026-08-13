# Roadmap

> Living roadmap for `pi-extension-template` — the template source for new Pi
> extension OSS projects. The published npm artifact is
> [`create-pi-extension`](https://www.npmjs.com/package/create-pi-extension)
> (the scaffold CLI). The repository root is template source, not published.

This file exists so the **Weekly maintenance seed planner** (and any human
maintainer) can pick the next bounded micro-maintenance candidate without
re-discovering project state. Update it whenever a release ships, a major item
is resolved, or the seed backlog is exhausted.

Status snapshot date: **2026-07-14**.

---

## 1. Current status

| Aspect | State |
|---|---|
| Latest GitHub release / tag | `v0.1.6` (2026-07-08) |
| Root `package.json` version | `0.1.6` (synced into `create-pi-extension` on publish) |
| `create-pi-extension` on npm | **Not published** — `404 Not Found`. Every `publish.yml` run on `main` fails with `E404` on `PUT create-pi-extension` (see §4, blocker). |
| Legacy `pi-extension-template` on npm | `0.1.6` is present (legacy root package; docs say it should *not* be published). |
| CI (`.github/workflows/ci.yml`) | Green on `main`. Runs typecheck, `sync:template`, tests, `pack:check`, and template-sync assertions. |
| Pi SDK alignment | Examples refreshed to Pi **0.80.x** (`@earendil-works/*` devDeps at `0.80.6`). `ctx.hasUI` guards, lifecycle events, TUI custom entries current. |
| Example coverage | extension (`hello`, typed tool, TUI dashboard, skill-bridge, package-layout), Agent Skill, prompt template, theme (all 51 tokens). |
| Tests | `greeting`, `format-table`, `create-pi-extension` CLI scaffold (unscoped + scoped), `smoke` (theme tokens, manifest entries, workflow shape), `sync-template`. |

### 1.1 What is healthy

- **CI is reliable and fast** (~30 s). Template-sync assertions prevent the
  bundled CLI template from drifting from repository source.
- **Dependabot** keeps `@earendil-works/*` and `typebox` current; PRs merge
  cleanly because examples track the latest patterns.
- **Examples are fresh** as of DOT-784 / DOT-789 / DOT-800 / DOT-815 / DOT-827 /
  DOT-828 (Pi 0.80.x lifecycle + TUI patterns).
- **Release plumbing is well-documented** (`docs/release.md`,
  `docs/publish-rerun-rollout.md`, `auto-release.yml` → `publish.yml` handoff).

### 1.2 What is at risk

- **`create-pi-extension` has never reached npm.** README badges, Quick start,
  and docs all point to a package that 404s. This is the single highest-impact
  issue and is **human-owned** (npm Trusted Publisher / package ownership).
- **Two package names on npm are out of sync with intent**: the legacy root
  `pi-extension-template` is published while the intended `create-pi-extension`
  is not.
- **No runtime validation of example extensions in CI** — only static
  `smoke.test.mjs` assertions. Example drift can land green and only surface
  for users who scaffold.

---

## 2. Project purpose & priorities

`pi-extension-template` is the **onboarding template** for the Pi package
ecosystem. Its job is to make a new contributor productive in minutes:

1. `bunx create-pi-extension my-pi-package` → working, CI-green Pi package.
2. Copy-pasteable examples for every Pi resource type (extension, skill, prompt,
   theme) that match the *current* Pi SDK.
3. A trustworthy, reproducible publish path (npm Trusted Publishing).

**Priorities (in order):**

1. **Make the package installable.** `create-pi-extension` must exist on npm.
   Everything else is secondary until onboarding actually works end-to-end.
2. **Keep examples correct** against the latest Pi SDK (the template's core
   value proposition is "examples that compile and run today").
3. **Keep the scaffold CLI ergonomic** (interactive defaults, scoped names,
   non-interactive mode for CI).
4. **Minimal, intentional docs** (Pi OSS minimal-docs policy: `docs/` is
   optional, bootstrap docs get cleaned up after generation).
5. **Low-risk maintenance hygiene** (changelog accuracy, dependency grouping,
   stale-reference cleanup).

---

## 3. Short-term goals (next 2–3 releases)

### v0.1.7 — "make onboarding real" (patch)

Goal: a user can actually run `bunx create-pi-extension` and get a published,
installable scaffold CLI. Mostly unblocks human-owned publish config; the
code-side work is diagnostics + cleanup that can ship independently.

- Resolve the `create-pi-extension` npm publish failure (human-owned config).
- Harden `publish.yml` so a "package name not registered" failure is diagnosed
  clearly instead of a bare `E404` (seed S-02).
- Reconcile `CHANGELOG.md` so released versions are dated and `Unreleased` only
  holds unreleased work (seed S-04).
- Remove stale follow-up issue references from docs (seed S-05).

### v0.2.0 — "ergonomic + verified scaffold" (minor)

Goal: the CLI is usable non-interactively and the examples are verified at
load time, not just statically.

- Non-interactive / flag-driven CLI mode (`--name`, `--yes`, `--version`) for
  CI and scripted use (seed S-08).
- Extension entrypoint shape assertion in tests (seed S-06).
- Grouped Dependabot updates for `@earendil-works/*` (seed S-09).
- Consolidate bootstrap docs per minimal-docs policy (seed S-07).

### v0.3.0 — "broader example coverage" (minor, later)

- Additional examples (e.g. MCP / custom provider, multi-extension manifest).
- Package-manager choice in the CLI (npm / pnpm / yarn), not only `bun`.

---

## 4. Known technical debt

| ID | Item | Severity | Ownership | Notes |
|---|---|---|---|---|
| TD-01 | `create-pi-extension` not on npm; `publish.yml` fails `E404` on every `main` push | **Blocker** | **Human** (npm Trusted Publisher / package ownership) | PUT returns 404 → Trusted Publisher not configured for the `create-pi-extension` name, or the package was never created on npm. README/docs/badges reference a 404 package. |
| TD-02 | Legacy root `pi-extension-template` is published on npm (`0.1.6`) despite docs saying it is not | High | **Human** (npm ownership) | Decide: deprecate on npm, or transfer. Coordinate with TD-01. |
| TD-03 | No runtime validation of example extensions — only static `smoke` assertions | Medium | AI | Examples can drift and stay green until a user scaffolds. Covered by seed S-06. |
| TD-04 | `CHANGELOG.md` has duplicate `### Changed` headers under `Unreleased` and an undated `[0.1.0] - YYYY-MM-DD` | Low | AI | Covered by seed S-04. |
| TD-05 | Docs still reference resolved follow-up placeholders (e.g. `05-implement-create-pi-extension-cli` / DOT-710 in `docs/template-sync.md`) | Low | AI | Covered by seed S-05. |
| TD-06 | Bootstrap docs (`github-template.md`, `repository-settings.md`, `typescript.md`) labeled delete-or-merge but still standalone | Low | AI | Minimal-docs policy. Covered by seed S-07. |
| TD-07 | Root `package.json` `author` is still the `YOUR_NAME` placeholder | Low | AI | Cosmetic; template source only. Tracked here only — not a bounded seed (the one-field change is <30 min). |
| TD-08 | `publish.yml` log shows `npm warn publish npm auto-corrected some errors in your package.json` | Low | AI | Re-run `npm pkg fix` in `packages/create-pi-extension/`; verify warning clears. |

> **Human-owned areas** (per project policy): release/publish, npm ownership,
> secrets, billing, permissions. AI agents must not perform these; flag them
> and stop. TD-01 and TD-02 require a human maintainer to act on npm.

---

## 5. Maintenance seed backlog

Each seed is intentionally bounded to **30–90 minutes** so the weekly planner
can promote one into a backlog issue. Promote in roughly the listed order;
earlier seeds unblock or de-risk later ones. When a seed is completed, strike
it through and move the detail into the relevant release section above.

| Seed | Title | Estimate | Depends on | Blocks |
|---|---|---|---|---|
| **S-01** ✅ | ~~Add `ROADMAP.md` to the repository~~ — done (PR #63, DOT-858) | — | — | — |
| **S-02** | Diagnose + clarify `publish.yml` `E404` failure | ~60 min | — | TD-01 (code side) |
| **S-03** | Hardening: README must not advertise a 404 npm package | ~30 min | — | TD-01 (docs side) |
| **S-04** | Reconcile `CHANGELOG.md` (dates, no dup headers) | ~45 min | — | TD-04 |
| **S-05** ✅ | ~~Remove stale follow-up issue references from docs~~ — done (DOT-1218) | ~30 min | — | TD-05 |
| **S-06** | Add extension entrypoint shape assertion test | ~60 min | — | TD-03 |
| **S-07** | Consolidate bootstrap docs (minimal-docs policy) | ~75 min | — | TD-06 |
| **S-08** | Non-interactive flags for `create-pi-extension` CLI | ~90 min | — | v0.2.0 |
| **S-09** | Group `@earendil-works/*` Dependabot updates | ~30 min | — | Hygiene |
| **S-10** | Apply `npm pkg fix` and verify publish warning clears | ~30 min | — | TD-08 |

### Seed detail + acceptance criteria

**S-01 — Add `ROADMAP.md`** ✅
- [x] `ROADMAP.md` exists at repo root and is linked from `README.md` (Docs section).
- [x] `npm run ci` passes; `scaffold/package-readme.md` cross-link considered.
- [x] Status snapshot, priorities, and ≥3 seeds with acceptance criteria present.
- *Status: ✅ complete — `ROADMAP.md` added and linked from `README.md` in PR #63 (DOT-858). Struck in the table above; the weekly planner should skip it.*

**S-02 — Diagnose + clarify `publish.yml` `E404` failure**
- [ ] `publish.yml` distinguishes "package name not registered on npm" from "version already published" and prints an actionable message for the former.
- [ ] `docs/release.md` gains a "First publish / Trusted Publisher not configured" troubleshooting subsection.
- [ ] CI still green. (Does **not** perform the publish — that is human-owned.)

**S-03 — README must not advertise a 404 npm package**
- [ ] Either the npm badge + Quick start reflect that `create-pi-extension` is pending first publish, or (after TD-01 resolves) point at the live package.
- [ ] No broken claim that `bunx create-pi-extension` resolves from npm while it 404s.
- [ ] `npm run ci` passes.

**S-04 — Reconcile `CHANGELOG.md`**
- [ ] Every `[x.y.z]` header that shipped has a real ISO date (fix `[0.1.0] - YYYY-MM-DD`).
- [ ] No duplicate `### Changed` blocks under `Unreleased`; move released items under their version headers.
- [ ] `npm run ci` passes.

**S-05 — Remove stale follow-up issue references from docs** ✅
- [x] `grep -rn "DOT-710\|05-implement-create-pi-extension-cli\|follow-up issue \`[0-9]" docs/` returns nothing stale.
- [x] Cross-links point to current docs or are removed.
- [x] `npm run ci` passes.
- *Status: ✅ complete — stale DOT-710 reference removed from `docs/template-sync.md`; regression test added in `tests/smoke.test.mjs` (DOT-1218).*

**S-06 — Extension entrypoint shape assertion test**
- [ ] A test asserts each `pi.extensions` entrypoint exports the shape Pi loads (default export / named handlers as appropriate) beyond the current static string checks.
- [ ] Test fails loudly if an entrypoint regresses; runs in CI.
- [ ] `npm run ci` passes.

**S-07 — Consolidate bootstrap docs**
- [ ] `docs/github-template.md` and `docs/repository-settings.md` folded into `docs/template-checklist.md` (or removed) per minimal-docs policy.
- [ ] No broken internal links; `README.md` Docs section updated.
- [ ] `npm run ci` passes (including `pack:check` file list).

**S-08 — Non-interactive CLI flags**
- [ ] `create-pi-extension --version` prints the package version.
- [ ] `--name <pkg>` and `--yes` allow a fully non-interactive scaffold for CI.
- [ ] New CLI test covers the non-interactive path; existing interactive tests still pass.

**S-09 — Grouped Dependabot updates**
- [ ] `.github/dependabot.yml` groups `@earendil-works/*` into a single PR.
- [ ] `npm run ci` passes; sample grouped config validated.

**S-10 — Apply `npm pkg fix`**
- [ ] `npm pkg fix` is a no-op on both root and `packages/create-pi-extension` `package.json`.
- [ ] Publish warning ("auto-corrected some errors") does not recur on the next `publish.yml` run.
- [ ] `npm run ci` passes.

---

## 6. How the weekly planner uses this file

1. Read §1 (status) and §4 (debt) to confirm nothing changed since last week.
2. Pick the **first non-struck seed in §5** whose dependencies are met and
   whose ownership allows an AI run (avoid TD-01/TD-02 — human-owned).
3. Promote it to a backlog issue scoped to the listed acceptance criteria.
4. When the seed's PR merges, strike the row here and record it under the
   target release in §3.

## 7. Conventions

- **Versioning:** the root `package.json` version is the source of truth and is
  synced into `create-pi-extension` on publish. Bump via `npm version
  <patch|minor|major>`; `auto-release.yml` tags and dispatches `publish.yml`.
- **Changelog:** keep `Unreleased` for unreleased work; date every released
  header.
- **Docs:** follow the Pi OSS minimal-docs policy — `docs/` is optional and
  bootstrap docs are delete-or-merge after setup.
- **Publish:** npm Trusted Publishing only. Never add `NPM_TOKEN`. Publish
  actions are human-owned.
