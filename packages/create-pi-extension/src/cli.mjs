#!/usr/bin/env node

import { cwd } from "node:process";
import { collectProjectOptions } from "./prompts.mjs";
import {
  assertOutputDirectoryAvailable,
  cleanupBootstrapDocs,
  resolveOutputDirectory,
  runPostSetup,
  scaffoldProject,
} from "./scaffold.mjs";
import { getGitConfig, parsePackageArg } from "./utils.mjs";

function printHelp() {
  console.log(`Usage: create-pi-extension <package-name>

Scaffold a new Pi extension project.

Examples:
  bunx create-pi-extension my-pi-package
  bunx create-pi-extension @my-scope/my-pi-tool

Environment:
  CREATE_PI_EXTENSION_YES=1           Use defaults without prompts
  CREATE_PI_EXTENSION_SKIP_POST_SETUP=1   Skip git init and bun install
`);
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === "-h" || arg === "--help") {
    printHelp();
    process.exit(arg ? 0 : 1);
  }

  const { packageName, directoryName } = parsePackageArg(arg);
  const outputDir = resolveOutputDirectory(cwd(), directoryName);
  assertOutputDirectoryAvailable(outputDir);

  const githubOwner = getGitConfig("github.user") || getGitConfig("user.name");
  const ownerSlug = githubOwner
    ? githubOwner
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
    : "your-name";

  const defaults = {
    displayName: directoryName,
    description: `Pi package ${packageName}`,
    author:
      process.env.CREATE_PI_EXTENSION_AUTHOR?.trim() ||
      getGitConfig("user.name") ||
      "Pi Developer",
    owner: ownerSlug,
    ownerRepo: `${ownerSlug}/${directoryName}`,
    licenseYear: new Date().getFullYear(),
  };

  const options = await collectProjectOptions({
    packageName,
    directoryName,
    defaults,
  });

  scaffoldProject(outputDir, options);
  const removedDocs = cleanupBootstrapDocs(outputDir);
  runPostSetup(outputDir);

  if (removedDocs.length > 0) {
    console.log("\nRemoved bootstrap docs:");
    for (const doc of removedDocs) {
      console.log(`  - ${doc}`);
    }
  }

  console.log("\nNext steps:");
  console.log("  1. Edit extensions/");
  console.log("  2. Run bun run ci");
  console.log("  3. Try pi -e .");
  console.log(`\nCreated ${packageName} at ${outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
