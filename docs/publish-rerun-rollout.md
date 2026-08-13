# Publish rerun guard rollout

Template fix: `publish.yml` now checks `https://registry.npmjs.org/<package>/<version>` before `setup-node` configures OIDC auth. Reruns for an already-published version exit green and log `publish intentionally skipped`.

## Why downstream repos need this

Older template copies used `npm view` after `setup-node` with `registry-url`. With npm Trusted Publishing, authenticated metadata reads can return `404` even when the version exists, so the guard misses and `npm publish` fails with `403 Forbidden - You cannot publish over the previously published versions`.

## Rollout list

Apply the updated `publish.yml` skip step (or merge the latest `pi-extension-template` workflow) in:

- [ ] `pi-startup-picker` — failed run `28704558891` on `v0.2.2`
- [ ] `pi-git-delegate` — failed run `28704535034` on `0.2.2`
- [ ] `pi-baton` — failed run `28704529442` on `0.7.2`
- [ ] `pi-widget-host` — failed run `28704568448` on `0.3.3`
- [ ] `pi-widget-core` — failed run `28704566953` on `0.1.2`
- [ ] `pi-handoff-clipboard` — failed run `28704536299`
- [ ] `pi-scheduled-router` — failed run `28704552385`

## Verification after rollout

1. Open Actions → `Publish to npm`.
2. Run `workflow_dispatch` on the tag for a version that is already on npm.
3. Confirm logs contain `publish intentionally skipped`.
4. Confirm the run is green and `npm publish` did not run.
