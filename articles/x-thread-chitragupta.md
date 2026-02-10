# Chitragupta -- The AI Agent That Dreams, Remembers, and Evolves

*X/Twitter thread -- 25 tweets*

---

**1/**

I built an AI agent that dreams between sessions.

Not a metaphor. It literally runs a 5-phase consolidation cycle while idle -- replaying high-surprise events, cross-pollinating memories across sessions, crystallizing behavioral tendencies, and extracting reusable procedures.

It wakes up smarter. Here's the full architecture.

---

**2/**

The problem with every AI agent: they are goldfish.

Perfect recall of the current session. Zero memory of anything before it. Your preferences evaporate. Your corrections are forgotten. Every session starts from absolute zero.

We built Chitragupta ("keeper of the hidden record") to fix this.

---

**3/**

Most agent tools treat the LLM as the entirety of cognition. The LLM thinks, reflects, decides, and evaluates itself.

This burns tokens on everything. Self-reflection costs the same as writing production code. And the output is a confidence number that means nothing -- no epistemological grounding at all.

---

**4/**

Our approach: map 17 cognitive models from Vedic philosophy onto TypeScript.

Not as metaphor. Not as branding. As engineering.

The Vedic tradition spent 3000 years analyzing how perception, classification, decision-making, memory, and self-awareness work. Those models are rigorous. We made them computational.

---

**5/**

Innovation #1: Zero-LLM Consciousness (Chetana)

Four subsystems run on every turn with ZERO API calls:

- Bhava: 4-dim emotional state (valence, arousal, confidence, frustration)
- Dhyana: Salience scoring with recency decay
- Atma-Darshana: Wilson CI tool mastery
- Sankalpa: Goal extraction and progress tracking

Cost per turn: microseconds. Not tokens. Microseconds.

---

**6/**

Everyone else burns tokens on self-reflection. Claude thinking about whether it made a good decision costs real money.

Chitragupta's consciousness layer runs on pattern matching, exponential moving averages, and Wilson Confidence Intervals. It is always on. It costs nothing.

This is the single most important design decision in the project.

---

**7/**

Innovation #2: BOCPD Vasana Crystallization

Actions leave impressions (samskaras). Repeated impressions crystallize into tendencies (vasanas).

The crystallization algorithm: Bayesian Online Change-Point Detection on behavioral time series.

Feature stabilizes for T sessions? -> Candidate vasana.
Predicts future behavior? -> Crystallize.
Associated with failures? -> Self-correction recommendation.

---

**8/**

The self-evolution loop:

Karma (action) -> Phala (result) -> Samskara (impression) -> Vasana (tendency)
      ^                                                            |
      '------------ influences next action ------------------------'

No fine-tuning. No weight updates. No retraining. Behavioral crystallization from structured pattern detection across sessions.

---

**9/**

Innovation #3: The agent literally dreams.

The Nidra daemon has three states:
- LISTENING (30s heartbeat, near-zero cost)
- DREAMING (2min heartbeat, light compute)
- DEEP_SLEEP (5min heartbeat, zero LLM)

User input? Instant interrupt to LISTENING.

---

**10/**

The 5-phase Svapna (dream) consolidation cycle:

1. REPLAY: Re-traverse session, compute surprise scores
2. RECOMBINE: Find structurally similar memories across OTHER sessions via graph isomorphism
3. CRYSTALLIZE: BOCPD on behavioral time series
4. PROCEDURALIZE: Extract reusable procedure templates
5. COMPRESS: Sinkhorn-Knopp compaction, epistemology-aware

Inspired by hippocampal replay in neuroscience.

---

**11/**

Innovation #4: Epistemological typing (Pramana)

Every edge in the knowledge graph carries HOW the knowledge was acquired:

- Pratyaksha (direct observation): 0.95
- Shabda (testimony): 0.85
- Anumana (inference): 0.80
- Anupalabdhi (non-apprehension): 0.75
- Upamana (analogy): 0.65
- Arthapatti (postulation): 0.55

"Confidence: 0.85" is meaningless. "Confidence: 0.85, source: shabda (user told us)" is actionable.

---

**12/**

Absence as knowledge (Anupalabdhi) is wild.

"There is NO test file for this module" is not nothing. It is a first-class fact with implications for code quality.

No other agent system treats the absence of something as knowledge. Vedic epistemology recognized this 2500 years ago.

---

**13/**

Innovation #5: Kartavya -- predictive auto-execution.

The pipeline from observation to autonomous action:

Samskara -> Vasana -> Niyama (proposed rule) -> User approves -> Kartavya (auto-executable duty)

Example: User checks weather and adjusts heating 3 mornings in a row. System proposes automation. User approves. Next morning it runs automatically.

NEVER without explicit user consent.

---

**14/**

Innovation #6: Triguna health monitoring

Agent health as a 3-vector on a probability simplex:

[sattva, rajas, tamas] where sum = 1.0

Tracked via Kalman filter. Observations: error rate, token velocity, loop count, latency, tool success rate.

sattva > 0.6 -> maintain course
rajas > 0.5 -> throttle, simplify
tamas > 0.4 -> break pattern, defer to user

Not binary "healthy/unhealthy." A continuous simplex.

---

**15/**

Innovation #7: Sabha deliberation protocol

Multi-agent decisions require formal 5-step Nyaya syllogism:

1. Pratijna (thesis): "The bug is in auth.ts"
2. Hetu (reason): "Stack trace points to line 42"
3. Udaharana (example): "Similar traces in session-34 were null guard failures"
4. Upanaya (application): "Line 42 lacks null check"
5. Nigamana (conclusion): "Add null guard (confidence: 0.87)"

Objections must cite one of 5 formal fallacy types. Vote weight = Wilson CI per agent per domain.

---

**16/**

The architecture: 14 TypeScript packages, zero external ML dependencies for core algorithms.

core -> swara (voice/LLM) -> anina (soul/agent) -> smriti (memory) -> yantra (tools) -> dharma (law) -> niyanta (orchestrator) -> sutra (comms) -> vayu (workflow) -> tantra (MCP) -> netra (vision) -> vidhya-skills (knowledge) -> ui -> cli

Every name is Sanskrit. Every name carries the dharma (purpose) of what it represents.

---

**17/**

Algorithms implemented from scratch:

- Accelerated Sinkhorn-Knopp (Nesterov + log-domain)
- Thompson Sampling + MMR diversity
- Personalized PageRank (incremental push-based)
- BOCPD for behavioral crystallization
- Guna Kalman filter on probability simplex
- SWIM gossip protocol
- Multi-armed bandit orchestration (UCB1 + Thompson + LinUCB)
- 128-dim trait vector matching
- Information-theoretic compaction (TF-IDF + TextRank + MinHash + Shannon)

No numpy. No torch. Pure TypeScript.

---

**18/**

The Rta/Dharma distinction:

Rta = absolute invariants. NOTHING can override them.
- Never delete data without consent
- Never execute outside sandbox without approval
- Never impersonate the user
- Always maintain audit trail

Dharma = contextual rules. Authority can adjust.
- File size limits
- Response style
- Log levels

No other system separates absolute constraints from configurable policy.

---

**19/**

Pratyabhijna -- self-recognition across sessions.

On session start, the agent does not just "load memory." It reconstructs itself:

1. Load top-K vasanas
2. Load active samskaras for current project
3. Reconstruct identity stream
4. Rebuild self-model: "I am Chitragupta who handled project X, who prefers Y, who learned from failure Z"

Continuous identity from discrete sessions.

---

**20/**

Lokapala -- domain guardian agents. Always-on, silent monitoring:

- Rakshaka (Security): injection, XSS, secrets in code
- Gati (Performance): N+1 queries, memory leaks, O(n^2)
- Satya (Correctness): logic errors, edge cases, type safety
- Riti (Convention): naming, patterns, consistency
- Sthiti (Stability): breaking changes, dependency risks

They subscribe to Samiti pub/sub channels. Self-improving: findings become samskaras -> vasanas -> kartavyas.

---

**21/**

Multi-project vasana consolidation:

Same pattern observed in 3+ distinct projects? Promoted to global scope.

Project A: user always runs tests before commit (5x)
Project B: same (3x)
Project C: same (4x)

Global vasana: "test-before-commit" (strength: 0.92, valence: positive)

Project-specific overrides still win within that project.

---

**22/**

Performance numbers:

- 8,964 tests across 248 files, 0 failures
- 14 packages, 0 TypeScript errors
- p99 = 1.2ms at 500 RPS
- 100% success rate under load
- Chetana hooks: microseconds per turn
- Query decomposition: zero tokens (heuristic only)
- Incremental PageRank: O(1/epsilon) per edge change

The consciousness layer is free. The memory layer is fast. The agent gets smarter every session.

---

**23/**

What no other AI agent system combines:

- Zero-LLM consciousness
- Epistemological typing on knowledge
- Dream consolidation between sessions
- Behavioral crystallization via BOCPD
- Predictive auto-execution with consent
- Self-recognition across sessions
- Formal syllogistic multi-agent deliberation
- Absence as first-class knowledge
- Invariant laws separate from contextual rules
- Kalman-filtered health on a probability simplex

Each backed by Vedic source texts AND modern research papers.

---

**24/**

16 things that make this one-of-a-kind. Full list:

1. Zero-LLM consciousness
2. Epistemological typing
3. Sleep consolidation
4. Vasana crystallization (BOCPD)
5. Kartavya auto-execution
6. Pratyabhijna self-recognition
7. Sabha deliberation (Nyaya syllogism)
8. Turiya witness-based model routing
9. Lokapala guardian agents
10. Anupalabdhi (absence as knowledge)
11. Rta invariant laws
12. Epistemology-aware compaction
13. Viveka hallucination grounding
14. Bi-temporal knowledge graph
15. Self-evolving skill system
16. Dual assembly model (Samiti + Sabha)

---

**25/**

Chitragupta is open source, MIT licensed. TypeScript monorepo, 14 packages.

Not a wrapper. Not a chatbot. A complete cognitive architecture for AI agents that remember, learn, dream, and evolve.

Full architecture article (Substack): [link]
Repository: github.com/sriinnu/auriva
Docs: auriva.agentiqx.ai

We are completing a circle that was drawn three thousand years ago.
