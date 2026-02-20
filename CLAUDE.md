# Chitragupta MCP

- with git push, dont add co-authored information AT ALL.
- before git push, check what files/folders need to be ignored and add them to .gitignore, report to jaanu whats been done.

## Local-Only Files — NEVER Commit or Publish
Internal/ephemeral files must stay local. NEVER commit these to git or let them reach npm:
- `HEALTH.md`, `*-AUDIT.md`, `TASK.md`, `TASK-COMPLETE*.md` — audit/health/task reports
- `.agents/`, `.worktrees/`, `work-in-progress/` — working directories
- Any file generated for diagnostics, benchmarks, or internal analysis
- When creating new report/audit/diagnostic files, **immediately add them to `.gitignore`** before doing anything else
- If unsure whether a file is internal, default to adding it to `.gitignore` and ask

## Session Start
- At the START of every session, call `chitragupta_memory_search` with the current task
  to load relevant context from past sessions.
- Call `chitragupta_session_list` to see recent sessions for this project.

## During Work
- When making architectural decisions, search past sessions first —
  call `chitragupta_memory_search` to check what was decided before.
- After completing significant work, call `akasha_deposit` with type "solution"
  to record the approach for future sessions.
- When you discover a recurring pattern, call `akasha_deposit` with type "pattern".

## Context Limits
- When approaching context limits, call `chitragupta_handover` to preserve
  work state (files modified, decisions made, errors encountered).
- On session resume, call `chitragupta_session_show` with the last session ID
  to restore context.

## Available Tools (28)
- `chitragupta_memory_search` — search project memory (GraphRAG-backed)
- `chitragupta_session_list` — list recent sessions
- `chitragupta_session_show` — show session by ID
- `chitragupta_handover` — work-state handover for context continuity
- `chitragupta_recall` — unified search across all memory layers
- `chitragupta_context` — load memory context for provider sessions
- `chitragupta_day_show` — show consolidated day file
- `chitragupta_day_list` — list available day files
- `chitragupta_day_search` — search across day files
- `akasha_traces` — query collective knowledge traces
- `akasha_deposit` — record solutions, patterns, warnings
- `vasana_tendencies` — learned behavioral patterns
- `health_status` — system health (Triguna)
- `atman_report` — full self-report

## Context Window Management 
- When working with sub-agents/Task tools, proactively monitor context window usage. If more than 5 parallel agents are running, summarize and commit progress before spawning additional agents. Never let the orchestrating conversation exceed 80% of context capacity.
- 
## Language & Code Standards  
- This is a TypeScript monorepo, with swift for ios/macos. Always use TypeScript idioms (strict types, no `any`, proper null vs undefined handling). When editing files, check for and fix import statements — never create duplicate imports. After multi-file changes, run the full test suite before reporting completion.
- no code more then 450 lines of code.
- jsdocs must, and comments as needed.

## Verification Standards section 
- When verifying sync, diff, or state claims (e.g., 'repos are in sync', 'all tests pass', 'build succeeded'), always show concrete evidence — actual command output, commit hashes, or file diffs. Never claim completion without proof.
-
## Testing section 
- When editing test files after changing source code field names, types, or APIs, always grep for all usages of the old names/signatures across the entire test suite and update them in the same pass. Never change source without updating corresponding tests.
- 
## Communication
When the user asks about status or progress, clarify the scope of their question before answering. For example, 'updated package.json?' might mean startup scripts, not dependencies. When ambiguous, ask.

# Multi-File Refactors
When we go to refactor any module. Rules: (1) change no more than 5 files per round, (2) run tests after each file change, (3) if any test fails, fix it before moving to the next file, (4) show me a summary after each round before proceeding.

# Parallel Sessions & Git Worktrees

## The Problem
Multiple Claude Code sessions sharing the same git working directory will collide — `git checkout` in one session changes HEAD for ALL sessions. Commits from different sessions end up on whichever branch was last checked out. This has caused data loss and merge confusion.

## The Rule
**NEVER run parallel sessions in the same working directory.** Always use git worktrees.

## Worktree Setup (Master Orchestrator)
When preparing branches for parallel sessions, the master must:

```bash
# 1. Create branches from main
git checkout main
git branch audit/smriti-refactor
git branch audit/niyanta-fix

# 2. Create worktrees — each session gets its own directory
git worktree add ../.worktrees/smriti-refactor audit/smriti-refactor
git worktree add ../.worktrees/niyanta-fix audit/niyanta-fix

# 3. Write TASK.md instructions into each worktree
# Each worktree is a fully independent working directory
```

## Session Launch
- Main session stays in the repo root (on main or its own branch)
- Each parallel session opens its **worktree directory**, NOT the main repo
- Session 1: `cd ../.worktrees/smriti-refactor` → works on smriti
- Session 2: `cd ../.worktrees/niyanta-fix` → works on niyanta
- Each has its own HEAD, staging area, and working tree — zero collision risk

## Post-Session Merge (Master Orchestrator)
After all sessions report completion:
1. Switch to main: `git checkout main`
2. Merge each branch: `git merge audit/smriti-refactor --no-edit`
3. Run full test suite: `npx vitest run`
4. Clean up worktrees: `git worktree remove ../.worktrees/smriti-refactor`
5. Delete merged branches: `git branch -d audit/smriti-refactor`

## Worktree Directory
All worktrees live in `../.worktrees/` (gitignored). Never commit worktree directories.

See **AGENTS.md** for full orchestration protocol.