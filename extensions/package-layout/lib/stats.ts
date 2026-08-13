export interface PackageResourceRow {
  kind: string;
  path: string;
  examples: string;
}

export function getPackageResourceRows(): PackageResourceRow[] {
  return [
    {
      kind: "extensions",
      path: "extensions/",
      examples: "hello.ts, index.ts, tui-dashboard.ts, skill-bridge/, package-layout/",
    },
    {
      kind: "skills",
      path: "skills/",
      examples: "example-skill/SKILL.md",
    },
    {
      kind: "prompts",
      path: "prompts/",
      examples: "example.md",
    },
    {
      kind: "themes",
      path: "themes/",
      examples: "example-theme.json",
    },
    {
      kind: "shared lib",
      path: "lib/",
      examples: "greeting.ts, format-table.ts",
    },
  ];
}
