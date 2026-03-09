# @chitragupta/smriti

![Logo](../../assets/logos/smriti.svg)

**smriti -- Memory**

**Sessions, 4-stream memory model, GraphRAG knowledge graphs, hybrid search, consolidation, procedural memory, behavioral crystallization, dream-cycle consolidation, temporal awareness, shared knowledge fields, provider bridge, Natasha temporal trending, Transcendence predictive pre-fetching, episodic developer memory, and SQLite persistence.**

Smriti is Chitragupta's memory system. It persists everything -- sessions as Markdown files (backed by SQLite for indexing and FTS5), memory across four streams (identity, projects, tasks, flow), and a knowledge graph that links sessions, concepts, files, and decisions. Sessions can be branched like git branches, letting you explore alternative conversation paths. The Sinkhorn-Knopp compaction algorithm optimally allocates token budgets across memory streams based on signal affinity.

The Phase 1 Self-Evolution Engine adds six new subsystems: the **Vasana Engine** crystallizes stable behavioral tendencies from raw samskaras using Bayesian change-point detection, the **Swapna Consolidation** pipeline runs a 5-phase dream cycle mirroring neuroscience sleep consolidation, the **Vidhi Engine** extracts parameterized procedural memories from repeated tool sequences, **Periodic Consolidation** generates monthly/yearly Markdown reports, **Akasha** implements stigmergic traces for indirect agent-to-agent knowledge sharing, and **Kala Chakra** provides 7-scale temporal awareness from the current turn to yearly patterns.

The Lucy neural capacity expansion system (named after the 2014 film) adds three more subsystems: **Natasha Observer** is a temporal trending engine that detects entity trends, error regressions, and coding velocity across time windows. **Transcendence Engine** is a predictive context pre-fetcher that fuses 5 signal sources (trends, temporal patterns, continuations, regressions, co-occurrence) to anticipate what memory context will be needed before it is requested. **Episodic Memory** provides durable developer experience recall -- errors, fixes, and discoveries tagged with error signatures, tool names, and file paths for automatic recall when similar situations recur.

---

## Key Features

- **Session management** -- Create, save, load, list, delete, and search sessions stored as Markdown + SQLite
- **4-stream memory model** -- Identity (95% preservation), projects (80%), tasks (70%), flow (30%)
- **GraphRAG engine** -- Knowledge graph with typed nodes (session, memory, concept, file, decision) and weighted edges; bi-temporal edge filtering via `queryEdgesAtTime()` before PageRank
- **Hybrid search (Samshodhana)** -- RRF fusion: BM25 + Vector + GraphRAG + Pramana epistemological weighting + Kala Chakra temporal boost; user-configurable weight priors blended with Thompson Sampling
- **Session branching** -- Branch sessions like git branches and build a session tree
- **Markdown storage** -- Sessions stored as human-readable Markdown with YAML frontmatter metadata
- **Scoped memory** -- Global, project, and agent-level memory files; session memory remains part of the session ledger and is accessed through session APIs
- **Sinkhorn-Knopp compaction** -- Nesterov-accelerated doubly stochastic mixing matrix for optimal token budget allocation; pre-compaction flush with `rollback()` support
- **Bi-temporal edges (Dvikala)** -- Every graph edge carries valid-time and record-time axes, enabling time-travel queries and correction without data loss
- **Memory consolidation (Samskaara)** -- Post-session pattern detection transforms raw experience into lasting knowledge rules with confidence tracking; evergreen rules exempt from temporal decay and pruning
- **Multi-round retrieval (Anveshana)** -- Heuristic query decomposition with iterative search, weighted result fusion, and adaptive termination
- **Pramana epistemology** -- 6 types of knowledge (Pratyaksha, Anumana, Shabda, Upamana, Arthapatti, Anupalabdhi) with reliability weighting
- **SQLite database layer** -- 3-database architecture (agent.db, graph.db, vectors.db) with prepared statements and schema versioning
- **Vasana Engine** -- Bayesian Online Change-Point Detection (BOCPD) for crystallizing stable behavioral tendencies
- **Swapna Consolidation** -- 5-phase dream cycle: REPLAY, RECOMBINE, CRYSTALLIZE, PROCEDURALIZE, COMPRESS
- **Vidhi Engine** -- Procedural memory: n-gram extraction, anti-unification, Thompson Sampling for selection
- **Periodic Consolidation** -- Monthly and yearly Markdown reports with FTS5 indexing
- **Curated packed summaries** -- Daily/monthly/yearly consolidation artifacts can carry optional PAKT-packed derived summaries for transport/context packing while semantic embeddings stay on the original curated summary text
- **Akasha** -- Stigmergic traces for indirect knowledge sharing between agents (ant colony optimization inspired)
- **Kala Chakra** -- 7-scale temporal awareness (turn, session, day, week, month, quarter, year) with multi-scale decay; auto-initialized by default in HybridSearchEngine (disable with `disableTemporalBoost`)
- **Provider Bridge** -- Adaptive context budget scaling with provider's context window; interrupted session detection for cross-device pickup
- **Encrypted cross-device sync snapshots** -- PBKDF2 + AES-256-GCM envelope helpers for passphrase-protected sync transport
- **Natasha Observer** -- Temporal trending engine: entity trend detection, error regression alerts, coding velocity tracking across hour/day/week/month windows; based on Zep/Graphiti bitemporal KG and TG-RAG hierarchical time summaries
- **Transcendence Engine** -- Predictive context pre-fetcher: 5-source signal fusion (trends, temporal patterns, continuations, regressions, co-occurrence), LRU cache with TTL eviction, fuzzy Jaccard lookup; based on Neural Paging and MEM1 anticipatory staging
- **Episodic Memory** -- Durable developer experience store: error signature normalization, multi-dimensional recall (error, tool, file, text), BM25 full-text search, recall frequency tracking

## Architecture

```
@chitragupta/smriti
├── types.ts                         Core types: Session, SessionTurn, PramanaType, Vasana, Vidhi, etc.
├── session-store.ts                 createSession(), saveSession(), loadSession(), addTurn()
├── memory-store.ts                  getMemory(), updateMemory(), appendMemory(), listMemoryScopes()
├── search.ts                        searchSessions(), searchMemory()
├── markdown-parser.ts               parseSessionMarkdown() — Markdown -> Session
├── markdown-writer.ts               writeSessionMarkdown(), writeTurnMarkdown()
├── branch.ts                        branchSession(), getSessionTree()
├── session-export.ts                JSON/Markdown export/import
│
├── db/                              SQLite Database Layer
│   ├── database.ts                  DatabaseManager — connection pool for agent/graph/vectors DBs
│   ├── schema.ts                    DDL: sessions, turns, FTS5, vasanas, kartavyas, nodes, edges
│   └── index.ts                     Re-exports
│
├── graphrag.ts                      GraphRAGEngine — knowledge graph with NER + embedding retrieval
├── graphrag-builder.ts              Graph construction with bi-temporal edges
├── graphrag-extraction.ts           Entity/relationship extraction + NER integration
├── graphrag-scoring.ts              BM25-lite scoring, token estimation
├── graphrag-adaptive-scoring.ts     Thompson Sampling weight learning + MMR diversity
├── graphrag-pagerank.ts             Standard PageRank
├── graphrag-pagerank-personalized.ts  Topic-biased teleportation + Gauss-Seidel + incremental push
├── graphrag-pagerank-incremental.ts   Push-based incremental PageRank updates
├── graphrag-persistence.ts          SQLite persistence for graph nodes/edges
├── graphrag-leiden.ts               Leiden community detection
├── graphrag-leiden-phases.ts        Leiden phase decomposition
│
├── hybrid-search.ts                 Samshodhana — RRF fusion (BM25 + Vector + GraphRAG + Pramana + Kala)
├── hybrid-search-learner.ts         Thompson Sampling weight learning with Beta posteriors
├── recall.ts                        RecallEngine — vector search across sessions & streams
├── recall-scoring.ts                Recall scoring configuration
├── recall-storage.ts                Recall persistence layer
├── unified-recall.ts                UnifiedRecall — layered fallback (Hybrid → BM25 → keyword)
├── embedding-service.ts             EmbeddingService — unified embedding abstraction
├── ner-extractor.ts                 NERExtractor — Named Entity Recognition
│
├── streams.ts                       StreamManager — 4-stream memory model
├── stream-extractor.ts              Signal classification for streams
├── sinkhorn-knopp.ts                Vanilla Sinkhorn-Knopp (doubly stochastic)
├── sinkhorn-accelerated.ts          Nesterov-accelerated Sinkhorn-Knopp (log-domain + adaptive eps)
├── sinkhorn-budget.ts               Budget allocation from mixing matrices
├── compactor.ts                     SessionCompactor — pre-compaction flush + rollback
├── compactor-signals.ts             Compaction signal configuration
├── checkpoint.ts                    CheckpointManager (Sthiti)
│
├── bitemporal.ts                    Dvikala — bi-temporal edge operations, time-travel, decay
├── consolidation.ts                 Samskaara — post-session pattern detection + knowledge rules
├── consolidation-types.ts           KnowledgeRule (with evergreen flag), DetectedPattern types
├── consolidation-phases.ts          Consolidation phase decomposition
├── consolidation-scoring.ts         Consolidation scoring logic
├── consolidation-indexer.ts         FTS5 indexing for consolidation output
├── multi-round-retrieval.ts         Anveshana — query decomposition + multi-round fusion
├── query-decomposition.ts           Heuristic query splitting for Anveshana
├── smaran.ts                        SmaranStore — explicit memory (structured, categorical, BM25)
├── smaran-store.ts                  Smaran persistence layer
├── memory-nlu.ts                    Detect "remember"/"forget"/"recall" commands
├── identity-context.ts              Load SOUL.md, IDENTITY.md, personality files
│
├── provider-bridge.ts               Provider Bridge — adaptive budget + interrupted session detection
├── provider-labels.ts               Provider label utilities
│
├── vasana-engine.ts                 BOCPD behavioral crystallization
├── vasana-bocpd.ts                  BOCPD algorithm (Normal-Gamma conjugate prior)
├── swapna-consolidation.ts          5-phase dream-cycle consolidation
├── swapna-types.ts                  Swapna type definitions
├── swapna-extraction.ts             Swapna feature extraction
├── swapna-rules.ts                  Swapna rule generation
├── swapna-vidhi.ts                  Swapna procedural extraction phase
├── swapna-samskara.ts               Swapna crystallization phase
├── vidhi-engine.ts                  Procedural memory (n-gram + anti-unification)
├── vidhi-extraction.ts              Vidhi n-gram extraction
├── vidhi-matching.ts                Vidhi trigger matching + Thompson Sampling
├── periodic-consolidation.ts        Monthly/yearly Markdown reports
├── periodic-monthly.ts              Monthly report generation
├── periodic-yearly.ts               Yearly report generation
├── akasha.ts                        Stigmergic shared knowledge field
├── akasha-integration.ts            Akasha integration utilities
├── kala-chakra.ts                   Multi-scale temporal awareness (7 scales)
├── temporal-context.ts              Temporal context utilities (ISO weeks, etc.)
│
├── natasha-observer.ts              Natasha — temporal trending engine (trends, regressions, velocity)
├── natasha-types.ts                 Natasha type definitions (TrendSignal, RegressionAlert, VelocityMetrics)
├── transcendence.ts                 Transcendence — predictive context pre-fetcher (5-source fusion)
├── transcendence-types.ts           Transcendence type definitions (ContextPrediction, CachedContext, CacheStats)
├── transcendence-helpers.ts         Transcendence pure helpers (clamp, dedup, Jaccard, DB queries)
│
├── episodic-store.ts                Episodic developer memory store (BM25 search, signature normalization)
├── episodic-types.ts                Episodic memory types (Episode, EpisodeInput, EpisodicQuery)
├── event-extractor.ts               Session event extraction
├── event-extractor-strategies.ts    Event extraction strategy patterns
├── day-consolidation.ts             Daily consolidation pipeline
├── day-consolidation-renderer.ts    Day consolidation Markdown renderer
├── day-consolidation-query.ts       Day consolidation query interface
├── session-queries.ts               Session query helpers
├── session-db.ts                    Session database operations
├── session-store-cache.ts           Session store LRU cache
├── session-store-migration.ts       Session store schema migrations
├── fact-extractor.ts                Fact extraction from session content
├── handover-types.ts                Handover type definitions
├── cross-machine-sync.ts            Cross-machine sync utilities
├── cross-machine-sync-encrypted.ts  Encrypted snapshot envelope helpers
├── critique-store.ts                Self-critique persistence
├── orchestrator-checkpoint.ts       Sanchaalaka-Sthiti — durable orchestrator checkpoint/resume
├── orchestrator-checkpoint-types.ts Orchestrator checkpoint types
├── pancha-vritti.ts                 Five mental modification patterns
├── pancha-vritti-patterns.ts        Pancha Vritti pattern definitions
├── hierarchical-temporal-search.ts  Hierarchical temporal search
├── leiden-algorithm.ts              Leiden algorithm core
└── sync-import.ts                   Sync import utilities
```

## API

### Session Management

```typescript
import {
  createSession,
  saveSession,
  loadSession,
  listSessions,
  addTurn,
} from "@chitragupta/smriti";

// Create a new session
const session = createSession({
  project: "/path/to/project",
  title: "Refactoring the parser",
  agent: "chitragupta",
  model: "claude-sonnet-4-5-20250929",
  tags: ["refactor", "parser"],
});

// Add turns
addTurn(session, {
  turnNumber: 1,
  role: "user",
  content: "Let's refactor the parser module.",
});

addTurn(session, {
  turnNumber: 2,
  role: "assistant",
  agent: "chitragupta",
  model: "claude-sonnet-4-5-20250929",
  content: "I'll start by analyzing the current structure...",
  toolCalls: [
    { name: "read", input: "src/parser.ts", result: "..." },
  ],
});

// Save to disk as Markdown + index in SQLite
await saveSession(session);

// Load and list
const loaded = await loadSession(session.meta.id);
const all = await listSessions();
```

### SQLite Database Layer

Three-database architecture with prepared statements and schema versioning.

```typescript
import { DatabaseManager, initAllSchemas } from "@chitragupta/smriti";

// Initialize the database manager (creates/opens all 3 databases)
const dbm = new DatabaseManager("/path/to/.chitragupta");
initAllSchemas(dbm);

// Access individual databases
const agentDb = dbm.get("agent");    // sessions, turns, FTS5, vasanas, vidhis
const graphDb = dbm.get("graph");    // knowledge graph nodes, edges, pagerank
const vectorDb = dbm.get("vectors"); // embeddings (HNSW or brute-force)

// Clean shutdown
dbm.closeAll();
```

### Memory Streams

```typescript
import {
  getMemory,
  updateMemory,
  appendMemory,
  listMemoryScopes,
} from "@chitragupta/smriti";

// Read memory for a scope
const identity = await getMemory({ type: "global" });
const projectMem = await getMemory({
  type: "project",
  path: "/path/to/project",
});

// Update entire memory content
await updateMemory(
  { type: "global" },
  "User prefers tabs (width 2). Uses TypeScript exclusively."
);

// Append to existing memory
await appendMemory(
  { type: "project", path: "/my/project" },
  "Decided to migrate from Express to Fastify."
);
```

### Cross-Device Sync (Encrypted)

Use plaintext snapshots for trusted local flows, or encrypted envelopes for cross-device transport.

```typescript
import {
  createCrossMachineSnapshot,
  writeEncryptedCrossMachineSnapshot,
  readEncryptedCrossMachineSnapshot,
  importEncryptedCrossMachineSnapshot,
} from "@chitragupta/smriti";

const snapshot = createCrossMachineSnapshot({ includeDays: true, includeMemory: true });

writeEncryptedCrossMachineSnapshot(
  snapshot,
  "./chitragupta-sync.enc.json",
  process.env.CHITRAGUPTA_SYNC_PASSPHRASE!,
);

const decrypted = readEncryptedCrossMachineSnapshot(
  "./chitragupta-sync.enc.json",
  process.env.CHITRAGUPTA_SYNC_PASSPHRASE!,
);

importEncryptedCrossMachineSnapshot(
  "./chitragupta-sync.enc.json",
  process.env.CHITRAGUPTA_SYNC_PASSPHRASE!,
  { strategy: "safe" },
);
```

Canonical sessions + memory reference: `packages/smriti/docs/sessions-memory.md`.

### Session Lineage Controls

When consumers intentionally want same-thread reuse, pass explicit metadata instead of assuming one project equals one session.

```typescript
const session = createSession({
  project: "/path/to/project",
  agent: "vaayu",
  model: "claude-sonnet-4-5-20250929",
  metadata: {
    clientKey: "vaayu:web:tab-7",
    sessionLineageKey: "vaayu:web:checkout-review",
    sessionReusePolicy: "same_day",
    consumer: "vaayu",
    surface: "api",
    channel: "web",
    actorId: "vaayu:tab:7",
  },
});
```

Default guidance:

- use `isolated` for most tabs, CLIs, and jobs
- use `same_day` only when you mean the same cognitive thread
- keep raw sessions canonical even when recall later prefers a derived consolidated artifact

### Remote Semantic Mirror

Cross-device encrypted snapshot sync and the remote semantic mirror are separate things.

- encrypted snapshot sync moves canonical data between trusted devices
- remote semantic mirror sync promotes curated day/monthly/yearly artifacts for semantic recall

```typescript
import {
  inspectRemoteSemanticSync,
  syncRemoteSemanticMirror,
} from "@chitragupta/smriti";

const status = await inspectRemoteSemanticSync();
console.log(status.issues);

await syncRemoteSemanticMirror();
```

The remote semantic mirror should ingest curated consolidation artifacts with provenance such as `sourceSessionIds`, not raw noisy turn exhaust.

### Hybrid Search (Samshodhana)

RRF fusion combining BM25, vector similarity, GraphRAG, Pramana epistemological weighting, and Kala Chakra temporal boosting. KalaChakra is auto-initialized by default (disable with `disableTemporalBoost`). User-configurable weight priors can be blended with Thompson-sampled weights via `weightPriors` and `priorBlend`.

```typescript
import { HybridSearchEngine, PRAMANA_RELIABILITY } from "@chitragupta/smriti";
import type { HybridSearchConfig, HybridSearchResult } from "@chitragupta/smriti";

const search = new HybridSearchEngine({
  graphrag: graphEngine,
  recall: recallEngine,
  // KalaChakra auto-initialized — no need to pass explicitly
  weights: {
    bm25: 0.25,
    vector: 0.35,
    graphrag: 0.25,
    pramana: 0.10,
    temporal: 0.05,
  },
  // User-configurable weight priors blended with Thompson Sampling
  weightPriors: { bm25: 0.3, vector: 0.4, graphrag: 0.2 },
  priorBlend: 0.3,  // 30% user priors, 70% Thompson-sampled
  // disableTemporalBoost: true,  // uncomment to disable KalaChakra
});

const results: HybridSearchResult[] = await search.search("authentication flow");
for (const r of results) {
  console.log(`[${r.score.toFixed(3)}] ${r.title} (${r.pramanaType})`);
}

// Pramana reliability weights
console.log(PRAMANA_RELIABILITY);
// pratyaksha: 1.0, anumana: 0.85, shabda: 0.75,
// upamana: 0.6, arthapatti: 0.5, anupalabdhi: 0.35
```

### Pramana Epistemology

The six Pramanas -- means of valid knowledge from Indian epistemology -- classify the source of every knowledge edge in the graph:

| Pramana | Sanskrit | Meaning | Reliability | Example |
|---------|----------|---------|-------------|---------|
| Pratyaksha | Direct perception | 1.00 | Tool output, file content, test results |
| Anumana | Inference | 0.85 | Deduced from patterns, logical reasoning |
| Shabda | Testimony | 0.75 | Documentation, user statements, README |
| Upamana | Analogy | 0.60 | Structural similarity to known patterns |
| Arthapatti | Postulation | 0.50 | Hypothesized to explain an observation |
| Anupalabdhi | Non-apprehension | 0.35 | Knowledge from absence (missing file, no test) |

```typescript
import type { PramanaType } from "@chitragupta/smriti";

const source: PramanaType = "pratyaksha"; // Direct observation (tool output)
```

### GraphRAG

Search now filters expired and superseded edges via `queryEdgesAtTime()` before running PageRank, ensuring only currently-valid bi-temporal edges contribute to scoring.

```typescript
import { GraphRAGEngine } from "@chitragupta/smriti";
import type { GraphRAGConfig } from "@chitragupta/smriti";

const config: GraphRAGConfig = {
  provider: "ollama",
  model: "nomic-embed-text",
};

const engine = new GraphRAGEngine(config);

// Add nodes and edges
await engine.addNode({
  id: "session-1",
  type: "session",
  label: "Parser refactoring",
  content: "Refactored the parser to use recursive descent...",
  metadata: { project: "/my/project" },
});

// Query the knowledge graph
// Internally: edges filtered by queryEdgesAtTime() -> PageRank on valid edges only
const results = await engine.query("How does the parser work?");
```

### Session Branching

```typescript
import { branchSession, getSessionTree } from "@chitragupta/smriti";

// Branch from an existing session at a specific turn
const branch = await branchSession(session.meta.id, {
  branchName: "try-different-approach",
  atTurn: 5,
});

// Get the full tree of sessions
const tree = await getSessionTree(rootSessionId);
console.log(tree.root.children); // SessionTreeNode[]
```

### Accelerated Sinkhorn-Knopp

Nesterov-accelerated Sinkhorn-Knopp with log-domain arithmetic and adaptive epsilon schedule for optimal token budget allocation.

```typescript
import {
  sinkhornAccelerated,
  computeTokenBudgetsMHC,
} from "@chitragupta/smriti";
import type {
  SinkhornAcceleratedOpts,
  SessionChunk,
} from "@chitragupta/smriti";

const affinity = [
  [0.8, 0.3, 0.1],
  [0.3, 0.9, 0.4],
  [0.1, 0.4, 0.7],
];

const { result, iterations, converged } = sinkhornAccelerated(affinity, {
  maxIterations: 200,
  epsilon: 1e-8,
  useNesterov: true,        // Nesterov momentum (O(1/k^2))
  useLogDomain: true,       // Numerically stable log-domain
  useAdaptiveEpsilon: true, // Coarse-to-fine schedule
});

// mHC Token Budget Allocation
const chunks: SessionChunk[] = [
  { id: "chunk-1", recency: 0.9, relevance: 0.8, importance: 0.7, topic: "auth", tokenCount: 500 },
  { id: "chunk-2", recency: 0.5, relevance: 0.9, importance: 0.4, topic: "auth", tokenCount: 300 },
];

const budgets = computeTokenBudgetsMHC(chunks, 4096);
for (const [id, tokens] of budgets) {
  console.log(`${id}: ${tokens} tokens`);
}
```

### GraphRAG Adaptive Scoring (Thompson Sampling)

Online-learned scoring weights via Thompson Sampling with temporal decay and MMR diversity re-ranking.

```typescript
import { AdaptiveScorer, mmrRerank } from "@chitragupta/smriti";

const scorer = new AdaptiveScorer(7 * 24 * 60 * 60 * 1000); // 7-day half-life

const candidates = [
  { id: "node-1", cosineScore: 0.9, pagerankScore: 0.3, textScore: 0.5 },
  { id: "node-2", cosineScore: 0.4, pagerankScore: 0.8, textScore: 0.7 },
];

const ranked = scorer.score("query-1", candidates);
scorer.recordFeedback("query-1", true); // User accepted -> reinforce

// MMR diversity re-ranking
const diverse = mmrRerank(ranked, 0.7, 10);

// Persistence
const state = scorer.serialize();
const restored = new AdaptiveScorer();
restored.deserialize(state);
```

### Personalized PageRank

Topic-biased teleportation, Gauss-Seidel iteration, and push-based incremental updates.

```typescript
import {
  computePersonalizedPageRank,
  IncrementalPageRank,
} from "@chitragupta/smriti";

// Topic-biased: nodes about "authentication" get higher teleportation
const ranks = computePersonalizedPageRank(graph, "authentication", {
  damping: 0.85,
  epsilon: 1e-6,
  maxIterations: 150,
  useGaussSeidel: true,
});

// Incremental: O(1/epsilon) per edge change vs O(N * iterations) for full recompute
const incremental = new IncrementalPageRank(0.85, 1e-6);
incremental.initialize(graph);
incremental.addEdge("n3", "n1");
const currentRanks = incremental.getRanks();
```

### Bi-Temporal Edges (Dvikala)

Two independent time axes: valid-time (when true in reality) and record-time (when recorded in graph). GraphRAG search calls `queryEdgesAtTime()` to filter expired/superseded edges before PageRank computation.

```typescript
import {
  createEdge,
  supersedEdge,
  expireEdge,
  queryEdgesAtTime,
  temporalDecay,
  compactEdges,
} from "@chitragupta/smriti";

// Create a bi-temporal edge
const edge = createEdge("session-42", "concept-auth", "mentions_concept", 0.85, "2026-01-15T10:00:00Z");

// Correct a relationship (old record kept for audit)
const [oldEdge, newEdge] = supersedEdge(edge, 0.95);

// Time-travel query: "What edges were valid on January 20?"
const jan20 = queryEdgesAtTime(allEdges, "2026-01-20T00:00:00Z");

// Temporal decay: weight * exp(-ln(2) * elapsed / halfLife)
const decayed = temporalDecay(newEdge, Date.now(), 7 * 86_400_000);
```

### Memory Consolidation (Samskaara)

Post-session pattern detection with 5 detectors, 8 rule categories, and confidence model with reinforcement/decay. Rules can be marked `evergreen: true` to exempt them from temporal decay and pruning -- useful for permanent preferences and invariants.

```typescript
import { ConsolidationEngine } from "@chitragupta/smriti";
import type { KnowledgeRule } from "@chitragupta/smriti";

const engine = new ConsolidationEngine({
  minObservations: 2,
  decayRatePerDay: 0.01,
  maxRules: 500,
  pruneThreshold: 0.1,
});

engine.load();
const result = engine.consolidate(recentSessions);
console.log(`New rules: ${result.newRules.length}`);
console.log(`Reinforced: ${result.reinforcedRules.length}`);

// Evergreen rules: exempt from decay and pruning
const evergreenRule: Partial<KnowledgeRule> = {
  rule: "Always use TypeScript strict mode",
  category: "convention",
  evergreen: true,  // Never decays, never pruned
};

engine.decayRules();  // Skips evergreen rules
engine.save();
```

### Multi-Round Retrieval (Anveshana)

Heuristic query decomposition (6 heuristics, no LLM), iterative retrieval, weighted result fusion.

```typescript
import { AnveshanaEngine } from "@chitragupta/smriti";

const engine = new AnveshanaEngine(hybridSearchEngine, {
  maxSubQueries: 4,
  maxRounds: 3,
  improvementThreshold: 0.05,
  multiQueryBoost: 1.3,
  adaptiveTermination: true,
});

// Simple queries pass through; complex queries are decomposed
const results = await engine.search(
  "What architecture decisions did we make about auth that affected the API layer?",
);

for (const result of results) {
  console.log(`[${result.score.toFixed(3)}] ${result.title}`);
  console.log(`  Found by: ${result.foundBy.join(", ")}`);
}
```

---

### Provider Bridge -- Adaptive Context for Any Provider

**File:** `provider-bridge.ts`

The Provider Bridge loads relevant memory context when a provider starts a session. This is what makes switching between Claude, Codex, and Vaayu seamless -- every provider gets the same memory context.

#### Adaptive Context Budget

The budget scales with the provider's context window size using a 2% allocation rule (~4 chars/token). Three tiers:

| Tier | Context Window | Budget | Sessions | Vasanas | Lookback |
|------|---------------|--------|----------|---------|----------|
| Small | < 32K tokens | 2K--2.6K chars | 2 | 3 | 4 hours |
| Medium | 32K--100K tokens | 2.6K--8K chars | 3 | 5 | 6 hours |
| Large | > 100K tokens | 8K--50K chars | 5 | 8 | 8 hours |

Budget is allocated proportionally across sections (global facts, project memory, recent context, interrupted session, vasanas) based on actual content availability -- no wasted budget on empty sections.

#### Interrupted Session Detection

The bridge detects recently abandoned conversations for cross-device pickup. A session is considered "interrupted" if:

- The last turn was from the user (no assistant response)
- The assistant's last message was cut short (< 100 chars, suggesting mid-thought interruption)
- The session ended within the tier's lookback window

Interrupted sessions surface at the top of the assembled context, enabling seamless conversation resumption across devices.

```typescript
import { loadProviderContext } from "@chitragupta/smriti";
import type { ProviderContext, ContextOptions } from "@chitragupta/smriti";

const ctx: ProviderContext = await loadProviderContext(
  deps,
  "/my/project",
  {
    providerContextWindow: 200_000,  // Claude 200K -> large tier
    deviceId: "macbook-pro",
    userId: "user-123",
  },
);

console.log(ctx.assembled);           // Full context string for injection
console.log(ctx.interruptedSession);   // Interrupted session handover (if any)
console.log(ctx.itemCount);            // Number of memory items loaded
```

---

### Vasana Engine -- Behavioral Crystallization

**File:** `vasana-engine.ts`

*Vasana* in Vedic philosophy means a latent impression or tendency that shapes behavior. The Vasana Engine crystallizes stable behavioral patterns (samskaras) into durable tendencies using **Bayesian Online Change-Point Detection** (Adams & MacKay 2007, arxiv 0710.3742).

#### Pipeline

```
Samskaras -> Feature Extraction -> BOCPD Stability Check -> Holdout Validation -> Vasana
```

#### BOCPD Algorithm

The engine maintains a run-length distribution using the **Normal-Gamma** conjugate prior:

- **Hazard function**: `H(tau) = 1/lambda` (constant hazard)
- **Change-point detection**: P(r=0) > threshold triggers a change-point
- **Stability criterion**: Consecutive sessions without a change-point >= `stabilityWindow`
- **Holdout validation**: Train/test split ensures the vasana has predictive power

All computations use **log-domain arithmetic** to prevent underflow.

```typescript
import { VasanaEngine } from "@chitragupta/smriti";
import type { VasanaConfig, CrystallizationResult, PromotionResult } from "@chitragupta/smriti";

const engine = new VasanaEngine(databaseManager, {
  lambda: 50,                  // Expected run length
  changePointThreshold: 0.3,   // P(r=0) threshold
  stabilityWindow: 5,          // Consecutive stable sessions
  holdoutTrainRatio: 0.7,      // Train fraction
  accuracyThreshold: 0.6,      // Min predictive accuracy
  decayHalfLifeMs: 30 * 86_400_000, // 30-day half-life
  promotionMinProjects: 3,     // Projects needed for global promotion
});

// Crystallize samskaras into vasanas
const result: CrystallizationResult = engine.crystallize("my-project");
console.log(result.newVasanas);       // Newly created vasanas
console.log(result.reinforced);       // Existing vasanas reinforced
console.log(result.decayed);          // Vasanas with reduced strength

// Promote project-local vasanas to global
const promoted: PromotionResult = engine.promoteToGlobal("my-project");
console.log(promoted.promotedCount);  // Number promoted

// Get vasanas for a project
const vasanas = engine.getVasanas("my-project");
```

---

### Swapna Consolidation -- Dream Cycle

**File:** `swapna-consolidation.ts`

In Yoga Nidra, *Swapna* is the dream state where the mind reorganizes experience into lasting knowledge. This module implements the **5-phase consolidation cycle** that runs during the Nidra daemon's DREAMING state.

The 5 phases mirror stages of sleep consolidation in neuroscience:

| Phase | Name | Inspiration | What It Does |
|-------|------|-------------|-------------|
| 1 | REPLAY | Hippocampal replay | Re-traverse recent turns, score surprise |
| 2 | RECOMBINE | Dream association | Cross-session structural similarity detection |
| 3 | CRYSTALLIZE | Vasana formation | Aggregate samskaras into stable tendencies |
| 4 | PROCEDURALIZE | Vidhi extraction | Learn parameterized tool sequences |
| 5 | COMPRESS | Sushupti (deep sleep) | Sinkhorn-Knopp weighted by epistemological source |

Performance target: full cycle < 20 seconds for 50 sessions.

```typescript
import { DatabaseManager, SwapnaConsolidation } from "@chitragupta/smriti";
import type { SwapnaResult } from "@chitragupta/smriti";

const databaseManager = DatabaseManager.instance();
const swapna = new SwapnaConsolidation(
  {
    maxSessionsPerCycle: 50,
    surpriseThreshold: 0.7,
    minPatternFrequency: 3,
    minSequenceLength: 2,
    minSuccessRate: 0.8,
    project: "/my/project",
    // Optional exact scope for Nidra deep-sleep or targeted replay.
    sessionIds: ["sess-1", "sess-2"],
  },
  databaseManager,
);

// Run the full 5-phase dream cycle
const result: SwapnaResult = await swapna.run((phase, pct) => {
  console.log(`${phase}: ${(pct * 100).toFixed(0)}%`);
});

console.log(result.sourceSessionIds);                     // Canonical source sessions
console.log(result.phases.replay.turnsScored);            // Turns scored for surprise
console.log(result.phases.recombine.associations);        // Cross-session connections found
console.log(result.phases.crystallize.vasanasCreated);    // Behaviors crystallized
console.log(result.phases.proceduralize.vidhisCreated);   // Tool sequences learned
console.log(result.phases.compress.compressionRatio);     // Compression ratio
console.log(result.totalDurationMs);                      // Total wall-clock time
```

Raw sessions remain canonical truth. Swapna outputs are derived artifacts and should keep provenance back to their `sourceSessionIds`.
Curated day/monthly/yearly artifacts are also the right semantic/vector promotion boundary: promote the consolidated artifact, not the raw noisy session exhaust.
Low-signal session detail may be compacted in day artifacts for readability, but canonical session replay must still come from the raw session ledger.

---

### Vidhi Engine -- Procedural Memory

**File:** `vidhi-engine.ts`

*Vidhi* means "method, procedure, rule" in Sanskrit. The engine extracts repeated, successful tool sequences from session data and crystallizes them into reusable, parameterized procedures.

#### Core Algorithms

1. **N-gram extraction** (2..5) over tool-call sequences per session
2. **Common subsequence discovery** across sessions (frequency + success filter)
3. **Anti-unification**: aligns argument instances to separate fixed (literal) from variable (parameter) positions
4. **Thompson Sampling**: Beta(alpha, beta) for exploration-exploitation when multiple Vidhis match
5. **Trigger-phrase detection**: verb-object NLU from preceding user messages
6. **SQLite persistence** via the `vidhis` table in agent.db

```typescript
import { VidhiEngine } from "@chitragupta/smriti";
import type { VidhiConfig, ExtractionResult } from "@chitragupta/smriti";
import type { Vidhi } from "@chitragupta/smriti";

const engine = new VidhiEngine(databaseManager, {
  minSessions: 3,
  minSuccessRate: 0.8,
  minSequenceLength: 2,
  maxSequenceLength: 5,
  project: "/my/project",
});

// Extract vidhis from session history
const result: ExtractionResult = engine.extract();
console.log(result.newVidhis);              // Newly discovered procedures
console.log(result.reinforced);             // Existing vidhis reinforced
console.log(result.totalSequencesAnalyzed); // Total n-grams evaluated
console.log(result.durationMs);             // Wall-clock time

// Match a user request to known vidhis
const matches: Vidhi[] = engine.match("add an API endpoint");
if (matches.length > 0) {
  console.log(matches[0].name);       // "add-api-endpoint"
  console.log(matches[0].steps);      // [{ tool: "read", ... }, { tool: "edit", ... }]
  console.log(matches[0].confidence); // 0.87
  console.log(matches[0].triggers);   // ["add endpoint", "new API", "create route"]
}
```

---

### Session Compaction -- Pre-Compaction Flush & Rollback

**File:** `compactor.ts`

The SessionCompactor orchestrates session compaction into the 4 memory streams. Before modifying any stream, it saves a **durable checkpoint** (pre-compaction flush) of all current stream contents. If compaction fails mid-way, call `rollback()` to restore the previous state.

```typescript
import { SessionCompactor } from "@chitragupta/smriti";

const compactor = new SessionCompactor();

// Compact a session — automatically flushes a durable checkpoint first
const result = await compactor.compact(session, "device-id");

// If something goes wrong downstream, restore streams to pre-compaction state
const restored = compactor.rollback(session.meta.id);
if (restored) {
  console.log("Streams restored to pre-compaction checkpoint");
}
```

Flush checkpoints are stored under `<chitraguptaHome>/smriti/flush-checkpoints/` as JSON files keyed by session ID. They are cleaned up automatically on successful rollback.

---

### Periodic Consolidation -- Monthly & Yearly Reports

**File:** `periodic-consolidation.ts`

Generates human-readable **Markdown reports** aggregating session data, vasanas, vidhis, and samskaras over calendar periods. Reports are stored under `<chitraguptaHome>/consolidated/` and indexed into FTS5 for full-text searchability.

These reports are derived artifacts. Raw sessions remain canonical truth, and the generated markdown now embeds provenance metadata with source-session references so higher-level recall can drill back into raw sessions when needed.

```typescript
import { PeriodicConsolidation } from "@chitragupta/smriti";
import type { ConsolidationReport, ReportEntry } from "@chitragupta/smriti";

const periodic = new PeriodicConsolidation(databaseManager, {
  project: "/my/project",
});

// Generate a monthly report
const monthly: ConsolidationReport = await periodic.monthly("2026-01");
console.log(monthly.stats.sessions);       // Number of sessions
console.log(monthly.stats.turns);          // Total turns
console.log(monthly.stats.tokens);         // Total tokens consumed
console.log(monthly.stats.cost);           // Total cost (USD)
console.log(monthly.stats.vasanasCreated); // New vasanas this month
console.log(monthly.filePath);             // Path to the .md report

// Generate a yearly report
const yearly: ConsolidationReport = await periodic.yearly("2025");

// List all existing reports
const reports: ReportEntry[] = periodic.listReports();

// Search across all reports (FTS5)
const hits = periodic.searchReports("authentication refactoring");
```

---

### Akasha -- Shared Knowledge Field

**File:** `akasha.ts`

In Vedic cosmology, *Akasha* is the all-pervading ether through which all information flows. In Chitragupta, Akasha implements **stigmergy**: indirect communication through the environment, inspired by ant colony optimization.

When Agent A solves a problem, it leaves a "trace" (like a pheromone) in the knowledge field. Later, Agent B encountering a similar problem picks up that trace, amplifying effective collective knowledge without any direct agent-to-agent communication.

Traces decay over time (evaporation) and strengthen with reinforcement (multiple agents confirming the same insight).

#### Trace Types

| Type | Description |
|------|-------------|
| `solution` | A verified problem-solution pair |
| `pattern` | A recurring structural pattern |
| `warning` | A known pitfall or anti-pattern |
| `insight` | A general observation or heuristic |

```typescript
import { AkashaField } from "@chitragupta/smriti";
import type { StigmergicTrace, TraceType, AkashaConfig } from "@chitragupta/smriti";

const akasha = new AkashaField({
  decayHalfLifeMs: 7 * 86_400_000, // 7-day half-life
  maxTraces: 1000,
  reinforcementBoost: 0.15,
});

// Leave a trace (pheromone deposit)
akasha.deposit({
  type: "solution",
  topic: "authentication JWT validation",
  content: "Use jose library for JWKS validation — native crypto is insufficient for key rotation",
  project: "/my/project",
  agentId: "agent-A",
  confidence: 0.9,
});

// Query traces (topic matching via Jaccard similarity)
const traces = akasha.query("JWT token validation", { limit: 5 });
for (const trace of traces) {
  console.log(`[${trace.type}] ${trace.topic} (strength: ${trace.strength.toFixed(2)})`);
  console.log(`  ${trace.content}`);
}

// Reinforce a trace (another agent confirms the insight)
akasha.reinforce(traceId, "agent-B");

// Decay all traces (called periodically)
akasha.evaporate();

// Get field statistics
const stats = akasha.getStats();
console.log(stats.totalTraces);
console.log(stats.byType);
```

---

### Kala Chakra -- Multi-Scale Temporal Awareness

**File:** `kala-chakra.ts`

In Vedic cosmology, *Kala Chakra* is the great wheel of time that governs all existence across scales. Chitragupta's Kala Chakra provides temporal context across **7 scales** -- from the immediate (current turn) to the historical (yearly).

KalaChakra is **auto-initialized by default** in `HybridSearchEngine`. To disable, pass `disableTemporalBoost: true` in the search config.

#### The 7 Temporal Scales

| Scale | Half-Life | Context Provided |
|-------|-----------|------------------|
| `turn` | 30 seconds | Current turn number, elapsed time, tokens so far |
| `session` | 30 minutes | Session ID, turn count, session tokens |
| `day` | 12 hours | Sessions today, tokens today, daily patterns |
| `week` | 3.5 days | Sessions this week, primary projects, weekly patterns |
| `month` | 15 days | Monthly sessions, active projects, monthly trends |
| `quarter` | 45 days | Quarterly aggregates |
| `year` | 180 days | Yearly patterns, long-term trends |

#### Multi-Scale Decay Formula

```
decay_s(t) = exp(-ln(2) * t / halfLife_s)
relevance(t) = SUM_s weight_s * decay_s(t)
boosted_score = original * (0.5 + 0.5 * relevance(t))
```

Recent documents retain up to 100% of their score; ancient documents decay to at most 50% -- never fully forgotten, but appropriately attenuated.

```typescript
import { KalaChakra, TEMPORAL_SCALES } from "@chitragupta/smriti";
import type { KalaContext, CurrentState, TemporalScale } from "@chitragupta/smriti";

const kala = new KalaChakra({
  project: "/my/project",
});

// Record current state
kala.updateState({
  sessionId: "session-42",
  turnNumber: 5,
  tokensUsed: 12_000,
});

// Get full temporal context across all 7 scales
const context: KalaContext = kala.getContext();
console.log(context.turn.turnNumber);     // 5
console.log(context.session.turnCount);   // 5
console.log(context.day.sessionsToday);   // 3
console.log(context.week.primaryProject); // "/my/project"
console.log(context.month.activeProjects); // ["/my/project", "/other"]

// Boost a retrieval score based on temporal relevance
const original = 0.85;
const timestamp = Date.now() - 3 * 86_400_000; // 3 days ago
const boosted = kala.boost(original, timestamp);
console.log(boosted); // 0.85 * (0.5 + 0.5 * relevance) ~ 0.78

// Multi-scale decay at a specific scale
const decay = kala.decay(timestamp, "week"); // Decay using week half-life
```

---

### Natasha Observer -- Temporal Trending Engine

**File:** `natasha-observer.ts`

*Named after Natasha Romanoff (Black Widow), played by Scarlett Johansson -- the master spy who observes everything from the shadows, sees patterns others miss, and never lets a regression slip past.* Natasha watches the temporal pulse of the system, detecting trending entities, error regressions, and coding velocity changes across four time windows (hour, day, week, month).

#### Research Basis

- **Zep/Graphiti** (ArXiv 2501.13956): Bitemporal knowledge graphs, 18.5% accuracy gain
- **TG-RAG** (ArXiv 2510.13590): Hierarchical time summaries
- **MemoTime** (ArXiv 2510.13614): Operator-aware temporal reasoning
- **MemWeaver** (ArXiv 2601.18204): Three-tier memory, 95% context reduction

#### Three Capabilities

| Capability | Description |
|-----------|-------------|
| **Trending Detection** | Track entity mention frequency across time windows. Compare current vs. previous period, surface entities with significant frequency changes. |
| **Regression Detection** | Compare error signature frequency between periods. If a fixed error recurs, emit a severity-ranked alert with the known fix (if recorded). |
| **Velocity Tracking** | Measure coding velocity (sessions, turns, tool calls) per window. Composite delta: 40% session weight + 60% turn weight. |

```typescript
import { NatashaObserver } from "@chitragupta/smriti";
import type { NatashaConfig, NatashaSummary, TrendSignal, RegressionAlert, VelocityMetrics } from "@chitragupta/smriti";

const natasha = new NatashaObserver(db, {
  minCountThreshold: 2,             // Min mentions to flag a trend
  minChangePercent: 25,             // Min % change to flag as rising/falling
  criticalRegressionThreshold: 3,   // Recurrences before critical severity
  maxTrendsPerWindow: 10,           // Cap on trends per window
});

// Detect trends in a single window
const trends: TrendSignal[] = natasha.detectTrends("day");
for (const t of trends) {
  console.log(`${t.entity}: ${t.direction} ${t.changePercent}% (confidence: ${t.confidence.toFixed(2)})`);
}

// Detect trends across all windows simultaneously
const allTrends = natasha.detectAllTrends(); // Map<TrendWindow, TrendSignal[]>

// Detect error regressions — previously fixed errors recurring
const regressions: RegressionAlert[] = natasha.detectRegressions("week");
for (const r of regressions) {
  console.log(`[${r.severity}] ${r.errorSignature}: ${r.currentOccurrences}x this period`);
  if (r.knownFix) console.log(`  Fix: ${r.knownFix}`);
}

// Measure coding velocity with delta comparison
const velocity: VelocityMetrics = natasha.measureVelocity("day");
console.log(`Sessions: ${velocity.sessionCount}, Turns: ${velocity.totalTurns}`);
console.log(`Velocity delta: ${velocity.velocityDelta}`); // -1 to 1 (0 = same as last period)

// Full temporal summary (trends + regressions + velocity)
const summary: NatashaSummary = natasha.observe();
```

---

### Transcendence Engine -- Predictive Context Pre-Fetcher

**File:** `transcendence.ts`

*Named after Lucy's 100% cerebral capacity -- the ability to perceive all of time simultaneously, predict what context will be needed before it is requested, and transcend reactive cognition.* Transcendence converts the system from reactive (load context when asked) to predictive (pre-stage context before it is needed). It fuses signals from Natasha (trends), temporal patterns, session continuations, regressions, and entity co-occurrence into a ranked prediction model of future context needs.

#### Research Basis

- **Neural Paging** (ArXiv 2603.02228): Predictive memory pre-loading
- **MEM1** (ArXiv 2506.15841): Anticipatory context staging
- **Codified Context** (ArXiv 2602.20478): Context quality > quantity
- **MemWeaver** (ArXiv 2601.18204): Three-tier memory with prefetch

#### Five Signal Sources

| Source | Weight | Description |
|--------|--------|-------------|
| `trend` | 0.35 | Rising entities from NatashaObserver |
| `temporal` | 0.25 | Time-of-day / day-of-week entity relevance patterns |
| `continuation` | 0.25 | Recent/interrupted session topics likely to continue |
| `regression` | -- | Error signatures from Natasha regression alerts (severity-weighted) |
| `cooccurrence` | 0.15 | Entity pairs that frequently appear together in sessions |

```typescript
import { TranscendenceEngine } from "@chitragupta/smriti";
import type { TranscendenceConfig, PrefetchResult, CachedContext, CacheStats } from "@chitragupta/smriti";

const engine = new TranscendenceEngine(db, {
  maxPredictions: 10,        // Max predictions per cycle
  minCacheConfidence: 0.4,   // Min confidence to cache a prediction
  cacheTtlMs: 300_000,       // Cache TTL: 5 minutes
  maxCacheEntries: 50,       // LRU eviction beyond this limit
  trendWeight: 0.35,         // Weight for trend-based predictions
  temporalWeight: 0.25,      // Weight for temporal pattern signals
  continuationWeight: 0.25,  // Weight for session continuation signals
  behavioralWeight: 0.15,    // Weight for co-occurrence / behavioral signals
});

// Ingest signals from NatashaObserver
engine.ingestTrends(natasha.detectTrends("day"));
engine.ingestRegressions(natasha.detectRegressions("day"));

// Run a full prediction cycle — generate predictions and cache context
const result: PrefetchResult = engine.prefetch();
console.log(`Predictions: ${result.predictions.length}`);
console.log(`Cached: ${result.cachedCount}, Evicted: ${result.evictedCount}`);
console.log(`Cache size: ${result.cacheSize}, Duration: ${result.durationMs}ms`);

// Exact lookup — O(1) cache hit
const cached: CachedContext | null = engine.lookup("typescript");
if (cached) {
  console.log(`Hit: ${cached.entity} (source: ${cached.source})`);
  console.log(`Content: ${cached.content}`);
}

// Fuzzy lookup — substring + Jaccard matching across all cache entries
const fuzzy: CachedContext | null = engine.fuzzyLookup("ts config");

// Cache hit/miss statistics
const stats: CacheStats = engine.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
console.log(`Cycles: ${stats.cyclesRun}, Avg predictions: ${stats.avgPredictions}`);
```

---

### Episodic Memory -- Developer Experience Recall

**File:** `episodic-store.ts`

Durable episodic developer memory that records experiences (errors, fixes, discoveries) tagged with error signatures, tool names, and file paths. When a similar error recurs, the system automatically recalls the relevant episode and its solution. Storage is backed by the `episodes` table in `agent.db`.

Error signatures are normalized by stripping volatile parts (file paths, line numbers, timestamps, UUIDs, hex hashes) so the same class of error always produces the same signature regardless of where it occurred.

#### Key Methods

| Method | Description |
|--------|-------------|
| `record(episode)` | Store a new episodic memory, returns UUID |
| `recall(query)` | Multi-dimensional recall: filter by error, tool, file, project, text |
| `recallByError(sig)` | Find episodes matching a normalized error signature |
| `recallByFile(path)` | Find episodes related to a specific file |
| `recallByTool(name)` | Find episodes involving a specific tool |
| `search(text)` | Full-text BM25 search across description and solution fields |
| `bumpRecallCount(id)` | Increment recall counter (tracks "hot" knowledge) |
| `getFrequentErrors()` | Get most frequently recalled episodes |
| `normalizeErrorSignature(err)` | Static: normalize error string into stable signature |

```typescript
import { EpisodicMemoryStore } from "@chitragupta/smriti";
import type { Episode, EpisodeInput, EpisodicQuery } from "@chitragupta/smriti";

const episodic = new EpisodicMemoryStore();

// Record a developer experience
const id = episodic.record({
  project: "/my/project",
  errorSignature: EpisodicMemoryStore.normalizeErrorSignature(
    "ERR_MODULE_NOT_FOUND: Cannot find module './parser' from '/src/index.ts:42:5'"
  ),
  toolName: "vitest",
  filePath: "src/index.ts",
  description: "Vitest fails with ESM module resolution error on .ts imports",
  solution: "Set moduleResolution: 'NodeNext' in tsconfig.json and use .js extensions in imports",
  tags: ["esm", "vitest", "typescript"],
});

// Recall by error signature — "Have we seen this before?"
const matches: Episode[] = episodic.recallByError(
  EpisodicMemoryStore.normalizeErrorSignature("ERR_MODULE_NOT_FOUND: Cannot find module './utils'")
);
if (matches.length > 0) {
  console.log(`Yes! Fixed on ${matches[0].createdAt}: ${matches[0].solution}`);
  episodic.bumpRecallCount(matches[0].id); // Track recall frequency
}

// Multi-dimensional recall
const results = episodic.recall({
  project: "/my/project",
  toolName: "vitest",
  text: "module resolution",
  limit: 5,
});

// Full-text BM25 search
const searched = episodic.search("authentication JWT validation");

// Get most frequently recalled ("hot") knowledge
const hotKnowledge = episodic.getFrequentErrors(10);
```

---

## Test Coverage

| Module | Test Files | Key Tests |
|--------|-----------|-----------|
| Session management & Markdown | 8 | Create, save, load, parse, write, branch, export, persistence |
| Memory store & streams | 4 | Scoped memory, 4-stream model, stream extraction, signals |
| GraphRAG & scoring | 6 | Knowledge graph, adaptive scoring, PageRank, NER, extraction |
| Search & retrieval | 4 | Hybrid search, multi-round, recall, embedding service |
| Sinkhorn & compaction | 3 | Vanilla, accelerated, session compactor |
| Bi-temporal & consolidation | 3 | Dvikala edges, Samskaara rules, knowledge base |
| Vasana Engine | 2 | BOCPD crystallization, promotion, decay |
| Swapna Consolidation | 2 | 5-phase cycle, replay, recombine, crystallize |
| Vidhi Engine | 2 | N-gram extraction, anti-unification, matching |
| Periodic Consolidation | 2 | Monthly/yearly reports, FTS5 indexing |
| Akasha | 2 | Stigmergic traces, Jaccard matching, evaporation |
| Kala Chakra | 2 | 7-scale context, multi-scale decay, boosting |
| Natasha Observer | 1 | Trend detection, regression alerts, velocity tracking, all-window summary |
| Transcendence Engine | 1 | 5-source prediction, cache hit/miss, fuzzy lookup, eviction, stats |
| Episodic Memory | 1 | Record, recall, BM25 search, error normalization, recall tracking |
| Smaran, NLU, Identity | 4 | Explicit memory, intent detection, identity files |
| **Total** | **47 test files, 0 failures** | |

---

[Back to Chitragupta root](../../README.md)
