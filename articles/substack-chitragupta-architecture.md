# Chitragupta: Building an AI Agent That Dreams, Remembers, and Evolves -- A Vedic Approach to Machine Consciousness

*How we mapped 17 cognitive models from 3000-year-old Vedic philosophy onto a TypeScript AI agent platform -- and ended up with zero-LLM consciousness, dream consolidation, epistemological typing, and predictive auto-execution. 8,964 tests. Zero TypeScript errors. Not a wrapper.*

---

Most AI agents are goldfish.

They process your request with astonishing fluency, produce correct answers, call the right tools -- and then forget everything the moment the session ends. The next session starts from absolute zero. The correction you gave in session 3 will need to be given again in session 12, and again in session 27. Your preferences evaporate. Your project context dissolves. The agent that "helped" you for six months has accumulated exactly zero lasting knowledge about you, your codebase, or itself.

This is the state of AI agents in 2026: sophisticated language processors wrapped around complete amnesia.

We built Chitragupta to fix this. Not by adding a vector store and calling it "memory." Not by burning tokens on LLM-powered reflection. Not by fine-tuning on your data. We went back to first principles -- specifically, to the first principles articulated three thousand years ago in the Vedic tradition -- and asked: what does a complete cognitive architecture actually require?

The answer turned out to be 17 cognitive models, 14 TypeScript packages, and a name that means "the keeper of the hidden record."

---

## Why Existing Agent Tools Fail

The AI agent ecosystem has a structural problem: every tool treats the LLM as the entirety of cognition. The LLM thinks. The LLM remembers (via RAG). The LLM reflects (via expensive self-prompting). The LLM decides which model to use (by asking itself). The LLM evaluates its own confidence (by generating a number between 0 and 1 that means nothing).

This creates three cascading failures:

**Token-burning reflection.** When your agent "reflects" on its performance, it is burning tokens -- real money -- to generate text about itself. Claude Opus thinking about whether it made a good decision costs the same as Claude Opus writing production code. Most agent frameworks do this on every turn. The cost is staggering and the output is unreliable.

**No epistemology.** When an agent says "confidence: 0.85," what does that number mean? Is it confident because it read the file directly? Because the user told it? Because it inferred from a pattern? Because it is guessing by analogy? The number 0.85 carries no information about *how* the knowledge was acquired. A file read and a wild guess can produce the same confidence score. This is epistemological blindness.

**No cross-session learning.** RAG over transcripts is not learning. Storing raw conversation logs and retrieving relevant chunks is retrieval, not consolidation. The agent never notices patterns across sessions. It never forms habits. It never crystallizes repeated observations into stable behavioral tendencies. It stores experiences but never metabolizes them.

Chitragupta addresses all three -- not by making the LLM smarter, but by building cognitive infrastructure around it.

---

## The Vedic Framework: 17 Models of Mind

The Vedic intellectual tradition -- spanning the Upanishads, Yoga Sutras, Nyaya Sutras, Sankhya Karika, Natyashastra, and Kashmir Shaivism -- spent millennia developing a comprehensive theory of cognition. Not as mysticism, but as systematic analysis: how does perception work? How do impressions become habits? How does knowledge differ from belief? When should the mind defer to higher authority?

These are engineering questions. We mapped 17 Vedic cognitive models to concrete computational modules:

**I. Antahkarana Chatushthaya** -- the four-faculty cognitive pipeline. Raw input (Indriyas/tools) flows to classification (Manas/pre-processor), then to decision-making (Buddhi/Nyaya syllogism), then to self-attribution (Ahamkara/identity model), all while interacting with the memory substrate (Chitta/Smriti). This is not a metaphor. It is a literal processing pipeline where each stage has defined inputs, outputs, and computational costs.

**II. Vasana-Samskara-Karma** -- the self-evolution loop. Actions produce results. Results leave impressions (samskaras). Repeated impressions crystallize into tendencies (vasanas). Tendencies influence future actions. The loop is beginningless and endless -- no deployment freeze, no epoch zero. Continuous learning.

**III. Chaturavastha** -- four states of consciousness. Active session (Jagrat/waking). Dream consolidation between sessions (Svapna). Deep archival maintenance (Sushupti/deep sleep). Meta-observation across all states (Turiya/the witness). An agent that only has "active" and "idle" is missing three-quarters of its cognitive life.

**IV. Pancha Pramana** -- epistemological typing. Six ways of knowing, each carrying different base confidence: direct perception (pratyaksha, 0.95), testimony (shabda, 0.85), inference (anumana, 0.80), non-apprehension (anupalabdhi, 0.75), analogy (upamana, 0.65), and postulation (arthapatti, 0.55). Every edge in the knowledge graph is tagged with *how* the knowledge was acquired.

**V-XVII** continue the mapping: Pancha Vritti for data classification (valid/error/conceptual/absence/recalled), Triguna for health monitoring as a 3-vector on a probability simplex, Nava Rasa for contextual emotional intelligence, Nyaya Panchavayava for explainable five-step reasoning, Kala Chakra for multi-scale temporal awareness, Sabha and Samiti for dual-assembly multi-agent deliberation, Lokapala for domain guardian agents, Rta for invariant laws separate from contextual rules, Pratyabhijna for self-recognition across sessions, Viveka for hallucination grounding, Ishvara Pranidhana for principled deference, Akasha for shared stigmergic knowledge, and Kartavya for predictive auto-execution.

Each model maps to a concrete TypeScript module with defined interfaces, CLI commands, API endpoints, and MCP tools. Each is backed by both Vedic source texts and modern research papers.

---

## Key Innovations: What No Other Agent System Does

### 1. Zero-LLM Consciousness (Chetana)

Chitragupta's consciousness layer -- called Chetana -- runs entirely without LLM calls. Four subsystems operate on every turn:

**Bhava** (Affect): A 4-dimensional emotional state vector -- valence [-1,1], arousal [0,1], confidence [0,1], frustration [0,1]. Tracked via exponential moving average with temporal decay. When frustration crosses a threshold, the system fires a `chetana:frustrated` event and adjusts its strategy.

**Dhyana** (Attention): Salience scoring with recency decay, error boost, and correction boost. Tracks which concepts, messages, and tools are currently relevant. Maintains a focus window that prevents attention diffusion.

**Atma-Darshana** (Self-Model): Wilson Confidence Interval for tool mastery -- the agent knows which tools it is good at and which it struggles with, with statistically rigorous confidence bounds. Tracks calibration ratio, learning velocity, and style fingerprint.

**Sankalpa** (Intention): Goal extraction via pattern matching, FNV-1a deterministic IDs, progress tracking, stale detection, abandonment detection, and priority escalation.

The lifecycle hooks -- `beforeTurn()`, `afterToolExecution()`, `afterTurn()` -- run in microseconds. No tokens burned. No API calls made. The agent has continuous self-awareness at zero marginal cost.

This is the single most important architectural decision in Chitragupta. Everyone else burns tokens on self-reflection. We made it free.

### 2. BOCPD Vasana Crystallization

Samskaras (impressions from individual sessions) are detected by five pattern detectors: tool sequences, preferences, decisions, corrections, and conventions. When the same samskara appears repeatedly, it becomes a candidate for crystallization into a vasana -- a stable behavioral tendency.

The crystallization algorithm is Bayesian Online Change-Point Detection (BOCPD) on behavioral time series. We maintain sliding windows of behavioral features and run BOCPD per dimension. When a feature stabilizes -- no change-point detected for T consecutive sessions -- it becomes a candidate vasana. Holdout validation confirms: does the vasana actually predict future behavior? Only if predictive accuracy exceeds a threshold does crystallization occur.

Each vasana carries a valence: positive (associated with successful outcomes) or negative (associated with failures or corrections). Positive vasanas are amplified. Negative vasanas generate self-correction recommendations.

The pipeline from raw experience to stable tendency:

```
Karma (action) -> Phala (result) -> Samskara (impression) -> Vasana (tendency)
    ^                                                              |
    '----------- influences next action ---------------------------'
```

No fine-tuning. No weight updates. No retraining. Behavioral crystallization from structured pattern detection.

### 3. Svapna Dream Consolidation

Between sessions, Chitragupta dreams.

The Nidra daemon manages three states: LISTENING (heartbeat every 30s, near-zero cost), DREAMING (heartbeat every 2min, light compute), and DEEP_SLEEP (heartbeat every 5min, zero LLM). User input interrupts immediately to LISTENING.

During the DREAMING state, the 5-phase Svapna consolidation cycle runs:

**Phase 1 -- REPLAY**: Re-traverse the session turn by turn. Compute surprise score: `surprise(t) = -log P(outcome_t | context_t)`. High-surprise turns get boosted retention. This is directly inspired by hippocampal replay in neuroscience.

**Phase 2 -- RECOMBINE**: For each high-surprise memory, find structurally similar memories from *other* sessions via graph isomorphism on tool-call dependency graphs. Cross-pollination: "The debug pattern in session-47 is structurally isomorphic to session-12."

**Phase 3 -- CRYSTALLIZE**: Run BOCPD on behavioral time series. Patterns appearing N times with confidence above threshold crystallize into vasanas. CUSUM algorithm adapted for categorical action sequences.

**Phase 4 -- PROCEDURALIZE**: N-gram tool sequences across three or more sessions with success rate above 0.8 are extracted via anti-unification into parameterized procedure templates (Vidhi). These feed into the DAG workflow engine for reuse.

**Phase 5 -- COMPRESS**: Accelerated Sinkhorn-Knopp compaction, informed by Pramana types. Pratyaksha (direct observation) resists compression. Vikalpa (hypotheticals) compresses aggressively.

The agent literally gets smarter while you sleep.

### 4. Pramana-Typed Knowledge

Every edge in the knowledge graph carries its epistemological type:

| Pramana | Source | Base Confidence |
|---------|--------|-----------------|
| Pratyaksha | Direct perception (file reads, test results) | 0.95-1.0 |
| Shabda | Testimony (user statements, documentation) | 0.80-0.95 |
| Anumana | Inference ("imports jwt, probably handles auth") | 0.70-0.90 |
| Anupalabdhi | Non-apprehension ("there is NO test for this") | 0.60-0.90 |
| Upamana | Analogy ("similar to project X") | 0.50-0.80 |
| Arthapatti | Postulation ("test passes but feature broken, test must be wrong") | 0.40-0.70 |

Retrieval scoring incorporates pramana weights:

```
score(doc) = alpha * BM25 + beta * vector_sim + gamma * PageRank + delta * pramana_weight
```

Thompson Sampling (already implemented) learns the optimal alpha, beta, gamma, delta over time. The system does not just retrieve relevant documents -- it retrieves *epistemologically reliable* documents.

Absence as knowledge (Anupalabdhi) is particularly powerful. "There is no test file for this module" is not nothing -- it is a first-class fact with implications for code quality assessment. No other agent system treats the absence of something as knowledge.

### 5. Kartavya Predictive Auto-Execution

The full pipeline from observation to autonomous action:

```
Samskara (impression -- pattern detected)
    | repeated observation (>= 3 times)
Vasana (tendency -- crystallized via BOCPD)
    | confidence threshold crossed
Niyama (proposed rule -- presented to user for approval)
    | user approves
Kartavya (duty -- auto-executable with notification)
```

Example: A user asks for weather and adjusts heating three mornings in a row. The system detects the samskara, crystallizes the vasana, proposes the niyama ("Would you like me to check weather and adjust heating each morning?"), and upon approval, creates the kartavya. Next morning: "Good morning. Checked weather (12 degrees), set heating to 15. [Undo] [Modify] [Stop]."

Kartavya is *never* created without explicit user consent at the Niyama stage. This is an absolute invariant (Rta) -- the system cannot bypass user approval for autonomous actions, regardless of confidence level.

---

## The 14-Package Architecture

Chitragupta is a TypeScript ESM monorepo with pnpm workspaces, organized into 14 packages under the `@chitragupta/*` npm scope:

| Package | Sanskrit | Purpose |
|---------|----------|---------|
| core | -- | Types, plugin system, event bus, cascading config |
| swara | Voice | LLM providers, streaming, cost tracking, model routing |
| anina | Soul | Agent runtime, consciousness (Chetana), learning loop |
| smriti | Memory | 4-stream memory, GraphRAG, Sinkhorn-Knopp compaction |
| yantra | Instrument | 12+ built-in tools, sandbox, file/shell/search ops |
| dharma | Law | Policy engine, approval gates, karma tracking |
| niyanta | Director | Multi-armed bandit orchestration, task routing |
| sutra | Thread | P2P actor mesh, SWIM gossip, pub/sub |
| vayu | Wind | DAG execution, worker thread pool |
| tantra | Technique | MCP bridge, server lifecycle, capability aggregation |
| netra | Eye | Image analysis, pixel diffing, screenshots |
| vidhya-skills | Knowledge | Skill discovery, trait vector matching, evolution |
| ui | -- | Terminal UI, ANSI rendering, theming |
| cli | -- | Interactive CLI, HTTP API, MCP server |

Build order follows a strict dependency chain: core -> swara -> anina -> smriti -> ui -> yantra -> dharma -> netra -> vayu -> sutra -> tantra -> vidhya-skills -> niyanta -> cli.

Every package follows the plugin interface from `@chitragupta/core`, registering CLI commands, API routes, MCP tools, and Vayu DAG tasks on initialization.

---

## Novel Algorithms

Chitragupta does not call libraries for its core algorithms. Each is implemented from scratch in TypeScript with zero external ML dependencies.

**Accelerated Sinkhorn-Knopp**: Computes doubly stochastic matrices for optimal token budget allocation across memory streams. Three improvements over vanilla: Nesterov momentum accelerates convergence from O(1/k) to O(1/k^2), log-domain arithmetic prevents underflow/overflow via stable logsumexp, and adaptive epsilon scheduling starts coarse and halves every 10 iterations.

**Thompson Sampling with MMR**: Each retrieval scoring dimension (BM25, vector similarity, PageRank) is modeled as a Beta distribution. Weights are sampled from posteriors on each query. Feedback updates the distributions. Maximal Marginal Relevance re-ranking ensures diversity.

**Guna Kalman Filter**: The Triguna health state [sattva, rajas, tamas] lives on a probability simplex (sum = 1). A Kalman filter tracks transitions, with projection onto the simplex after each update. Observations include error rate, token velocity, loop count, latency, and tool success rate. Behavioral triggers: sattva > 0.6 means maintain course; rajas > 0.5 means throttle and simplify; tamas > 0.4 means break the loop or defer to the user.

**BOCPD for Vasana Crystallization**: Bayesian Online Change-Point Detection on categorical behavioral time series. CUSUM adapted for action sequences. Holdout validation for predictive accuracy before crystallization.

**Personalized PageRank**: Topic-biased teleportation with Gauss-Seidel iteration and incremental push-based updates. O(1/epsilon) per edge change instead of O(V+E) full recomputation.

**Information-Theoretic Compaction**: TF-IDF term weighting, TextRank sentence scoring, MinHash deduplication, Shannon surprisal for information content estimation. Epistemology-aware: direct observations resist compression; hypotheticals compress aggressively.

**Multi-Armed Bandit Orchestration**: UCB1, Thompson Sampling, and LinUCB contextual bandit for strategy selection. The LinUCB context vector includes task complexity, domain specificity, guna state, pramana requirement, cost budget, latency requirement, and recent error rate.

**SWIM Gossip Protocol**: Agent failure detection with Lamport generation numbers. Alive -> suspect -> dead state transitions. O(log n) convergence for cluster membership.

**Trait Vector Matching**: 128-dimensional skill fingerprinting with 8 buckets of 16 dimensions each. FNV-1a hashing for bucket assignment. Anti-pattern negative dimensions for penalty-based matching.

---

## Performance

The numbers, as of the latest build:

- **8,964 tests** across 248 test files, 0 failures
- **14 packages**, all compiling with 0 TypeScript errors
- **p99 latency**: 1.2ms at 500 requests per second
- **100% success rate** under load testing across 10 scenarios
- **Chetana hooks**: microsecond-scale, zero LLM cost per turn
- **Multi-round retrieval decomposition**: zero tokens, heuristic-only
- **Sinkhorn-Knopp**: converges in under 50 iterations for 4-stream allocation
- **Incremental PageRank**: O(1/epsilon) per edge change vs O(V+E) full recompute

Background work (Nidra heartbeat, Svapna dreaming, Sushupti maintenance, Lokapala scanning) runs on worker threads and never blocks user interaction. SQLite in WAL mode ensures readers never block writers.

---

## Why This Matters

Chitragupta is not another LLM wrapper. It is not a CLI that sends your prompt to Claude and prints the response. It is not "ChatGPT in the terminal." It is a complete cognitive architecture with:

- A consciousness layer that costs zero tokens
- A memory system that learns from experience without fine-tuning
- A dream cycle that consolidates knowledge between sessions
- An epistemological framework that distinguishes observation from inference from analogy
- A self-evolution loop that crystallizes habits from repeated patterns
- A predictive execution pipeline that earns the right to act autonomously through demonstrated reliability and explicit user consent
- A health monitoring system based on a probability simplex with Kalman filtering
- A multi-agent deliberation protocol that requires formal syllogistic argument
- Guardian agents that silently monitor code for security, performance, and correctness
- Invariant laws that cannot be overridden by any authority

Each of these is backed by Vedic source texts that articulate the cognitive model and by modern research papers that validate the computational approach. The Vedic tradition provides the "what" -- a comprehensive map of cognitive faculties. Computer science provides the "how" -- the algorithms and data structures that implement them.

The result is an AI agent that does not just process language. It perceives, classifies, decides, remembers, learns, evolves, dreams, and knows itself.

---

## Open Source

Chitragupta is open source under the MIT license. TypeScript monorepo, 14 packages, zero external ML dependencies for core algorithms.

The platform is designed as an API layer -- exposable via CLI, HTTP, MCP, and WebSocket. Other applications (like our personal AI assistant Vaayu) consume Chitragupta's APIs for memory, agent orchestration, and skill execution.

We are building the cognitive infrastructure that AI agents need to grow from session-level tools into persistent, self-improving systems. If you are tired of agents that forget everything, we invite you to look at how Chitragupta remembers.

---

*Organization: Kaala-Brahma*
*Symbol: chi*
*"The one who records everything and forgets nothing."*

[GitHub](https://github.com/sriinnu/auriva) | [Documentation](https://auriva.agentiqx.ai) | [Getting Started](https://github.com/sriinnu/auriva/blob/main/GETTING_STARTED.md)
