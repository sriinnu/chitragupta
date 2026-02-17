# Skills (Legacy)

This directory contains only the skill template. Actual skills live in two places:

## Chitragupta's Built-in Skills

```
chitragupta/skills-core/    # First-party, Chitragupta-maintained
```

8 curated skills: code-review, git-workflow, test-runner, doc-generator, dependency-manager, project-scaffold, network-discovery, location-places.

## Ecosystem Skills

```
ecosystem/skills/            # Approved, vetted, cross-project
ecosystem/skill-lab/         # Experimental, sandboxed
ecosystem/skill-community/   # External submissions, disabled by default
```

See [`packages/vidhya-skills`](../packages/vidhya-skills) for the Vidya skill system implementation.

## Creating a New Skill

```bash
cp -r chitragupta/skills/_template ecosystem/skill-lab/my-skill
$EDITOR ecosystem/skill-lab/my-skill/SKILL.md
```

Skills in `skill-lab/` are experimental. Use the promote command to move them to `skills/` when vetted.
