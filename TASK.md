# TASK: Smriti Package Refactor

**Branch:** `audit/smriti-refactor`
**Package:** `packages/smriti`
**Current Grade:** B+ → Target: A-
**Scope:** Split large files (20 files over 450 LOC). ONLY touch files in `packages/smriti/`.

---

## Rules (from CLAUDE.md)

1. Change no more than 5 files per round
2. Run `pnpm vitest run` after each file change
3. If any test fails, fix it before moving to the next file
4. Show a summary after each round before proceeding
5. No file should exceed 450 LOC after splitting
6. JSDoc on all public exports

---

## Context

Smriti is the memory system — 24,377 LOC across 53 files with 2,061 tests. The package has **20 files over 450 LOC**, primarily consolidation engines and search components with high control flow complexity. Zero `as any`, zero lint suppressions. The challenge is splitting complex algorithmic files without breaking the 2,061 passing tests.

---

## Phase 1: Split Consolidation Engines (P0 — highest LOC)

### 1.1 Split `src/svapna-consolidation.ts` (1,522 LOC → 3-4 modules)

This implements a 5-phase dream cycle consolidation. Split by phase:

- `src/svapna-consolidation.ts` — Orchestrator + phase dispatch (under 450 LOC)
- `src/svapna-extraction.ts` — Pattern extraction phase
- `src/svapna-rules.ts` — Rule generation/reinforcement phase
- `src/svapna-vidhi.ts` — Vidhi (procedure) compilation phase

### 1.2 Split `src/periodic-consolidation.ts` (1,085 LOC → 2-3 modules)

- `src/periodic-consolidation.ts` — Main scheduler + dispatch (under 450 LOC)
- `src/periodic-monthly.ts` — Monthly consolidation logic
- `src/periodic-yearly.ts` — Yearly report generation

### 1.3 Split `src/consolidation.ts` (1,085 LOC → 2-3 modules)

- `src/consolidation.ts` — Base consolidation engine (under 450 LOC)
- `src/consolidation-phases.ts` — Individual phase implementations
- `src/consolidation-scoring.ts` — Scoring/ranking logic

### 1.4 Split `src/session-store.ts` (1,032 LOC → 2-3 modules)

- `src/session-store.ts` — Store interface + CRUD (under 450 LOC)
- `src/session-queries.ts` — Complex query logic
- `src/session-export.ts` — Import/export functionality (if not already separate)

### 1.5 Split `src/vidhi-engine.ts` (950 LOC → 2 modules)

- `src/vidhi-engine.ts` — Engine core (under 450 LOC)
- `src/vidhi-matching.ts` — Pattern matching + trigger detection

---

## Phase 2: Split GraphRAG Components (P1)

### 2.1 Split `src/graphrag.ts` (913 LOC → 2-3 modules)

- `src/graphrag.ts` — Orchestrator (under 450 LOC)
- `src/graphrag-query.ts` — Query execution logic
- `src/graphrag-update.ts` — Graph update/maintenance

### 2.2 Split `src/akasha.ts` (811 LOC → 2 modules)

- `src/akasha.ts` — Trace store + query (under 450 LOC)
- `src/akasha-stigmergy.ts` — Reinforcement + decay logic

### 2.3 Split `src/hybrid-search.ts` (722 LOC → 2 modules)

- `src/hybrid-search.ts` — RRF fusion orchestrator (under 450 LOC)
- `src/hybrid-search-strategies.ts` — Individual search strategies

---

## Phase 3: Split Remaining Large Files (P2)

These are 500-700 LOC each. Split if phases 1-2 are complete:

| File | LOC | Split Strategy |
|------|-----|---------------|
| `multi-round-retrieval.ts` | 702 | Split query decomposition from retrieval |
| `kala-chakra.ts` | 686 | Split temporal queries from time math |
| `event-extractor.ts` | 685 | Split extraction from classification |
| `pancha-vritti.ts` | 682 | Split vritti types into separate modules |
| `graphrag-leiden.ts` | 677 | Split algorithm from graph integration |
| `smaran.ts` | 651 | Split categorical store from BM25 search |
| `vasana-engine.ts` | 635 | Split BOCPD from tendency crystallization |
| `day-consolidation.ts` | 555 | Split diary writing from aggregation |
| `graphrag-pagerank-personalized.ts` | 511 | Split PageRank math from topic biasing |
| `recall.ts` | 509 | Split vector search from scoring |
| `sinkhorn-accelerated.ts` | 499 | Split Nesterov from log-domain mixing |
| `cross-machine-sync.ts` | 454 | Split export from import logic |

---

## Verification Checklist

Before marking complete:
- [ ] All 2,061 tests still pass (`pnpm vitest run`)
- [ ] `npx tsc --noEmit` passes with 0 errors in packages/smriti
- [ ] No file in `packages/smriti/src/` exceeds 450 LOC
- [ ] All new files have proper exports and are re-exported from index.ts
- [ ] All imports updated across the package
- [ ] Commit with message: `refactor(smriti): split 20 oversized files into focused modules`
