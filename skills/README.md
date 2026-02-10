# Agent Skills

This directory follows the [Agent Skills open standard](https://agentskills.io).

Skills are self-contained capability packages that give AI agents domain expertise, executable scripts, and reference material — without requiring code changes to the agent itself.

## Structure

```
skills/
  .curated/          # Built-in skills maintained by chitragupta
  _template/         # Skeleton for creating new skills
  <your-skill>/      # Drop custom skills here
```

Each skill is a directory containing:

| File/Dir | Required | Purpose |
|---|---|---|
| `SKILL.md` | Yes | YAML frontmatter + agent instructions |
| `scripts/` | No | Executable scripts the agent can invoke |
| `references/` | No | Supplementary docs loaded on demand |
| `assets/` | No | Static resources (templates, schemas, configs) |

## Installing a Skill

Drop the skill directory into `skills/`:

```bash
# From a git repo
git clone https://github.com/someone/cool-skill.git skills/cool-skill

# Or just copy it
cp -r ~/my-skill skills/my-skill
```

The agent discovers skills automatically. No registration required.

## Creating a New Skill

```bash
cp -r skills/_template skills/my-new-skill
```

Edit `SKILL.md` — fill in the frontmatter and write your instructions. See `_template/CREATING_SKILLS.md` for the full guide.

## Curated Skills

| Skill | Description |
|---|---|
| `code-review` | Automated code review with pattern detection |
| `git-workflow` | Branch management, commits, PRs, conflict resolution |
| `test-runner` | Test discovery, execution, and coverage analysis |
| `doc-generator` | README, API docs, JSDoc, and changelog generation |
| `dependency-manager` | Package installation, updates, and vulnerability audits |
| `project-scaffold` | File, module, and project structure scaffolding |

## Spec Compliance

All skills conform to the Agent Skills open standard v1.0. See [agentskills.io](https://agentskills.io) for the full specification.
