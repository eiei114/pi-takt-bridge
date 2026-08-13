export type ConfigFieldRule =
  | { type: "string"; minLength: number }
  | { type: "boolean" };

export const packageLayoutConfigRules = {
  title: { type: "string", minLength: 1 },
  statusLabel: { type: "string", minLength: 1 },
  showSkillHint: { type: "boolean" },
} as const satisfies Record<string, ConfigFieldRule>;

export const packageLayoutConfigSchema = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(packageLayoutConfigRules),
  properties: packageLayoutConfigRules,
} as const;

export type PackageLayoutConfig = {
  [Key in keyof typeof packageLayoutConfigRules]:
    (typeof packageLayoutConfigRules)[Key]["type"] extends "string" ? string : boolean;
};

export function parsePackageLayoutConfig(input: unknown): PackageLayoutConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Package layout config must be an object");
  }
  const record = input as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Package layout config must be a plain object");
  }
  const allowed = new Set(Object.keys(packageLayoutConfigRules));
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new TypeError(`Unknown package layout config field: ${key}`);
  }
  for (const [key, rule] of Object.entries(packageLayoutConfigRules)) {
    const value = record[key];
    if (!Object.hasOwn(record, key) || typeof value !== rule.type) {
      throw new TypeError(`${key} must be ${rule.type}`);
    }
    if (rule.type === "string" && typeof value === "string" && value.length < rule.minLength) {
      throw new TypeError(`${key} must contain at least ${rule.minLength} character`);
    }
  }
  return record as PackageLayoutConfig;
}
