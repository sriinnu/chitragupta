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
