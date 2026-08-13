import * as p from "@clack/prompts";
import { isCancel } from "@clack/prompts";
import { defaultGitHubOwner, isInteractive, parseOwnerRepo } from "./utils.mjs";

export async function collectProjectOptions({ packageName, directoryName, defaults }) {
  const owner = defaultGitHubOwner() || defaults.owner;
  const defaultOwnerRepo = owner ? `${owner}/${directoryName}` : defaults.ownerRepo;

  if (!isInteractive()) {
    return {
      packageName,
      displayName: defaults.displayName,
      description: defaults.description,
      author: defaults.author,
      ownerRepo: defaultOwnerRepo,
      licenseYear: defaults.licenseYear,
    };
  }

  p.intro("create-pi-extension");

  const displayName = await p.text({
    message: "Display name",
    initialValue: defaults.displayName,
    validate: (value) => (value?.trim() ? undefined : "Display name is required"),
  });
  if (isCancel(displayName)) {
    p.cancel("Scaffold cancelled.");
    process.exit(0);
  }

  const description = await p.text({
    message: "Description",
    initialValue: defaults.description,
    validate: (value) => (value?.trim() ? undefined : "Description is required"),
  });
  if (isCancel(description)) {
    p.cancel("Scaffold cancelled.");
    process.exit(0);
  }

  const authorDefault = defaults.author || undefined;
  const author = await p.text({
    message: "Author",
    initialValue: authorDefault,
    validate: (value) => (value?.trim() ? undefined : "Author is required"),
  });
  if (isCancel(author)) {
    p.cancel("Scaffold cancelled.");
    process.exit(0);
  }

  const ownerRepo = await p.text({
    message: "GitHub owner/repo",
    initialValue: defaultOwnerRepo,
    validate: (value) => {
      try {
        parseOwnerRepo(String(value));
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : "Use owner/repo format";
      }
    },
  });
  if (isCancel(ownerRepo)) {
    p.cancel("Scaffold cancelled.");
    process.exit(0);
  }

  p.outro("Scaffolding project...");

  return {
    packageName,
    displayName: String(displayName).trim(),
    description: String(description).trim(),
    author: String(author).trim(),
    ownerRepo: String(ownerRepo).trim(),
    licenseYear: defaults.licenseYear,
  };
}
