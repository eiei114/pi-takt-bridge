---
name: template-skill-bridge
description: Template skill contributed by extensions/skill-bridge via resources_discover. Use when testing extension-provided Agent Skills or /skill:template-skill-bridge.
---

# Template Skill Bridge

This skill is registered at runtime by `extensions/skill-bridge/index.ts` through the `resources_discover` event.

## When to use

- Verify that an extension can contribute skills without editing `package.json`
- Demonstrate dynamic skill discovery alongside static `skills/` package resources

## Response pattern

- Confirm the skill loaded from the extension directory
- Mention `/template-skill-info` for the companion command
- Point maintainers to `extensions/skill-bridge/SKILL.md` as the file to customize
