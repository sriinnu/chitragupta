# Parallel Agent Orchestration Protocol

This document defines how the **master orchestrator** (the primary Claude Code session) coordinates parallel worker sessions across the chitragupta monorepo.

## Roles

### Master Orchestrator
- Runs in the main repo directory
- Creates branches, worktrees, and TASK.md instructions
- Never does implementation work directly during parallel runs
- Validates, merges, and cleans up after workers finish
- Owns the `main` branch

### Worker Sessions
- Each runs in its own git worktree (isolated directory)
- Reads TASK.md for instructions — this is their contract
- Works only on files within their assigned package(s)
- Commits to their branch, pushes when done
- Reports completion back to the user

## Pre-Flight Checklist (Master)

Before launching parallel sessions:

1. **Ensure main is clean**
   ```bash
   git checkout main
   git status  # must be clean
   ```

2. **Create feature branches**
   ```bash
   git branch audit/smriti-refactor
   git branch audit/niyanta-fix
   git branch audit/ui-tests
   ```

3. **Create worktrees** (one per session)
   ```bash
   git worktree add ../.worktrees/smriti-refactor audit/smriti-refactor
   git worktree add ../.worktrees/niyanta-fix audit/niyanta-fix
   git worktree add ../.worktrees/ui-tests audit/ui-tests
   ```

4. **Write TASK.md in each worktree**
   Each TASK.md must contain:
   - Scope: which package(s) this session owns
   - Objectives: numbered list of deliverables
   - Constraints: file size limits, test requirements, coding standards
   - Verification: what commands to run before reporting done
   - Do-not-touch: files/packages outside scope

5. **Verify isolation**
   ```bash
   git worktree list  # confirm each points to correct branch
   ```

## TASK.md Template

```markdown
# Task: [Branch Name]

## Scope
Package(s): `packages/[name]`
Branch: `audit/[name]-refactor`

## Objectives
1. [Specific deliverable with acceptance criteria]
2. [Specific deliverable with acceptance criteria]

## Constraints
- All source files must be < 450 LOC
- TypeScript strict mode — no `as any`
- Run `npx vitest run` and ensure ALL tests pass before committing
- Do NOT modify files outside `packages/[name]/`

## Verification (run before reporting done)
1. `npx tsc --noEmit` — zero errors in your package
2. `npx vitest run packages/[name]/` — all tests green
3. `git diff --stat` — only expected files changed

## Do Not Touch
- Any file outside `packages/[name]/`
- `package.json` dependencies (unless explicitly listed in objectives)
- `CLAUDE.md`, `AGENTS.md`, `HEALTH.md`
```

## Worker Session Protocol

Each worker session should:

1. **Read TASK.md** — understand scope and objectives completely
2. **Verify branch** — `git branch --show-current` must match expected branch
3. **Work within scope** — never edit files outside assigned packages
4. **Follow multi-file refactor rules** — max 5 files per round, test after each
5. **Commit incrementally** — small, focused commits with descriptive messages
6. **Run verification** — all commands in TASK.md verification section must pass
7. **Push branch** — `git push -u origin [branch-name]`
8. **Report completion** — tell the user "done, pushed to [branch]"

## Post-Completion Merge Protocol (Master)

When all workers report done:

### Phase 1: Validate
```bash
# For each branch, in order:
git checkout audit/[branch]
npx vitest run                    # full test suite
npx tsc --noEmit                  # type check
git diff --stat main..HEAD        # review scope of changes
```

### Phase 2: Merge
```bash
git checkout main
# Merge branches one at a time, test after each:
git merge audit/smriti-refactor --no-edit
npx vitest run                    # must pass before next merge
git merge audit/niyanta-fix --no-edit
npx vitest run
# ... repeat for each branch
```

### Phase 3: Clean Up
```bash
# Remove worktrees
git worktree remove ../.worktrees/smriti-refactor
git worktree remove ../.worktrees/niyanta-fix

# Delete merged branches (local)
git branch -d audit/smriti-refactor
git branch -d audit/niyanta-fix

# Delete remote branches
git push origin --delete audit/smriti-refactor
git push origin --delete audit/niyanta-fix
```

### Phase 4: Post-Merge Health Check
```bash
npx vitest run          # full suite green
pnpm build              # builds clean
# Update HEALTH.md with new metrics
```

## Conflict Resolution

If merge conflicts occur:
1. **Never force** — no `--force`, no `--ours`/`--theirs` blindly
2. **Inspect** — read both sides, understand intent
3. **Resolve manually** — preserve both changes where possible
4. **Test** — run full suite after resolution
5. **If stuck** — abort merge, ask user for guidance

## Limits

| Constraint | Value | Reason |
|------------|-------|--------|
| Max parallel sessions | 5 | Context window + filesystem safety |
| Max files per session | ~30 | Keep scope focused |
| Max packages per session | 2 | Avoid cross-package conflicts |
| Worktree location | `../.worktrees/` | Gitignored, outside repo |

## Lessons Learned

- **2026-02-19**: 4 parallel sessions without worktrees caused all commits to land on one branch. All work was recoverable but required manual validation. Always use worktrees.
- Shared filesystem = shared HEAD. There is no workaround except separate working directories.
- Sessions that modify `pnpm-lock.yaml` or root `package.json` MUST run sequentially, not in parallel.
