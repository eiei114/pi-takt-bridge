import assert from "node:assert/strict";
import test from "node:test";
import {
  packageLayoutConfigSchema,
  parsePackageLayoutConfig,
} from "../lib/config-contract.ts";

const valid = {
  title: "Pi package layout",
  statusLabel: "layout",
  showSkillHint: true,
};

test("schema and runtime accept the same valid package layout config", () => {
  assert.deepEqual(packageLayoutConfigSchema.required, ["title", "statusLabel", "showSkillHint"]);
  assert.deepEqual(parsePackageLayoutConfig(valid), valid);
});

test("runtime rejects every schema-required field when missing", () => {
  for (const key of packageLayoutConfigSchema.required) {
    const invalid = { ...valid };
    delete invalid[key];
    assert.throws(() => parsePackageLayoutConfig(invalid), new RegExp(`${key} must be`));
  }
});

test("runtime rejects wrong types, empty strings, and extra fields", () => {
  assert.throws(() => parsePackageLayoutConfig({ ...valid, showSkillHint: "yes" }), /showSkillHint must be boolean/);
  assert.throws(() => parsePackageLayoutConfig({ ...valid, title: "" }), /title must contain at least 1 character/);
  assert.throws(() => parsePackageLayoutConfig({ ...valid, extra: true }), /Unknown package layout config field: extra/);
});

test("runtime rejects inherited config fields", () => {
  assert.throws(
    () => parsePackageLayoutConfig(Object.create(valid)),
    /Package layout config must be a plain object/,
  );
});
