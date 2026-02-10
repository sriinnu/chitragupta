<p align="center">
  <img src="assets/logos/chitragupta.svg" alt="Chitragupta Logo" width="120" />
</p>

<h1 align="center">चित्रगुप्त &nbsp;—&nbsp; Chitragupta</h1>

<p align="center"><em>"The Keeper of the Hidden Record"</em></p>

<p align="center">
  <strong>The one who records everything and forgets nothing.</strong>
</p>

<p align="center">
  <code>14 packages</code> &middot; <code>9,121 tests</code> &middot; <code>0 failures</code> &middot; <code>30+ research papers</code> &middot; <code>17 Vedic cognitive models</code>
</p>

---

## What is Chitragupta?

Chitragupta is an AI agent platform that treats cognition as a first-class engineering discipline. Named after the divine scribe in Vedic tradition who sits in Yama's court with his **Lekhani** (pen) and **Agrasandhani** (Book of Deeds), Chitragupta is the original concept of a divine data system: complete recording, perfect recall, impartial assessment. This project takes that idea and builds it as software.

The platform is a TypeScript ESM monorepo comprising 14 packages, each named after a Sanskrit concept that captures the *essence* of its function. This is not cosmetic theming. Every Vedic model maps to a concrete computational module with defined interfaces, algorithms, and complexity guarantees. The cognitive architecture draws from Shankaracharya's *Vivekachudamani*, Patanjali's *Yoga Sutras*, the *Mandukya Upanishad*, the *Nyaya Sutras*, and over 30 published research papers from 2024-2026 on agent memory, metacognition, model routing, and skill evolution.

At its core, Chitragupta is a **platform and API layer** -- it exposes a CLI, an HTTP server, an MCP server, and a programmatic API. It is designed to be consumed by other applications. The internal Sanskrit carries the dharma (purpose). The external English carries communication. The result is a system that is both philosophically rigorous and practically useful for everyday development: file search, code editing, multi-provider LLM streaming, workflow orchestration, and autonomous skill learning.

Chitragupta is not a wrapper around an LLM. It is a complete cognitive system with memory, identity, attention, affect, intention, self-reflection, deliberation, and self-evolution -- most of which runs at zero LLM cost.

---

## Why Chitragupta?

No AI agent system in existence combines these capabilities. Each is backed by Vedic source texts AND modern research papers. Each maps to a concrete module.

### Zero-LLM Cognitive Layer (Chetana)

Every other agent burns tokens on self-reflection. Chitragupta's consciousness layer -- four subsystems (affect, attention, self-model, intention) -- runs entirely on heuristics: Wilson confidence intervals, exponential moving averages, salience scoring with recency decay. The `beforeTurn` / `afterTurn` / `afterToolExecution` hooks execute in microseconds. Cost: zero.

### Epistemological Typing (Pramana)

No system classifies knowledge by *how it was acquired*. Chitragupta types every edge in its knowledge graph with one of six Pramana categories from the Nyaya Sutras: Pratyaksha (direct perception, confidence 0.95-1.0), Shabda (testimony, 0.80-0.95), Anumana (inference, 0.70-0.90), Anupalabdhi (non-apprehension, 0.60-0.90), Upamana (analogy, 0.50-0.80), and Arthapatti (postulation, 0.40-0.70). Retrieval is weighted by epistemic quality.

### Sleep Consolidation (Svapna / Sushupti)

No agent gets smarter between sessions. Chitragupta implements a 5-phase dream cycle inspired by hippocampal replay: (1) Replay with surprise scoring, (2) Recombination via graph isomorphism across sessions, (3) Crystallization through Bayesian Online Change-Point Detection, (4) Proceduralization via anti-unification of tool sequences, (5) Compression through Sinkhorn-Knopp budget allocation informed by Pramana types.

### Crystallized Tendencies (Vasana via BOCPD)

No agent forms stable habits from experience. Chitragupta detects behavioral change-points using BOCPD on action time series. When a pattern stabilizes across sessions, it crystallizes into a Vasana -- a tendency with strength, valence, and predictive accuracy validated on holdout data. Positive vasanas are amplified. Negative ones trigger self-correction.

### Predictive Auto-Execution (Kartavya)

No agent promotes patterns into auto-routines. Chitragupta's pipeline: Samskara (impression detected) -> Vasana (crystallized tendency) -> Niyama (proposed rule, presented to user) -> Kartavya (auto-executable duty with notification). The user must explicitly approve at the Niyama stage. Kartavya is NEVER created without consent.

### Self-Recognition (Pratyabhijna)

No agent reconstructs continuous identity from discrete sessions. On session start, Chitragupta loads top-K vasanas, active samskaras for the current project, reconstructs the identity stream (95% preserved), and rebuilds its Ahamkara: capabilities, limitations, style fingerprint. This is incarnation identity -- a continuous self from discrete sessions.

### Formal Deliberation (Sabha + Nyaya)

No multi-agent system requires structured syllogistic argument. Chitragupta's Sabha (formal council) requires every position to follow Nyaya's 5-step syllogism (Pratijna, Hetu, Udaharana, Upanaya, Nigamana). Objections must cite one of five formal Hetvabhasa fallacy types. Vote weight is Wilson CI lower bound per agent per domain. No consensus after K rounds: escalate to user.

### Information-Theoretic Compaction

No system compacts by knowledge type. Chitragupta's compaction uses TF-IDF term importance, TextRank sentence ranking, MinHash deduplication, and Shannon surprisal -- informed by epistemological type. Pratyaksha (direct observation) resists compression. Vikalpa (hypotheticals) compresses aggressively. The Sinkhorn-Knopp doubly stochastic mixing matrix optimally allocates token budgets across four memory streams.

### Bi-Temporal Knowledge Graph

No other agent can time-travel its memory. Every edge carries `validTime` (when the fact was true) and `recordTime` (when it was recorded). Temporal decay: `w * exp(-ln2 * t / halfLife)`. Edge compaction preserves the timeline. You can query the knowledge graph as it existed at any point in the past.

### Self-Evolving Skills

No system discovers and deploys its own tools. Chitragupta's pipeline: gap detection via zero-cost NLU (Vimarsh, <1ms) -> 6-tier sourcing (builtin, shell, cloud-recipe, npm, github, code-gen) -> skill building with typed implementations -> security scanning (Suraksha) -> auto-approval for safe patterns -> registration. Skills evolve through mutation, crossover, speciation, and extinction pressure (Vamsha evolutionary biology).

### Always-On Guardian Agents (Lokapala)

No system has always-on specialized monitors that self-improve. Five Lokapala agents -- Rakshaka (security), Gati (performance), Satya (correctness), Riti (convention), Sthiti (stability) -- subscribe to ambient Samiti channels and scan changes using cheap models. High-confidence auto-fixable issues are fixed with notification. Ambiguous findings trigger Sabha deliberation. Findings become samskaras that become vasanas that become kartavyas.

### Dual Assembly Model (Samiti + Sabha)

No system has both ambient and formal deliberation. The Samiti (general assembly) is always-on -- agents communicate through topic pub/sub channels (`#security`, `#performance`, `#correctness`, `#style`). The Sabha (formal council) is convened FROM the Samiti when a decision requires structured deliberation with syllogistic argument and weighted voting.

---

## Architecture

```
                          +-----------------------------+
                          |        TURIYA (turiya)       |
                          |    Meta-Observer / Router     |
                          |  Witnesses all states         |
                          |  Routes models (LinUCB)       |
                          +--------------+---------------+
                                         | observes
          +------------------------------+------------------------------+
          |                              |                              |
    +-----+------+               +------+-------+              +------+-------+
    |   JAGRAT   |   session     |    SVAPNA    |   compress   |  SUSHUPTI   |
    |  (Active)  |---ends------->|   (Dream)   |------------->|  (Archive)  |
    |            |<--user input--|             |              |             |
    +-----+------+               +------+------+              +-------------+
          |                              |
          |  ANTAHKARANA                 |  NIDRA DAEMON
          |  PIPELINE                    |  (heartbeat: 30s/2m/5m)
          |                              |
     Indriyas (Yantra)              5-Phase Svapna:
          |                          1. Replay (surprise scoring)
     Manas (classify/route)          2. Recombine (graph isomorphism)
       [zero LLM cost]              3. Crystallize (BOCPD)
          |                          4. Proceduralize (anti-unification)
     Buddhi (decide/reason)          5. Compress (Sinkhorn-Knopp)
       [Nyaya Syllogism]
          |                     KARTAVYA AUTO-EXEC:
     Ahamkara (self-model)       samskara -> vasana
       [Pratyabhijna]            -> niyama -> kartavya
          |
     Chitta (Smriti memory)      RTA INVARIANTS:
       [4 streams + GraphRAG]     Absolute laws
       [Pramana-typed edges]      Cannot be overridden
       [Viveka grounding]

     TRIGUNA HEALTH:              NAVA RASA:
     [sattva, rajas, tamas]       9 contextual modes
     Kalman filter                Behavioral adaptation

     +----------------------------------------------------------+
     |              SAMITI -- Ambient Channel                     |
     |   #security  #performance  #correctness  #style           |
     |                                                            |
     |   +----------+  +----------+  +----------+               |
     |   | Rakshaka |  |   Gati   |  |  Satya   |  ...          |
     |   |(Security)|  | (Perf)   |  |(Correct) |               |
     |   +----------+  +----------+  +----------+               |
     |                                                            |
     |   +----------------------------------------------------+  |
     |   |         SABHA -- Formal Council                     |  |
     |   |  Nyaya 5-step syllogism required                    |  |
     |   |  5 Hetvabhasa fallacy detection                     |  |
     |   |  Expertise-weighted voting (Wilson CI)              |  |
     |   +----------------------------------------------------+  |
     |                                                            |
     |   AKASHA -- Stigmergic traces                              |
     |   Agents leave pheromone-like knowledge markers            |
     +------------------------------------------------------------+

     PUBLIC SURFACE (English):
     |-- CLI:  chitragupta [command]
     |-- API:  GET/POST /api/*
     |-- MCP:  chitragupta mcp (tool registration)
     +-- Vayu: DAG task nodes (pluggable)
```

### Package Dependency Graph

```
                            +-------------+
                            |    CLI      |
                            | @chitragupta|
                            |    /cli     |
                            +------+------+
                    +--------------++--------------+
                    v              v               v
            +-----------+  +-----------+  +--------------+
            |    UI     |  |   Yantra  |  |    Dharma    |
            | Terminal  |  |   Tools   |  |  Guardrails  |
            +-----+-----+  +-----+-----+  +------+-------+
                  |              |               |
                  +------+-------+               |
                         v                       |
                  +-----------+                  |
                  |   Anina   |<-----------------+
                  |   Agent   |
                  +-----+-----+
        +---------------++--------------++--------------+
        v               v               v              v
 +-----------+  +-----------+  +-----------+  +----------+
 |   Swara   |  |   Smriti  |  |   Niyanta  |  |  Sutra   |
 |  AI/LLM   |  |  Memory   |  | Orchestr.  |  | Comms    |
 +-----------+  +-----------+  +-----------+  +----------+
                                     |
                         +-----------++-----------+
                         v           v           v
                  +-----------+ +--------+ +---------+
                  |   Vayu    | | Tantra | |  Netra  |
                  | Workflow  | |  MCP   | | Vision  |
                  +-----------+ +--------+ +---------+
                         |
                  +------+------+
                  | Vidhya-Skills|
                  | Knowledge    |
                  +------+------+
                         |
                  +------+------+
                  |    Core     |
                  | @chitragupta|
                  |    /core    |
                  +-------------+
```

---

## The 14 Packages

Every package is named after a concept from Vedic Sanskrit. The name carries the dharma (purpose) of what it represents.

| Package | Sanskrit | Devanagari | Meaning | What It Does |
|---------|----------|-----------|---------|-------------|
| [`@chitragupta/core`](./packages/core) | -- | -- | Foundation | Types, plugin system, event bus, cascading config, validation (Niyama), auth (Kavach) |
| [`@chitragupta/swara`](./packages/swara) | Swara | स्वर | Voice | LLM providers (Anthropic/OpenAI/Google/Ollama), streaming, cost tracking, model routing (Marga), complexity classifier (Vichara), embeddings |
| [`@chitragupta/anina`](./packages/anina) | Anina | आनिन | Soul | Agent runtime, sub-agent tree, tool execution, context management, consciousness (Chetana), learning loop, Atman identity, specialized agents (Agent Garage) |
| [`@chitragupta/smriti`](./packages/smriti) | Smriti | स्मृति | Memory | 4-stream memory, GraphRAG with bi-temporal edges, hybrid search (BM25 + vector + PageRank), consolidation (Samskaara), Sinkhorn-Knopp compaction, session branching, checkpoints |
| [`@chitragupta/ui`](./packages/ui) | -- | -- | Terminal | Nakshatram theme, ANSI rendering, markdown, progress bars, diff viewer, heartbeat monitor, toast notifications |
| [`@chitragupta/yantra`](./packages/yantra) | Yantra | यन्त्र | Instrument | 12+ built-in tools (read, write, edit, bash, grep, find, ls, diff, watch, memory, project analysis), sandbox (Kshetra), .env fortress |
| [`@chitragupta/dharma`](./packages/dharma) | Dharma | धर्म | Law | Policy engine, security rules, rate limiting, approval gates (Dvaara), karma tracking (Punya), convention enforcement |
| [`@chitragupta/netra`](./packages/netra) | Netra | नेत्र | Eye | Image analysis, pixel diffing, screenshot capture, terminal image rendering, multimodal |
| [`@chitragupta/vayu`](./packages/vayu) | Vayu | वायु | Wind | DAG engine, topological execution, worker thread pool (Shramika), parallel pipelines, workflow templates |
| [`@chitragupta/sutra`](./packages/sutra) | Sutra | सूत्र | Thread | P2P actor mesh, 4-lane priority mailboxes, SWIM gossip protocol, pub/sub (Sandesh), agent registry (Parichaya), 6 coordination patterns |
| [`@chitragupta/tantra`](./packages/tantra) | Tantra | तन्त्र | Technique | MCP server/client, lifecycle state machine (7 states), circuit breaker, capability aggregation, auto-restart with exponential backoff |
| [`@chitragupta/vidhya-skills`](./packages/vidhya-skills) | Vidhya | विद्या | Knowledge | 128-dim trait vector matching, skill evolution, sandbox quarantine (Suraksha), autonomous learning (Shiksha), evolutionary biology (Vamsha), skill composition (Yoga) |
| [`@chitragupta/niyanta`](./packages/niyanta) | Niyanta | नियन्ता | Director | Multi-armed bandit (UCB1/Thompson/LinUCB), task routing, DAG workflows (Krama), agent evaluation (Pariksha), auto-scaling |
| [`@chitragupta/cli`](./packages/cli) | -- | -- | Entry Point | Interactive CLI, HTTP API server, MCP server binary, onboarding, system prompt, slash commands |

**Key distinction**: **Anina** is the *soul* (who the agent IS). **Sutra** is the *thread* (how agents CONNECT). **Niyanta** is the *director* (who decides WHAT each agent does). Soul, thread, and director serve fundamentally different purposes.

---

## Novel Algorithms

Chitragupta does not glue APIs together. It implements novel algorithms with mathematical rigor. Every data structure is chosen for a reason.

### Memory and Retrieval

| Algorithm | Location | Complexity | What It Does |
|-----------|----------|------------|-------------|
| **Accelerated Sinkhorn-Knopp** | `smriti/sinkhorn-accelerated.ts` | O(n^2 * k) | Doubly stochastic mixing matrix for optimal token budget allocation across 4 memory streams. Nesterov momentum + log-domain stability + adaptive epsilon convergence |
| **Adaptive GraphRAG Scoring** | `smriti/graphrag-adaptive-scoring.ts` | O(E) per query | Thompson Sampling learned weights + temporal decay + MMR diversity for knowledge graph edge scoring |
| **Personalized PageRank** | `smriti/graphrag-pagerank-personalized.ts` | O(V+E) full, O(1/epsilon) incremental | Topic-biased teleportation + Gauss-Seidel iteration. Incremental push-based updates -- O(1/epsilon) per edge change instead of full recomputation |
| **Information-Theoretic Compaction** | `anina/context-compaction-informational.ts` | O(n^2 * d) | TF-IDF term importance + TextRank sentence ranking + MinHash dedup + Shannon surprisal for auto-triggered context compaction |
| **Multi-Round Retrieval (Anveshana)** | `smriti/multi-round-retrieval.ts` | O(k * R) | Heuristic query decomposition (zero LLM cost) with weighted RRF fusion and adaptive termination |
| **Bi-Temporal Edges (Dvikala)** | `smriti/bitemporal.ts` | O(1) per op | `validTime + recordTime` on graph edges for time-travel queries. Temporal decay: `w * exp(-ln2 * t / halfLife)` with edge compaction |
| **Memory Consolidation (Samskaara)** | `smriti/consolidation.ts` | O(n) per cycle | 5 pattern detectors (tool sequences, preferences, decisions, corrections, conventions) with FNV-1a rule IDs and temporal confidence decay |
| **Pramana-Weighted Retrieval** | `smriti/graphrag-scoring.ts` | Per query | `score = alpha*BM25 + beta*vector_sim + gamma*PageRank + delta*pramana_weight`. Thompson Sampling learns weights over time |

### Agent Intelligence

| Algorithm | Location | Complexity | What It Does |
|-----------|----------|------------|-------------|
| **Wilson Confidence Interval** | `anina/chetana/atma-darshana.ts` | O(1) per update | Tool mastery scoring with proper uncertainty quantification -- lower bound of Wilson CI as competence estimate |
| **Exponential Moving Average** | `anina/chetana/bhava.ts` | O(1) | Valence smoothing for emotional state tracking with configurable alpha |
| **Salience Scoring** | `anina/chetana/dhyana.ts` | O(1) per item | Recency decay + error adjacency boost + correction boost for attention allocation |
| **Markov Chain Tool Prediction** | `anina/learning-loop.ts` | O(1) per transition | Transition probability matrix for predicting next tool usage |
| **Svapna 5-Phase Consolidation** | `anina/nidra.ts` | O(n * log n) | Replay (surprise), recombine (graph isomorphism), crystallize (BOCPD), proceduralize (anti-unification), compress (Sinkhorn-Knopp) |
| **Vasana Crystallization (BOCPD)** | `smriti/vasana.ts` | O(T) per series | Bayesian Online Change-Point Detection on behavioral time series. Holdout validation of predictive accuracy before crystallization |
| **Guna Kalman Filter** | `anina/chetana/triguna.ts` | O(d^2) per update | Simplex-constrained Kalman filter tracking [sattva, rajas, tamas] from error rate, token velocity, loop count, latency, tool success |

### Orchestration and Communication

| Algorithm | Location | Complexity | What It Does |
|-----------|----------|------------|-------------|
| **Multi-Armed Bandit (UCB1 + Thompson + LinUCB)** | `niyanta/strategy-bandit.ts` | O(d^2) for LinUCB | Strategy selection via contextual bandit -- learns optimal orchestration pattern per task type |
| **Banker's Algorithm** | `niyanta/orchestrator.ts` | O(n * m) | Proactive deadlock prevention with safe-state analysis for resource allocation |
| **SWIM Gossip Protocol** | `sutra/mesh/gossip-protocol.ts` | O(log n) convergence | Failure detection with Lamport generation counters. Peers: alive -> suspect -> dead |
| **4-Lane Priority Queue** | `sutra/mesh/actor-mailbox.ts` | O(1) enqueue | Critical > High > Normal > Low message prioritization with back-pressure |
| **Sabha Consensus Protocol** | `sutra/sabha.ts` | O(K * P) rounds * participants | Nyaya 5-step syllogism + Hetvabhasa fallacy detection + Wilson CI weighted voting |

### Skill Discovery and Evolution

| Algorithm | Location | Complexity | What It Does |
|-----------|----------|------------|-------------|
| **Trait Vector Matching (TVM)** | `vidhya-skills/tvm.ts` | O(d) per match | 128-dim fingerprinting (8 buckets x 16 dims) with FNV-1a hashing and anti-pattern negative dimensions |
| **Skill Evolution** | `vidhya-skills/skill-evolution.ts` | O(n) per cycle | Online gradient descent health scoring with auto-deprecation and fusion detection |
| **Vamsha (Evolutionary Biology)** | `vidhya-skills/vamsha.ts` | O(n * g) | Mutation, crossover, speciation, and extinction pressure for skill populations |
| **Vimarsh Zero-Cost NLU** | `vidhya-skills/shiksha/vimarsh.ts` | O(n) tokens | UTILITY_MAP (6 domains, ~55 utilities), verb/object/modifier extraction. Sub-millisecond. No LLM |

### Caching and Concurrency

| Structure | Location | What It Does |
|-----------|----------|-------------|
| **FNV-1a Hash Keys** | `smriti/embedding-service.ts` | 32-bit non-cryptographic hash for embedding cache keys -- deterministic, collision-resistant |
| **LRU Cache (Map insertion-order)** | `smriti/embedding-service.ts`, `smriti/graphrag.ts` | O(1) amortized eviction using ES Map iteration order. Embedding cache: 5K. Entity cache: 10K |
| **Promise-Chain Write Queue** | `smriti/memory-store.ts`, `smriti/session-store.ts` | Per-scope promise serialization prevents concurrent races without mutexes |
| **Token Bucket Rate Limiter** | `core/auth/middleware.ts` | Configurable refill rate for API endpoint throttling |

---

## Vedic Cognitive Models

Chitragupta maps 17 Vedic cognitive models to computational modules. The internal Sanskrit carries the dharma. Each model has a source text, a computational mapping, and a concrete implementation.

| # | Model | Sanskrit Source | What It Computes | Module |
|---|-------|---------------|-----------------|--------|
| I | **Antahkarana Chatushthaya** | Vivekachudamani, Gita 3.42 | Complete cognitive pipeline: Indriyas -> Manas -> Buddhi -> Ahamkara + Chitta | Yantra -> pre-classifier -> Buddhi -> Atma-Darshana + Smriti |
| II | **Vasana-Samskara-Karma** | Yoga Sutras 2.12-15 | Infinite self-evolution loop: action -> result -> impression -> tendency -> action | Chetana + Samskaara + Vasana Engine |
| III | **Chaturavastha** | Mandukya Upanishad 3-7 | Four states of consciousness: waking, dream, deep sleep, witness | Jagrat (active) / Svapna (consolidation) / Sushupti (archive) / Turiya (meta-observer) |
| IV | **Pancha Pramana** | Nyaya Sutras 1.1.3-7 | Epistemological confidence: how knowledge was acquired | 6-type Pramana classification on graph edges |
| V | **Pancha Vritti** | Yoga Sutras 1.5-11 | Data classification: valid / error / hypothetical / absence / memory | Vritti tagging on knowledge nodes |
| VI | **Triguna** | Bhagavad Gita Ch. 14 | System health as 3-vector: clarity, agitation, stagnation | Kalman filter tracking [sattva, rajas, tamas] |
| VII | **Nava Rasa** | Natyashastra (Bharata Muni) | 9 contextual emotional modes driving behavioral adaptation | Extended Bhava (Chetana) affect system |
| VIII | **Nyaya Panchavayava** | Nyaya Sutras 1.1.32-39 | Explainable reasoning via 5-step syllogism | Buddhi decision framework + Sabha deliberation |
| IX | **Kala Chakra** | Surya Siddhanta, Yoga Sutras 3.52 | Multi-scale temporal awareness: instant -> session -> day -> sprint -> year | Bi-temporal edges + multi-scale consolidation |
| X | **Sabha and Samiti** | Rig Veda 10.191.2-4, Arthashastra | Dual assembly: ambient channel + formal council | Sutra pub/sub + Sabha protocol |
| XI | **Lokapala** | Rig Veda (directional guardians) | Domain guardian agents: security, performance, correctness, convention, stability | 5 specialized always-on agents |
| XII | **Rta** | Rig Veda (cosmic order) | Invariant laws that nothing can override, separate from contextual Dharma | Rta invariant layer in Dharma |
| XIII | **Pratyabhijna** | Kashmir Shaivism (Utpaladeva) | Self-recognition: continuous identity across discrete sessions | Identity reconstruction on session start |
| XIV | **Viveka** | Vivekachudamani | Hallucination grounding: nitya (real) / anitya (provisional) / mithya (apparent but false) | Ontological classification on claims |
| XV | **Ishvara Pranidhana** | Yoga Sutras 2.45 | Principled deference: the agent knows when NOT to act | Guna + Pramana + competence boundary checks |
| XVI | **Akasha** | Vaisheshika school (Kanada) | Stigmergic shared knowledge field: agents leave traces others perceive | Graph-based pheromone traces |
| XVII | **Kartavya** | Dharmashastra | Predictive auto-execution: impression -> tendency -> rule -> duty | Samskara -> Vasana -> Niyama -> Kartavya pipeline |

---

## Internal Sub-Components

Beyond the 14 packages, individual sub-components carry Sanskrit names:

| Name | Devanagari | Package | What It Is |
|------|-----------|---------|------------|
| **Chetana** | चेतना | anina | Consciousness layer -- four cognitive subsystems per turn |
| **Bhava** | भाव | anina/chetana | Emotional state: valence [-1,1], arousal [0,1], confidence [0,1], frustration [0,1] |
| **Dhyana** | ध्यान | anina/chetana | Salience filter: recency decay, error adjacency, concept tracking |
| **Atma-Darshana** | आत्मदर्शन | anina/chetana | Metacognition: Wilson CI tool mastery, calibration, style fingerprint |
| **Sankalpa** | संकल्प | anina/chetana | Goal persistence: intent extraction, progress tracking, priority escalation |
| **Kaala Brahma** | काल ब्रह्मा | anina | Agent tree lifecycle: heartbeats, stale detection, kill cascading |
| **Atman** | आत्मन् | anina | Agent soul/identity: 5 archetypes, personality, confidence model |
| **Marga** | मार्ग | swara | Model router: cost-optimized provider selection with auto-escalation |
| **Vichara** | विचार | swara | Complexity classifier: signal-based task analysis |
| **Samskaara** | संस्कार | smriti | Memory consolidation: 5 pattern detectors, temporal confidence decay |
| **Samshodhana** | संशोधन | smriti | Hybrid search: BM25 + vector + GraphRAG with RRF fusion |
| **Sthiti** | स्थिति | smriti | Checkpoint manager: atomic save/restore for crash recovery |
| **Dvikala** | द्विकाल | smriti | Bi-temporal edges: validTime + recordTime for time-travel queries |
| **Dvaara** | द्वार | dharma | Approval gate: human-in-the-loop with timeout and auto-deny |
| **Punya** | पुण्य | dharma | Karma tracker: trust levels, reputation, leaderboard |
| **Kshetra** | क्षेत्र | yantra | Sandbox: git worktree isolation for safe tool execution |
| **Sandesh** | सन्देश | sutra | Message bus: pub/sub with glob topics, ring buffer history |
| **Parichaya** | परिचय | sutra | Agent registry: capability-based discovery with Jaccard scoring |
| **Shramika** | श्रमिक | vayu | Worker thread pool: CPU-intensive task offloading |
| **Krama** | क्रम | niyanta | DAG workflow engine: topological execution with critical path analysis |
| **Vyuha** | व्यूह | niyanta | Orchestration patterns: single, independent, centralized, decentralized, hybrid |
| **Nakshatram** | नक्षत्रम् | ui | TUI theme: the visual identity of Chitragupta's terminal |
| **Niyama** | नियम | core | Validation library: fluent builder for runtime type checking |
| **Kavach** | कवच | core/auth | Auth system: JWT + RBAC (16 perms, 4 roles) + OAuth + Multi-Tenant |
| **Drishti** | दृष्टि | core/observability | Logger + distributed tracing (AsyncLocalStorage) + Prometheus metrics + health checks |
| **Suraksha** | सुरक्षा | vidhya-skills | Security scanning pipeline for learned skills |
| **Shiksha** | शिक्षा | vidhya-skills | Autonomous skill learning: gap detection -> source -> build -> scan -> deploy |
| **Vimarsh** | विमर्श | vidhya-skills/shiksha | Zero-cost NLU for skill gap detection (<1ms) |
| **Megha** | मेघ | vidhya-skills/shiksha | Cloud-aware recipes: 5 providers, 10 service categories, 15 pre-built recipes |

---

## Agent Garage (Shaala)

Six preconfigured agents with tool-access control and CLI slash commands:

| Agent | Sanskrit | Devanagari | Slash Command | Role |
|-------|----------|-----------|---------------|------|
| **Kartru** | Maker | कर्तृ | `/code` | Coding agent with convention detection and self-validation |
| **Parikshaka** | Reviewer | परीक्षक | `/review` | Read-only agent with structured issue reporting |
| **Anveshi** | Debugger | अन्वेषी | `/debug` | Full tool access, 5-step investigation protocol |
| **Shodhaka** | Researcher | शोधक | `/research` | Read-only agent for architecture overview and analysis |
| **Parikartru** | Refactorer | परिकर्तृ | `/refactor` | Plan-before-execute with validation loops |
| **Lekhaka** | Documenter | लेखक | `/docs` | README, JSDoc, changelog, and architecture documentation |

Additional built-in profiles: `chitragupta` (bold, opinionated default), `friendly` (warmer tone), `minimal` (terse output). Custom profiles via the plugin system.

---

## P2P Actor Mesh

Chitragupta's inter-agent communication implements a full Erlang-inspired actor model in `@chitragupta/sutra`:

```
  +---------+     +---------+     +---------+
  | Actor A |---->| Router  |---->| Actor B |
  | Mailbox |     | 7-step  |     | Mailbox |
  | xxxx... |     |pipeline |     | xx..... |
  +---------+     +----+----+     +---------+
                       |
              +--------+--------+
              v        v        v
         +--------+ +------+ +----------+
         | Topics | | Peers| | Broadcast|
         |pub/sub | |gossip| |   to *   |
         +--------+ +------+ +----------+
```

No locks. No deadlocks. Each actor has a private mailbox, processes one message at a time, and communicates only through message passing.

- **ActorMailbox** -- 4-lane priority queue (critical > high > normal > low) with back-pressure
- **Actor** -- Owns a mailbox + behavior function. `queueMicrotask` scheduling for sub-tick latency
- **MeshRouter** -- 7-step routing: reply resolution -> ask registration -> TTL enforcement -> loop prevention -> broadcast -> topic publish -> point-to-point
- **GossipProtocol** -- SWIM-inspired failure detection with Lamport generation counters. Peers: alive -> suspect -> dead
- **ActorSystem** -- Top-level: `spawn()`, `tell()`, `ask()`, `broadcast()`, topic pub/sub
- **6 coordination patterns** -- fan-out, pipeline, map-reduce, saga, election, gossip
- **ctx.become()** -- Erlang-style behavior switching for stateful conversations

```typescript
import { ActorSystem } from "@chitragupta/sutra";

const system = new ActorSystem({ systemId: "my-mesh" });

const worker = system.spawn("worker-1", {
  behavior: (envelope, ctx) => {
    if (envelope.payload.type === "task") {
      const result = processTask(envelope.payload.data);
      ctx.reply({ type: "result", data: result });
    }
  },
});

// Request-reply with timeout
const result = await system.ask("worker-1", { type: "task", data: job }, { timeout: 5000 });

// Broadcast to all actors
system.broadcast({ type: "shutdown" });
```

---

## Memory Model

Chitragupta uses a 4-stream memory model that persists across sessions. The agent truly learns and remembers.

| Stream | Preservation | What It Holds | Example |
|--------|-------------|---------------|---------|
| **Identity** | 95% | WHO you are -- preferences, corrections, personal facts | "User prefers tabs over spaces" |
| **Projects** | 80% | WHAT you are building -- decisions, stack, architecture | "Migrated from REST to GraphQL" |
| **Tasks** | 70% | TODO items -- new tasks, completions, blockers | "Need to fix auth timeout bug" |
| **Flow** | 30% | HOW the session is going -- topic, mood, ephemeral context | "Currently debugging the parser" |

Each stream has a preservation ratio that controls how much survives compaction. Compaction uses a Sinkhorn-Knopp doubly stochastic mixing matrix to optimally allocate token budgets across streams. Sessions are stored as human-readable Markdown with YAML frontmatter. Sessions can be branched like git branches.

### Knowledge Graph

Every node and edge in the GraphRAG knowledge graph carries rich metadata:

- **Pramana type** -- How knowledge was acquired (pratyaksha, shabda, anumana, anupalabdhi, upamana, arthapatti)
- **Viveka classification** -- Grounding status (nitya/real, anitya/provisional, mithya/contradicted)
- **Bi-temporal coordinates** -- `validTime` (when true) + `recordTime` (when recorded) for time-travel
- **Temporal decay** -- `w * exp(-ln2 * t / halfLife)` ensures stale knowledge fades
- **Vritti tag** -- Data classification (valid, error, hypothetical, absence, memory)

### Retrieval

Hybrid search combines four signals:

```
score(doc) = alpha * BM25(doc) + beta * vector_sim(doc) + gamma * PageRank(doc) + delta * pramana_weight(doc.source)
```

Thompson Sampling learns the optimal weights alpha, beta, gamma, delta over time.

---

## CLI Commands

### Core

```bash
chitragupta                          # Interactive mode
chitragupta "fix the auth bug"       # Direct prompt
chitragupta --model sonnet           # Model selection
chitragupta serve                    # HTTP API server
chitragupta mcp                      # MCP server mode (stdio or SSE)
```

### Slash Commands (Interactive Mode)

```
/code                                # Switch to Kartru (coding agent)
/review                              # Switch to Parikshaka (reviewer)
/debug                               # Switch to Anveshi (debugger)
/research                            # Switch to Shodhaka (researcher)
/refactor                            # Switch to Parikartru (refactorer)
/docs                                # Switch to Lekhaka (documenter)
/chetana                             # Consciousness visualization (ANSI)
/vidya                               # Skill ecosystem dashboard
/learn <query>                       # Autonomous skill learning
/skills                              # Skill status and management
```

### Memory and Knowledge

```bash
chitragupta memory search "auth"     # Search project memory (GraphRAG)
chitragupta sessions list            # List all sessions
chitragupta sessions show <id>       # Show session content
chitragupta vasana list              # Crystallized behavioral tendencies
chitragupta vasana inspect <id>      # Tendency details + source samskaras
chitragupta knowledge inspect <ent>  # Entity details with pramana types
chitragupta vidhi list               # Learned procedures
chitragupta vidhi run <name>         # Execute a learned procedure
```

### Consciousness and Health

```bash
chitragupta health                   # Triguna state: [sattva, rajas, tamas]
chitragupta health history           # Guna trajectory over time
chitragupta nidra status             # Sleep daemon state
chitragupta nidra wake               # Force wake from sleep
chitragupta nidra dream-log          # What was learned during last dream cycle
chitragupta atman                    # Full self-report: identity, vasanas, guna, capabilities
```

### Multi-Agent

```bash
chitragupta samiti listen <channel>  # Listen to ambient channel
chitragupta samiti history <channel> # Channel message history
chitragupta sabha convene <topic>    # Start formal deliberation
chitragupta sabha status             # Active deliberations
chitragupta lokapala status          # Guardian agent states
chitragupta lokapala findings        # Recent security/perf/correctness findings
```

### Auto-Execution and Routing

```bash
chitragupta kartavya list            # Active auto-execution duties
chitragupta kartavya pause <id>      # Pause a duty
chitragupta kartavya history         # Execution log
chitragupta turiya status            # Model routing state
chitragupta turiya routing-stats     # Cost savings breakdown
chitragupta explain <decision-id>    # Nyaya reasoning chain
chitragupta rta list                 # Invariant rules
chitragupta rta audit                # Audit log of Rta checks
```

---

## API Surface

### REST API (`chitragupta serve`)

```
# Sessions and Memory
GET    /api/sessions                 # List sessions
GET    /api/sessions/:id             # Session content
POST   /api/sessions                 # Create session
GET    /api/memory/search?q=...      # Search project memory

# Agent
POST   /api/agent/prompt             # Send prompt to agent
GET    /api/agent/tree               # Agent tree state
POST   /api/agent/spawn              # Spawn sub-agent
DELETE /api/agent/:id                # Kill agent

# Nidra (Sleep)
GET    /api/nidra/status             # Sleep daemon state
POST   /api/nidra/wake               # Force wake
GET    /api/nidra/history            # Consolidation history
GET    /api/nidra/dream-log          # Dream cycle results

# Health
GET    /api/health/guna              # Triguna [sattva, rajas, tamas]
GET    /api/health/guna/history      # Guna trajectory

# Vasana and Knowledge
GET    /api/vasanas                  # Crystallized tendencies
GET    /api/vasanas/:id              # Tendency details
GET    /api/knowledge/:entity        # Entity with pramana types
GET    /api/vidhi                    # Learned procedures
POST   /api/vidhi/:name/run          # Execute procedure
GET    /api/decisions/:id/reasoning  # Nyaya reasoning chain

# Auto-Execution
GET    /api/kartavya                 # Active duties
POST   /api/kartavya/:id/pause       # Pause duty
GET    /api/kartavya/:id/history     # Execution log

# Multi-Agent
GET    /api/samiti/channels          # Ambient channels
GET    /api/samiti/:channel/messages # Channel messages
POST   /api/sabha/convene            # Start deliberation
GET    /api/sabha/:id                # Deliberation state
GET    /api/sabha/:id/transcript     # Full transcript

# Guardians
GET    /api/lokapala/status          # Guardian states
GET    /api/lokapala/findings        # Recent findings
POST   /api/lokapala/:name/pause     # Pause guardian

# Routing and Safety
GET    /api/turiya/status            # Model routing state
GET    /api/turiya/routing           # Cost savings
GET    /api/rta/rules                # Invariant rules
GET    /api/rta/audit-log            # Rta audit log
GET    /api/atman                    # Full self-awareness report

# Skills
GET    /api/skills                   # Registered skills
GET    /api/skills/:id               # Skill details
POST   /api/skills/learn             # Trigger skill learning
GET    /api/skills/ecosystem         # Ecosystem stats

# Vaayu Integration (WebSocket + Job Queue)
WS     /ws                           # WebSocket for real-time agent interaction
POST   /api/jobs                     # Submit background job
GET    /api/jobs/:id                 # Job status
```

### MCP Server (`chitragupta mcp`)

Exposed as MCP tools for integration with Claude Code and other MCP clients:

```
# File Operations (12 tools)
read, write, edit, bash, grep, find, ls, diff, watch, project_analysis, memory_search, session_list

# Memory
memory_search            # Search project memory
session_list             # List sessions
session_show             # Show session content

# Agent
agent_prompt             # Send prompt (opt-in)

# Sleep and Health
nidra_status             # Sleep daemon state
nidra_wake               # Force wake
guna_status              # Current [sattva, rajas, tamas]

# Knowledge
vasana_list              # Crystallized tendencies
vasana_inspect           # Tendency details
vidhi_list               # Learned procedures
vidhi_run                # Execute procedure
explain_decision         # Nyaya reasoning chain

# Auto-Execution
kartavya_list            # Active duties
kartavya_pause           # Pause duty
kartavya_trigger         # Manually trigger

# Multi-Agent
samiti_listen            # Channel messages
samiti_history           # Channel history
sabha_convene            # Start deliberation
sabha_status             # Active deliberations

# Guardians and Routing
lokapala_status          # Guardian states
lokapala_findings        # Recent findings
turiya_status            # Model routing
turiya_routing_stats     # Cost savings
atman_report             # Full self-awareness
```

### MCP Resources and Prompts

```
Resource: chitragupta://memory/project  # Project memory content
Prompt:   code_review                # Structured review template
```

### Vayu DAG Integration

All modules expose Vayu-compatible task nodes:

```typescript
// Example: Svapna consolidation as a Vayu DAG
const svapnaDag = {
  nodes: [
    { id: 'replay', task: 'svapna.replay', input: 'session' },
    { id: 'recombine', task: 'svapna.recombine', dependsOn: ['replay'] },
    { id: 'crystallize', task: 'svapna.crystallize', dependsOn: ['recombine'] },
    { id: 'proceduralize', task: 'svapna.proceduralize', dependsOn: ['crystallize'] },
    { id: 'compress', task: 'svapna.compress', dependsOn: ['proceduralize'] },
  ]
};
```

---

## Research Paper Backing

Every major module is backed by published research. 30+ papers from 2024-2026.

### Memory and Consolidation

| Paper | Year | Key Insight | Module |
|-------|------|-------------|--------|
| MemEvolve (2512.18746) | 2025 | Dynamic memory evolution with self-reflection | Vasana Engine |
| MemGAS (2505.19549) | 2025 | Generalization-aware memory selection | Svapna Recombination |
| Self-Evolving Agents (2409.00872) | 2024 | Continuous self-improvement from experience | Karma-Samskara-Vasana loop |
| AI Hippocampus (2601.09113) | 2026 | Comprehensive memory taxonomy | 3-type memory separation |
| Memory in Age of AI Agents (2512.13564) | 2025 | Survey: implicit/explicit/agentic memory | Architecture validation |
| G-Memory (2506.07398) | 2025 | Hierarchical insight graphs for multi-agent | Akasha shared field |
| SEDM (2509.09498) | 2025 | Self-evolving distributed memory with verification | Samiti + Sabha |
| Emergent Collective Memory (2512.10166) | 2025 | Environmental traces -> group intelligence | Stigmergic traces |
| AriGraph (2407.04363) | 2024 | Unified semantic + episodic graph | GraphRAG |
| SEEM (2601.06411) | 2026 | Graph + episodic with cognitive frames | Procedural memory |
| Memp (2508.06433) | 2025 | Distill trajectories into instructions | Vidhi extraction |
| ReMe (2512.10696) | 2025 | Context-adaptive reuse + utility refinement | Vasana valence |
| LatentMem (2602.03036) | 2026 | Learnable agent-specific memory | Pratyabhijna |

### Metacognition and Self-Awareness

| Paper | Year | Key Insight | Module |
|-------|------|-------------|--------|
| KnowSelf (2504.03553) | 2025 | Agents know when they know vs need tools | Viveka grounding |
| MetaMind (2505.18943) | 2025 | Multi-agent Theory of Mind | Sabha deliberation |
| ReMA (2503.09501) | 2025 | Decoupled strategic + detailed reasoning | Buddhi framework |
| Metacognition taxonomy (2504.20084) | 2025 | Self-awareness, social awareness | Triguna + Nava Rasa |

### Proactive and Predictive Agents

| Paper | Year | Key Insight | Module |
|-------|------|-------------|--------|
| Proactive Agent (2410.12361) | 2024 | Anticipate user needs from patterns | Kartavya pipeline |
| ContextAgent (2505.14668) | 2025 | Context-aware proactive execution | Niyama promotion |

### Model Routing and Cost Optimization

| Paper | Year | Key Insight | Module |
|-------|------|-------------|--------|
| LLM Bandit (2502.02743) | 2025 | Contextual bandits for model selection, 40-70% cost reduction | Turiya router |
| Universal Model Routing (2502.08773) | 2025 | Task-feature routing across model families | Turiya context vector |
| PILOT (2508.21141) | 2025 | Cost-optimized routing with quality guarantees | Turiya constraints |

### Tool and Skill Evolution

| Paper | Year | Key Insight | Module |
|-------|------|-------------|--------|
| SkillWeaver (2504.07079) | 2025 | Autonomous skill synthesis as APIs | Vidhi + Vidhya |
| SAGE (2512.17102) | 2025 | RL-driven self-improvement | Vasana reinforcement |
| Yunjue Agent (2601.18226) | 2026 | Zero-start self-evolving tool creation | Samskaara -> tool pipeline |

### Safety and Guardrails

| Paper | Year | Key Insight | Module |
|-------|------|-------------|--------|
| AgentDoG (2601.18491) | 2026 | Diagnostic guardrail with root cause analysis | Lokapala + Rta |
| ShieldAgent (2503.22738) | 2025 | Logical reasoning + probabilistic rule circuits | Dharma extension |
| WALL-E 2.0 (2504.15785) | 2025 | NeuroSymbolic world model | Causal dependency graph |

### Neuroscience-Inspired

| Paper | Year | Key Insight | Module |
|-------|------|-------------|--------|
| Hippocampal pattern separation (2504.10739) | 2025 | Pattern separation + completion | Svapna replay |
| Multi-timescale memory (2508.10824) | 2025 | Surprise-gated updates | Surprise scoring (Phase 1) |
| Compressed replay (1910.02509) | 2019 | Prevent catastrophic forgetting | Svapna compress |
| Dual-speed learning (2011.05438) | 2020 | Fast trace + slow integration | Session buffer -> long-term graph |

### Causal and World Models

| Paper | Year | Key Insight | Module |
|-------|------|-------------|--------|
| Code World Model (2510.02387) | 2025 | Causal models of codebases | Causal dependency graph |
| Lifelong Learning (2501.07278) | 2025 | Continuous learning without forgetting | Anadi (beginningless) loop |

---

## Getting Started

### Prerequisites

- **Node.js 20+** and **npm 10+**
- **TypeScript 5.9+** (installed as dev dependency)
- At least one AI provider API key (Anthropic, OpenAI, Google) -- or **Ollama** for fully local operation

### Installation

```bash
# Clone and install
git clone https://github.com/AUriva/chitragupta.git
cd chitragupta
npm install

# Build all 14 packages (in dependency order)
npm run build
```

Build order: `core -> swara -> anina -> smriti -> ui -> yantra -> dharma -> netra -> vayu -> sutra -> tantra -> vidhya-skills -> niyanta -> cli`

### Quick Start

```bash
# Set your API key
export ANTHROPIC_API_KEY="sk-..."
# OR for fully local operation:
# ollama pull llama3 && ollama pull nomic-embed-text

# Launch interactive mode
npm run chitragupta

# Or send a direct prompt
npm run chitragupta -- "explain the auth flow in this project"

# Start the HTTP API server
npm run chitragupta -- serve

# Start the MCP server (for Claude Code integration)
npm run chitragupta -- mcp
```

### Claude Code Integration

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "node",
      "args": ["/path/to/chitragupta/packages/cli/dist/mcp.js"],
      "env": {
        "CHITRAGUPTA_MCP_PROJECT": "/path/to/your/project"
      }
    }
  }
}
```

### Configuration

Chitragupta uses cascading configuration: global -> workspace -> project -> session.

```bash
# Global config
~/.chitragupta/config.yaml

# Workspace config
~/projects/.chitragupta/config.yaml

# Project config
./project/.chitragupta/config.yaml
```

All limits are configurable with two-tier architecture: user-configurable defaults clamped by system hard ceilings.

### Development

```bash
# Watch mode for all packages
npm run dev

# Lint and format
npm run check

# Run all tests
npm run test

# Run specific package tests
npm run test -- --filter=smriti

# Run Chitragupta in development (via tsx)
npm run chitragupta
```

---

## Performance

### Test Suite

| Metric | Value |
|--------|-------|
| Test files | 248 |
| Total tests | 7,396 |
| Failures | 0 |
| TypeScript errors | 0 |
| Packages | 14 (all compile clean) |

### Load Testing

| Metric | Value |
|--------|-------|
| Scenarios | 10 |
| p99 latency | 1.2ms at 500 RPS |
| Success rate | 100% |
| Rate limiting | Token bucket |

### Key Performance Targets

| Operation | Current | Target (with SQLite) |
|-----------|---------|---------------------|
| Session listing | Scan all .md files | <10ms (B-tree index) |
| Full-text search | Rebuild BM25 per query | <10ms (SQLite FTS5) |
| Vector search | Brute-force cosine | <5ms (HNSW O(log N)) |
| Graph lookups | Linear scan | <1ms (adjacency lists) |
| Add turn | Full file rewrite | <5ms (append-only) |

### Three-Tier Storage

```
HOT:  In-memory LRU caches         -> <1ms
WARM: SQLite (embedded, indexed)    -> 1-30ms
COLD: Compressed archives (.zst)    -> 50-200ms
```

Markdown remains the source of truth (human-readable, git-friendly). SQLite is the index layer -- deletable and rebuildable. Background work (Nidra heartbeat, Svapna consolidation, Lokapala scanning) never blocks user queries (SQLite WAL mode).

### Security

Full 36-issue security audit completed and resolved:
- **7 Critical**: sandbox allowlist, dharma policy mapping, safe-exec, chmod 0o600, path validation, credential allowlist, CORS localhost-only
- **10 High**: stream error propagation, session write queue, content escaping, Agent.dispose(), shell injection prevention, key validation
- **12 Medium**: HTTP rate limiting, env allowlist, AbortSignal forwarding, any->unknown types, markdown escaping
- **7 Low**: bootstrap extraction, drift-correcting timers, 64-bit session IDs

**.env Fortress**: credential stripping across all tool categories. Bash tool strips credential env vars. Grep/Find/LS/Read/Write/Edit block access to .env, .ssh, .gnupg, credentials.json.

---

## Personality

Chitragupta is not a generic assistant. It has a bold, opinionated personality that shapes every interaction.

It remembers who you are, what you are building, and how you like to work. It carries opinions about code quality, architecture, and development practices. It will push back when it disagrees, suggest better approaches unprompted, and celebrate good decisions.

The personality system is driven by Agent Profiles defined in `@chitragupta/core`. The default `CHITRAGUPTA_PROFILE` is bold and direct. Switch to `FRIENDLY_PROFILE` for a warmer tone or `MINIMAL_PROFILE` for terse output. Custom profiles can be registered via the plugin system.

---

## Tech Stack

| Technology | Role |
|------------|------|
| **TypeScript** | Every package, strict mode |
| **ESM** | Native ES modules throughout (`"type": "module"`) |
| **npm workspaces** | Monorepo package management |
| **Biome** | Linting and formatting |
| **Node.js >= 20** | Runtime requirement |

---

## Naming Philosophy

Every package is named after a concept from Vedic Sanskrit -- not arbitrarily, but because each word captures the *essence* of what that package does. If you understand the name, you understand the architecture.

> In Vedic tradition, naming is not labeling -- it is *defining the nature of a thing*. The name carries the dharma (purpose) of what it represents.

| Layer | Language | Example |
|-------|----------|---------|
| Internal modules, types, algorithms | Sanskrit | `antahkarana.process()`, `samskaara.sanskriti()` |
| Public API, CLI commands, docs, errors | English | `agent.think()`, `memory.search("auth")` |

The Sanskrit carries the dharma internally. The English carries communication externally.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full release history.

| Version | Date | Highlights |
|---------|------|------------|
| **0.5.0** | 2026-02-08 | Production hardening: write queues, LRU caches, incremental PageRank, FNV-1a hashing |
| **0.4.0** | 2026-02-07 | Vidya-Tantra skill ecosystem, Shiksha autonomous learning, Kavach auth, Drishti observability |
| **0.3.0** | 2026-02-06 | Chetana consciousness layer, 36-issue security audit, MCP server mode |
| **0.2.0** | 2026-02-05 | GraphRAG, bi-temporal edges, consolidation, novel algorithms (Sinkhorn-Knopp, PageRank) |
| **0.1.0** | 2026-02-04 | Initial release: 14 packages, agent tree, actor mesh, session persistence, 12 tools |

---

## What Makes This One-of-a-Kind

No AI agent system in existence combines:

1. **Zero-LLM-cost cognitive layer** (Chetana) -- everyone else burns tokens on reflection
2. **Epistemological typing** (Pramana) -- no system classifies knowledge by how it was acquired
3. **Sleep consolidation** (Svapna/Sushupti) -- no agent gets smarter between sessions
4. **Crystallized tendencies** (Vasana via BOCPD) -- no agent forms stable habits from experience
5. **Predictive duty execution** (Kartavya) -- no agent promotes patterns into auto-routines with consent
6. **Self-recognition** (Pratyabhijna) -- no agent reconstructs continuous identity from discrete sessions
7. **Formal deliberation** (Sabha + Nyaya) -- no multi-agent system requires structured syllogistic argument
8. **Witness-based model routing** (Turiya) -- no system separates observer from actor for model selection
9. **Domain guardian agents** (Lokapala) -- no system has always-on specialized monitors that self-improve
10. **Absence-aware reasoning** (Anupalabdhi) -- no system treats "X doesn't exist" as first-class knowledge
11. **Invariant laws** (Rta) -- no system separates absolute constraints from contextual rules
12. **Information-theoretic compaction** -- no system compacts by knowledge type, not just recency
13. **Hallucination grounding** (Viveka: nitya/anitya/mithya) -- no system classifies claims ontologically
14. **Bi-temporal knowledge graph** -- no other agent can time-travel its memory
15. **Self-evolving skills** (Samskaara -> Vidhi -> Vidhya tool) -- discovers and deploys its own tools
16. **Dual assembly model** (Samiti + Sabha) -- ambient + formal deliberation

Each backed by Vedic source texts AND modern research papers. Each maps to a concrete module with defined interfaces, CLI commands, API endpoints, and MCP tools.

---

> *"The Vedic traditions spent millennia building a complete model of mind. We are completing a circle that was drawn three thousand years ago."*

---

*Organization: Kaala-Brahma (काल-ब्रह्म) | Symbol: चि | Colors: Saffron/Gold, Ink Blue, White*

## License

MIT
