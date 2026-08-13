# Release

This repository publishes **`create-pi-extension`** to npm using Trusted Publishing with GitHub Actions OIDC.

The root `pi-extension-template` package is the **template source** and is not published to npm. Only `packages/create-pi-extension` is published.

Do not add `NPM_TOKEN` or long-lived npm tokens to GitHub Secrets.

## One-time npm setup

On npmjs.com, configure Trusted Publishing for **`create-pi-extension`**:

- Publisher: GitHub Actions
- Repository: `eiei114/pi-extension-template`
- Workflow filename: `publish.yml`
- Permissions: publish (and stage publish if used)

Remove or update any Trusted Publisher entry that still targets the legacy root package name `pi-extension-template`.

## Publish

```bash
npm version patch
git push
```

On `main`, `.github/workflows/auto-release.yml` checks the root `package.json` **repository version**. If `v<version>` does not exist yet, it creates the tag, creates the GitHub Release, then explicitly dispatches `.github/workflows/publish.yml` for that tag.

The `v*.*.*` tag also triggers `.github/workflows/publish.yml`, which syncs the bundled template, runs CI, and publishes `create-pi-extension@<version>` to npm when tags are pushed manually.

Publishing also runs when a GitHub Release is published, and can be run manually from GitHub Actions with `workflow_dispatch`.

`publish.yml` runs `npm run sync:template` before publish so the tarball includes the current **Bundled template** under `packages/create-pi-extension/template/`.

The workflow skips `create-pi-extension@<version>` if that exact package version already exists on npm.

### Rerun and manual dispatch

`publish.yml` checks the public npm registry API before `setup-node` configures OIDC auth. That keeps already-published reruns green:

- `workflow_dispatch` on an existing tag/ref
- duplicate `publish.yml` runs for the same `v<version>`
- auto-release handoff retries after a successful publish

When the version already exists, the job still runs validation but logs `publish intentionally skipped` and exits without calling `npm publish`.

Do not use `npm view` after `setup-node` with `registry-url` for this guard. Trusted Publishing OIDC can make authenticated metadata reads look like `404`, which leads to duplicate `E403` publish failures.

See also `docs/publish-rerun-rollout.md` for downstream rollout notes.

### First publish / Trusted Publisher not configured

`publish.yml` logs two different situations before `npm publish`:

| Registry check | Meaning | Workflow behavior |
| --- | --- | --- |
| `GET /create-pi-extension` returns **404** | Package name is **not registered** on npm yet | Continues to publish; logs Trusted Publisher setup guidance |
| `GET /create-pi-extension/<version>` returns **200** | That exact version is **already published** | Logs `publish intentionally skipped` and exits green without `npm publish` |
| Package exists, version returns **404** | New version for an existing package | Continues to publish |

If Trusted Publisher is missing or still targets the legacy `pi-extension-template` package, `npm publish` fails with:

```text
npm error code E404
npm error 404 Not Found - PUT https://registry.npmjs.org/create-pi-extension - Not found
```

That `E404` is **not** the rerun skip path. It means npm rejected the publish because the package name is not registered under your account yet, or OIDC Trusted Publishing is not authorized for `create-pi-extension` + `publish.yml`.

Fix (human-owned, one-time on npmjs.com):

1. Open **create-pi-extension** on npm (or create the package name under your npm org/user if npm allows pre-registration).
2. Add **Trusted Publisher**: GitHub Actions, repository `eiei114/pi-extension-template`, workflow filename `publish.yml`, permissions **publish** (and stage publish if used).
3. Remove or update any Trusted Publisher entry that still targets the legacy root package `pi-extension-template`.
4. Re-run `publish.yml` via `workflow_dispatch` on the release tag/ref (for example `v0.1.7`).

Do not add `NPM_TOKEN` to GitHub Secrets; this repository uses OIDC Trusted Publishing only.

## Workflow guardrail

Do not ship a new Pi OSS package or version bump with only `package.json` changes.
The repository must include the release workflow pair:

- `.github/workflows/auto-release.yml` creates `v<version>` tags and GitHub Releases from `main` version bumps.
- `.github/workflows/publish.yml` syncs the template and publishes `create-pi-extension` through Trusted Publishing.

Important: tags or releases created by `GITHUB_TOKEN` do not reliably fan out into another workflow through normal `push.tags` or `release.published` triggers. The template keeps publishing reliable by having `auto-release.yml` explicitly dispatch `publish.yml` after creating the tag/release. If you change the release flow, keep one explicit handoff path: `workflow_dispatch` from auto-release, `repository_dispatch`, or `workflow_run` on the auto-release workflow.

## GitHub Actions requirements

- `permissions: id-token: write`
- `permissions: actions: write` on auto-release so it can dispatch `publish.yml`
- `auto-release.yml` must call `gh workflow run publish.yml --ref "$TAG" -f ref="$TAG"`, or `publish.yml` must have an equivalent explicit handoff trigger such as `workflow_run`
- GitHub-hosted runner
- Node.js 24, so the release job uses a current npm CLI for Trusted Publishing
- Bun (for `sync:template` before publish)
- No `NPM_TOKEN`
- `npm publish` from `packages/create-pi-extension` in the configured workflow file

## First release checklist

- [ ] Root `package.json` version is final (synced into `create-pi-extension` on publish)
- [ ] `packages/create-pi-extension/package.json` name is `create-pi-extension`
- [ ] `repository.url` points to the real GitHub repository
- [ ] npm Trusted Publisher targets `create-pi-extension` + `publish.yml`
- [ ] `npm run ci` passes
- [ ] `npm pack --dry-run` in `packages/create-pi-extension` contains `template/`
- [ ] CHANGELOG.md has the release date
