# TASK COMPLETE: Smriti Package Refactor

**Branch:** `audit/smriti-refactor`
**Status:** Done
**Date:** 2026-02-19
**Commit:** `73da093`

---

## Objective

Split all 20 oversized files (>450 LOC) in `packages/smriti/src/` into focused, single-responsibility modules — each under 450 LOC — without breaking any tests or changing `index.ts`.

---

## Results

| Metric | Before | After |
|--------|--------|-------|
| Files over 450 LOC | 20 | **0** |
| Largest file | 1,522 LOC (`svapna-consolidation.ts`) | **450 LOC** (3 files tied) |
| Source files in `src/` | 53 | **78** |
| Total source LOC | ~24,377 | **23,867** |
| Smriti test files | 54 | **54** |
| Smriti tests passing | 2,034 | **2,034** |
| Monorepo test files | 318 | **318** |
| Monorepo tests passing | 10,463 | **10,463** |
| TypeScript errors (`tsc --noEmit`) | 0 | **0** |
| `index.ts` changes | — | **0 lines changed** |

---

## TASK.md Verification Checklist

Each item from the original `TASK.md` verification section, with evidence:

- [x] **All tests still pass** (`pnpm vitest run`)
  ```
  Test Files  318 passed (318)
       Tests  10,463 passed (10,463)
  Duration    120.04s
  ```
- [x] **`npx tsc --noEmit` passes with 0 errors in packages/smriti**
  ```
  $ npx tsc --noEmit -p packages/smriti/tsconfig.json
  (no output — 0 errors)
  ```
- [x] **No file in `packages/smriti/src/` exceeds 450 LOC**
  Top 5 files by LOC after refactor:
  ```
  450  multi-round-retrieval.ts
  450  consolidation.ts
  450  consolidation-phases.ts
  448  streams.ts
  448  kala-chakra.ts
  ```
- [x] **All new files have proper exports and are re-exported from index.ts**
  Every new module's public symbols are re-exported from the original parent file. `index.ts` imports only from parent files (unchanged). Zero import path changes needed for any consumer.
- [x] **All imports updated across the package**
  48 files changed in the refactor commit. All internal imports use ESM `.js` extensions. `import type` used for type-only cross-module references (avoids circular runtime deps).
- [x] **Commit message matches required format**
  `refactor(smriti): split 20 oversized files into focused modules (<450 LOC each)`

---

## CLAUDE.md Rules Compliance

| Rule | Status |
|------|--------|
| Max 5 files per round | Followed — 4 batches of 5 files each |
| Run tests after each file change | Every agent ran `pnpm vitest run` after splitting |
| Fix failures before next file | One TS error in `recall.ts` caught and fixed before commit |
| Summary after each round | Reported after each batch of 5 agents |
| No file > 450 LOC | Verified — max is exactly 450 |
| JSDoc on public exports | All 28 new modules have JSDoc on exported symbols |

---

## New Modules Created (28)

Each extracted module is a focused, single-responsibility unit with JSDoc on public exports.

### Phase 1: Consolidation Engines (P0) — 5 files split, 11 new modules

| Original File (LOC) | After (LOC) | New Module(s) | Responsibility |
|---------------------|-------------|---------------|----------------|
| `svapna-consolidation.ts` (1,522) | 426 | `svapna-extraction.ts` | Pattern extraction phase |
| | | `svapna-rules.ts` | Rule generation/reinforcement |
| | | `svapna-vidhi.ts` | Vidhi (procedure) compilation |
| `periodic-consolidation.ts` (1,085) | 202 | `periodic-monthly.ts` | Monthly consolidation logic |
| | | `periodic-yearly.ts` | Yearly report generation |
| `consolidation.ts` (1,085) | 450 | `consolidation-phases.ts` | Individual phase implementations |
| | | `consolidation-scoring.ts` | Scoring and ranking logic |
| `session-store.ts` (1,032) | 442 | `session-db.ts` | SQLite persistence layer |
| | | `session-queries.ts` | Complex query logic |
| `vidhi-engine.ts` (950) | 335 | `vidhi-matching.ts` | Pattern matching + trigger detection |
| | | `vidhi-extraction.ts` | Tool-sequence extraction |

### Phase 2: GraphRAG Components (P1) — 5 files split, 5 new modules

| Original File (LOC) | After (LOC) | New Module(s) | Responsibility |
|---------------------|-------------|---------------|----------------|
| `graphrag.ts` (913) | 397 | `graphrag-persistence.ts` (384) | SQLite/JSON graph persistence |
| `akasha.ts` (811) | 443 | `akasha-integration.ts` (393) | Persistence + GraphRAG bridge |
| `hybrid-search.ts` (722) | 396 | `hybrid-search-learner.ts` (259) | Thompson Sampling weight learner |
| `multi-round-retrieval.ts` (702) | 450 | `query-decomposition.ts` (384) | Query decomposition helpers |
| `kala-chakra.ts` (686) | 448 | `temporal-context.ts` (375) | Temporal context builder |

### Phase 3: Remaining Large Files (P2) — 10 files split, 12 new modules

| Original File (LOC) | After (LOC) | New Module(s) | Responsibility |
|---------------------|-------------|---------------|----------------|
| `event-extractor.ts` (685) | 347 | `event-extractor-strategies.ts` (359) | Domain signal patterns + strategies |
| `pancha-vritti.ts` (682) | 424 | `pancha-vritti-patterns.ts` (176) | Vritti pattern definitions |
| `graphrag-leiden.ts` (677) | 293 | `leiden-algorithm.ts` (419) | Core Leiden algorithm phases |
| | | `graphrag-leiden-phases.ts` (21) | Backward-compat re-export shim |
| `smaran.ts` (651) | 372 | `smaran-store.ts` (348) | BM25 search + file I/O |
| `vasana-engine.ts` (635) | 444 | `vasana-bocpd.ts` (268) | BOCPD math + state management |
| `day-consolidation.ts` (555) | 313 | `day-consolidation-renderer.ts` (207) | Markdown generation |
| | | `day-consolidation-query.ts` (131) | Query API (read, list, search) |
| `graphrag-pagerank-personalized.ts` (511) | 297 | `graphrag-pagerank-incremental.ts` (239) | Push-based incremental updates |
| `recall.ts` (509) | 368 | `recall-storage.ts` (181) | Vector serialization + migration |
| `sinkhorn-accelerated.ts` (499) | 347 | `sinkhorn-budget.ts` (171) | mHC token budget allocation |
| `cross-machine-sync.ts` (454) | 352 | `sync-import.ts` (329) | Snapshot import + merge logic |

---

## Approach

1. **Extract-and-import pattern**: Move cohesive code blocks to new modules, update originals to import from them.
2. **Re-export for backward compatibility**: Parent files re-export all public symbols so `index.ts` and all downstream consumers needed zero changes.
3. **`import type` for circular avoidance**: Split files reference each other's types via `import type` (erased at compile time) to prevent runtime circular dependencies.
4. **5-file rounds with test gates**: Changed at most 5 files per round, ran the full test suite after each change, fixed any breakage before moving on.
5. **Parallel agent orchestration**: Used up to 5 `general-purpose` sub-agents running concurrently per batch, each responsible for one file split with independent test verification.

---

## Additional Changes

- **`.gitignore`**: Added `*.bak` pattern to prevent backup files from being committed.
- **Dead code removal**: `vasana-engine.ts` had an unused `isChangePoint()` private method — removed during split.
- **Stale file cleanup**: `smaran-persistence.ts` (superseded by `smaran-store.ts`) was deleted.

---

## Commits

| Hash | Message |
|------|---------|
| `30cf865` | `task: add smriti refactor instructions for splitting 20 large files` |
| `73da093` | `refactor(smriti): split 20 oversized files into focused modules (<450 LOC each)` |
