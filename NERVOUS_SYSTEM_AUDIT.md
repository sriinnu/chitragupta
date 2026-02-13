# Chitragupta Nervous System — End-to-End Audit

> Audited: 2026-02-13 | Branch: `feat/agent-code` | 288 test files, 9698 tests passing

## Mental Model: A Day's Journey Through Chitragupta

```
 MORNING                    AFTERNOON                   NIGHT                    NEXT DAY
 ───────                    ─────────                   ─────                    ────────
 User starts work           User keeps coding           Daemon wakes at 2AM      User asks "how did I
 ↓                          ↓                           ↓                        fix the auth bug?"
 MCP tools fire             Turns accumulate            consolidateDay()         ↓
 ↓                          ↓                           ↓                        recall(query)
 recordToolCall()           Facts extracted live         EventExtractor runs      ↓
 ↓                          ↓                           ↓                        HybridSearch
 2 turns → agent.db         Memory grows                FactExtractor runs       + Memory + DayFiles
 + FTS5 index               ↓                           ↓                        ↓
 ↓                          GraphRAG indexes            Day file written         Assembled answer
 FactExtractor runs         entities in background      ~/.chitragupta/days/     returned
                                                        YYYY/MM/DD.md
```

---

## Phase 1: Real-Time Recording (MCP Server)

**Path**: `tantra/server.ts` → `mcp-server.ts:recordToolCall()` → `session-store.ts:addTurn()`

Every MCP tool call:

1. Creates 2 turns (user: `[tool:read] path=...`, assistant: `[read → 12ms] content...`)
2. **Write-through**: `.md` file first (source of truth) → SQLite `agent.db` (turns + FTS5 index)
3. **FactExtractor runs immediately** on tool args → saves to `~/.chitragupta/memory/global.md`
4. **autoExtractEvents** records high-level semantics (files changed, commits, decisions)

**Status**: SOLID — All 25 MCP tools pass through `recordToolCall`. Facts persist in real-time.

---

## Phase 2: Background Indexing (GraphRAG + Vectors)

**Path**: `MemoryBridge` (anina) → `GraphRAGEngine` + `RecallEngine`

As turns accumulate:

- **GraphRAG** extracts entities (Ollama `llama3.2` or keyword fallback) → `graph.db` (nodes, edges, pagerank)
- **RecallEngine** generates embeddings (Ollama `nomic-embed-text` or hash fallback) → `vectors.db` as BLOBs
- **PageRank** runs incrementally on graph changes

**Status**: SOLID — Both engines gracefully degrade when Ollama is unavailable.

---

## Phase 3: Night Consolidation (Daemon → Day File)

**Path**: `ChitraguptaDaemon` → `consolidateDay(date)` → `EventExtractor` + `FactExtractor` → day markdown

**Three triggers**:

1. **Idle**: When Nidra detects user idle → consolidate today
2. **Cron**: 2 AM nightly → consolidate yesterday
3. **Startup backfill**: Catches missed days (up to 7 days back)

**For each session on that day**:

1. `listSessionsByDate(date)` pulls all sessions from SQLite
2. `listTurnsWithTimestamps()` loads turns with real timestamps (fallback: synthetic 1s spacing)
3. `extractEventChain(meta, turns)` → session-type-aware gist:
   - **coding** (>60% tool ratio): extracts tool results, file mods, errors, commits
   - **discussion** (<15% tool ratio): extracts topics, options, conclusions
   - **mixed**: both strategies
   - **personal** (≤4 turns, short): minimal extraction
4. `FactExtractor` runs on all user turns (pattern matching + vector similarity)
5. Files collected from event chain `event.files`

**Generated day file** (`~/.chitragupta/days/YYYY/MM/DD.md`):

```markdown
# 2025-06-15 — Wednesday
> 8 sessions | 3 projects | 142 turns

## Facts Learned
- [preference] Always use pnpm install --force after renames

## Project: /path/to/chitragupta
**Branch**: main | **Providers**: claude-code | **Sessions**: 5 | **Files Modified**: 12

### Session: session-2025-06-15-abc1
*10:00 | claude-code | 25 turns | coding session*
> 10:00 via claude-code — 12 actions, 2 commits, 1 error
**Topics**: authentication, JWT migration
- **Decision**: Use JWT for auth instead of session cookies
- **Commit**: abc1234
- **Error**: TypeScript strict null check failed

### Tools Used
- **read**: 45 calls | **edit**: 23 calls | **bash**: 12 calls

### Files Modified
- src/auth/jwt.ts, src/middleware/auth.ts, ...
```

**Status**: SOLID — EventExtractor and FactExtractor both properly wired. No broken imports.

---

## Phase 4: Recall (Next Day Query)

**Path**: `recall(query)` → 4 parallel searches → deduplicate → rank → return

```
recall("how did I fix the auth bug?")
├── searchHybrid() ─── HybridSearchEngine ──┐
│   ├── BM25 ranker (FTS5 on agent.db)      │
│   ├── Vector ranker (RecallEngine)         ├── RRF Fusion
│   ├── GraphRAG ranker (graph.db)           │   score = Σ w_i / (k + rank_i)
│   └── Pramana epistemic weighting          │
│       (pratyaksha=1.0, shabda=0.75, ...)   ┘
│       + Thompson Sampling weight learning
│       + Multi-source agreement bonus (1.05x-1.15x)
│
├── searchTurns() ─── [FALLBACK only if hybrid empty]
│   └── FTS5 → loadSession → manual term scoring
│
├── searchMemoryLayer() ─── [SUPPLEMENTARY, always runs]
│   └── In-memory BM25 over global/project/agent memory
│
└── searchDayFileLayer() ─── [SUPPLEMENTARY, always runs]
    └── Line-by-line substring search on day files
```

**Score normalization**:

| Layer | Formula | Range |
|-------|---------|-------|
| Hybrid | `score / (score + 0.5)` | [0, 1] |
| FTS5 fallback | `termHitRatio + 0.3` | [0.3, 1] |
| Memory | `relevance + 0.1` | [0.1, 1] |
| Day files | fixed `0.5` | 0.5 |

**Dedup**: By session ID (exact) or by `source:snippet[0:50]` (content similarity)

**Status**: SOLID — Hybrid primary, FTS5 fallback, Memory + DayFiles supplementary. All parallel via `Promise.allSettled`.

---

## Full Integration Map

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERACTION                          │
│  MCP Tool Call → recordToolCall() → addTurn()               │
│       │                                    │                │
│       ├── FactExtractor (real-time)        ├── agent.db     │
│       │   → global memory                  │   turns + FTS5 │
│       │                                    │                │
│       └── autoExtractEvents                └── .md file     │
│           → project memory                     (source of   │
│                                                 truth)      │
├─────────────────────────────────────────────────────────────┤
│                  BACKGROUND INDEXING                         │
│  MemoryBridge → GraphRAGEngine → graph.db (nodes/edges/PR) │
│               → RecallEngine   → vectors.db (embeddings)    │
├─────────────────────────────────────────────────────────────┤
│                  NIGHT CONSOLIDATION                         │
│  ChitraguptaDaemon (2AM or idle)                            │
│       → consolidateDay(date)                                │
│           → extractEventChain() per session                 │
│           → FactExtractor on user turns                     │
│           → generateDayMarkdown()                           │
│           → ~/.chitragupta/days/YYYY/MM/DD.md               │
│       → Svapna (5-phase dream consolidation)                │
│       → Persist facts to global memory                      │
├─────────────────────────────────────────────────────────────┤
│                  RECALL (QUERY TIME)                         │
│  recall(query) → Promise.allSettled([                       │
│       HybridSearch (RRF + Thompson + Pramana)  ← agent.db  │
│       FTS5 fallback                            ← agent.db  │
│       Memory search (BM25)                     ← memory/   │
│       DayFile search (substring)               ← days/     │
│  ]) → deduplicate → rank → top K                           │
├─────────────────────────────────────────────────────────────┤
│                  CONTEXT INJECTION                           │
│  loadProviderContext() → assembles memory for new sessions  │
│       ← global memory + project memory + recent sessions    │
│       (read-only — does NOT record, only injects)           │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Status Table

| Component | Status | Connected? | Notes |
|-----------|--------|------------|-------|
| **MCP → Recording** | SOLID | All 25 tools → recordToolCall | Write-through .md + SQLite |
| **MCP → FactExtractor** | SOLID | Real-time on every tool call | Minor: double extraction (deduped) |
| **MCP → Provider Bridge** | SOLID | Via `chitragupta_context` tool | Read-only assembly |
| **Daemon → consolidateDay** | SOLID | 3 triggers (idle/cron/backfill) | Calls with `force: true` |
| **consolidateDay → EventExtractor** | SOLID | Per-session event chains | Session-type-aware (4 types) |
| **consolidateDay → FactExtractor** | SOLID | Pattern + vector + fallback | Dedup by first 50 chars |
| **Day file → searchDayFiles** | SOLID | Substring search, recent-first | Linear scan (no index) |
| **recall → HybridSearch** | SOLID | RRF + Thompson + Pramana | Graceful degradation |
| **recall → FTS5 fallback** | SOLID | Only when hybrid returns empty | Term scoring + 0.3 boost |
| **recall → Memory** | SOLID | Always supplementary | BM25 + 0.1 boost |
| **recall → DayFiles** | SOLID | Always supplementary | Fixed 0.5 score |
| **GraphRAG indexing** | SOLID | Background via MemoryBridge | Ollama → keyword fallback |
| **Vector indexing** | SOLID | Background via MemoryBridge | Ollama → hash fallback |
| **Exports** | SOLID | All modules in index.ts | Types exported too |
| **No orphans** | CONFIRMED | Every module called by ≥1 consumer | Zero dead code |

---

## Issues Found

### Issue 1: Double Fact Extraction in MCP (Inefficiency)

**Location**: `packages/cli/src/modes/mcp-server.ts` lines 2264-2279 + 2304-2371

**Problem**: `recordToolCall` extracts facts from tool args, then `autoExtractEvents` extracts facts again from the same content. The dedup cache prevents duplicate saves, but wastes CPU cycles.

**Fix**: Extract once, share results.

### Issue 2: Day File Search is Linear (Scalability)

**Location**: `packages/smriti/src/day-consolidation.ts` `searchDayFiles()`

**Problem**: Searches day files with O(days × lines) substring matching. Fine for months, degrades at years of data (365+ files × hundreds of lines each).

**Fix**: Hierarchical temporal consolidation (daily → monthly → yearly) with vector-indexed summaries for deep traversal. See `HIERARCHICAL_MEMORY_SPEC.md`.

### Issue 3: Provider Bridge Not Auto-Injected (UX Gap)

**Location**: `packages/cli/src/modes/mcp-server.ts`

**Problem**: `loadProviderContext()` only runs when MCP client explicitly calls `chitragupta_context` tool. New MCP clients don't know to call it, missing memory injection.

**Fix**: Auto-inject context on first tool call per MCP session.
