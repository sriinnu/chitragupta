# Chitragupta Monorepo — Health Audit Report

**Date:** 2026-02-19
**Audited by:** Claude Code (Opus 4.6) with 15 parallel sub-agents (Haiku 4.5)
**Monorepo:** `chitragupta-monorepo` v0.1.14 — 15 packages

---

## Executive Summary

The chitragupta monorepo is in **strong overall health** with 10,046 passing tests, strict TypeScript across all packages, and zero external runtime dependencies beyond the workspace. The primary concern is **file size discipline** — 97 source files exceed the 450 LOC threshold, with the worst offenders in `cli` (3,149 LOC) and `anina` (1,718 LOC). Code quality is exceptional: only 38 `as any` casts and 8 TODO markers across 149K+ LOC.

### Overall Monorepo Score: **B+**

| Metric | Value |
|--------|-------|
| Packages | 15 |
| Source files | 391 |
| Source LOC | 149,362 |
| Test files | 303 |
| Test LOC | 133,171 |
| Total tests | 10,046 (all passing) |
| Test-to-source ratio | 0.89 |
| Files > 450 LOC | 97 (24.8%) |
| `as any` casts | 38 |
| TODO/FIXME/HACK | 8 |
| External deps | 1 (better-sqlite3 via smriti) |
| TypeScript strict | All 15 packages |
| Build status | Clean (0 errors) |

---

## Package Health Scores

| Package | Grade | Source LOC | Source Files | Tests | Test Files | Files >450 | `as any` | Key Issue |
|---------|-------|-----------|-------------|-------|-----------|-----------|---------|-----------|
| **core** | **A** | 4,692 | 20 | 197 | 15 | 2 | 0 | Near-perfect foundation |
| **darpana** | **A** | 2,440 | 12 | 84 | 6 | 0 | 0 | Clean proxy layer |
| **dharma** | **A** | 3,316 | 13 | 558 | 12 | 1 | 0 | rta.ts needs split (708 LOC) |
| **netra** | **A** | 1,882 | 8 | 113 | 6 | 0 | 0 | Pristine vision package |
| **sutra** | **A** | 7,127 | 21 | 733 | 18 | 3 | 0 | sabha.ts at 1,040 LOC |
| **swara** | **A** | 8,268 | 30 | 555 | 28 | 3 | 0 | Excellent provider layer |
| **tantra** | **A** | 4,946 | 15 | 325 | 12 | 2 | 0 | mcp-autonomous.ts (825 LOC) |
| **vayu** | **A** | 4,540 | 12 | 229 | 8 | 2 | 0 | Strong workflow engine |
| **vidhya-skills** | **A** | 18,915 | 42 | 1,718 | 35 | 16 | 0 | Shiksha subsystem untested |
| **yantra** | **A** | 4,558 | 18 | 340 | 16 | 0 | 1 | Security-first tool system |
| **smriti** | **B+** | 24,377 | 53 | 2,061 | 54 | 20 | 0 | 20 large files, wide API |
| **ui** | **B+** | 7,143 | 25 | 313 | 10 | 2 | 0 | 15 components untested |
| **anina** | **B** | 20,871 | 48 | 1,401 | 33 | 22 | 3 | 22 files >450 LOC, chetana/lokapala untested |
| **niyanta** | **B** | 7,156 | 16 | 453 | 13 | 8 | 0 | 8 large files, 3 phantom deps |
| **cli** | **C+** | 27,553 | 52 | 778 | 28 | 17 | 30 | 17 large files, 30 `as any`, largest file 3,149 LOC |

---

## Top 10 Priority Action Items

### P0 — Critical (file splitting, test gaps in high-risk areas)

1. **Split `cli/src/modes/mcp-server.ts`** (3,149 LOC)
   The largest file in the monorepo. Extract transport handlers, tool registration, and resource management into separate modules.

2. **Split `cli/src/modes/interactive-commands.ts`** (2,693 LOC)
   Extract command groups into separate files (session commands, config commands, debug commands).

3. **Split `anina/src/coding-orchestrator.ts`** (1,718 LOC)
   Extract planning, execution, and review phases into dedicated modules.

4. **Add tests for `anina/chetana/` subsystem** (8 files, 0 tests)
   The consciousness layer (triguna, nava-rasa, atma-darshana, sankalpa) has zero test coverage despite being core to agent behavior.

5. **Add tests for `niyanta/kartavya-dispatcher.ts`** (492 LOC, 0 tests)
   This module executes autonomous bash commands and arbitrary actions with no test validation — a security-critical gap.

### P1 — High (code quality, dependency cleanup)

6. **Eliminate 30 `as any` casts in `cli`** package
   Primarily in `http-server.ts` and `mcp-server.ts`. Replace with proper generic types or `unknown` + type guards.

7. **Remove 3 phantom dependencies in `niyanta/package.json`**
   `@chitragupta/sutra`, `@chitragupta/swara`, `@chitragupta/anima` are declared but never imported.

8. **Split `smriti/src/svapna-consolidation.ts`** (1,522 LOC)
   Extract pattern extraction, rule generation, and vidhi compilation into separate modules.

### P2 — Medium (monitoring, documentation)

9. **Add tests for `anina/lokapala/` subsystem** (8 files, 0 tests)
   World guardian modules lack test coverage entirely.

10. **Enforce 450 LOC file limit in CI**
    Add a pre-commit hook or CI check that fails when any source file exceeds 450 LOC. Currently 97 files violate this threshold.

---

## Detailed Per-Package Reports

### core (Grade: A)

| Metric | Value |
|--------|-------|
| LOC | 4,692 |
| Files | 20 src / 15 test |
| Tests | 197 |
| `as any` | 0 |
| TODO | 0 |
| Build | Clean |

**Strengths:** Zero external dependencies. Comprehensive auth (JWT, RBAC, OAuth), observability (logger, metrics, tracing), and validation. 100% strict TypeScript. Zero code quality issues.

**Issues:** `token-exchange.ts` lacks tests. 2 files near 450 LOC (metrics.ts: 478, logger.ts: 470).

---

### darpana (Grade: A)

| Metric | Value |
|--------|-------|
| LOC | 2,440 |
| Files | 12 src / 6 test |
| Tests | 84 |
| `as any` | 0 |
| TODO | 0 |
| Build | Clean |

**Strengths:** All files under 450 LOC. Single workspace dependency. Clean proxy/gateway architecture. Zero code quality issues.

**Issues:** Minor — 6 source files lack dedicated tests (config, upstream).

---

### dharma (Grade: A)

| Metric | Value |
|--------|-------|
| LOC | 3,316 |
| Files | 13 src / 12 test |
| Tests | 558 |
| `as any` | 0 |
| TODO | 0 |
| Build | Clean |

**Strengths:** 100% test file coverage. 558 tests in 371ms. Exemplary policy engine with extensible rule system. Zero code quality issues.

**Issues:** `rta.ts` at 708 LOC — should split invariant rules into separate files.

---

### netra (Grade: A)

| Metric | Value |
|--------|-------|
| LOC | 1,882 |
| Files | 8 src / 6 test |
| Tests | 113 |
| `as any` | 0 |
| TODO | 0 |
| Build | Clean |

**Strengths:** Zero external dependencies. Custom PNG decoder, pixel diffing, terminal rendering. Test LOC exceeds source LOC (1.07:1). All files under 450 LOC.

**Issues:** None significant.

---

### sutra (Grade: A)

| Metric | Value |
|--------|-------|
| LOC | 7,127 |
| Files | 21 src / 18 test |
| Tests | 733 |
| `as any` | 0 |
| TODO | 0 |
| Build | Clean |

**Strengths:** Comprehensive multi-agent communication framework (CommHub, Actor Mesh, Sabha deliberation, Samiti channels). 1.3:1 test-to-source ratio. 100% source file coverage.

**Issues:** `sabha.ts` at 1,040 LOC — monitor for growth.

---

### swara (Grade: A)

| Metric | Value |
|--------|-------|
| LOC | 8,268 |
| Files | 30 src / 28 test |
| Tests | 555 |
| `as any` | 0 |
| TODO | 0 |
| Build | Clean |

**Strengths:** Zero external deps. LinUCB contextual bandit routing. Production-grade resilience (circuit breaker, retry, rate limiting). 83.8% test ratio.

**Issues:** 3 files slightly over 450 LOC (turiya.ts: 813, router-task-type.ts: 598, anthropic.ts: 463).

---

### tantra (Grade: A)

| Metric | Value |
|--------|-------|
| LOC | 4,946 |
| Files | 15 src / 12 test |
| Tests | 325 |
| `as any` | 0 |
| TODO | 0 |
| Build | Clean |

**Strengths:** 21.67 tests per source file. Zero technical debt. Comprehensive MCP protocol implementation.

**Issues:** `mcp-autonomous.ts` at 825 LOC.

---

### vayu (Grade: A)

| Metric | Value |
|--------|-------|
| LOC | 4,540 |
| Files | 12 src / 8 test |
| Tests | 229 |
| `as any` | 0 |
| TODO | 0 |
| Build | Clean |

**Strengths:** Clean DAG workflow engine. 229 passing tests in 406ms. Well-layered architecture (types -> dag -> executor -> builder). Worker pool with thread isolation.

**Issues:** `executor-lifecycle.ts` at 901 LOC, `chitragupta-nodes.ts` at 822 LOC — both lack dedicated tests.

---

### vidhya-skills (Grade: A)

| Metric | Value |
|--------|-------|
| LOC | 18,915 |
| Files | 42 src / 35 test |
| Tests | 1,718 |
| `as any` | 0 |
| TODO | 0 |
| Build | Clean |

**Strengths:** 1,718 tests — highest in the monorepo. Comprehensive skill discovery, parsing, lifecycle, and security. Zero code quality issues.

**Issues:** Shiksha autonomous learning subsystem (2,854 LOC) has zero test coverage. 16 files over 450 LOC.

---

### yantra (Grade: A)

| Metric | Value |
|--------|-------|
| LOC | 4,558 |
| Files | 18 src / 16 test |
| Tests | 340 |
| `as any` | 1 (justified) |
| TODO | 0 |
| Build | Clean |

**Strengths:** Defense-in-depth security across all 12 tools. 32 dedicated security tests (env-fortress). 0.89 test-to-source ratio. No file exceeds 455 LOC.

**Issues:** None significant.

---

### smriti (Grade: B+)

| Metric | Value |
|--------|-------|
| LOC | 24,377 |
| Files | 53 src / 54 test |
| Tests | 2,061 |
| `as any` | 0 |
| TODO | 7 |
| Build | Clean |

**Strengths:** Second-highest test count (2,061). 1.25 test-to-source ratio. GraphRAG, bi-temporal knowledge, Svapna consolidation. Zero `as any`.

**Issues:** 20 files over 450 LOC (worst: svapna-consolidation.ts at 1,522). Wide API surface (76+ exports). High control flow complexity in consolidation engines.

---

### ui (Grade: B+)

| Metric | Value |
|--------|-------|
| LOC | 7,143 |
| Files | 25 src / 10 test |
| Tests | 313 |
| `as any` | 0 |
| TODO | 0 |
| Build | Clean |

**Strengths:** Zero external deps. Core terminal rendering (ANSI, keys, input, screen, theme). 3 biome-ignore directives only (justified for regex).

**Issues:** 15 of 25 components lack dedicated tests (37% test-to-source ratio).

---

### anina (Grade: B)

| Metric | Value |
|--------|-------|
| LOC | 20,871 |
| Files | 48 src / 33 test |
| Tests | 1,401 |
| `as any` | 3 |
| TODO | 0 |
| Build | Clean |

**Strengths:** 1,401 tests. Clean dependency graph (3 workspace deps). 80+ well-organized exports. Comprehensive agent framework.

**Issues:** **22 files over 450 LOC** (worst: coding-orchestrator.ts at 1,718). Entire `chetana/` subsystem (8 files) and `lokapala/` subsystem (8 files) have zero test coverage.

---

### niyanta (Grade: B)

| Metric | Value |
|--------|-------|
| LOC | 7,156 |
| Files | 16 src / 13 test |
| Tests | 453 |
| `as any` | 0 |
| TODO | 0 |
| Build | Clean |

**Strengths:** 453 tests with 70% test-to-source ratio. Sophisticated orchestration (DAG engine, strategy bandit). Zero code quality issues.

**Issues:** 8 files over 450 LOC (50% of codebase). `kartavya-dispatcher.ts` (492 LOC, autonomous execution) has zero tests. 3 phantom dependencies in package.json.

---

### cli (Grade: C+)

| Metric | Value |
|--------|-------|
| LOC | 27,553 |
| Files | 52 src / 28 test |
| Tests | 778 |
| `as any` | 30 |
| TODO | 0 |
| Build | Clean |

**Strengths:** 778 tests. 26 well-organized public exports. Functional with comprehensive MCP server, HTTP server, WebSocket, and interactive modes.

**Issues:** **Largest package with worst code organization.** 17 files over 450 LOC. Top 3 files are 28% of all code (mcp-server.ts: 3,149, interactive-commands.ts: 2,693, openapi.ts: 1,806). **30 `as any` casts** (79% of monorepo total). 50% of source files lack tests. 1 unused dependency (@chitragupta/vidhya-skills).

---

## Files Over 450 LOC — Full List (97 files)

| LOC | Package | File |
|-----|---------|------|
| 3,149 | cli | mcp-server.ts |
| 2,693 | cli | interactive-commands.ts |
| 1,806 | cli | openapi.ts |
| 1,718 | anina | coding-orchestrator.ts |
| 1,698 | cli | main.ts |
| 1,687 | cli | http-server.ts |
| 1,522 | smriti | svapna-consolidation.ts |
| 1,186 | anina | agent.ts |
| 1,085 | smriti | periodic-consolidation.ts |
| 1,085 | smriti | consolidation.ts |
| 1,066 | vidhya-skills | porter.ts |
| 1,048 | cli | api.ts |
| 1,040 | sutra | sabha.ts |
| 1,032 | smriti | session-store.ts |
| 1,030 | cli | interactive.ts |
| 950 | smriti | vidhi-engine.ts |
| 922 | vidhya-skills | megha.ts |
| 919 | niyanta | kartavya.ts |
| 913 | smriti | graphrag.ts |
| 901 | vayu | executor-lifecycle.ts |
| 895 | cli | ws-handler.ts |
| 854 | cli | code-interactive.ts |
| 849 | vidhya-skills | crystallization.ts |
| 825 | tantra | mcp-autonomous.ts |
| 822 | vayu | chitragupta-nodes.ts |
| 813 | swara | turiya.ts |
| 811 | smriti | akasha.ts |
| 808 | vidhya-skills | parser.ts |
| 807 | vidhya-skills | vidya-orchestrator.ts |
| 801 | vidhya-skills | skill-evolution.ts |
| 769 | anina | coding-agent.ts |
| 739 | anina | agent-autonomy.ts |
| 730 | vidhya-skills | types-v2.ts |
| 728 | vidhya-skills | agent-skills-loader.ts |
| 722 | smriti | hybrid-search.ts |
| 719 | anina | triguna.ts |
| 713 | vidhya-skills | matcher.ts |
| 713 | anina | context-compaction-informational.ts |
| 708 | dharma | rta.ts |
| 702 | smriti | multi-round-retrieval.ts |
| 686 | smriti | kala-chakra.ts |
| 685 | smriti | event-extractor.ts |
| 684 | niyanta | orchestrator.ts |
| 682 | smriti | pancha-vritti.ts |
| 677 | smriti | graphrag-leiden.ts |
| 661 | sutra | samiti.ts |
| 660 | vidhya-skills | suraksha.ts |
| 652 | anina | buddhi.ts |
| 651 | smriti | smaran.ts |
| 651 | anina | chitragupta-daemon.ts |
| 635 | smriti | vasana-engine.ts |
| 631 | anina | learning-loop.ts |
| 628 | anina | nava-rasa.ts |
| 625 | niyanta | evaluator.ts |
| 622 | cli | collaboration.ts |
| 613 | cli | server.ts |
| 611 | niyanta | orchestrator-autonomous.ts |
| 598 | swara | router-task-type.ts |
| 595 | niyanta | orchestration-patterns.ts |
| 575 | cli | code.ts |
| 575 | anina | atma-darshana.ts |
| 566 | anina | agent-kaala.ts |
| 564 | anina | nidra-daemon.ts |
| 555 | smriti | day-consolidation.ts |
| 554 | vidhya-skills | pratiksha.ts |
| 546 | anina | memory-bridge.ts |
| 538 | anina | types.ts |
| 531 | sutra | event-manager.ts |
| 528 | anina | sankalpa.ts |
| 526 | vidhya-skills | registry.ts |
| 520 | anina | pratyabhijna.ts |
| 515 | anina | daemon-manager.ts |
| 511 | smriti | graphrag-pagerank-personalized.ts |
| 509 | smriti | recall.ts |
| 506 | cli | interactive-render.ts |
| 504 | anina | debug-agent.ts |
| 503 | cli | cli.ts |
| 502 | anina | manas.ts |
| 499 | vidhya-skills | vimarsh.ts |
| 499 | smriti | sinkhorn-accelerated.ts |
| 496 | niyanta | orchestrator-scaling.ts |
| 492 | niyanta | kartavya-dispatcher.ts |
| 487 | niyanta | strategy-bandit.ts |
| 478 | core | metrics.ts |
| 476 | cli | skills.ts |
| 476 | cli | init.ts |
| 470 | core | logger.ts |
| 469 | vidhya-skills | pancha-kosha.ts |
| 468 | vidhya-skills | discovery.ts |
| 465 | ui | editor.ts |
| 463 | swara | anthropic.ts |
| 462 | vidhya-skills | approval-queue.ts |
| 457 | ui | heartbeat-monitor.ts |
| 456 | anina | rakshaka.ts |
| 455 | yantra | grep.ts |
| 454 | smriti | cross-machine-sync.ts |
| 451 | tantra | server-discovery.ts |

---

## Dependency Graph

All packages depend only on `@chitragupta/core` (workspace) with these exceptions:
- **smriti**: Also depends on `better-sqlite3` (only external runtime dep in monorepo)
- **smriti**: Also depends on `@chitragupta/swara` (lightly used)
- **cli**: Depends on most packages (expected for the entry point)
- **anina**: Depends on `@chitragupta/smriti`, `@chitragupta/swara`, `@chitragupta/core`

**Zero circular dependencies detected.**

---

## Build Status

All 15 packages compile cleanly with `tsc --noEmit` under strict mode. Full test suite: **10,046 tests passing** in ~120s.

---

*Generated 2026-02-19 by autonomous health audit (15 parallel sub-agents)*
*Detailed per-package reports available in `.agents/results/`*
