# TASK COMPLETE: Smriti Package Refactor

**Branch:** `audit/smriti-refactor`
**Status:** Done
**Date:** 2026-02-19

---

## Objective

Split all 20 oversized files (>450 LOC) in `packages/smriti/src/` into focused, single-responsibility modules — each under 450 LOC — without breaking any tests.

---

## Results

| Metric | Before | After |
|--------|--------|-------|
| Files over 450 LOC | 20 | **0** |
| Largest file | 1,522 LOC (`svapna-consolidation.ts`) | **450 LOC** |
| Source files | 53 | **81** |
| Total LOC | ~24,377 | **24,415** |
| Test files | 318 | 318 |
| Tests passing | 10,463 | **10,463** |
| TypeScript errors | 0 | **0** |

---

## New Modules Created (28)

Each extracted module is a focused, single-responsibility unit with JSDoc on public exports.

### Phase 1: Consolidation Engines (P0)

| Original File | New Module(s) | Responsibility |
|---------------|---------------|----------------|
| `svapna-consolidation.ts` (1,522) | `svapna-extraction.ts` | Pattern extraction phase |
| | `svapna-rules.ts` | Rule generation/reinforcement |
| | `svapna-vidhi.ts` | Vidhi (procedure) compilation |
| `periodic-consolidation.ts` (1,085) | `periodic-monthly.ts` | Monthly consolidation logic |
| | `periodic-yearly.ts` | Yearly report generation |
| `consolidation.ts` (1,085) | `consolidation-phases.ts` | Individual phase implementations |
| | `consolidation-scoring.ts` | Scoring and ranking logic |
| `session-store.ts` (1,032) | `session-db.ts` | SQLite persistence layer |
| | `session-queries.ts` | Complex query logic |
| `vidhi-engine.ts` (950) | `vidhi-matching.ts` | Pattern matching + trigger detection |
| | `vidhi-extraction.ts` | Tool-sequence extraction |

### Phase 2: GraphRAG Components (P1)

| Original File | New Module(s) | Responsibility |
|---------------|---------------|----------------|
| `graphrag.ts` (913) | `graphrag-persistence.ts` | SQLite/JSON graph persistence |
| `akasha.ts` (811) | `akasha-integration.ts` | Persistence + GraphRAG bridge |
| `hybrid-search.ts` (722) | `hybrid-search-learner.ts` | Weight learning + RRF strategies |

### Phase 3: Remaining Large Files (P2)

| Original File | New Module(s) | Responsibility |
|---------------|---------------|----------------|
| `multi-round-retrieval.ts` (702) | `query-decomposition.ts` | Query decomposition from retrieval |
| `kala-chakra.ts` (686) | `temporal-context.ts` | Temporal queries from time math |
| `event-extractor.ts` (685) | `event-extractor-strategies.ts` | Domain signal patterns + strategies |
| `pancha-vritti.ts` (682) | `pancha-vritti-patterns.ts` | Vritti pattern definitions |
| `graphrag-leiden.ts` (677) | `leiden-algorithm.ts` | Core algorithm phases |
| | `graphrag-leiden-phases.ts` | Backward-compat re-export shim |
| `smaran.ts` (651) | `smaran-store.ts` | BM25 search + file I/O |
| `vasana-engine.ts` (635) | `vasana-bocpd.ts` | BOCPD math + state management |
| `day-consolidation.ts` (555) | `day-consolidation-renderer.ts` | Markdown generation |
| | `day-consolidation-query.ts` | Query API (read, list, search) |
| `graphrag-pagerank-personalized.ts` (511) | `graphrag-pagerank-incremental.ts` | Push-based incremental updates |
| `recall.ts` (509) | `recall-storage.ts` | Vector serialization + migration |
| `sinkhorn-accelerated.ts` (499) | `sinkhorn-budget.ts` | mHC token budget allocation |
| `cross-machine-sync.ts` (454) | `sync-import.ts` | Snapshot import + merge logic |

---

## Approach

1. **Extract-and-import pattern**: Move cohesive code blocks to new modules, update originals to import from them.
2. **Re-export for backward compatibility**: Parent files re-export all public symbols so `index.ts` and consumers needed zero changes.
3. **`import type` for circular avoidance**: Split files reference each other's types via `import type` to prevent runtime cycles.
4. **5-file rounds with test gates**: Changed at most 5 files per round, ran the full test suite after each change, fixed any breakage before moving on.

---

## Verification

```
$ pnpm vitest run
 Test Files  318 passed (318)
      Tests  10,463 passed (10,463)

$ npx tsc --noEmit -p packages/smriti/tsconfig.json
(0 errors)

$ # No file exceeds 450 LOC
$ find packages/smriti/src -name '*.ts' ! -name '*.test.ts' ! -path '*__tests__*' \
    -exec sh -c 'lines=$(wc -l < "$1"); [ "$lines" -gt 450 ] && echo "$lines $1"' _ {} \;
(no output)
```

---

## Commits

| Hash | Message |
|------|---------|
| `30cf865` | `task: add smriti refactor instructions for splitting 20 large files` |
| `73da093` | `refactor(smriti): split 20 oversized files into focused modules (<450 LOC each)` |
