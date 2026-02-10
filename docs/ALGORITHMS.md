# Novel Algorithms

Chitragupta does not glue APIs together. It implements novel algorithms with mathematical rigor. Every data structure is chosen for a reason.

---

## Memory and Retrieval

| Algorithm | Location | Complexity | What It Does |
|-----------|----------|------------|-------------|
| **Accelerated Sinkhorn-Knopp** | `smriti/sinkhorn-accelerated.ts` | O(n^2 * k) | Doubly stochastic mixing matrix for optimal token budget allocation across 4 memory streams. Nesterov momentum + log-domain stability + adaptive epsilon convergence |
| **Adaptive GraphRAG Scoring** | `smriti/graphrag-adaptive-scoring.ts` | O(E) per query | Thompson Sampling learned weights + temporal decay + MMR diversity for knowledge graph edge scoring |
| **Personalized PageRank** | `smriti/graphrag-pagerank-personalized.ts` | O(V+E) full, O(1/epsilon) incremental | Topic-biased teleportation + Gauss-Seidel iteration. Incremental push-based updates — O(1/epsilon) per edge change instead of full recomputation |
| **Information-Theoretic Compaction** | `anina/context-compaction-informational.ts` | O(n^2 * d) | TF-IDF term importance + TextRank sentence ranking + MinHash dedup + Shannon surprisal for auto-triggered context compaction |
| **Multi-Round Retrieval (Anveshana)** | `smriti/multi-round-retrieval.ts` | O(k * R) | Heuristic query decomposition (zero LLM cost) with weighted RRF fusion and adaptive termination |
| **Bi-Temporal Edges (Dvikala)** | `smriti/bitemporal.ts` | O(1) per op | `validTime + recordTime` on graph edges for time-travel queries. Temporal decay: `w * exp(-ln2 * t / halfLife)` with edge compaction |
| **Memory Consolidation (Samskaara)** | `smriti/consolidation.ts` | O(n) per cycle | 5 pattern detectors (tool sequences, preferences, decisions, corrections, conventions) with FNV-1a rule IDs and temporal confidence decay |
| **Pramana-Weighted Retrieval** | `smriti/graphrag-scoring.ts` | Per query | `score = alpha*BM25 + beta*vector_sim + gamma*PageRank + delta*pramana_weight`. Thompson Sampling learns weights over time |

---

## Agent Intelligence

| Algorithm | Location | Complexity | What It Does |
|-----------|----------|------------|-------------|
| **Wilson Confidence Interval** | `anina/chetana/atma-darshana.ts` | O(1) per update | Tool mastery scoring with proper uncertainty quantification — lower bound of Wilson CI as competence estimate |
| **Exponential Moving Average** | `anina/chetana/bhava.ts` | O(1) | Valence smoothing for emotional state tracking with configurable alpha |
| **Salience Scoring** | `anina/chetana/dhyana.ts` | O(1) per item | Recency decay + error adjacency boost + correction boost for attention allocation |
| **Markov Chain Tool Prediction** | `anina/learning-loop.ts` | O(1) per transition | Transition probability matrix for predicting next tool usage |
| **Svapna 5-Phase Consolidation** | `anina/nidra.ts` | O(n * log n) | Replay (surprise), recombine (graph isomorphism), crystallize (BOCPD), proceduralize (anti-unification), compress (Sinkhorn-Knopp) |
| **Vasana Crystallization (BOCPD)** | `smriti/vasana.ts` | O(T) per series | Bayesian Online Change-Point Detection on behavioral time series. Holdout validation of predictive accuracy before crystallization |
| **Guna Kalman Filter** | `anina/chetana/triguna.ts` | O(d^2) per update | Simplex-constrained Kalman filter tracking [sattva, rajas, tamas] from error rate, token velocity, loop count, latency, tool success |

---

## Orchestration and Communication

| Algorithm | Location | Complexity | What It Does |
|-----------|----------|------------|-------------|
| **Multi-Armed Bandit (UCB1 + Thompson + LinUCB)** | `niyanta/strategy-bandit.ts` | O(d^2) for LinUCB | Strategy selection via contextual bandit — learns optimal orchestration pattern per task type |
| **Banker's Algorithm** | `niyanta/orchestrator.ts` | O(n * m) | Proactive deadlock prevention with safe-state analysis for resource allocation |
| **SWIM Gossip Protocol** | `sutra/mesh/gossip-protocol.ts` | O(log n) convergence | Failure detection with Lamport generation counters. Peers: alive -> suspect -> dead |
| **4-Lane Priority Queue** | `sutra/mesh/actor-mailbox.ts` | O(1) enqueue | Critical > High > Normal > Low message prioritization with back-pressure |
| **Sabha Consensus Protocol** | `sutra/sabha.ts` | O(K * P) rounds * participants | Nyaya 5-step syllogism + Hetvabhasa fallacy detection + Wilson CI weighted voting |

---

## Skill Discovery and Evolution

| Algorithm | Location | Complexity | What It Does |
|-----------|----------|------------|-------------|
| **Trait Vector Matching (TVM)** | `vidhya-skills/tvm.ts` | O(d) per match | 128-dim fingerprinting (8 buckets x 16 dims) with FNV-1a hashing and anti-pattern negative dimensions |
| **Skill Evolution** | `vidhya-skills/skill-evolution.ts` | O(n) per cycle | Online gradient descent health scoring with auto-deprecation and fusion detection |
| **Vamsha (Evolutionary Biology)** | `vidhya-skills/vamsha.ts` | O(n * g) | Mutation, crossover, speciation, and extinction pressure for skill populations |
| **Vimarsh Zero-Cost NLU** | `vidhya-skills/shiksha/vimarsh.ts` | O(n) tokens | UTILITY_MAP (6 domains, ~55 utilities), verb/object/modifier extraction. Sub-millisecond. No LLM |

---

## Caching and Concurrency

| Structure | Location | What It Does |
|-----------|----------|-------------|
| **FNV-1a Hash Keys** | `smriti/embedding-service.ts` | 32-bit non-cryptographic hash for embedding cache keys — deterministic, collision-resistant |
| **LRU Cache (Map insertion-order)** | `smriti/embedding-service.ts`, `smriti/graphrag.ts` | O(1) amortized eviction using ES Map iteration order. Embedding cache: 5K. Entity cache: 10K |
| **Promise-Chain Write Queue** | `smriti/memory-store.ts`, `smriti/session-store.ts` | Per-scope promise serialization prevents concurrent races without mutexes |
| **Token Bucket Rate Limiter** | `core/auth/middleware.ts` | Configurable refill rate for API endpoint throttling |
