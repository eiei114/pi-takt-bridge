import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { validateWorkflowGuardrails } from "../scripts/check-review-guardrails.mjs";

const FIXTURE_DIR = fileURLToPath(new URL("fixtures/review-guardrails", import.meta.url));

async function validateFixture(name) {
  const content = await readFile(join(FIXTURE_DIR, name), "utf8");
  return validateWorkflowGuardrails({ relativePath: `fixtures/${name}`, content });
}

test("G8 workflow validator accepts a read-only PR workflow fixture", async () => {
  assert.deepEqual(await validateFixture("valid-pr-readonly.yml"), []);
});

test("G8 workflow validator rejects PR workflows without explicit permissions", async () => {
  const problems = await validateFixture("invalid-missing-permissions.yml");
  assert.match(problems.join("\n"), /must declare top-level permissions with contents: read/);
});

test("G8 workflow validator recognizes aliased pull_request triggers", async () => {
  const problems = await validateFixture("invalid-aliased-trigger.yml");
  assert.match(problems.join("\n"), /must declare top-level permissions with contents: read/);
});

test("G8 workflow validator rejects write permissions in PR jobs", async () => {
  const problems = await validateFixture("invalid-write-permissions.yml");
  assert.match(problems.join("\n"), /must not grant contents: write/);
});

test("G8 workflow validator rejects persisted checkout credentials in PR workflows", async () => {
  const problems = await validateFixture("invalid-checkout-credentials.yml");
  assert.match(problems.join("\n"), /actions\/checkout in a PR workflow must set persist-credentials: false/);
});
