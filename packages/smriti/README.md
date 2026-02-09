# @chitragupta/smriti

![Logo](../../assets/logos/smriti.svg)

**स्मृति (smriti) -- Memory**

**Sessions, 4-stream memory model, GraphRAG knowledge graphs, hybrid search, consolidation, procedural memory, behavioral crystallization, dream-cycle consolidation, temporal awareness, shared knowledge fields, and SQLite persistence.**

Smriti is Chitragupta's memory system. It persists everything -- sessions as Markdown files (backed by SQLite for indexing and FTS5), memory across four streams (identity, projects, tasks, flow), and a knowledge graph that links sessions, concepts, files, and decisions. Sessions can be branched like git branches, letting you explore alternative conversation paths. The Sinkhorn-Knopp compaction algorithm optimally allocates token budgets across memory streams based on signal affinity.

The Phase 1 Self-Evolution Engine adds six new subsystems: the **Vasana Engine** crystallizes stable behavioral tendencies from raw samskaras using Bayesian change-point detection, the **Svapna Consolidation** pipeline runs a 5-phase dream cycle mirroring neuroscience sleep consolidation, the **Vidhi Engine** extracts parameterized procedural memories from repeated tool sequences, **Periodic Consolidation** generates monthly/yearly Markdown reports, **Akasha** implements stigmergic traces for indirect agent-to-agent knowledge sharing, and **Kala Chakra** provides 7-scale temporal awareness from the current turn to yearly patterns.

---

## Key Features

- **Session management** -- Create, save, load, list, delete, and search sessions stored as Markdown + SQLite
- **4-stream memory model** -- Identity (95% preservation), projects (80%), tasks (70%), flow (30%)
- **GraphRAG engine** -- Knowledge graph with typed nodes (session, memory, concept, file, decision) and weighted edges
- **Hybrid search (Samshodhana)** -- RRF fusion: BM25 + Vector + GraphRAG + Pramana epistemological weighting + Kala Chakra temporal boost
- **Session branching** -- Branch sessions like git branches and build a session tree
- **Markdown storage** -- Sessions stored as human-readable Markdown with YAML frontmatter metadata
- **Scoped memory** -- Global, project, agent, and session-level memory scopes
- **Sinkhorn-Knopp compaction** -- Nesterov-accelerated doubly stochastic mixing matrix for optimal token budget allocation
- **Bi-temporal edges (Dvikala)** -- Every graph edge carries valid-time and record-time axes, enabling time-travel queries and correction without data loss
- **Memory consolidation (Samskaara)** -- Post-session pattern detection transforms raw experience into lasting knowledge rules with confidence tracking
- **Multi-round retrieval (Anveshana)** -- Heuristic query decomposition with iterative search, weighted result fusion, and adaptive termination
- **Pramana epistemology** -- 6 types of knowledge (Pratyaksha, Anumana, Shabda, Upamana, Arthapatti, Anupalabdhi) with reliability weighting
- **SQLite database layer** -- 3-database architecture (agent.db, graph.db, vectors.db) with prepared statements and schema versioning
- **Vasana Engine** -- Bayesian Online Change-Point Detection (BOCPD) for crystallizing stable behavioral tendencies
- **Svapna Consolidation** -- 5-phase dream cycle: REPLAY, RECOMBINE, CRYSTALLIZE, PROCEDURALIZE, COMPRESS
- **Vidhi Engine** -- Procedural memory: n-gram extraction, anti-unification, Thompson Sampling for selection
- **Periodic Consolidation** -- Monthly and yearly Markdown reports with FTS5 indexing
- **Akasha** -- Stigmergic traces for indirect knowledge sharing between agents (ant colony optimization inspired)
- **Kala Chakra** -- 7-scale temporal awareness (turn, session, day, week, month, quarter, year) with multi-scale decay

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
│
├── hybrid-search.ts                 Samshodhana — RRF fusion (BM25 + Vector + GraphRAG + Pramana + Kala)
├── recall.ts                        RecallEngine — vector search across sessions & streams
├── recall-scoring.ts                Recall scoring configuration
├── embedding-service.ts             EmbeddingService — unified embedding abstraction
├── ner-extractor.ts                 NERExtractor — Named Entity Recognition
│
├── streams.ts                       StreamManager — 4-stream memory model
├── stream-extractor.ts              Signal classification for streams
├── sinkhorn-knopp.ts                Vanilla Sinkhorn-Knopp (doubly stochastic)
├── sinkhorn-accelerated.ts          Nesterov-accelerated Sinkhorn-Knopp (log-domain + adaptive eps)
├── compactor.ts                     SessionCompactor
├── compactor-signals.ts             Compaction signal configuration
├── checkpoint.ts                    CheckpointManager (Sthiti)
│
├── bitemporal.ts                    Dvikala — bi-temporal edge operations, time-travel, decay
├── consolidation.ts                 Samskaara — post-session pattern detection + knowledge rules
├── multi-round-retrieval.ts         Anveshana — query decomposition + multi-round fusion
├── smaran.ts                        SmaranStore — explicit memory (structured, categorical, BM25)
├── memory-nlu.ts                    Detect "remember"/"forget"/"recall" commands
├── identity-context.ts              Load SOUL.md, IDENTITY.md, personality files
│
├── vasana-engine.ts                 ★ NEW — BOCPD behavioral crystallization
├── svapna-consolidation.ts          ★ NEW — 5-phase dream-cycle consolidation
├── vidhi-engine.ts                  ★ NEW — Procedural memory (n-gram + anti-unification)
├── periodic-consolidation.ts        ★ NEW — Monthly/yearly Markdown reports
├── akasha.ts                        ★ NEW — Stigmergic shared knowledge field
└── kala-chakra.ts                   ★ NEW — Multi-scale temporal awareness (7 scales)
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

### Hybrid Search (Samshodhana)

RRF fusion combining BM25, vector similarity, GraphRAG, Pramana epistemological weighting, and Kala Chakra temporal boosting.

```typescript
import { HybridSearchEngine, PRAMANA_RELIABILITY } from "@chitragupta/smriti";
import type { HybridSearchConfig, HybridSearchResult } from "@chitragupta/smriti";

const search = new HybridSearchEngine({
  graphrag: graphEngine,
  recall: recallEngine,
  kalaChakra: kalaChakra,
  weights: {
    bm25: 0.25,
    vector: 0.35,
    graphrag: 0.25,
    pramana: 0.10,
    temporal: 0.05,
  },
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

The six Pramanas (प्रमाण -- means of valid knowledge) from Indian epistemology classify the source of every knowledge edge in the graph:

| Pramana | Sanskrit | Meaning | Reliability | Example |
|---------|----------|---------|-------------|---------|
| Pratyaksha | प्रत्यक्ष | Direct perception | 1.00 | Tool output, file content, test results |
| Anumana | अनुमान | Inference | 0.85 | Deduced from patterns, logical reasoning |
| Shabda | शब्द | Testimony | 0.75 | Documentation, user statements, README |
| Upamana | उपमान | Analogy | 0.60 | Structural similarity to known patterns |
| Arthapatti | अर्थापत्ति | Postulation | 0.50 | Hypothesized to explain an observation |
| Anupalabdhi | अनुपलब्धि | Non-apprehension | 0.35 | Knowledge from absence (missing file, no test) |

```typescript
import type { PramanaType } from "@chitragupta/smriti";

const source: PramanaType = "pratyaksha"; // Direct observation (tool output)
```

### GraphRAG

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

Two independent time axes: valid-time (when true in reality) and record-time (when recorded in graph).

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

Post-session pattern detection with 5 detectors, 8 rule categories, and confidence model with reinforcement/decay.

```typescript
import { ConsolidationEngine } from "@chitragupta/smriti";

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

engine.decayRules();
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

### Vasana Engine (वासना) -- Behavioral Crystallization

**File:** `vasana-engine.ts` | **NEW in Phase 1**

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

### Svapna Consolidation (स्वप्न) -- Dream Cycle

**File:** `svapna-consolidation.ts` | **NEW in Phase 1**

In Yoga Nidra, *Svapna* is the dream state where the mind reorganizes experience into lasting knowledge. This module implements the **5-phase consolidation cycle** that runs during the Nidra daemon's DREAMING state.

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
import { SvapnaConsolidation } from "@chitragupta/smriti";
import type { SvapnaConfig, SvapnaResult } from "@chitragupta/smriti";

const svapna = new SvapnaConsolidation(databaseManager, {
  maxSessionsPerCycle: 50,
  surpriseThreshold: 0.7,
  minPatternFrequency: 3,
  minSequenceLength: 2,
  minSuccessRate: 0.8,
  project: "/my/project",
});

// Run the full 5-phase dream cycle
const result: SvapnaResult = await svapna.consolidate((phase, pct) => {
  console.log(`${phase}: ${(pct * 100).toFixed(0)}%`);
});

console.log(result.replay.highSurpriseTurns);  // Turns with novel information
console.log(result.recombine.associations);     // Cross-session connections found
console.log(result.crystallize.newVasanas);     // Behaviors crystallized
console.log(result.proceduralize.newVidhis);    // Tool sequences learned
console.log(result.compress.tokensReclaimed);   // Tokens freed via compression
console.log(result.durationMs);                 // Total wall-clock time
```

---

### Vidhi Engine (विधि) -- Procedural Memory

**File:** `vidhi-engine.ts` | **NEW in Phase 1**

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

### Periodic Consolidation -- Monthly & Yearly Reports

**File:** `periodic-consolidation.ts` | **NEW in Phase 1**

Generates human-readable **Markdown reports** aggregating session data, vasanas, vidhis, and samskaras over calendar periods. Reports are stored under `<chitraguptaHome>/consolidated/` and indexed into FTS5 for full-text searchability.

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

### Akasha (आकाश) -- Shared Knowledge Field

**File:** `akasha.ts` | **NEW in Phase 1**

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

### Kala Chakra (काल चक्र) -- Multi-Scale Temporal Awareness

**File:** `kala-chakra.ts` | **NEW in Phase 1**

In Vedic cosmology, *Kala Chakra* is the great wheel of time that governs all existence across scales. Chitragupta's Kala Chakra provides temporal context across **7 scales** -- from the immediate (current turn) to the historical (yearly).

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

const kala = new KalaChakra(databaseManager, {
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
| Svapna Consolidation | 2 | 5-phase cycle, replay, recombine, crystallize |
| Vidhi Engine | 2 | N-gram extraction, anti-unification, matching |
| Periodic Consolidation | 2 | Monthly/yearly reports, FTS5 indexing |
| Akasha | 2 | Stigmergic traces, Jaccard matching, evaporation |
| Kala Chakra | 2 | 7-scale context, multi-scale decay, boosting |
| Smaran, NLU, Identity | 4 | Explicit memory, intent detection, identity files |
| **Total** | **44 test files, 0 failures** | |

---

[Back to Chitragupta root](../../README.md)
