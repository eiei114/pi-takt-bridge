# Release

Releases are tagged with `vX.Y.Z`. The tag workflow publishes the root package
through npm Trusted Publishing (OIDC); it never uses `NPM_TOKEN` or
`NODE_AUTH_TOKEN`.

Before tagging:

```bash
npm run ci
git diff --check
```

Configure npm Trusted Publishing for package `pi-takt-marionette`, repository
`eiei114/pi-takt-marionette`, workflow `publish.yml`.
