import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const DOCS_DIR = fileURLToPath(new URL("../docs", import.meta.url));
const STALE_DOC_PATTERNS = [
  /DOT-710/,
  /05-implement-create-pi-extension-cli/,
  /follow-up issue `[0-9]/,
];

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const autoReleaseWorkflow = await readFile(new URL("../.github/workflows/auto-release.yml", import.meta.url), "utf8");
const publishWorkflow = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
const exampleTheme = JSON.parse(await readFile(new URL("../themes/example-theme.json", import.meta.url), "utf8"));
const examplePrompt = await readFile(new URL("../prompts/example.md", import.meta.url), "utf8");
const exampleSkill = await readFile(new URL("../skills/example-skill/SKILL.md", import.meta.url), "utf8");
const helloExtension = await readFile(new URL("../extensions/hello.ts", import.meta.url), "utf8");
const indexExtension = await readFile(new URL("../extensions/index.ts", import.meta.url), "utf8");
const tuiDashboardExtension = await readFile(new URL("../extensions/tui-dashboard.ts", import.meta.url), "utf8");
const packageLayoutExtension = await readFile(new URL("../extensions/package-layout/index.ts", import.meta.url), "utf8");
const skillBridgeExtension = await readFile(new URL("../extensions/skill-bridge/index.ts", import.meta.url), "utf8");

// Every Pi theme must define all 51 required color tokens.
// See https://pi.dev docs: "There are no optional colors."
const REQUIRED_THEME_COLOR_TOKENS = [
  // Core UI (11)
  "accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text", "thinkingText",
  // Backgrounds & Content (11)
  "selectedBg", "userMessageBg", "userMessageText", "customMessageBg", "customMessageText", "customMessageLabel", "toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput",
  // Markdown (10)
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  // Tool Diffs (3)
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
  // Syntax Highlighting (9)
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  // Thinking Level Borders (6)
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh",
  // Bash Mode (1)
  "bashMode",
];

const EXPECTED_EXTENSION_ENTRIES = [
  "./extensions/hello.ts",
  "./extensions/index.ts",
  "./extensions/tui-dashboard.ts",
  "./extensions/skill-bridge/index.ts",
  "./extensions/package-layout/index.ts",
];

test("package declares pi resources", () => {
  assert.deepEqual(packageJson.pi.extensions, EXPECTED_EXTENSION_ENTRIES);
  assert.deepEqual(packageJson.pi.skills, ["./skills"]);
  assert.deepEqual(packageJson.pi.prompts, ["./prompts"]);
  assert.deepEqual(packageJson.pi.themes, ["./themes"]);
});

test("pi.extensions lists each entrypoint explicitly (not directory shorthand)", () => {
  assert.notDeepEqual(packageJson.pi.extensions, ["./extensions"]);
  assert.ok(
    packageJson.pi.extensions.includes("./extensions/hello.ts"),
    "hello.ts must be listed so /template-hello loads",
  );
  assert.match(helloExtension, /registerCommand\(["']template-hello["']/);
});

test("package is discoverable as a Pi package", () => {
  assert.ok(packageJson.keywords.includes("pi-package"));
});

test("package uses public publish config", () => {
  assert.equal(packageJson.publishConfig.access, "public");
});

test("template includes npm release workflow handoff", () => {
  assert.match(autoReleaseWorkflow, /actions:\s*write/);
  assert.match(autoReleaseWorkflow, /contents:\s*write/);
  assert.match(autoReleaseWorkflow, /gh workflow run publish\.yml/);
  assert.match(publishWorkflow, /id-token:\s*write/);
  assert.match(publishWorkflow, /workflow_dispatch:/);
  assert.match(publishWorkflow, /npm publish --access public/);
});

test("publish workflow targets create-pi-extension monorepo package", () => {
  assert.match(publishWorkflow, /packages\/create-pi-extension/);
  assert.match(publishWorkflow, /sync:template/);
  assert.match(publishWorkflow, /create-pi-extension/);
  assert.match(publishWorkflow, /template\//);
});

test("publish workflow distinguishes unregistered package from already-published version", () => {
  assert.match(publishWorkflow, /not registered on npm yet/);
  assert.match(publishWorkflow, /publish intentionally skipped/);
  assert.match(publishWorkflow, /first-publish--trusted-publisher-not-configured/);
  assert.match(publishWorkflow, /npm error code E404/);
});

test("ci pack check targets create-pi-extension workspace", () => {
  assert.equal(
    packageJson.scripts.ci,
    "npm run typecheck && npm run sync:template && npm test && npm run review:guardrails && npm run pack:check && node --test tests/sync-template.test.mjs",
  );
  assert.equal(packageJson.scripts["review:guardrails"], "node scripts/check-review-guardrails.mjs");
  assert.equal(packageJson.scripts["pack:check"], "npm pack --dry-run --workspace create-pi-extension");
});

test("example theme defines all required Pi color tokens", () => {
  assert.equal(typeof exampleTheme.name, "string");
  assert.ok(exampleTheme.name.trim().length > 0, "theme name is required");
  assert.ok(!exampleTheme.name.includes("/"), "theme name must not contain /");
  assert.ok(exampleTheme.colors && typeof exampleTheme.colors === "object", "theme colors object is required");

  const present = Object.keys(exampleTheme.colors);
  const missing = REQUIRED_THEME_COLOR_TOKENS.filter((token) => !present.includes(token));
  assert.deepEqual(missing, [], `theme is missing required color tokens: ${missing.join(", ")}`);
});

test("example prompt template uses supported positional argument syntax", () => {
  // Pi prompt templates support $1, $@, $ARGUMENTS, ${N:-default}, ${@:N}. They do
  // NOT support Mustache-style {{var}} interpolation or a frontmatter `arguments` map.
  assert.doesNotMatch(examplePrompt, /\{\{/, "prompt template must not use unsupported {{...}} interpolation");
  assert.doesNotMatch(examplePrompt, /^arguments:/m, "prompt template must not declare an unsupported `arguments` frontmatter map");
});

test("example skill follows the Agent Skills frontmatter spec", () => {
  // Pi validates SKILL.md frontmatter against the Agent Skills standard
  // (see docs/skills.md). `name` and `description` are required; `name` must be
  // 1-64 lowercase a-z/0-9/hyphen chars with no leading/trailing/consecutive
  // hyphens; skills with a missing description are not loaded. `license` is a
  // documented optional field this template models for OSS packages.
  const fence = exampleSkill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fence, "SKILL.md must open with --- frontmatter fences");

  const frontmatter = fence[1];
  const field = (key) => {
    const m = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
  };

  const name = field("name");
  assert.ok(name, "skill must define `name`");
  assert.match(
    name,
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "skill `name` must be lowercase a-z/0-9/hyphens with no leading/trailing/consecutive hyphens",
  );
  assert.ok(name.length >= 1 && name.length <= 64, "skill `name` must be 1-64 chars");

  const description = field("description");
  assert.ok(description, "skill must define `description` (skills without it are not loaded)");
  assert.ok(description.length <= 1024, "skill `description` must be <= 1024 chars");

  const license = field("license");
  assert.ok(license, "example skill models the documented optional `license` field");
});

test("hello extension demonstrates current lifecycle and entry renderer patterns", () => {
  assert.match(helloExtension, /registerEntryRenderer/);
  assert.match(helloExtension, /appendEntry/);
  assert.match(helloExtension, /session_shutdown/);
  assert.match(helloExtension, /tool_execution_start/);
  assert.match(helloExtension, /tool_execution_end/);
  assert.match(helloExtension, /ctx\.hasUI/);
});

test("index extension registers tools with prepareArguments compatibility shim", () => {
  assert.match(indexExtension, /pi\.registerTool\(/);
  assert.match(indexExtension, /prepareArguments/);
  assert.doesNotMatch(indexExtension, /defineTool/);
});

test("tui-dashboard extension guards UI calls with ctx.hasUI", () => {
  assert.match(tuiDashboardExtension, /ctx\.hasUI/);
});

test("package-layout extension guards UI calls with ctx.hasUI", () => {
  assert.match(packageLayoutExtension, /ctx\.hasUI/);
});

test("hello extension guards UI calls with ctx.hasUI", () => {
  assert.match(helloExtension, /ctx\.hasUI/);
});

test("skill-bridge extension guards UI calls with ctx.hasUI", () => {
  assert.match(skillBridgeExtension, /ctx\.hasUI/);
});

test("CHANGELOG has no placeholder dates or duplicate Unreleased section headers", async () => {
  const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.doesNotMatch(changelog, /YYYY-MM-DD/, "released version headers must use real ISO dates");

  const unreleased = changelog.split(/^## \[/m)[0];
  const unreleasedHeaders = changelog.match(/^## Unreleased$/gm) ?? [];
  assert.ok(
    unreleasedHeaders.length <= 1,
    "CHANGELOG must not contain duplicate ## Unreleased headers",
  );
  const changedHeaders = unreleased.match(/^### Changed$/gm) ?? [];
  assert.ok(
    changedHeaders.length <= 1,
    "Unreleased must not contain duplicate ### Changed headers",
  );
});

test("docs do not reference resolved follow-up issue placeholders", async () => {
  const entries = await readdir(DOCS_DIR, { withFileTypes: true });
  const markdownFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));

  for (const entry of markdownFiles) {
    const content = await readFile(join(DOCS_DIR, entry.name), "utf8");
    for (const pattern of STALE_DOC_PATTERNS) {
      assert.doesNotMatch(
        content,
        pattern,
        `${entry.name} must not contain stale follow-up reference ${pattern}`,
      );
    }
  }
});
