import { execFileSync } from "node:child_process";

const PACKAGE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export function parsePackageArg(arg) {
  const trimmed = arg.trim();
  if (!trimmed) {
    throw new Error("Package name is required.");
  }

  if (trimmed.startsWith("@")) {
    const match = /^@([^/]+)\/([^/]+)$/.exec(trimmed);
    if (!match || !PACKAGE_SEGMENT_PATTERN.test(match[1]) || !PACKAGE_SEGMENT_PATTERN.test(match[2])) {
      throw new Error(`Invalid scoped package name: ${arg}`);
    }
    return {
      packageName: trimmed,
      directoryName: match[2],
      isScoped: true,
    };
  }

  if (!PACKAGE_SEGMENT_PATTERN.test(trimmed)) {
    throw new Error(`Invalid package name: ${arg}`);
  }

  return {
    packageName: trimmed,
    directoryName: trimmed,
    isScoped: false,
  };
}

export function getGitConfig(key) {
  try {
    return execFileSync("git", ["config", key], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export function defaultGitHubOwner() {
  const githubUser = getGitConfig("github.user");
  if (githubUser) {
    return githubUser;
  }

  const userName = getGitConfig("user.name");
  if (!userName) {
    return "";
  }

  return userName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function parseOwnerRepo(value) {
  const trimmed = value.trim();
  const match = /^([^/]+)\/([^/]+)$/.exec(trimmed);
  if (!match) {
    throw new Error(`Expected owner/repo, got: ${value}`);
  }
  return { owner: match[1], repo: match[2] };
}

export function isInteractive() {
  if (process.env.CREATE_PI_EXTENSION_YES === "1") {
    return false;
  }
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
