import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const workflowDirectory = join(root, ".github", "workflows");

for (const name of readdirSync(workflowDirectory)) {
  const path = join(workflowDirectory, name);
  if (!statSync(path).isFile()) {
    continue;
  }
  const content = readFileSync(path, "utf8");
  if (/NPM_TOKEN|NODE_AUTH_TOKEN/.test(content)) {
    throw new Error(`${name} contains a long-lived npm token reference`);
  }
}

console.log("publish guard: no long-lived npm token references found");
