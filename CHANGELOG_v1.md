# Changelog

All notable changes to Chitragupta will be documented in this file.

## [0.5.0] - 2026-02-08

### Production Hardening — Performance, Safety, and Correctness

A comprehensive sweep across the entire monorepo targeting performance bugs, memory safety, race conditions, and operational correctness.

### Added

- **Memory-store write queue** — Per-scope promise-chain serialization in `memory-store.ts` prevents concurrent read-modify-write corruption on `updateMemory()` and `appendMemory()` (same pattern already used in `session-store.ts`)
- **Memory max size protection** — 500KB ceiling per memory scope with oldest-entry truncation (`truncateToFit`) using `\n---\n\n` entry separators; keeps header + newest entries within budget
- **LRU embedding cache** — `EmbeddingService` now uses FNV-1a hash keys (replacing collision-prone `text.slice(0,200)`) and Map insertion-order eviction at 5,000 entries for O(1) amortized cache management
- **LRU entity cache** — GraphRAG entity cache capped at 10,000 entries with Map insertion-order eviction
- **IncrementalPageRank as default** — Push-based O(1/ε) per edge change replaces full-recompute PageRank in GraphRAG, activated when `incrementalPageRank` instance is available
- **Fire-and-forget error logging** — All `.catch(() => {})` swallowed-error patterns replaced with `.catch(e => log.debug(...))` across `agent.ts`, `memory-bridge.ts`, `vidya-orchestrator.ts`, `server-registry.ts`, `server-lifecycle.ts`, `main.ts`

### Fixed

- **Hardcoded year bug** — `streams.ts` regex `2024` replaced with dynamic capturing group `(\d{4})` for year extraction
- **Embedding cache key collisions** — Replaced naive `text.slice(0,200)` keys with FNV-1a 32-bit hash for deterministic, collision-resistant cache lookup
- **Duplicate `cosineSimilarity`** — `recall-scoring.ts` now re-exports from `graphrag-scoring.ts` (single source of truth)
- **Duplicate `estimateTokens`** — Clarifying comment added in `graphrag-extraction.ts` explaining why its character-level estimator differs from `graphrag-scoring.ts`'s word-level version
- **Console output leak** — Removed `console.log/error` from `core/events.ts`, `tantra/server.ts`, `sutra/hub.ts` (production code should use structured logger)
- **Consolidation pruning** — `consolidation.ts` auto-prunes low-confidence rules during consolidation cycle
- **Test mock gap** — `cli/test/main.test.ts` mock updated with `createLogger` export after agent wiring change

### Changed

- `updateMemory()` signature: `void` → `Promise<void>` (write queue serialization)
- `appendMemory()` signature: `void` → `Promise<void>` (write queue serialization)
- All callers updated: `http-server.ts` (await), `memory-bridge.ts` (.catch for fire-and-forget), tests (async/await)
- `consolidation.test.ts` updated for `pruneRules()` return type change

### Performance

- **Embedding lookups**: FNV-1a hash → O(1) Map lookup, 5K LRU cap prevents unbounded memory growth
- **Entity cache**: 10K LRU cap prevents GraphRAG memory leak on long sessions
- **PageRank**: Incremental push-based updates avoid O(V+E) full recomputation on every edge change
- **Memory writes**: Promise-chain queue eliminates race conditions without mutexes

### Test Coverage

- **248 test files, 7,396 tests, 0 failures**
- All 14 packages compile with 0 TypeScript errors
- Load tests: p99 = 1.2ms at 500 RPS, 100% success rate

---

## [0.4.0] - 2026-02-07

### Vidya-Tantra — Skill Ecosystem Redesign

- **Pancha-Kosha** — 5-layer skill anatomy (Annamaya → Vijnanamaya)
- **Ashrama** — 4-stage lifecycle state machine (Brahmacharya → Sannyasa)
- **Kula** — Clan-based skill grouping with shared trait inheritance
- **Parampara** — Trust chain provenance tracking (guru-disciple lineage)
- **Samskara-Skill Bridge** — Memory consolidation → skill evolution bridge
- **Yoga** — Skill composition engine (sequential, parallel, conditional, fallback)
- **Vamsha** — Evolutionary biology for skills (mutation, crossover, speciation, extinction)
- **Vidya Orchestrator (Sūtradhāra)** — Unified lifecycle controller

### Shiksha — Autonomous Skill Learning

- **Vimarsh** — Zero-cost NLU for gap detection (<1ms)
- **Praptya** — 6-tier cascading sourcer (builtin → shell → cloud → npm → github → codegen)
- **Nirmana** — Skill builder with manifest generation
- **Megha** — Cloud-aware recipes for 5 providers, 10 service categories

### Auth, Observability, Load Testing

- **Kavach** auth system — JWT + RBAC + OAuth + Multi-Tenant (102 tests)
- **Drishti** observability — Logger + Tracing + Metrics + Health (93 tests)
- Load testing framework — 10 scenarios, token bucket rate limiting

---

## [0.3.0] - 2026-02-06

### Chetana — Consciousness Layer

- 4 cognitive subsystems: Bhava (affect), Dhyana (attention), Atma-Darshana (self-model), Sankalpa (intention)
- ChetanaController with beforeTurn/afterTurn/afterToolExecution hooks
- `/chetana` slash command with ANSI visualization

### Security Audit

- Full 36-issue audit: 7 Critical + 10 High + 12 Medium + 7 Low — all resolved
- .env Fortress: credential stripping across all 6 tool categories

### MCP Server Mode

- Stdio + SSE transports
- 12 tools + memory + session + agent prompt exposed

---

## [0.2.0] - 2026-02-05

### Memory Architecture

- GraphRAG with bi-temporal edges (Dvikala)
- Memory consolidation (Samskaara) — 5 pattern detectors
- Multi-round retrieval (Anveshana) — heuristic query decomposition
- Unified embedding pipeline — Ollama → OpenAI → char-frequency hash fallback

### Novel Algorithms

- Accelerated Sinkhorn-Knopp with Nesterov momentum
- Adaptive GraphRAG scoring with Thompson Sampling
- Personalized PageRank with Gauss-Seidel
- Information-theoretic compaction with TF-IDF + TextRank + MinHash

---

## [0.1.0] - 2026-02-04

### Initial Release

- 14-package TypeScript ESM monorepo
- Multi-provider AI streaming (Anthropic, OpenAI, Google, Ollama)
- Agent tree with sub-agent spawning
- P2P Actor Mesh (Erlang-inspired)
- Session persistence as Markdown
- 12 built-in tools
- Agent Garage: 6 preconfigured agent profiles
