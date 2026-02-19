# Chitragupta MCP

- with git push, dont add co-authored information AT ALL.
- before git push, check what files/folders need to be ignored and add them to .gitignore, report to jaanu whats been done.

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

# multi-file recfactors
When we go to refactor any module. Rules: (1) change no more than 5 files per round, (2) run tests after each file change, (3) if any test fails, fix it before moving to the next file, (4) show me a summary after each round before proceeding.