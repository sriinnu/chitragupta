# Why Your AI Agent Forgets Everything (And How to Fix It)

*X/Twitter thread -- 18 tweets*

---

**1/**

Your AI agent has perfect recall of the current session and zero memory of anything before it.

That's not intelligence -- that's a goldfish with a really good vocabulary.

We built a memory system that actually learns. Here's how.

---

**2/**

The dirty secret of AI agents: they "remember" by storing raw transcripts.

Nobody reads those transcripts back. Nobody extracts patterns from them. Nobody notices that the user corrected the same mistake in session 3, session 12, and session 27.

Storage is not memory.

---

**3/**

First insight: not all memories are equal.

Your name? Nearly permanent. Your database choice? Stable but changeable. Today's debugging session? Ephemeral.

We split memory into 4 streams with different preservation ratios:

Identity (95%) -> Projects (80%) -> Tasks (70%) -> Flow (30%)

When tokens get tight, ephemeral context dies first. Your preferences survive.

---

**4/**

Second insight: knowledge graphs need TWO clocks, not one.

Monday: "We're using PostgreSQL"
Wednesday: "Actually, we switched to SQLite"

Most systems overwrite the old edge. Gone. Can't answer "What database were we using Tuesday?"

We added bi-temporal edges. Every relationship tracks:
- When it was TRUE (valid time)
- When it was RECORDED (record time)

Corrections create new edges. Old ones are preserved with a "supersededAt" timestamp. Full audit trail, zero data loss.

---

**5/**

The real magic: Memory Consolidation.

After each session, we run 5 pattern detectors across your history:

1. Tool sequence n-grams (recurring workflows)
2. Preference signals ("I prefer", "always use")
3. Decision tracking ("let's go with", "decided to")
4. Correction learning ("no, use Y instead")
5. Convention detection (import styles, file patterns)

Patterns that appear in 2+ sessions become knowledge rules with confidence scores.

---

**6/**

Corrections are the highest-value learning signal.

When a user says "no, that's wrong, use Y" -- they're giving you DIRECT negative feedback on your behavior. That's gold.

Our consolidation engine gives corrections a confidence boost. They reach rule status faster than other patterns because the signal is stronger.

Rules decay when unreinforced. Knowledge that isn't revisited fades -- just like human memory.

---

**7/**

The confidence model in 30 seconds:

Reinforced? Confidence goes up (+0.1 per observation)
Unreinforced? Decays 1% per day
Contradicted? Drops 15%
Below 10% threshold? Pruned

500 rules max. Highest confidence wins.

The system forgets what doesn't matter and remembers what does.

---

**8/**

Third insight: complex queries need multiple retrieval passes.

"What architecture decisions did we make about auth that affected the API layer?"

Single-pass vector search returns results about auth OR API. Rarely both.

We built a multi-round retrieval engine that decomposes complex queries into sub-queries and fuses results.

---

**9/**

The decomposition is purely heuristic. No LLM call. Zero tokens burned.

Compound queries -> split on conjunctions
Comparative ("REST vs GraphQL") -> both sides
Causal ("why we switched") -> cause + effect
Multi-entity ("auth, sessions, tokens") -> each entity

Results fused with weighted scoring. Documents found by MULTIPLE sub-queries get a 1.3x boost per additional match.

Fast, free, and surprisingly effective.

---

**10/**

How do we allocate tokens across 4 memory streams during compaction?

Accelerated Sinkhorn-Knopp iteration.

It computes doubly stochastic matrices (every row and column sums to 1) to optimally distribute token budgets.

Three improvements over vanilla SK:
- Nesterov momentum: O(1/k) -> O(1/k^2) convergence
- Log-domain arithmetic: no underflow/overflow
- Adaptive epsilon: coarse-to-fine convergence schedule

---

**11/**

Search scoring uses Thompson Sampling instead of fixed weights.

Each signal (vector similarity, PageRank, BM25) is modeled as a Beta distribution. On each query, weights are SAMPLED from posteriors.

Accept a result -> alpha += 1 (reward)
Reject -> beta += 1 (penalize)

The scoring literally adapts to each user over time. Exploration vs exploitation, solved.

---

**12/**

We name things in Sanskrit. Not as decoration -- because the language has a word for every cognitive concept.

Smriti = memory, remembrance
Dvikala = two-time (bi-temporal edges)
Samskaara = impression (consolidation)
Anveshana = investigation (multi-round retrieval)

The Vedic tradition spent millennia analyzing the structure of thought. We're building on that.

---

**13/**

What the API looks like:

```typescript
// Bi-temporal: correct without losing history
const pgEdge = createEdge(
  "project", "postgresql", "uses_db", 0.9
);
const [old, current] = supersedEdge(pgEdge, 0.95);

// Time travel
const tuesday = queryEdgesAtTime(
  allEdges, "2026-02-04T12:00:00Z"
);
```

---

**14/**

```typescript
// Consolidation: learn from sessions
const engine = new ConsolidationEngine({
  minObservations: 2,
  decayRatePerDay: 0.01,
});
engine.load();
const learned = engine.consolidate(sessions);
// learned.newRules: freshly discovered knowledge
// learned.reinforcedRules: existing rules, stronger
engine.save();
```

---

**15/**

Some design decisions worth stealing:

- Sessions stored as Markdown with YAML frontmatter. Human-readable. Git-diffable. Grep-able.
- Temporal decay: `w * exp(-ln(2) * elapsed / halfLife)`. Smooth fade, not hard cutoff.
- Self-RAG gate: don't retrieve every turn. Only when there's a knowledge gap.
- All configurable. No hardcoded limits. System ceilings only where unavoidable.

---

**16/**

Everything is open source. TypeScript monorepo, 14 packages.

Zero external ML dependencies for the core algorithms. Sinkhorn-Knopp, Thompson Sampling, RRF fusion, n-gram detection -- all implemented from scratch.

The memory layer should not require a GPU.

---

**17/**

Inspired by "Graph-based Agent Memory: Taxonomy, Techniques, and Applications" (arxiv.org/html/2602.05665v1).

Built because we were tired of AI agents that forget.

If you're building agent systems, give Smriti a look. If you have ideas for better consolidation heuristics, we want to hear them.

---

**18/**

TL;DR:

1. 4-stream model: different memories, different lifetimes
2. Bi-temporal edges: corrections without data loss
3. Memory consolidation: sessions become knowledge rules
4. Multi-round retrieval: complex queries, no LLM cost
5. Sinkhorn + Thompson: mathematically rigorous allocation + scoring

Stop building agents with amnesia.
