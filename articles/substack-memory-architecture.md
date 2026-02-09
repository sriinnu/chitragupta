# From Storage to Learning: Building AI Memory That Actually Remembers

*How we built a memory system that learns from experience, corrects itself without data loss, and decomposes complex queries -- all without a single extra LLM call.*

---

Your AI agent remembers everything that happened in the current conversation and nothing from the one before it. It dutifully stores transcripts on disk, but never reads them back. Never learns from them. Never notices that you corrected the same mistake three sessions in a row.

This is the state of AI memory in 2026: we have agents that can write code, plan multi-step workflows, and orchestrate sub-agents -- but the moment you close the terminal, the slate is wiped. Every session starts from zero. Every correction is made for the first time, again.

We set out to change that when building [Chitragupta](https://github.com/sriinnu/chitragupta), an open-source TypeScript platform for AI agents. The memory package, called **Smriti** (Sanskrit: *memory, remembrance*), implements three techniques inspired by the recent survey ["Graph-based Agent Memory: Taxonomy, Techniques, and Applications"](https://arxiv.org/html/2602.05665v1) -- layered on top of our existing 4-stream model, GraphRAG, and accelerated Sinkhorn-Knopp compaction.

This article walks through the architecture, the algorithms, and the design decisions. Code examples are in TypeScript, but the ideas are language-agnostic.

---

## The 4-Stream Model: Not One Blob, Four Rivers

Most memory systems treat all memories the same. A user preference, a project decision, a pending task, and a fleeting thought all get dumped into the same vector store. When you search, you get a soup of results with no structural hierarchy.

Smriti separates memory into four **streams**, each stored as a human-readable Markdown file:

| Stream       | Preservation | Purpose |
|-------------|-------------|---------|
| **Identity** (WHO)  | 95%  | Preferences, corrections, personal facts. Near-immutable. |
| **Projects** (WHAT) | 80%  | Active projects, architecture decisions, stack choices. |
| **Tasks** (TODO)    | 70%  | Pending work, completed items, blockers. |
| **Flow** (HOW)      | 30%  | Ephemeral context -- current topic, mood, open questions. Per-device. |

The preservation ratios determine how much of each stream survives when the context window fills up and compaction kicks in. Your name and preferences (identity, 95%) almost never get evicted. The flow of a debugging session from three weeks ago (flow, 30%) fades quickly.

Why four streams instead of one? Because different kinds of memory have fundamentally different *half-lives*. Your preference for tabs over spaces does not decay. The fact that you were debugging a CORS error on Tuesday does. A flat memory store forces you to treat both the same -- either aggressively pruning (losing preferences) or hoarding everything (burning tokens on stale context).

The 4-stream model makes compaction a structural decision, not a heuristic gamble.

---

## Bi-Temporal Edges: The Two Clocks of Knowledge

Here is a scenario that breaks most knowledge graphs:

> On Monday, you tell the agent: "We're using PostgreSQL for the database."
> On Wednesday, you switch: "Actually, we migrated to SQLite."

A naive knowledge graph overwrites the PostgreSQL edge with the SQLite one. The old fact is gone. If you later ask "What database were we using on Tuesday?", the system has no answer.

The database world solved this problem decades ago with **bi-temporal modeling** -- tracking *when something was true* separately from *when we recorded it*. We brought the same idea to AI knowledge graphs.

Every edge in Smriti's graph now carries two temporal axes:

- **Valid time** (`validFrom` / `validUntil`): When the relationship was true in the real world.
- **Record time** (`recordedAt` / `supersededAt`): When the relationship was recorded or corrected in the graph.

```typescript
interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  weight: number;
  validFrom?: string;    // When this became true
  validUntil?: string;   // When this stopped being true (undefined = still valid)
  recordedAt?: string;   // When we recorded this
  supersededAt?: string; // When a newer version replaced this record
}
```

When a correction happens, we don't delete the old edge. We call `supersedEdge()`:

```typescript
import { createEdge, supersedEdge, queryEdgesAtTime } from "@chitragupta/smriti";

// Monday: record the PostgreSQL decision
const pgEdge = createEdge("project-x", "postgresql", "uses_database", 0.9);

// Wednesday: correct to SQLite -- old edge is preserved, not deleted
const [supersededPg, sqliteEdge] = supersedEdge(pgEdge, 0.95, "uses_database");

// Time-travel: "What did we know on Tuesday?"
const tuesdayEdges = queryEdgesAtTime(
  [supersededPg, sqliteEdge],
  "2026-02-04T12:00:00Z"  // Tuesday noon
);
// Returns: [pgEdge] -- PostgreSQL was the known truth on Tuesday
```

The old edge gets a `supersededAt` timestamp but remains in the graph. The new edge gets fresh `validFrom` and `recordedAt` timestamps. Nothing is lost.

This also enables **full audit trails**. Calling `getEdgeHistory(edges, source, target)` returns every version of a relationship, sorted chronologically -- a complete record of how the system's understanding evolved.

We named this module **Dvikala** (Sanskrit: *two-time*), reflecting the dual temporal axes that govern every relationship.

### Temporal Decay

Edges that haven't been relevant for a while should carry less weight. Smriti uses exponential half-life decay:

$$\text{decay}(w, t) = w \cdot \exp\!\left(-\frac{\ln 2 \cdot \Delta t}{t_{1/2}}\right)$$

where $w$ is the edge weight, $\Delta t$ is the elapsed time since the edge became valid (or expired), and $t_{1/2}$ is the configurable half-life. The formula guarantees that an edge's influence halves every $t_{1/2}$ milliseconds -- a smooth, predictable fade rather than a hard cutoff.

### Compaction

Superseded edges accumulate over time. The `compactEdges()` function garbage-collects superseded edges older than a configurable retention window, while always preserving current (non-superseded) edges. This keeps the graph bounded without losing recent audit history.

---

## Memory Consolidation: The Crown Jewel

Bi-temporal edges fix how we *store* knowledge. Consolidation fixes how we *learn* it.

Consider what happens across 50 sessions. The user corrects the agent's import style in session 3, again in session 12, and again in session 27. Each time, the correction lives in that session's transcript. The agent never connects the dots. It never says: "I know this user wants ESM imports with `.js` extensions because they've told me three times."

**Samskaara** (Sanskrit: *impression, refinement*) is a post-session analysis engine that transforms raw experience into distilled knowledge rules. It runs five pattern detectors across recent sessions:

### 1. Tool Sequence Detection

N-gram analysis (2-gram, 3-gram, 4-gram) finds recurring sequences of tool calls across sessions. If the agent consistently runs `read -> grep -> edit` when fixing bugs, that becomes a workflow rule.

### 2. Preference Learning

Regex-based detection of explicit preference signals: "I prefer X", "always use Y", "never use Z", "let's stick with W". Each match is associated with the session it came from and tracked across sessions.

### 3. Decision Tracking

Captures architectural and design decisions: "let's use React", "decided to go with monorepo", "switched to Vite". These become project-level knowledge rules.

### 4. Correction Learning

This is the highest-value signal. When a user says "no, not that -- use Y instead" or "that's wrong, it should be Z", they are giving the most direct learning feedback possible. Corrections get a confidence boost in the scoring formula:

```
correction confidence = sessions.size / max(totalSessions * 0.2, 1)
```

Compared to regular patterns where the denominator uses 0.3, corrections reach high confidence faster because they represent stronger signals.

### 5. Convention Detection

Analyzes tool call inputs for patterns: file extensions used, import styles (ESM with `.js` extension vs. without), naming conventions. These become convention rules that inform future behavior.

### The Confidence Model

Every knowledge rule has a confidence score in [0, 1]. Confidence changes through three mechanisms:

**Reinforcement**: When the same pattern appears in new sessions, confidence increases by `0.1 * observationCount`. Rules that keep showing up get stronger.

**Decay**: Unreinforced rules lose confidence at a rate of `decayRatePerDay` (default: 0.01) for each day since last reinforcement. Knowledge that isn't revisited fades, just like human memory.

**Contradiction**: When a correction pattern contains words that overlap with an existing rule and includes negation ("not", "wrong"), that rule's confidence drops by 0.15.

Rules whose confidence falls below the prune threshold (default: 0.1) are garbage-collected. A maximum of 500 rules are retained, keeping the highest-confidence ones.

```typescript
import { ConsolidationEngine } from "@chitragupta/smriti";

const engine = new ConsolidationEngine({
  minObservations: 2,    // Pattern must appear in 2+ sessions to become a rule
  decayRatePerDay: 0.01, // 1% confidence loss per unreinforced day
  maxRules: 500,         // Hard ceiling on stored rules
  pruneThreshold: 0.1,   // Rules below 10% confidence get removed
});

engine.load(); // Load previously learned rules from disk

const result = engine.consolidate(recentSessions);
// result.newRules       -- freshly discovered knowledge
// result.reinforcedRules -- existing rules that got stronger
// result.weakenedRules  -- rules contradicted by new evidence

engine.save(); // Persist to ~/.chitragupta/consolidation/
```

The result: an agent that literally learns from experience. Not through fine-tuning, not through RAG over raw transcripts, but through structured pattern detection that builds a growing, self-maintaining knowledge base.

---

## Multi-Round Retrieval: Asking Deeper Questions

"What architecture decisions did we make about auth that affected the API layer?"

Try answering that with a single vector search. You will get either results about "auth" or results about "API layer", but rarely results that bridge both concepts. Single-pass retrieval is fundamentally limited when the query has compound structure.

**Anveshana** (Sanskrit: *investigation, disciplined inquiry*) decomposes complex queries into sub-queries and fuses their results -- all through heuristics, with zero LLM calls.

The decomposition pipeline:

1. **Complexity analysis**: Word count, conjunctions, temporal markers, comparative structures, multiple named entities. If the query is simple, bypass decomposition entirely.

2. **Comparative decomposition**: "REST vs GraphQL" becomes two sub-queries, one for each side.

3. **Causal decomposition**: "Why we switched to SQLite" splits into cause and effect components.

4. **Multi-entity decomposition**: "authentication, sessions, and tokens" becomes three targeted sub-queries.

5. **Conjunction splitting**: "auth AND API changes" splits on the conjunction.

Each sub-query gets a positional weight: `w(i) = max(0.4, 1.0 - 0.2 * i)`, so the original query always has the highest weight and later decompositions contribute less. A specificity bonus adds 0.05-0.1 for longer sub-queries that are more targeted.

### Result Fusion

Results from all sub-queries are fused with weighted scoring:

```
fused_score(doc) = SUM(round_score * sub_query_weight) * multi_query_boost
```

The multi-query boost (default: 1.3) rewards documents found by multiple sub-queries. A document relevant to both "auth" AND "API layer" gets `1.3^(n-1)` boost where `n` is the number of sub-queries that found it. This naturally surfaces documents that bridge multiple concepts.

### Adaptive Termination

After each round, the engine checks whether new documents were discovered or scores improved. If no new documents appear and improvement falls below the threshold (default: 0.05), retrieval stops early. This avoids wasting computation on diminishing returns.

The entire pipeline runs without calling any LLM for decomposition. The heuristics are fast, free, and surprisingly effective -- because most complex queries follow predictable grammatical structures.

---

## The Sinkhorn Connection: Optimal Token Distribution

When the context window fills up and compaction triggers, Smriti needs to decide how many tokens each stream gets. This is an allocation problem: distribute a fixed total budget across four streams in a way that respects their preservation ratios while accounting for the actual content distribution.

We solve this with **accelerated Sinkhorn-Knopp iteration** -- an algorithm for computing doubly stochastic matrices (matrices where every row and every column sums to 1).

Three improvements over vanilla Sinkhorn-Knopp:

**1. Nesterov Momentum** accelerates convergence from $O(1/k)$ to $O(1/k^2)$:

$$y_k = x_k + \frac{k-1}{k+2}(x_k - x_{k-1}), \quad x_{k+1} = \text{SK}(y_k)$$

The momentum coefficient $(k-1)/(k+2)$ is the optimal schedule for Nesterov's accelerated gradient method on the Birkhoff polytope.

**2. Log-domain arithmetic** prevents numerical underflow/overflow using stable `logsumexp`:

$$\text{logsumexp}(\mathbf{x}) = \max(\mathbf{x}) + \log\sum_i \exp(x_i - \max(\mathbf{x}))$$

All row and column normalizations happen in log space, making the algorithm robust even on large, poorly-conditioned matrices.

**3. Adaptive epsilon scheduling** starts with coarse convergence ($\epsilon = 10^{-2}$) and halves every 10 iterations until reaching the target ($\epsilon = 10^{-8}$). This gives fast initial convergence followed by precise refinement -- a warm-start strategy that reduces total iterations.

The resulting doubly stochastic matrix is used to build the hierarchical affinity between session chunks. Each chunk has recency, relevance, and importance scores. The affinity matrix encodes how chunks relate to each other, and the Sinkhorn-solved allocation determines how the token budget is distributed.

---

## The Scoring Layer: Thompson Sampling Learns What Matters

Smriti's search has three signals: cosine similarity (vector), PageRank (graph), and BM25 (text). Fixed weights (0.6, 0.25, 0.15) work for a generic user, but different users value different signals.

We replaced fixed weights with **Thompson Sampling**. Each scoring dimension is modeled as a Beta distribution. On each query:

1. **Sample** weights from the Beta posteriors
2. **Normalize** to sum to 1
3. **Score** candidates using sampled weights
4. After feedback (accept/reject), update: accept increments alpha, reject increments beta

This balances exploration (trying new weight combinations) with exploitation (using what works). Old feedback decays exponentially so the scorer adapts as preferences change.

After scoring, **Maximal Marginal Relevance (MMR)** re-ranking reduces redundancy in the top-K results, ensuring diversity even when multiple similar documents score highly.

---

## The Vedic Naming Philosophy

A brief note on naming. We name packages after what they *are*, not what they *do*:

- **Smriti** (memory, remembrance) -- the memory package
- **Dvikala** (two-time) -- bi-temporal edges
- **Samskaara** (impression, refinement) -- memory consolidation
- **Anveshana** (investigation) -- multi-round retrieval

This is not decoration. Sanskrit has a word for nearly every cognitive concept because the Vedic tradition spent millennia analyzing the structure of thought. When we name a consolidation engine "Samskaara" -- the process by which raw experience becomes lasting impression -- the name carries the full weight of the concept. It tells you what the module does, why it exists, and what philosophical lineage it follows.

---

## Where This Is Going

The vision is an AI that gets meaningfully better with every session you use it. Not through expensive fine-tuning, but through structured learning at the memory layer:

- **Bi-temporal edges** ensure corrections never lose history
- **Consolidation** turns patterns into persistent knowledge
- **Multi-round retrieval** handles the complex questions that matter most
- **Sinkhorn compaction** keeps memory bounded without losing what matters
- **Thompson Sampling** adapts scoring to individual users over time

We are building toward an agent that remembers your preferences, learns your patterns, corrects its mistakes permanently, and gets better at finding what you need. Not a chatbot with a transcript log -- a system with actual memory.

Chitragupta's Smriti package is open-source and written in TypeScript. The algorithms described here are implemented, tested, and shipping. If you are building agent systems and want memory that actually works, we would love your feedback and contributions.

-- - [GitHub Repository](https://github.com/sriinnu/auriva) | [Documentation](https://auriva.agentiqx.ai) | [Join the Discussion](https://discord.gg/auriva)
---

*Inspired by the survey ["Graph-based Agent Memory: Taxonomy, Techniques, and Applications"](https://arxiv.org/html/2602.05665v1). Built with TypeScript, zero external ML dependencies for the core algorithms, and a deep appreciation for what the Vedic tradition can teach us about the architecture of mind.*
