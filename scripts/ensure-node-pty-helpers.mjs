import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// node-pty's npm tarball ships prebuilds/*/spawn-helper as mode 0644.
// Fresh installs then fail on macOS with "posix_spawnp failed" until the
// helper is executable. Root postinstall always runs; dependency install
// scripts may be gated by npm allowScripts.
//
// Resolve helpers from process.cwd() so npm lifecycle hooks and CI both work
// when started from the package root.
const root = process.cwd();
const prebuildsRoot = join(root, "node_modules", "node-pty", "prebuilds");

if (!existsSync(prebuildsRoot)) {
  process.exit(0);
}

let fixed = 0;
for (const entry of readdirSync(prebuildsRoot)) {
  const helperPath = join(prebuildsRoot, entry, "spawn-helper");
  if (!existsSync(helperPath) || !statSync(helperPath).isFile()) {
    continue;
  }
  chmodSync(helperPath, 0o755);
  fixed += 1;
}

if (fixed > 0) {
  console.log(`ensure-node-pty-helpers: chmod +x on ${fixed} spawn-helper file(s)`);
}
