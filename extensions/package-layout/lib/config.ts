import { parsePackageLayoutConfig, type PackageLayoutConfig } from "../../../lib/config-contract.ts";

export type { PackageLayoutConfig } from "../../../lib/config-contract.ts";

export const defaultPackageLayoutConfig: PackageLayoutConfig = parsePackageLayoutConfig({
  title: "Pi package layout",
  statusLabel: "layout",
  showSkillHint: true,
});
