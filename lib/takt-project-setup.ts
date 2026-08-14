import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeProjectPath } from "./takt-project-registry.ts";

const PROJECT_GITIGNORE_BLOCK = [
  "# Keep project-local TAKT configuration and execution presets versionable.",
  "!config.yaml",
  "!exec/",
  "!exec/presets/",
  "!exec/presets/**",
  "!workflows/",
  "!workflows/**",
  "!steps/",
  "!steps/**",
  "!facets/",
  "!facets/**",
  "!provider-options/",
  "!provider-options/**",
].join("\n");

const PROJECT_EXEC_GITIGNORE_COMMENT = "# Keep project-local TAKT execution presets versionable.";

export interface TaktProjectSetupOptions {
  cwd: string;
  preset: string;
  copyGlobalPreset?: boolean;
  globalTaktDir?: string;
}

export interface TaktProjectSetupResult {
  cwd: string;
  taktDir: string;
  preset: string;
  presetPath: string;
  presetSource: "project" | "global" | "missing";
  copiedFiles: string[];
  createdDirectories: string[];
  warnings: string[];
}

/**
 * Prepare the safe, project-local part of TAKT configuration.
 *
 * Only the selected exec preset is copied from the global config. Runtime
 * state, task queues, sessions, logs, and credentials stay out of the repo.
 */
export function setupProjectLocalTakt(options: TaktProjectSetupOptions): TaktProjectSetupResult {
  const cwd = normalizeProjectPath(options.cwd);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`TAKT project folder does not exist: ${cwd}`);
  }

  const preset = validatePresetName(options.preset);
  const taktDir = join(cwd, ".takt");
  const presetDir = join(taktDir, "exec", "presets");
  const workflowsDir = join(taktDir, "workflows");
  const createdDirectories: string[] = [];

  for (const directory of [taktDir, join(taktDir, "exec"), presetDir, workflowsDir]) {
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
      createdDirectories.push(directory);
    }
  }

  ensureProjectGitignore(taktDir);

  const presetPath = join(presetDir, `${preset}.yaml`);
  const copiedFiles: string[] = [];
  const warnings: string[] = [];
  if (existsSync(presetPath)) {
    return {
      cwd,
      taktDir,
      preset,
      presetPath,
      presetSource: "project",
      copiedFiles,
      createdDirectories,
      warnings,
    };
  }

  if (options.copyGlobalPreset !== false) {
    const globalTaktDir = resolve(
      options.globalTaktDir
        ?? process.env.TAKT_CONFIG_DIR
        ?? join(homedir(), ".takt"),
    );
    const globalPresetPath = join(globalTaktDir, "exec", "presets", `${preset}.yaml`);
    if (existsSync(globalPresetPath)) {
      copyFileSync(globalPresetPath, presetPath);
      copiedFiles.push(presetPath);
      return {
        cwd,
        taktDir,
        preset,
        presetPath,
        presetSource: "global",
        copiedFiles,
        createdDirectories,
        warnings,
      };
    }
    warnings.push(`Global TAKT preset not found: ${globalPresetPath}`);
  }

  return {
    cwd,
    taktDir,
    preset,
    presetPath,
    presetSource: "missing",
    copiedFiles,
    createdDirectories,
    warnings,
  };
}

export function validatePresetName(value: string): string {
  const preset = value.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(preset)) {
    throw new Error("TAKT preset name must contain only letters, numbers, hyphens, or underscores");
  }
  return preset;
}

function ensureProjectGitignore(taktDir: string): void {
  const gitignorePath = join(taktDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(
      gitignorePath,
      ["# Ignore TAKT runtime artifacts by default.", "*", "!.gitignore", PROJECT_GITIGNORE_BLOCK, ""].join("\n"),
      "utf8",
    );
    return;
  }

  const content = readFileSync(gitignorePath, "utf8");
  const requiredLines = ["!exec/", "!exec/presets/", "!exec/presets/**"];
  if (requiredLines.every((line) => content.split(/\r?\n/).includes(line))) {
    return;
  }
  const missingLines = requiredLines.filter((line) => !content.split(/\r?\n/).includes(line));
  appendFileSync(
    gitignorePath,
    `\n${PROJECT_EXEC_GITIGNORE_COMMENT}\n${missingLines.join("\n")}\n`,
    "utf8",
  );
}
