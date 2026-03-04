# Cross-Device and Cross-Session Continuity

How Chitragupta preserves conversational context across sessions, devices, and AI providers.

---

## Table of Contents

1. [Session Persistence](#1-session-persistence)
2. [Cross-Session Continuity](#2-cross-session-continuity)
3. [Cross-Device Flow](#3-cross-device-flow)
4. [Provider Switching](#4-provider-switching)
5. [Data Flow Diagram](#5-data-flow-diagram)
6. [Architecture Decisions](#6-architecture-decisions)

---

## 1. Session Persistence

Sessions are the atomic unit of memory in Chitragupta. Every conversation -- regardless of provider, device, or agent -- becomes a session that persists through a dual-write architecture: Markdown files as the source of truth, SQLite as the query accelerator.

### 1.1 Markdown Files (Source of Truth)

Every session is a `.md` file stored under `~/.chitragupta/sessions/<project-hash>/YYYY/MM/`.

The file contains YAML frontmatter with full metadata, followed by turn sections in Markdown:

```markdown
---
id: session-2026-03-04-a1b2c3d4
title: "Refactor memory store"
created: 2026-03-04T10:30:00.000Z
updated: 2026-03-04T11:45:00.000Z
agent: chitragupta
model: claude-opus-4-6
project: /home/user/projects/chitragupta
parent: null
branch: null
tags:
  - refactor
  - smriti
totalCost: 0.1234
totalTokens: 15000
---

## Turn 1 -- user

Refactor the memory store to use write queues...

## Turn 2 -- assistant (agent: chitragupta, model: claude-opus-4-6)

I'll implement serialized write queues using promise chains...

### Tool: Bash

**Input:**
```json
{"command": "npx vitest run"}
```

<details>
<summary>Result</summary>

```
All 42 tests passed
```

</details>
```

Key properties of this format:

- **Human-readable**: Open any session file in a text editor and read the full conversation.
- **Git-friendly**: Markdown diffs cleanly. Session files can be committed, branched, and merged.
- **Grep-able**: Search across all sessions with standard text tools.
- **Append-only hot path**: New turns are appended to the file without rewriting the entire document (`addTurn()` in `packages/smriti/src/session-store.ts`). Only the YAML `updated:` field is patched in-place.
- **Atomic writes**: Initial session creation uses temp-file + rename (`atomicRename()`) to prevent half-written files on crash.

File path resolution supports both legacy flat layouts and the current hierarchical layout:

```
~/.chitragupta/sessions/
  <project-hash>/
    2026/
      03/
        session-2026-03-04-a1b2c3d4.md
        session-2026-03-04-a1b2c3d4-2.md   # second session same day
```

Source: `resolveSessionPath()` in `packages/smriti/src/session-store.ts`

### 1.2 SQLite + FTS5 (Query Accelerator)

Every session write is mirrored to an SQLite database (`agent.db`) as a write-through cache. SQLite provides:

- **Full-text search** via FTS5 on turn content (`turns_fts` virtual table)
- **Structured queries**: list sessions by date range, project, agent, tags
- **Turn-level indexing**: each turn is a row in `turns` with `session_id`, `turn_number`, `role`, `content`, `tool_calls`, and `created_at`
- **Session metadata**: the `sessions` table stores id, project, title, timestamps, model, agent, cost, tokens, tags, and arbitrary JSON metadata

Write-through is **best-effort** -- if SQLite fails, the Markdown file is still written successfully. This is enforced throughout the codebase:

```typescript
// From packages/smriti/src/session-db.ts — upsertSessionToDb()
try {
    const db = getAgentDb();
    db.prepare(`INSERT INTO sessions ... ON CONFLICT(id) DO UPDATE SET ...`).run(row);
} catch (err) {
    // SQLite write-through is best-effort — .md file is the source of truth
    process.stderr.write(`[chitragupta] session upsert failed for ${meta.id}: ...`);
}
```

Self-healing: if a turn insert hits a foreign key constraint (session row missing from SQLite but `.md` file exists), `insertTurnToDb()` automatically seeds a minimal session row and retries. See `seedSessionRowForTurn()` in `packages/smriti/src/session-db.ts`.

### 1.3 L1 LRU Cache

Parsed `Session` objects are cached in-process to avoid repeated Markdown parsing:

| Parameter       | Value    |
|-----------------|----------|
| Max entries     | 500      |
| Max bytes       | ~25 MB   |
| Eviction policy | LRU (Map insertion-order, delete+re-insert on access) |
| Cache hit time  | <0.01ms  |

On mutation (`addTurn()`, `saveSession()`), the cache entry is invalidated so the next `loadSession()` re-reads from disk.

Source: `packages/smriti/src/session-store-cache.ts`

---

## 2. Cross-Session Continuity

### 2.1 Session Handover

When approaching context limits, `chitragupta_handover` captures the current work state as a structured delta:

```typescript
// From packages/smriti/src/handover-types.ts
export interface HandoverDelta {
    sessionId: string;
    previousCursor: number;    // turn number at last handover
    newCursor: number;         // current turn number
    turnsAdded: number;
    filesModified: string[];
    filesRead: string[];
    decisions: string[];
    errors: string[];
    commands: string[];
}
```

The handover captures _only the delta since the last cursor position_, not the full session transcript. This enables incremental context restoration: a new session calls `chitragupta_session_show` with the previous session ID and gets the handover delta injected into its context.

There is also `chitragupta_handover_since` for even more granular incremental handovers -- it accepts a cursor (turn number) and returns only changes since that point.

### 2.2 Provider Bridge Context Loading

At the start of every provider session, `loadProviderContext()` assembles a context string from five sources:

1. **Global facts** -- identity, location, preferences (`~/.chitragupta/memory/global.md`)
2. **Project memory** -- decisions, patterns, architecture notes (`~/.chitragupta/memory/projects/<hash>/project.md`)
3. **Recent sessions** -- summaries of the last N sessions (date, provider, turn count, first user message)
4. **Vasanas** -- learned behavioral patterns with strength scores (e.g., "prefer-functional-style (strength: 85%)")
5. **Interrupted sessions** -- recently abandoned conversations (see Section 2.3)

The assembled context is a single string with Markdown sections:

```
## Interrupted Conversation
**Interrupted Session** (2.3h ago, 2026-03-04 at 14:20)
Session: Refactor memory store
Last exchange:
  [user]: Can you now update the tests for the new...
  [assistant]: Let me update the test suite. First...

## Known Facts
- Name: Sriinnu
- Timezone: PST
...

## Project Context
- Architecture: TypeScript monorepo, 11 published packages
- No file > 450 LOC, strict TypeScript
...

## Recent Sessions
- 2026-03-04 (claude-opus-4-6, 24 turns): Refactor the memory store...
- 2026-03-03 (codex, 8 turns): Fix session-store cache eviction...

## Behavioral Patterns
- prefer-functional-style (strength: 85%): Prefers functional patterns
- test-before-commit (strength: 92%): Always runs tests before committing
```

Source: `loadProviderContext()` in `packages/smriti/src/provider-bridge.ts`

### 2.3 Interrupted Session Detection

The Provider Bridge detects recently interrupted conversations for cross-device pickup. This is the mechanism that enables the "start on MacBook, pick up on phone" workflow.

Detection heuristics (from `detectInterruptedSession()` in `packages/smriti/src/provider-bridge.ts`):

1. Session was updated within the lookback window (4-8 hours, depending on budget tier)
2. The session has **no handover marker** (no `[handover]` or `chitragupta_handover` in turn content)
3. The conversation appears interrupted:
   - Last turn was from the user (assistant never responded), OR
   - Last assistant turn ends with mid-thought language: "next", "continuing", "will now", "let me", "todo", "then we"

When an interrupted session is detected, the Provider Bridge places it **first** in the assembled context (before global facts, project memory, etc.) because it is the most actionable information for the new session.

The detection scans the 10 most recent sessions for the project, checking each against the cutoff time and heuristics:

```typescript
// Simplified from detectInterruptedSession()
for (const meta of sessions) {
    const updatedMs = new Date(meta.updated).getTime();
    if (updatedMs < cutoff) continue;

    const session = loadSession(meta.id, meta.project);
    if (session.turns.length < 2) continue;

    const lastTurn = session.turns[session.turns.length - 1];
    const hasHandover = session.turns.some((t) =>
        t.content.includes("[handover]") || t.content.includes("chitragupta_handover"),
    );
    if (hasHandover) continue;

    const isInterrupted = lastTurn.role === "user" ||
        /\b(next|continuing|will now|let me|todo|then we)\b/i.test(
            lastTurn.content.slice(-200),
        );
    if (!isInterrupted) continue;

    // Build and return interruption summary with last 3 turns
}
```

---

## 3. Cross-Device Flow

### 3.1 The Scenario

User is working on their MacBook with Claude Code. The conversation is mid-flight -- they asked about refactoring the session store and the assistant was outlining next steps. The user closes the laptop and picks up their phone to continue with a different provider (e.g., Vaayu).

What happens:

1. **MacBook session persists** -- the session `.md` file and SQLite rows were written on every turn
2. **Phone session starts** -- `loadProviderContext()` runs on session init
3. **Interrupted session detected** -- the MacBook session matches the heuristics (updated recently, last turn was mid-thought, no handover marker)
4. **Context injected** -- the phone provider receives the interrupted session summary plus global facts, project memory, and vasanas, all scaled to its context window budget
5. **User continues seamlessly** -- the new provider knows what was being discussed and can pick up the thread

### 3.2 Adaptive Context Budget

Different providers have different context window sizes. A Claude 200K session can absorb far more memory context than a 4K model. The Provider Bridge computes an adaptive budget:

```typescript
// From computeBudget() in packages/smriti/src/provider-bridge.ts
function computeBudget(providerTokens: number): ContextBudget {
    // ~4 chars per token, allocate 2% of context window to memory
    const totalChars = Math.max(2000, Math.min(50_000,
        Math.floor(providerTokens * 4 * 0.02)));

    if (providerTokens >= 100_000) {
        // Large context (Claude 200K, Gemini 1M): rich context injection
        return { totalChars, recentSessions: 5, vasanaCount: 8,
                 interruptedLookbackHours: 8 };
    }
    if (providerTokens >= 32_000) {
        // Medium context (GPT-4 128K, Claude Haiku): balanced
        return { totalChars, recentSessions: 3, vasanaCount: 5,
                 interruptedLookbackHours: 6 };
    }
    // Small context (< 32K): lean injection
    return { totalChars, recentSessions: 2, vasanaCount: 3,
             interruptedLookbackHours: 4 };
}
```

**Three budget tiers:**

| Tier   | Context Window   | Memory Budget | Recent Sessions | Vasanas | Lookback |
|--------|-----------------|---------------|-----------------|---------|----------|
| Large  | >= 100K tokens  | up to 16K chars | 5             | 8       | 8 hours  |
| Medium | 32K-100K tokens | up to 10K chars | 3             | 5       | 6 hours  |
| Small  | < 32K tokens    | 2K-5K chars    | 2             | 3       | 4 hours  |

Budget allocation across sections is **proportional**, not fixed. The `allocateBudget()` function distributes the total character budget based on how much content each section actually has, with a minimum floor of 200 characters per section. Empty sections waste no budget. Sections that exceed their allocation are truncated at line boundaries via `truncateTobudget()`.

### 3.3 Cross-Machine Sync

For scenarios where the same Chitragupta home directory is not shared (e.g., MacBook vs. phone with separate local storage), the cross-machine sync system provides explicit export/import of memory snapshots.

Source: `packages/smriti/src/cross-machine-sync.ts` and `packages/smriti/src/sync-import.ts`

#### Export

`createCrossMachineSnapshot()` builds a portable JSON snapshot containing day files and/or memory files:

```typescript
// From packages/smriti/src/cross-machine-sync.ts
export interface CrossMachineSnapshot {
    version: 1;
    exportedAt: string;
    source: {
        machine: string;     // os.hostname()
        platform: string;    // e.g., "darwin-arm64", "linux-x64"
        home: string;        // Chitragupta home path on source machine
    };
    files: CrossMachineSnapshotFile[];
}

export interface CrossMachineSnapshotFile {
    path: string;        // portable POSIX-style relative path
    kind: "day" | "memory";
    content: string;     // full file content
    sha256: string;      // SHA-256 hex digest for integrity verification
    bytes: number;
    mtimeMs: number;     // modification time for conflict resolution
}
```

Key design choices in the export:

- **Portable paths**: All file paths are converted to POSIX-style relative paths anchored at the Chitragupta home directory (`toPortablePath()`). This means a snapshot created on macOS can be imported on Linux or Windows.
- **SHA-256 integrity**: Every file entry carries a SHA-256 hash of its content. On import, the hash is verified before writing -- if it does not match, the file is flagged as an error and skipped.
- **Configurable scope**: The caller can choose to include only day files, only memory files, or both. A `maxDays` option caps the number of day files included.
- **Best-effort collection**: If individual files are unreadable, they are silently skipped. The snapshot captures whatever is available.

The snapshot is written to disk with `writeCrossMachineSnapshot()`, which also updates the local `sync-state.json` with the export timestamp and path.

#### Import

`importCrossMachineSnapshot()` applies a snapshot with explicit conflict resolution:

**Three conflict strategies:**

| Strategy       | Day Files              | Memory Files                  |
|----------------|------------------------|-------------------------------|
| `safe` (default) | Conflict files saved as `.remote` sidecars under `sync-conflicts/` | Merged with local-first deduplication |
| `preferRemote` | Remote overwrites local | Merged with local-first deduplication |
| `preferLocal`  | Local preserved, remote skipped | Merged with local-first deduplication |

Memory files are always **merged**, never overwritten. The merge algorithm (`mergeMemory()` in `sync-import.ts`):

1. Splits both local and remote files into entries (separated by `---`)
2. Normalizes each entry (lowercase, whitespace-collapsed)
3. Computes SHA-256 of the normalized form
4. Keeps local entries in order, appends remote entries only if their hash is not already present

This ensures that no knowledge is lost during sync, while duplicates are deduplicated.

The import function returns a detailed result:

```typescript
export interface CrossMachineImportResult {
    importedAt: string;
    sourceExportedAt: string;
    strategy: "safe" | "preferRemote" | "preferLocal";
    dryRun: boolean;
    totals: {
        files: number;
        created: number;    // new files written
        updated: number;    // existing files overwritten (preferRemote only)
        merged: number;     // memory files merged
        skipped: number;    // identical content or preferLocal
        conflicts: number;  // day files with conflicts (safe mode)
        errors: number;     // SHA-256 mismatch or write failures
    };
    changedPaths: string[];
    conflictPaths: string[];
    errorPaths: string[];
}
```

A `dryRun: true` option simulates the import without writing any files, returning the same result structure for preview.

#### Sync State Tracking

The local `sync-state.json` file (at `~/.chitragupta/sync-state.json`) tracks:

```json
{
    "lastExportAt": "2026-03-04T10:30:00.000Z",
    "lastExportPath": "/tmp/chitragupta-sync-2026-03-04.json",
    "lastImportAt": "2026-03-04T14:00:00.000Z",
    "lastImportSource": "macbook-pro.local",
    "lastImportTotals": { "files": 42, "created": 5, "merged": 3, ... }
}
```

`getCrossMachineSyncStatus()` provides a dashboard view: file counts, last export/import metadata, and the Chitragupta home path.

### 3.4 Device ID Tracking in the Flow Stream

The flow stream (`~/.chitragupta/smriti/streams/flow/`) is **per-device**. Each device gets its own `.md` file:

```
~/.chitragupta/smriti/streams/flow/
  default.md
  macbook-pro.md
  pixel-8.md
```

When the compactor runs (`SessionCompactor.compact()` in `packages/smriti/src/compactor.ts`), the `deviceId` parameter determines which flow file is written:

```typescript
// From updateFlowStream() in packages/smriti/src/compactor.ts
function updateFlowStream(
    streamManager: StreamManager,
    signals: StreamSignals,
    session: Session,
    deviceId: string,
): void {
    const parts: string[] = [];
    parts.push(`## Current Context`);
    parts.push(`- Session: ${session.meta.title}`);
    parts.push(`- Project: ${session.meta.project}`);
    parts.push(`- Agent: ${session.meta.agent}`);
    parts.push(`- Model: ${session.meta.model}`);
    // ... active threads, recent questions ...
    streamManager.write("flow", parts.join("\n"), deviceId);
}
```

The flow stream has a preservation ratio of 0.30 (highly ephemeral) compared to identity (0.95) and projects (0.80). This means flow state is aggressively compacted -- only the most recent context survives. This is intentional: flow state is device-specific and short-lived. The device that picks up a conversation gets its own fresh flow file while the interrupted device's flow file remains as a historical record.

---

## 4. Provider Switching

### 4.1 Provider-Agnostic Session Format

The session format is provider-agnostic. The `SessionMeta` type carries optional `provider` and `metadata` fields:

```typescript
// From packages/smriti/src/types.ts
export interface SessionMeta {
    id: string;
    title: string;
    created: string;
    updated: string;
    agent: string;
    model: string;
    provider?: string;         // "claude-code", "codex", "vaayu", etc.
    project: string;
    parent: string | null;
    branch: string | null;
    tags: string[];
    totalCost: number;
    totalTokens: number;
    metadata?: Record<string, unknown>;  // arbitrary provider-specific fields
}
```

Any provider can create sessions (`createSession()`) and add turns (`addTurn()`) using the same API. The `provider` field is informational -- it does not affect persistence or retrieval.

### 4.2 Provider Bridge: Same Memory for Every Provider

The Provider Bridge (`loadProviderContext()`) is the unifying layer. When a session starts -- whether from Claude Code, Codex, Vaayu, or any MCP client -- the bridge loads the same memory context:

```
loadProviderContext(project, {
    providerContextWindow: 200000,  // Claude
    deviceId: "macbook-pro",
})

loadProviderContext(project, {
    providerContextWindow: 128000,  // GPT-4
    deviceId: "pixel-8",
})

loadProviderContext(project, {
    providerContextWindow: 4096,    // Small local model
    deviceId: "raspberry-pi",
})
```

All three calls access the same underlying data (global facts, project memory, recent sessions, vasanas, interrupted sessions). The only difference is how much of that data fits within the budget. The provider never needs to know about the memory architecture -- it receives a single assembled string to inject into its system prompt or first message.

### 4.3 MCP Session Reuse

For MCP-connected providers (agent type `"mcp"`), session-store implements client-key-based session reuse. If the same MCP client reconnects on the same day with the same client key, the existing session is reused rather than creating a new one:

```typescript
// From packages/smriti/src/session-store.ts — resolveMcpClientKey()
function resolveMcpClientKey(opts: SessionOpts): string | undefined {
    // Check metadata, then environment variables
    for (const key of [
        "CHITRAGUPTA_CLIENT_KEY",
        "CODEX_THREAD_ID",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_SESSION_ID",
    ]) {
        const value = process.env[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
}
```

This prevents session fragmentation when MCP connections drop and reconnect.

---

## 5. Data Flow Diagram

```
                        SESSION LIFECYCLE
                        =================

  Provider A          Provider B          Provider C
  (Claude)            (Codex)             (Vaayu)
      |                   |                   |
      v                   v                   v
  +-----------------------------------------------+
  |            Provider Bridge                     |
  |  loadProviderContext(project, options)          |
  |                                                |
  |  Loads:                                        |
  |    1. Global facts     (memory/global.md)      |
  |    2. Project memory   (memory/projects/...)   |
  |    3. Recent sessions  (session-store)         |
  |    4. Vasanas          (vasana-engine)          |
  |    5. Interrupted sess (detectInterruptedSession)|
  |                                                |
  |  Budget: 2% of provider's context window       |
  |  Allocation: proportional to content size      |
  +-----------------------------------------------+
                        |
                        v
              +-------------------+
              |  New Session      |
              |  (session-store)  |
              +-------------------+
                        |
            +-----------+-----------+
            |                       |
            v                       v
  +------------------+    +------------------+
  |  Markdown File   |    |  SQLite + FTS5   |
  |  (.md source     |    |  (write-through  |
  |   of truth)      |    |   query cache)   |
  +------------------+    +------------------+
            |                       |
            v                       v
  +------------------+    +------------------+
  |  Append turns    |    |  Index turns in  |
  |  (hot path,      |    |  turns_fts for   |
  |   no rewrite)    |    |  full-text search|
  +------------------+    +------------------+
            |
            v
  +-----------------------------------------------+
  |            Session Compaction                   |
  |  (SessionCompactor.compact)                    |
  |                                                |
  |  1. Extract signals (LLM or keyword fallback)  |
  |  2. Build affinity matrix from signal counts   |
  |  3. Sinkhorn-Knopp -> doubly stochastic matrix |
  |  4. Compute token budgets per stream           |
  +-----------------------------------------------+
            |
            v
  +-----------------------------------------------+
  |            4 Memory Streams                    |
  |  (~/.chitragupta/smriti/streams/)              |
  |                                                |
  |  identity.md   (WHO)   preservation: 0.95      |
  |  projects.md   (WHAT)  preservation: 0.80      |
  |  tasks.md      (TODO)  preservation: 0.70      |
  |  flow/{dev}.md (HOW)   preservation: 0.30      |
  +-----------------------------------------------+
            |
            +---> Compressed delta saved to
            |     smriti/deltas/{session-id}.md
            |
            +---> Mixing matrix audit trail saved to
            |     smriti/compaction/{session-id}.json
            |
            +---> Indexed into RecallEngine for
                  future semantic search


  CROSS-DEVICE SYNC
  =================

  Device A                              Device B
  (MacBook)                             (Phone)
      |                                     |
      v                                     v
  createCrossMachineSnapshot()     importCrossMachineSnapshot()
      |                                     |
      v                                     v
  +--------------------+           +--------------------+
  | JSON Snapshot      |   --->    | Apply with         |
  | - version: 1       |  (file   | conflict strategy: |
  | - source machine   |  transfer| safe / preferRemote|
  | - files[]          |  or sync)| / preferLocal      |
  |   - path (POSIX)   |          |                    |
  |   - kind (day/mem) |          | Memory: merged     |
  |   - content        |          | Days: strategy     |
  |   - sha256         |          | Integrity: SHA-256 |
  +--------------------+          +--------------------+
```

---

## 6. Architecture Decisions

### 6.1 Why Markdown for Sessions

**Decision**: Session files are plain Markdown with YAML frontmatter.

**Rationale**:

- **Human-readable**: Users can open, read, and understand any session without tooling. This matters for debugging, auditing, and building trust in the memory system.
- **Git-friendly**: Markdown diffs are clean and reviewable. Sessions can be committed to a repository, compared across branches, and merged with standard git tools.
- **Grep-able**: `grep -r "refactor" ~/.chitragupta/sessions/` works immediately. No database client required.
- **Portable**: No binary format dependencies. A session file from macOS can be read on Linux or Windows without conversion.
- **Append-friendly**: The hot path (`addTurn()`) appends to the file without rewriting. YAML frontmatter `updated:` field is patched in-place.
- **Resilient**: If SQLite corrupts or the database is deleted, all session data survives in the Markdown files. The system can rebuild SQLite from Markdown at any time.

**Trade-offs accepted**:

- Parsing Markdown is slower than a database read (mitigated by L1 LRU cache)
- No relational queries on Markdown (mitigated by SQLite write-through)
- File-per-session can lead to many small files (mitigated by YYYY/MM directory structure)

### 6.2 Why SQLite for Search

**Decision**: SQLite with FTS5 as a write-through query cache alongside Markdown files.

**Rationale**:

- **FTS5 performance**: Full-text search across thousands of session turns completes in milliseconds. Grep across Markdown files would take seconds for large histories.
- **Structured queries**: "List sessions from last week for project X sorted by cost" is a single SQL query. Impossible to express efficiently against the filesystem.
- **Aggregation**: Total cost, token usage, session counts by agent -- all trivial with SQL.
- **No migration burden**: SQLite is a write-through cache, not a source of truth. If the schema changes, rebuild from Markdown files. No data migration required.

**Write-through semantics**:

- Every `createSession()`, `addTurn()`, and metadata update writes to both Markdown and SQLite
- SQLite writes are **best-effort**: failures are logged to stderr but do not prevent the Markdown write from succeeding
- Self-healing: `insertTurnToDb()` detects missing session rows and creates placeholders automatically

### 6.3 Why Dual Persistence

**Decision**: Maintain both Markdown and SQLite, with Markdown as source of truth.

**Rationale**: This is not redundancy for its own sake. The two systems serve fundamentally different access patterns:

| Access Pattern | Markdown | SQLite |
|----------------|----------|--------|
| Read single session | LRU cache hit or file read | Not used for this |
| Full-text search | Impractical at scale | FTS5, sub-millisecond |
| List/filter sessions | Requires scanning files | Single SQL query |
| Human inspection | Open in editor | Requires tooling |
| Backup/sync | Copy files | Must export/import |
| Crash recovery | Files survive | May need rebuild |
| Append turns | Filesystem append | Transaction + index |

The Markdown files guarantee that no data is ever lost. The SQLite database makes that data queryable. Neither alone would satisfy both requirements.

### 6.4 Why JSON Snapshots for Cross-Device Sync

**Decision**: Export/import via self-describing JSON snapshots with SHA-256 integrity.

**Alternatives considered**:

- **Git sync**: Would require git on all devices, complex merge logic for non-code files, and would expose the full session history (potentially sensitive).
- **Database replication**: SQLite is not designed for multi-master replication. CRDTs add complexity.
- **Cloud sync service**: Creates a dependency on external infrastructure. Not self-hosted.

**Why JSON snapshots work**:

- **Self-describing**: Version number, source machine, platform -- everything needed to interpret the snapshot is embedded in the file.
- **Integrity**: SHA-256 per file entry means corrupted transfers are detected and rejected, not silently applied.
- **Conflict strategies**: The caller explicitly chooses how to handle conflicts. No silent data loss.
- **Transport-agnostic**: The snapshot is a file. Transfer it via USB, cloud storage, airdrop, email -- the system does not care.
- **Dry-run support**: Preview the import result before committing any changes.

### 6.5 Why Proportional Budget Allocation

**Decision**: Context budget is allocated proportionally to content availability, not fixed-fraction splits.

**Problem with fixed splits**: If global facts are 100 characters and project memory is 5000 characters, a fixed 1/3 split wastes the global facts allocation while truncating project memory unnecessarily.

**Proportional allocation** (`allocateBudget()` in `packages/smriti/src/provider-bridge.ts`):

1. Sum the raw content lengths of all non-empty sections
2. If total content fits within budget, no truncation needed
3. Otherwise, allocate proportionally with a 200-character minimum floor per section
4. Apply budget to each section via `truncateTobudget()`, preferring line-boundary breaks

This ensures every character of the context budget carries maximum information value.

### 6.6 Why Per-Device Flow Streams

**Decision**: The flow stream is per-device, unlike identity/projects/tasks which are global.

**Rationale**: Flow state ("what am I currently doing") is inherently device-specific. When a user is working on their MacBook, the flow state reflects that device's context (current topic, open questions, active threads). If they switch to their phone, the phone needs its own flow state -- it should not overwrite or conflict with the MacBook's flow.

The per-device design also enables the interrupted session detection: the flow file for the MacBook remains untouched when the phone picks up, providing a clear signal that the MacBook conversation was abandoned.

Flow files have a preservation ratio of 0.30 -- the lowest of all streams. They are aggressively compacted because ephemeral context becomes stale quickly. The identity stream (0.95) and projects stream (0.80) persist for much longer because they contain durable knowledge.

---

## File Reference

| File | Purpose |
|------|---------|
| `packages/smriti/src/provider-bridge.ts` | Provider Bridge: loads memory context for new sessions, adaptive budget, interrupted session detection |
| `packages/smriti/src/cross-machine-sync.ts` | Cross-machine sync: snapshot creation, writing, reading, status |
| `packages/smriti/src/sync-import.ts` | Cross-machine sync: snapshot import, conflict resolution, memory merge |
| `packages/smriti/src/session-store.ts` | Session lifecycle: create, save, load, delete, addTurn |
| `packages/smriti/src/session-store-cache.ts` | L1 LRU cache for parsed Session objects |
| `packages/smriti/src/session-db.ts` | SQLite helpers: schema init, write-through, path resolution |
| `packages/smriti/src/session-export.ts` | Session export/import in JSON and Markdown formats |
| `packages/smriti/src/handover-types.ts` | HandoverDelta type for incremental context handover |
| `packages/smriti/src/compactor.ts` | Session compaction: signal extraction, Sinkhorn-Knopp, stream updates |
| `packages/smriti/src/streams.ts` | StreamManager: 4 memory streams (identity, projects, tasks, flow) |
| `packages/smriti/src/types.ts` | All type definitions: Session, SessionMeta, StreamType, Vasana, etc. |
| `packages/smriti/src/memory-store.ts` | Scoped memory files: global, project, agent (Markdown-based) |
| `packages/smriti/src/markdown-writer.ts` | Markdown serialization for session files |
