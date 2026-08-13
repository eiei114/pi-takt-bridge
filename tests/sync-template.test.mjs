import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEMPLATE_ROOT = join(ROOT, "packages", "create-pi-extension", "template");
const CLI_PACKAGE_JSON = join(ROOT, "packages", "create-pi-extension", "package.json");
const ROOT_PACKAGE_JSON = join(ROOT, "package.json");
const ROOT_PACKAGE_LOCK = join(ROOT, "package-lock.json");
const ROOT_README = join(ROOT, "README.md");

const STANDARD_BADGES = [
  "Join dotfield.xyz on Discord",
  "CI",
  "Publish",
  "npm version",
  "npm downloads",
  "License: MIT",
  "Pi package",
  "Trusted Publishing",
];

const STANDARD_HEADINGS = [
  "## What this is",
  "## Features",
  "## Install",
  "## Quick start",
  "## Package contents",
  "## Development",
  "## Release",
  "## Docs",
  "## Security",
  "## Links",
  "## License",
];

function templatePath(...segments) {
  return join(TEMPLATE_ROOT, ...segments);
}

test("synced template contains expected scaffold files", () => {
  for (const relativePath of [
    "package.json",
    "README.md",
    "extensions/index.ts",
    "docs/examples.md",
    ".github/workflows/ci.yml",
  ]) {
    assert.ok(existsSync(templatePath(relativePath)), `missing ${relativePath}`);
  }
});

test("synced template excludes monorepo paths", () => {
  assert.equal(existsSync(templatePath("packages")), false);
  assert.equal(existsSync(templatePath(".git")), false);
  assert.equal(existsSync(templatePath("package-lock.json")), false);
  assert.equal(existsSync(templatePath("ROADMAP.md")), false);
  for (const path of [
    "docs/github-template.md",
    "docs/repository-settings.md",
    "docs/template-sync.md",
    "docs/typescript.md",
  ]) {
    assert.equal(existsSync(templatePath(path)), false, `CLI template must omit bootstrap-only ${path}`);
  }
});

test("synced template package.json is standalone", () => {
  const templatePackageJson = JSON.parse(readFileSync(templatePath("package.json"), "utf8"));
  assert.equal(templatePackageJson.workspaces, undefined);
  assert.equal(templatePackageJson.scripts?.["sync:template"], undefined);
  assert.equal(templatePackageJson.scripts?.["sync:template:check"], undefined);
  assert.equal(templatePackageJson.name, "pi-extension-template");
  assert.equal(templatePackageJson.scripts?.["pack:check"], "npm pack --dry-run");
  assert.equal(templatePackageJson.scripts?.["review:guardrails"], "node scripts/check-review-guardrails.mjs");
  assert.match(templatePackageJson.scripts?.ci, /npm run review:guardrails/);
});

test("synced template README comes from scaffold source", () => {
  const scaffoldReadme = readFileSync(join(ROOT, "scaffold", "package-readme.md"), "utf8");
  const templateReadme = readFileSync(templatePath("README.md"), "utf8");
  assert.equal(templateReadme, scaffoldReadme);
  assert.match(templateReadme, /PACKAGE_DISPLAY_NAME/);
  assert.doesNotMatch(templateReadme, /bunx create-pi-extension/);
  assert.match(templateReadme, /PACKAGE_NAME@PACKAGE_VERSION/);
});

test("repository and scaffold READMEs keep the standard public contract", () => {
  for (const readmePath of [ROOT_README, join(ROOT, "scaffold", "package-readme.md")]) {
    const readme = readFileSync(readmePath, "utf8");

    for (const badge of STANDARD_BADGES) {
      assert.ok(readme.includes(`[![${badge}]`), `${badge} badge missing in ${readmePath}`);
    }

    const headings = [...readme.matchAll(/^##[ \t]+.*$/gm)].map(([heading]) => heading);
    let previousIndex = -1;
    for (const heading of STANDARD_HEADINGS) {
      const headingIndex = headings.indexOf(heading);
      assert.ok(headingIndex > previousIndex, `${heading} missing or out of order in ${readmePath}`);
      previousIndex = headingIndex;
    }

    assert.match(readme, /buymeacoffee\.com\/ekawano114m/);
  }
});

test("create-pi-extension version matches repository version", () => {
  const rootPackageJson = JSON.parse(readFileSync(ROOT_PACKAGE_JSON, "utf8"));
  const cliPackageJson = JSON.parse(readFileSync(CLI_PACKAGE_JSON, "utf8"));
  const packageLock = JSON.parse(readFileSync(ROOT_PACKAGE_LOCK, "utf8"));
  assert.equal(cliPackageJson.version, rootPackageJson.version);
  assert.equal(cliPackageJson.name, "create-pi-extension");
  assert.equal(packageLock.version, rootPackageJson.version);
  assert.equal(packageLock.packages?.[""]?.version, rootPackageJson.version);
  assert.equal(packageLock.packages?.["packages/create-pi-extension"]?.version, cliPackageJson.version);
});
