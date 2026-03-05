# Changelog

All notable changes to `@chitragupta/smriti` will be documented in this file.

## 0.1.1 (2026-03-05)

### Features

- **natasha-observer**: Temporal trending engine with trend/regression/velocity detection, renamed from Morgan Observer (Scarlett-themed naming)
- **transcendence**: Predictive context pre-fetcher for Lucy 100% phase
- **lucy-bridge**: Lucy Bridge integration with 40-60% neural capacity observer layer
- **episodic-memory**: Episodic developer memory for error pattern recall and recurrence detection
- **competitive-gap**: Competitive gap features with adaptive context budget management
- **akasha-bridge**: Bridge akasha traces into the unified recall engine for cross-layer search

### Bug Fixes

- **recall-akasha-bridge**: Wire akasha traces into unified recall so `chitragupta_recall` searches all memory layers
- **memory-quality-gates**: Improve memory quality gates and wire dead agent callbacks
- **mcp-memory-dedupe**: Deduplicate persisted facts and harden MCP session/state wiring
- **critical-bugs**: Fix missing imports, priorBlend clamp, truncateToBudget typo, svapna migration path
- **error-handling**: Add logging to bare catch blocks across mesh/smriti (no more swallowed errors)

### Refactoring

- **svapna-to-swapna**: Rename svapna to swapna across codebase (correct Sanskrit spelling)
- **loc-split**: Split 17 oversized files into 44 focused modules (all under 450 LOC)
- **type-extraction**: Extract types to dedicated `-types.ts` files to fix LOC violations

### Changed

- Monorepo build restored across cli/smriti/tantra/vidhya-skills after refactor
- Standardized configs across all packages
- Re-export new types from barrel indexes

## 0.1.0 (2026-02-08)

### Initial Release

- GraphRAG with bi-temporal edges (Dvikala)
- Memory consolidation (Samskaara) with 5 pattern detectors
- Multi-round retrieval (Anveshana) with heuristic query decomposition
- Unified embedding pipeline (Ollama, OpenAI, char-frequency hash fallback)
- Accelerated Sinkhorn-Knopp with Nesterov momentum
- Adaptive GraphRAG scoring with Thompson Sampling
- Personalized PageRank with Gauss-Seidel
- Information-theoretic compaction with TF-IDF + TextRank + MinHash
- Memory-store write queue with per-scope promise-chain serialization
- LRU embedding cache with FNV-1a hash keys (5K entry cap)
- LRU entity cache for GraphRAG (10K entry cap)
- IncrementalPageRank as default (push-based O(1/epsilon) per edge change)
