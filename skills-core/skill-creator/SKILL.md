---
name: skill-creator
description: >
  Create new Vidya-format skills from scratch. Scaffolds the directory structure,
  writes SKILL.md with frontmatter, generates eval cases, computes integrity hashes,
  and optionally signs the skill. Activates when the user asks to create, scaffold,
  or bootstrap a new skill.
license: Apache-2.0
metadata:
  author: chitragupta
  version: "1.0.0"
  tags: [skill, scaffold, generator, vidya, creator, bootstrap]
kula: antara
whenToUse:
  - User asks to create a new skill
  - User wants to scaffold a skill directory
  - User asks to bootstrap a skill from a description
  - User wants to convert an idea into a Vidya skill
whenNotToUse:
  - User asks to edit an existing skill (use code-review instead)
  - User asks to run or test a skill (use test-runner instead)
  - User asks about skill discovery or matching (that's internal)
complements: [code-review, test-runner, git-workflow]
---

# Skill Creator (Nirmana — निर्माण — Creation)

Creates new Vidya-format skills from scratch. The smith that forges new tools.

## When to Activate

- User asks to create, scaffold, or bootstrap a new skill
- User describes a capability they want as a skill
- User wants to convert an idea, tool, or API into a Vidya skill

## Protocol

### Step 1 — Gather Requirements

Ask (or infer from context):
1. **Name**: lowercase, hyphenated, 1-64 chars (`[a-z0-9-]+`)
2. **Description**: what it does, when to activate (1-1024 chars)
3. **Tags**: at least 3, lowercase hyphenated
4. **Capabilities**: verb/object pairs (what actions the skill performs)
5. **Requirements**: bins, env vars, OS, network, privileges
6. **Target tier**: skills-core (P4), ecosystem/skills (P3), or skill-lab (P2)

### Step 2 — Scaffold Directory

Create the skill directory structure:

```
<skill-name>/
├── SKILL.md              # Frontmatter + instructions
├── scripts/              # Optional: executable scripts
│   └── (action).sh       # Named after the action
├── references/           # Optional: supplementary docs
├── assets/               # Optional: templates, schemas
└── eval/                 # Optional: structured eval cases
    └── cases/
        ├── golden.json   # Happy-path test cases
        └── adversarial.json  # Edge/attack cases
```

### Step 3 — Write SKILL.md

Generate the SKILL.md with:

**Frontmatter (YAML between `---` delimiters):**
- `name`: matches directory name
- `description`: clear, specific activation trigger
- `license`: SPDX identifier (default: Apache-2.0)
- `metadata.author`: who wrote it
- `metadata.version`: start at "1.0.0"
- `metadata.tags`: at least 3 descriptive tags
- `kula`: auto-detected from target tier
- `requirements`: bins, env, os, network, privilege
- `whenToUse`: bullet list of activation conditions
- `whenNotToUse`: bullet list of anti-activation signals
- `complements`: skills that pair well

**Body (Markdown):**
- `# Title` with Sanskrit name if appropriate
- `## When to Activate` — trigger conditions
- `## Protocol` — numbered steps the agent follows
- `## Output Format` — expected response structure
- `## Rules` — hard constraints
- `## Capabilities` — structured `### verb / object` blocks
- `## Examples` — structured input/output examples

### Step 4 — Generate Eval Cases (Optional)

If the skill has clear inputs/outputs, create eval cases:

```json
[
  {
    "id": "golden-basic",
    "input": { "task": "example input" },
    "expected": { "status": "success" },
    "type": "golden",
    "description": "Basic happy path"
  },
  {
    "id": "adversarial-injection",
    "input": { "task": "'; DROP TABLE skills; --" },
    "expected": "error or safe handling",
    "type": "adversarial",
    "description": "SQL injection attempt should be rejected"
  }
]
```

### Step 5 — Validate

Run the skill through validation:
1. Check SKILL.md parses correctly (YAML frontmatter + body)
2. Verify name matches directory name
3. Verify all required fields present
4. Check tag count >= 3
5. Verify scripts have shebangs and are executable

### Step 6 — Seal (Optional)

If the skill will be promoted or shared:
1. Compute integrity: SHA-256 per file + Merkle root hash
2. Write INTEGRITY.json to skill directory
3. If signing key available, sign and write SIGNATURE.json

## Output Format

```
Created skill: <skill-name>
  Directory: <path>/<skill-name>/
  Files:
    SKILL.md .......... frontmatter + instructions
    eval/cases/ ....... <N> eval cases (golden: <G>, adversarial: <A>)
    INTEGRITY.json .... SHA-256 integrity manifest

  Validation: <PASS/FAIL>
    Errors: <N>
    Warnings: <N>

  Next steps:
    - Review SKILL.md and customize instructions
    - Add scripts/ if the skill needs executable actions
    - Add references/ for supplementary documentation
    - Run eval cases to verify behavior
```

## Rules

- **Name must match directory name.** This is enforced by the validator.
- **Description must be specific.** "A useful skill" is rejected. "Automated code review with security analysis" is accepted.
- **Tags must be lowercase hyphenated.** No spaces, no uppercase, no generic tags (tool, utility, helper).
- **No consecutive hyphens in names.** `my--skill` is invalid.
- **Keep SKILL.md under 500 lines / 5000 tokens.** Move verbose docs to references/.
- **Scripts must have shebangs.** `#!/usr/bin/env bash` preferred.
- **Scripts must handle --help.** Print usage when called with no args or --help.
- **Never hardcode secrets.** Use `requirements.env` for API keys and `permissions.secrets` for named injection.
- **Follow the Vidya Skill Specification v1.0.** Every field must conform to the spec.

## Capabilities

### create / skill
Create a new Vidya-format skill from a description or requirements.

**Parameters:**
- `name` (string, required): Skill name
- `description` (string, required): What the skill does
- `tags` (string[], required): At least 3 tags
- `tier` (string, default "skill-lab"): Target tier directory

### scaffold / directory
Create the directory structure for a skill without writing SKILL.md content.

**Parameters:**
- `name` (string, required): Skill name
- `withEval` (boolean, default true): Include eval/cases/ directory
- `withScripts` (boolean, default false): Include scripts/ directory

### validate / skill
Run the validator against an existing skill directory.

**Parameters:**
- `path` (string, required): Path to the skill directory

## Examples

### Create a REST API skill
- **input**: `{ "name": "weather-api", "description": "Fetch weather data from OpenWeatherMap API", "tags": ["weather", "api", "openweathermap"] }`
- **output**: Scaffolded directory with SKILL.md, eval cases, and integrity manifest

### Scaffold an empty skill
- **input**: `{ "name": "my-new-skill", "tier": "skill-lab" }`
- **output**: Empty directory structure ready for manual SKILL.md authoring
