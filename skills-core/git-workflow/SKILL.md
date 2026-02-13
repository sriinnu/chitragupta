---
name: git-workflow
description: >
  Git branch management and commit workflow skill. Handles branching strategy,
  commit conventions, PR creation, conflict resolution, and repository hygiene.
  Invoke when a user works with git, asks about branching, or needs help with PRs.
license: Apache-2.0
metadata:
  author: chitragupta
  version: "1.0"
  tags: [git, branch, commit, pr, workflow, version-control]
---

# Git Workflow (Pravaha — प्रवाह — Flow)

You are a disciplined git operator. Every commit tells a story. Every branch has a purpose. No sloppy history.

## When to Activate

- User asks to commit, branch, merge, rebase, or create a PR
- User asks about git best practices or conventions
- User has merge conflicts and needs resolution help
- User wants to clean up git history

## Branching Strategy

### Branch Naming

```
<type>/<short-description>

Types: feat, fix, refactor, docs, test, chore, perf, ci
Examples: feat/auth-jwt, fix/memory-leak-sessions, refactor/extract-parser
```

- Always branch from the default branch (main/master) unless told otherwise.
- Keep branches short-lived. Merge early, merge often.
- Delete branches after merge.

### Before Creating a Branch

1. `git fetch origin` — always start from latest.
2. Check `git status` — no uncommitted changes.
3. Stash if needed: `git stash push -m "wip: description"`.

## Commit Protocol

### Message Format

Follow Conventional Commits. See `references/CONVENTIONS.md`.

```
<type>(<scope>): <imperative summary>

<optional body — explain WHY, not WHAT>

<optional footer — breaking changes, issue refs>
```

### Rules

- **Atomic commits**: one logical change per commit. Not "fix everything."
- **Imperative mood**: "Add feature" not "Added feature" or "Adds feature."
- **No generated files**: never commit node_modules, dist, build artifacts.
- **No secrets**: never commit .env, credentials, API keys.
- **Sign commits** if GPG is configured.

### Before Committing

1. `git diff --staged` — review what you are actually committing.
2. Run `scripts/branch-check.sh` to verify branch hygiene.
3. Stage specific files. Avoid `git add .` unless you have verified every change.

## Pull Request Workflow

### Creating a PR

1. Push branch: `git push -u origin <branch>`.
2. Create PR with clear title (<70 chars) and description.
3. Description must include: Summary, Test Plan, and any Breaking Changes.
4. Request reviewers if the team has review requirements.

### PR Checklist

- [ ] Tests pass
- [ ] No lint errors
- [ ] No unresolved TODOs added
- [ ] Documentation updated if needed
- [ ] Commit history is clean (squash fixups)

## Conflict Resolution

1. `git fetch origin && git rebase origin/main` — prefer rebase over merge for feature branches.
2. Resolve conflicts file by file. Understand both sides before choosing.
3. After resolving: `git add <resolved-files> && git rebase --continue`.
4. Run tests after resolution. Conflicts can introduce subtle bugs.
5. Never blindly accept "ours" or "theirs" without reading the diff.

## Dangerous Operations

These require explicit user confirmation. Never run them unprompted:

- `git push --force` (use `--force-with-lease` instead)
- `git reset --hard`
- `git clean -fd`
- `git branch -D`
- `git rebase` on shared branches
