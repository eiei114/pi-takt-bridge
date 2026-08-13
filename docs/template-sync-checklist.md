# Template Sync Checklist

`create-pi-extension` CLI を publish する前に、テンプレートソース（このリポジトリルート）と CLI にバンドルされるテンプレートが一致していることを確認するためのチェックリスト。

## Before sync

- [ ] `docs/examples.md` が現在の extension / skill / prompt / theme の example を正しく説明している
- [ ] 新しく追加したファイルが `sync-template.ts` の exclude リストで除外されていない
- [ ] 削除したファイルが `sync-template.ts` の exclude リストから削除されている
- [ ] 新規 resource type（extension, skill, prompt, theme）を追加した場合、`docs/examples.md` に例を追記した
- [ ] `scaffold/package-readme.md` に新しい resource type の記述が反映されている（該当する場合）

## Run sync

- [ ] `bun run sync:template` を実行して `packages/create-pi-extension/template/` を再生成する
- [ ] 生成されたファイル数が期待通りであることを確認する（目安: 47 ファイル。`ROADMAP.md` は maintainer-only のため除外）

## Verify synced template

- [ ] `packages/create-pi-extension/template/` に必要なファイルがすべて含まれている
  - [ ] `package.json`（workspaces 削除・sync:template script 削除済み）
  - [ ] `README.md`（scaffold/package-readme.md の内容）
  - [ ] `extensions/hello.ts`, `extensions/index.ts`, `extensions/tui-dashboard.ts`, `extensions/skill-bridge/`, `extensions/package-layout/`
  - [ ] `skills/example-skill/SKILL.md`
  - [ ] `prompts/example.md`
  - [ ] `themes/example-theme.json`
  - [ ] `docs/examples.md`
  - [ ] `.github/workflows/ci.yml` と `.github/workflows/publish.yml`
- [ ] 除外されるべきディレクトリが含まれていないこと
  - [ ] `packages/` がない
  - [ ] `.git/` がない
  - [ ] `node_modules/` がない
  - [ ] `package-lock.json` がない

## Verify template package.json

- [ ] `workspaces` フィールドが削除されている
- [ ] `scripts.ci` が `"npm run typecheck && npm test && npm run pack:check"` になっている
- [ ] `scripts["sync:template"]` と `scripts["sync:template:check"]` が削除されている
- [ ] `scripts["pack:check"]` が `"npm pack --dry-run"` になっている
- [ ] `version` が root `package.json` の repository version と一致している

## CI check

- [ ] `npm run typecheck` が通る
- [ ] `npm test` がすべてのテストにパスする
  - [ ] `tests/greeting.test.mjs`
  - [ ] `tests/format-table.test.mjs`
  - [ ] `tests/smoke.test.mjs`
  - [ ] `tests/create-pi-extension-cli.test.mjs`
- [ ] `npm run sync:template` を再実行して `tests/sync-template.test.mjs` がパスする
- [ ] `node --test tests/sync-template.test.mjs` がパスする

## CLI scaffold test（オプションだが推奨）

- [ ] 一時ディレクトリで `node packages/create-pi-extension/src/cli.mjs test-refresh-pkg` を実行する
- [ ] 生成されたプロジェクトで `npm run ci` が通る
- [ ] `pi -e .` が extension をロードできる（Pi が利用可能な環境で）

## Before publish

- [ ] CHANGELOG.md に新しいバージョンのリリースノートを追記した
- [ ] 既存の issue / PR と競合していないことを確認した
- [ ] `docs/release.md` の手順に従って publish する準備ができている

## Post-publish

- [ ] `npm view create-pi-extension` で新しいバージョンが反映されていることを確認する
- [ ] 新しいバージョンの CLI で scaffold して動作確認する
