import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOwnerRepo } from "./utils.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEMPLATE_ROOT = join(PACKAGE_ROOT, "template");

const PLACEHOLDER_PATTERN = /PACKAGE_NAME|PACKAGE_DISPLAY_NAME|PACKAGE_VERSION|OWNER\/REPO|YOUR_NAME|\bOWNER\b|\bREPO\b/;

export const BOOTSTRAP_DOC_PATHS = [
  "docs/github-template.md",
  "docs/repository-settings.md",
  "docs/template-sync.md",
  "docs/typescript.md",
];

export function resolveTemplateRoot() {
  if (!existsSync(TEMPLATE_ROOT)) {
    throw new Error(
      "Bundled template is missing. Run `bun run sync:template` from the pi-extension-template repository root.",
    );
  }
  return TEMPLATE_ROOT;
}

function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
      continue;
    }
    if (entry.isFile()) {
      mkdirSync(dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
    }
  }
}

function isTextFile(filePath) {
  try {
    const buffer = readFileSync(filePath);
    return !buffer.includes(0);
  } catch {
    return false;
  }
}

function applyTextReplacements(content, replacements, licenseYear) {
  let next = content;
  for (const [from, to] of replacements) {
    next = next.replaceAll(from, to);
  }
  next = next.replace(/Copyright \(c\) \d{4}/g, `Copyright (c) ${licenseYear}`);
  return next;
}

function walkFiles(directory, visitor) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, visitor);
      continue;
    }
    if (entry.isFile()) {
      visitor(entryPath);
    }
  }
}

function patchPackageJson(packageJsonPath, options) {
  const { owner, repo } = parseOwnerRepo(options.ownerRepo);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  packageJson.name = options.packageName;
  packageJson.description = options.description;
  packageJson.author = options.author;
  packageJson.repository = {
    type: "git",
    url: `https://github.com/${owner}/${repo}`,
  };
  packageJson.bugs = {
    url: `https://github.com/${owner}/${repo}/issues`,
  };
  packageJson.homepage = `https://github.com/${owner}/${repo}#readme`;

  if (packageJson.scripts && typeof packageJson.scripts === "object") {
    const scripts = { ...packageJson.scripts };
    delete scripts["sync:template"];
    delete scripts["sync:template:check"];
    scripts.ci = "npm run typecheck && npm test && npm run review:guardrails && npm run pack:check";
    scripts["pack:check"] = "npm pack --dry-run";
    packageJson.scripts = scripts;
  }

  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

export function assertNoPlaceholders(outputDir) {
  const offenders = [];
  walkFiles(outputDir, (filePath) => {
    if (!isTextFile(filePath)) {
      return;
    }
    const content = readFileSync(filePath, "utf8");
    if (PLACEHOLDER_PATTERN.test(content)) {
      offenders.push(filePath);
    }
  });

  if (offenders.length > 0) {
    throw new Error(`Unreplaced template placeholders remain:\n${offenders.join("\n")}`);
  }
}

export function scaffoldProject(outputDir, options) {
  const templateRoot = resolveTemplateRoot();
  assertOutputDirectoryAvailable(outputDir);

  copyDirectory(templateRoot, outputDir);

  const { owner, repo } = parseOwnerRepo(options.ownerRepo);
  const templatePackageJson = JSON.parse(readFileSync(join(templateRoot, "package.json"), "utf8"));
  const replacements = [
    ["OWNER/REPO", `${owner}/${repo}`],
    ["PACKAGE_NAME", options.packageName],
    ["PACKAGE_DISPLAY_NAME", options.displayName],
    ["PACKAGE_VERSION", templatePackageJson.version],
    ["YOUR_NAME", options.author],
    ["OWNER", owner],
    ["REPO", repo],
  ];

  walkFiles(outputDir, (filePath) => {
    if (!isTextFile(filePath)) {
      return;
    }
    const original = readFileSync(filePath, "utf8");
    const replaced = applyTextReplacements(original, replacements, options.licenseYear);
    if (replaced !== original) {
      writeFileSync(filePath, replaced);
    }
  });

  patchPackageJson(join(outputDir, "package.json"), options);
  assertNoPlaceholders(outputDir);
}

export function cleanupBootstrapDocs(outputDir) {
  const removed = [];
  for (const relativePath of BOOTSTRAP_DOC_PATHS) {
    const filePath = join(outputDir, relativePath);
    if (existsSync(filePath)) {
      rmSync(filePath);
      removed.push(relativePath);
    }
  }
  return removed;
}

export function runPostSetup(outputDir) {
  if (process.env.CREATE_PI_EXTENSION_SKIP_POST_SETUP === "1") {
    return;
  }

  execFileSync("git", ["init"], { cwd: outputDir, stdio: "inherit" });
  execFileSync("bun", ["install"], { cwd: outputDir, stdio: "inherit" });
}

function assertSafeOutputDirectoryName(directoryName) {
  if (typeof directoryName !== "string" || !directoryName) {
    throw new Error("Output directory name is required.");
  }
  if (
    directoryName !== directoryName.trim() ||
    directoryName === "." ||
    directoryName === ".." ||
    directoryName.includes("/") ||
    directoryName.includes("\\") ||
    directoryName.includes(":")
  ) {
    throw new Error(`Output directory must be a single relative directory name: ${directoryName}`);
  }
}

export function resolveOutputDirectory(cwd, directoryName) {
  assertSafeOutputDirectoryName(directoryName);
  const root = resolve(cwd);
  const outputDir = resolve(root, directoryName);
  const relativePath = relative(root, outputDir);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Output directory escapes current working directory: ${directoryName}`);
  }
  return outputDir;
}

export function assertOutputDirectoryAvailable(outputDir) {
  if (!existsSync(outputDir)) {
    return;
  }
  if (lstatSync(outputDir).isSymbolicLink()) {
    throw new Error(`Output path exists but is unsafe: ${outputDir}`);
  }
  if (!statSync(outputDir).isDirectory()) {
    throw new Error(`Output path exists but is not a directory: ${outputDir}`);
  }
  const entries = readdirSync(outputDir);
  if (entries.length > 0) {
    throw new Error(`Output directory already exists and is not empty: ${outputDir}`);
  }
}
