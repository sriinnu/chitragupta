# Creating a New Skill

This guide explains how to create a skill that follows the [Agent Skills open standard](https://agentskills.io).

## Quick Start

```bash
# From workspace root, copy the template into ecosystem skill-lab
cp -r chitragupta/skills/_template ecosystem/skill-lab/my-skill

# Edit the SKILL.md
$EDITOR ecosystem/skill-lab/my-skill/SKILL.md
```

That's it. The agent discovers skills automatically from the 4-tier layout.

## Skill Tiers

| Priority | Directory | Purpose |
|----------|-----------|---------|
| 4 (highest) | `{project}/skills-core/` | First-party project skills |
| 3 | `ecosystem/skills/` | Approved, vetted, cross-project skills |
| 2 | `ecosystem/skill-lab/` | Experimental, sandboxed skills |
| 1 (lowest) | `ecosystem/skill-community/` | External submissions (disabled by default) |

Place new skills in `ecosystem/skill-lab/` first, then promote when vetted.

## Directory Structure

```
my-skill/
├── SKILL.md          # Required — YAML frontmatter + agent instructions
├── scripts/          # Optional — Executable scripts
├── references/       # Optional — Supplementary documentation
└── assets/           # Optional — Templates, schemas, static files
```

### SKILL.md (Required)

This is the only required file. It contains:

1. **YAML frontmatter** with metadata (name, description, license, author, version, tags)
2. **Markdown body** with instructions the agent follows

```yaml
---
name: my-skill
description: >
  What this skill does and when to use it. Be specific.
license: Apache-2.0
metadata:
  author: your-name
  version: "1.0"
  tags: [relevant, tags]
---

# Instructions for the agent
```

### scripts/ (Optional)

Executable scripts the agent can run. Requirements:

- Must start with a shebang (`#!/bin/bash` or `#!/usr/bin/env node`)
- Must use `set -euo pipefail` for bash scripts
- Must be cross-platform where possible (macOS + Linux)
- Must handle missing dependencies gracefully
- Must accept `--help` or provide usage info when called with no args

### references/ (Optional)

Supplementary documentation loaded on demand. Use for:

- Anti-pattern catalogs
- Convention guides
- Framework-specific details
- Lookup tables

Keep each reference file focused on one topic. The agent loads them when relevant, not all at once.

### assets/ (Optional)

Static resources: templates, schemas, config files, images. These are not instructions — they are materials the skill uses to produce output.

## Writing Good Instructions

### Be Specific About Activation

Bad:
```
## When to Activate
- When the user needs help
```

Good:
```
## When to Activate
- User asks to review a pull request or code diff
- User submits code and asks for feedback on quality
- User asks about security vulnerabilities in their code
```

### Be Opinionated

The agent needs clear guidance, not wishy-washy suggestions.

Bad: "You might want to consider checking for null values."
Good: "Check every function parameter for null. Unvalidated inputs are bugs."

### Structure as a Protocol

Give the agent a step-by-step protocol, not a wall of text. Number the steps. Make each step actionable.

### Define Output Format

Tell the agent exactly how to structure its response. Use a template with placeholders.

### Set Hard Rules

End with non-negotiable rules. These override everything else.

## Size Limits

- SKILL.md body: under 500 lines
- Total skill instructions: under 5000 tokens
- Keep it focused. A skill that tries to do everything does nothing well.

## Testing Your Skill

1. Read your SKILL.md as if you were the agent. Is every instruction clear?
2. Run your scripts manually. Do they work without the agent?
3. Check that references are accurate and up to date.
4. Ask the agent to use your skill. Watch what it does. Iterate.

## Publishing

Skills are portable directories. Share them by:

- Copying the directory
- Publishing as a git repository
- Including in a package registry

The spec does not mandate a specific distribution mechanism. A directory is a skill.
