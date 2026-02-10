# What If We Built AI the Way the Vedas Described the Mind?

*Most AI agent architectures are invented from scratch every year. But the Vedic tradition spent three thousand years building a complete model of mind, memory, knowledge, and consciousness. We stopped inventing and started listening.*

---

Every few months, a new agent framework appears with a new architecture diagram. Boxes and arrows. Perception, reasoning, memory, action. The authors treat these components as if they are being discovered for the first time -- as if nobody has ever sat down and rigorously analyzed what a mind is, how it processes information, where knowledge lives, and what it means for a system to be conscious of its own operation.

Somebody has. Many somebodies, over many centuries.

The Vedic intellectual tradition -- spanning the Upanishads, the Yoga Sutras of Patanjali, the Sankhya Karika of Ishvarakrishna, the Nyaya Sutras of Gautama, and the Bhagavad Gita -- contains what may be the most comprehensive pre-modern model of cognition ever constructed. Not metaphor. Not poetry. A systematic, internally consistent, multi-layered architecture of mind that includes perception, reasoning, self-modeling, memory, knowledge classification, epistemological confidence levels, multi-agent deliberation protocols, and operational health monitoring.

When we set out to build [Chitragupta](https://github.com/sriinnu/chitragupta) -- an open-source TypeScript platform for AI agents -- we did not start with the Vedic texts and work backward. We started with engineering problems: how should memory decay? How should an agent model its own confidence? How should multiple agents deliberate? And we kept arriving at answers that the Vedic tradition had already formalized.

So we stopped fighting it. We adopted the architecture. Not the vocabulary -- the architecture. The Sanskrit names our packages carry are not decoration. They are load-bearing. They encode design constraints that English approximations would lose.

This article lays out the mapping between Vedic cognitive philosophy and modern agent architecture. It is not an analogy. It is a design document.

---

## The Antahkarana Pipeline: A 3,000-Year-Old Processing Architecture

The Sankhya Karika (verses 23-27) and Adi Shankaracharya's Vivekachudamani describe the **Antahkarana** -- the "inner instrument" of cognition -- as having four faculties:

1. **Manas** (mind) -- receives raw sensory input and organizes it into coherent percepts
2. **Buddhi** (intellect) -- discriminates, reasons, and makes decisions
3. **Ahamkara** (ego/I-maker) -- the self-referential faculty that claims ownership: "I did this," "I know this," "this is relevant to me"
4. **Chitta** (memory-field) -- the substrate of all stored impressions, accessible by all other faculties

The processing order is explicit in the texts: Manas perceives, Buddhi evaluates, Ahamkara contextualizes against the self-model, and Chitta stores and retrieves. But Chitta is not a terminal stage -- it feeds back into every other faculty. Buddhi reasons over memories. Ahamkara's self-model is built from accumulated experience in Chitta. Manas interprets new input through the lens of what Chitta already holds.

Now look at a modern agent processing pipeline:

1. **Perception** -- parse user input, tool outputs, environmental signals
2. **Reasoning** -- evaluate, plan, decide on next action
3. **Self-Model** -- assess own confidence, capabilities, limitations, and relevance
4. **Memory** -- store, retrieve, and consolidate experiences across sessions

The structural isomorphism is not approximate. It is exact:

```
Manas     (मनस्)     ->  Perception Layer     (input parsing, tool output processing)
Buddhi    (बुद्धि)    ->  Reasoning Layer      (LLM inference, planning, decision-making)
Ahamkara  (अहंकार)   ->  Self-Model           (confidence, calibration, capability tracking)
Chitta    (चित्त)     ->  Memory System         (sessions, knowledge graph, consolidation)
```

In Chitragupta, this is not a theoretical mapping. It is the actual architecture. The consciousness layer -- **Chetana** -- orchestrates four subsystems per turn: **Bhava** (affective state / arousal), **Dhyana** (attention / salience), **Atma-Darshana** (self-model / metacognition), and **Sankalpa** (intention / goal persistence). The controller calls `beforeTurn()` to extract intentions and track concepts, `afterToolExecution()` to update affect and self-model, and `afterTurn()` to decay salience and advance stale counters. Four faculties. One pipeline. The Antahkarana, in TypeScript.

The critical insight from the Vedic model is the bidirectional relationship between Chitta and the other three faculties. Memory is not a database you query at the end -- it is an active participant in every stage of processing. Our memory package, **Smriti**, feeds into perception (context from prior sessions), reasoning (knowledge graph edges inform decisions), and self-modeling (consolidation rules update the agent's understanding of its own patterns). This bidirectionality is architecturally enforced, not optional.

---

## Karma-Samskara-Vasana: Reinforcement Learning, Circa 200 BCE

The Yoga Sutras of Patanjali (2.12-15, 4.8-11) describe a cycle that governs all learning:

- **Karma** (action) -- the agent acts
- **Samskara** (impression) -- the action leaves a trace in memory
- **Vasana** (tendency) -- repeated impressions crystallize into stable tendencies
- **Future Karma** -- tendencies bias future actions

This cycle is described as **anadi** -- beginningless. There is no "episode zero." The system is always already running, always carrying forward the accumulated weight of prior experience. Patanjali is explicit: vasanas from one life carry into the next (4.9-10). Translated to engineering: the agent's learned tendencies from one deployment persist into the next.

Map this onto reinforcement learning:

```
Karma       (कर्म)     ->  Action         (tool execution, response generation)
Samskara    (संस्कार)   ->  Experience     (recorded outcome in replay buffer)
Vasana      (वासना)     ->  Policy bias    (learned tendencies that shape future actions)
```

The Vedic tradition further classifies karma into three types:

- **Sanchita Karma** -- the total accumulated store of all past actions and their impressions. This is the **replay buffer** -- the complete history of experiences the agent can draw from.
- **Prarabdha Karma** -- the subset of sanchita that is active in the current life/episode. This is the **current episode** -- the experiences actually being processed right now.
- **Kriyamana Karma** -- new actions being performed right now, creating fresh impressions. These are **new traces** being written to the buffer.

In Chitragupta, the consolidation engine **Samskaara** (we use the Sanskrit term deliberately) implements exactly this cycle. It runs five pattern detectors across recent sessions -- tool sequence detection, preference learning, decision tracking, correction learning, and convention detection. Each detected pattern becomes a **samskara** (impression). When the same pattern recurs across multiple sessions, it crystallizes into a **vasana** -- a high-confidence knowledge rule that actively biases future behavior. The confidence model uses temporal decay (unreinforced rules lose 1% confidence per day) and reinforcement (each new observation strengthens the rule), so the cycle is continuous, not episodic.

```
// The Karma-Samskara-Vasana cycle, implemented
engine.consolidate(recentSessions)
  -> detects repeated correction: "user always wants ESM imports"
  -> samskara: { pattern: "esm-imports", confidence: 0.4, sessions: 3 }
  -> ... 5 more sessions reinforce ...
  -> vasana:   { pattern: "esm-imports", confidence: 0.92, sessions: 8 }
  -> future karma: agent defaults to ESM imports without being told
```

The Vedic framework gives us something that vanilla RL does not: a vocabulary for the *ontological status* of learned behavior. A vasana is not just a high-confidence rule. It is a tendency so deeply embedded that the agent may not even be "aware" it is applying it. This distinction matters for debugging and interpretability -- when an agent makes an unexpected decision, you want to know whether it was following a fresh samskara (recent impression, inspectable) or a deep vasana (crystallized tendency, requiring archaeological excavation through the consolidation history).

---

## The Four States of Consciousness: Agent Operational Modes

The Mandukya Upanishad -- twelve verses that the tradition considers sufficient to describe the entire structure of consciousness -- defines four states:

1. **Jagrat** (waking) -- the outward-facing state, processing external stimuli, acting in the world
2. **Svapna** (dream) -- the inward-facing state, where the mind replays, recombines, and processes accumulated experiences without external input
3. **Sushupti** (deep sleep) -- the state of complete quiescence, where individual impressions dissolve into an undifferentiated substrate
4. **Turiya** (the fourth) -- the witness state that observes the other three without participating in any of them

These are not metaphors for "being busy" and "being idle." They are formally distinct operational modes with different cognitive characteristics. And they map directly to agent operational states:

```
Jagrat    (जाग्रत्)   ->  Active Session     (processing user input, executing tools)
Svapna    (स्वप्न)     ->  Dream Cycle        (between-session consolidation, memory replay)
Sushupti  (सुषुप्ति)   ->  Deep Archive       (long-term compression, cold storage)
Turiya    (तुरीय)      ->  Meta-Observer      (system-level monitoring of all other states)
```

The **Svapna cycle** is the killer feature, and it maps to something modern AI research is just beginning to explore: offline memory consolidation. When you sleep, your brain replays the day's experiences, strengthening important connections and discarding noise. This is not idle time -- it is perhaps the most important cognitive process there is.

An AI agent should do the same thing. Between sessions, it should enter Svapna: replay recent interactions, detect cross-session patterns, consolidate impressions into stable knowledge, and discover latent connections between experiences that were separated in time but related in meaning. An agent that runs Svapna consolidation after every session literally gets smarter overnight.

```
// Svapna Consolidation -- the dream cycle
async function svapnaCycle(recentSessions: Session[]): Promise<ConsolidationResult> {
  // 1. Replay: re-examine recent experience
  const patterns = detectPatterns(recentSessions);

  // 2. Recombine: find connections across sessions
  const crossLinks = discoverCrossSessionLinks(patterns);

  // 3. Crystallize: promote recurring patterns to stable knowledge
  const vasanas = crystallizeVasanas(patterns, crossLinks);

  // 4. Prune: decay unreinforced knowledge
  const pruned = decayAndPrune(existingRules, vasanas);

  return { newRules: vasanas, reinforced: crossLinks, pruned };
}
```

Sushupti maps to what any long-running system needs: archival compression. Sessions older than a configurable threshold undergo aggressive compaction -- preserving high-value content (corrections, decisions, preferences) while discarding ephemeral flow. In Chitragupta, this is the Sinkhorn-Knopp compaction layer, which uses an accelerated doubly stochastic matrix to optimally allocate token budgets across the four memory streams. Identity (95% preservation) survives almost intact. Ephemeral flow (30% preservation) dissolves -- not deleted, but compressed into the undifferentiated substrate of deep storage.

Turiya -- the meta-observer -- is the monitoring layer that watches all other states without being any of them. In Chitragupta, this corresponds to the system-level observability: event buses, cognitive reports, health metrics, and the ability to inspect any subsystem's state without perturbing it. The `getCognitiveReport()` method on the Chetana controller assembles data from all four cognitive subsystems into a single view -- the Turiya perspective on the agent's consciousness.

---

## Pramana: Not All Knowledge Is Equal

The Nyaya Sutras of Gautama Rishi (circa 2nd century BCE) open with what may be the most important epistemological assertion in any philosophical tradition: the enumeration of **pramanas** -- valid means of knowledge. The Nyaya school recognizes four:

1. **Pratyaksha** (direct perception) -- knowledge from direct observation. The agent saw the file. The tool returned the output. Confidence: highest.
2. **Anumana** (inference) -- knowledge derived by reasoning from other knowledge. "The build failed after this change, so this change likely caused the failure." Confidence: high but defeasible.
3. **Shabda** (testimony) -- knowledge received from a reliable source. The user told the agent. Documentation states it. Confidence: depends on source reliability.
4. **Anupalabdhi** (non-apprehension) -- knowledge derived from the *absence* of something. "There is no test file for this module" is not a gap in knowledge -- it is itself knowledge. This is Nyaya's most radical contribution: absence is informative.

Most knowledge graphs treat all edges as equivalent. An edge is an edge. But an edge established by direct observation ("the file contains this function -- I read it") is fundamentally more reliable than an edge established by inference ("this module probably depends on that one -- they are in the same directory") or testimony ("the user said they prefer React").

Every edge in Smriti's knowledge graph should carry its pramana type:

```typescript
interface PramanaEdge extends GraphEdge {
  pramana: "pratyaksha" | "anumana" | "shabda" | "anupalabdhi";
  confidence: number;  // base confidence modulated by pramana type
}

// Retrieval weights by pramana type
const PRAMANA_WEIGHTS = {
  pratyaksha:   0.95,  // Direct observation -- highest confidence
  shabda:       0.85,  // Testimony -- reliable but second-hand
  anumana:      0.75,  // Inference -- reasonable but defeasible
  anupalabdhi:  0.70,  // Absence -- valuable but contextual
};
```

The inclusion of **anupalabdhi** is not philosophical indulgence. It is practical. When an agent searches for test coverage and finds none, that absence should be recorded as a positive fact in the knowledge graph: "module X has no tests (anupalabdhi, confidence 0.70, observed 2026-02-09)." This is actionable knowledge. It enables the agent to proactively suggest writing tests, to flag untested modules during review, to track test coverage evolution over time. Systems that model only presence are blind to half the information landscape.

In Chitragupta, this is already partially implemented. The sub-component **Pratyaksha** (direct perception) in the Anina package handles agent self-reflection with heuristic scoring and peer review. The name is not coincidence -- it implements the Nyaya pramana of direct observation applied to the agent's own cognitive state. The full pramana-weighted retrieval system -- where every knowledge graph edge carries its epistemological provenance -- is the natural extension of this foundation.

---

## Sabha: The Agent Parliament

Rig Veda 10.191 -- one of the oldest texts in any Indo-European language -- contains the hymn of unity: *"samani va akutih, samana hrdayani vah"* ("common be your intention, common be your hearts"). This hymn describes the **Sabha** -- the Vedic assembly where decisions are made through structured deliberation, not unilateral decree.

In most multi-agent systems, agents pass messages. Agent A sends a request to Agent B. Agent B responds. Maybe there is a coordinator. But the deliberation structure is ad hoc -- there is no formal protocol for how agents *argue*, how disagreements are resolved, or how expertise affects influence.

The Vedic Sabha, combined with the Nyaya school's five-step syllogism (**Nyaya Panchavayava**), gives us a formal deliberation protocol:

1. **Pratijna** (thesis) -- "I claim that module X should use dependency injection"
2. **Hetu** (reason) -- "Because it has 12 external dependencies that change across environments"
3. **Udaharana** (example) -- "Similar to how module Y was refactored in session 47, reducing test complexity by 60%"
4. **Upanaya** (application) -- "Module X exhibits the same coupling pattern as module Y"
5. **Nigamana** (conclusion) -- "Therefore, module X should use dependency injection"

```
// Sabha Consensus Protocol -- multi-agent deliberation
interface SabhaClaim {
  agent:      string;
  pratijna:   string;          // Thesis
  hetu:       string;          // Reason
  udaharana:  string;          // Supporting example
  upanaya:    string;          // Application to current case
  nigamana:   string;          // Conclusion
  expertise:  number;          // Agent's expertise weight for this domain
  pramana:    PramanaType;     // Epistemological basis of the claim
}

function sabhaDeliberate(claims: SabhaClaim[]): SabhaVerdict {
  // Weight each claim by: expertise * pramana_confidence * argument_completeness
  // Arguments with all 5 steps rank higher than partial arguments
  // Contradictions trigger structured rebuttal rounds
  // Consensus = expertise-weighted agreement above threshold
}
```

In Chitragupta, the orchestration package **Niyanta** (director) already implements multiple coordination strategies: round-robin, least-loaded, specialized routing, hierarchical delegation, competitive evaluation, and swarm patterns. The Sabha protocol extends this by adding *structured argumentation* -- agents do not merely vote or race, they present formally structured arguments that can be evaluated, challenged, and weighted by domain expertise. The P2P Actor Mesh in **Sutra** provides the communication substrate, while the Sabha provides the deliberation logic.

The insight from the Vedic model is that consensus is not voting. It is not even majority rule. It is the emergent alignment of perspectives that have been tested through structured argument. The five-step syllogism forces each agent to make its reasoning explicit, connectable to evidence, and falsifiable. This is qualitatively different from "Agent A says yes, Agent B says no, let the coordinator decide."

---

## Pancha Vritti: Classifying All Data

Yoga Sutra 1.6 defines five **vrittis** (mental fluctuations) that exhaustively classify all mental content:

1. **Pramana** (valid cognition) -- verified, reliable knowledge
2. **Viparyaya** (error) -- knowledge that appears valid but is wrong. In modern terms: hallucination.
3. **Vikalpa** (imagination/conceptual construction) -- ideas that have linguistic existence but no real-world referent. Hypotheticals, plans, what-ifs.
4. **Nidra** (sleep/absence) -- the state of cognitive inactivity. Not "no data" but rather the *active experience* of absence.
5. **Smriti** (memory) -- recalled experience, re-presented to the mind

Patanjali's genius is in the completeness claim: *every* mental content falls into one of these five categories. And his treatment of **Nidra** as an active vritti -- not as mere emptiness, but as a positive cognitive state -- anticipates the Nyaya concept of anupalabdhi. The system is aware that it is not perceiving anything, and that awareness is itself a datum.

For an AI agent, this gives us a data classification taxonomy that is surprisingly practical:

```typescript
type VrittiType =
  | "pramana"    // Verified knowledge -- test passed, file confirmed, output validated
  | "viparyaya"  // Error/hallucination -- generated content that failed verification
  | "vikalpa"    // Hypothetical -- plan, suggestion, unexecuted proposal
  | "nidra"      // Null/absence -- searched and found nothing (this IS data)
  | "smriti";    // Cached/recalled -- retrieved from memory, not freshly observed

interface ClassifiedDatum {
  content: string;
  vritti: VrittiType;
  timestamp: string;
  source: string;
  confidence: number;
}
```

This matters because systems that do not distinguish between pramana and vikalpa will treat a hypothesis with the same weight as a verified fact. Systems that do not track viparyaya will not learn from their hallucinations. And systems that ignore nidra will miss the signal in the silence -- the search that returned nothing, the file that does not exist, the test that was never written.

---

## Triguna: System Health as a Three-Vector, Not a Boolean

The Bhagavad Gita (14.10) states: *"rajas tamas ca abhibhuya sattvam bhavati bharata"* -- "Sometimes sattva predominates over rajas and tamas; sometimes rajas predominates; sometimes tamas." All three qualities are always present. They differ only in proportion.

The three **gunas** (qualities/forces) are:

- **Sattva** (clarity, harmony) -- the system is balanced, responsive, accurate
- **Rajas** (activity, agitation) -- the system is under high load, reactive, potentially over-processing
- **Tamas** (inertia, degradation) -- the system is sluggish, stuck, accumulating technical debt

Most systems model health as a boolean (healthy/unhealthy) or a single scalar (0-100%). The triguna model is richer: a three-component vector where all components are always nonzero and their *ratio* characterizes the system state:

```typescript
interface TrigunaHealth {
  sattva: number;  // 0-1: clarity, accuracy, responsiveness
  rajas:  number;  // 0-1: load, reactivity, resource churn
  tamas:  number;  // 0-1: staleness, error accumulation, degradation
}

// All three always present -- normalize to sum to 1.0
function assessHealth(metrics: SystemMetrics): TrigunaHealth {
  const raw = {
    sattva: computeClarity(metrics),     // response quality, accuracy, cache hit rate
    rajas:  computeAgitation(metrics),    // CPU load, queue depth, retry rate
    tamas:  computeInertia(metrics),      // stale cache ratio, error rate, stuck tasks
  };
  const sum = raw.sattva + raw.rajas + raw.tamas;
  return { sattva: raw.sattva/sum, rajas: raw.rajas/sum, tamas: raw.tamas/sum };
}

// System is never purely "healthy" or "unhealthy" -- it has a character
// sattva-dominant: {0.7, 0.2, 0.1} -> optimal
// rajas-dominant:  {0.2, 0.6, 0.2} -> overworked, needs throttling
// tamas-dominant:  {0.1, 0.2, 0.7} -> degraded, needs intervention
```

In Chitragupta, the affective state system **Bhava** already tracks a multi-dimensional cognitive state: valence, arousal, confidence, and frustration. The triguna model generalizes this to the system level, providing a health characterization that is more nuanced than any single metric and more actionable than a dashboard of disconnected numbers. When rajas dominates, the system should throttle. When tamas dominates, it should self-heal or alert. When sattva dominates, it can operate autonomously with higher confidence thresholds.

---

## Novel Algorithms: Where Philosophy Becomes Code

The mappings above are not theoretical. They produce concrete algorithms that would not have been designed without the philosophical framework:

**Svapna Consolidation** -- The between-session dream cycle where the agent replays recent interactions, discovers cross-session patterns, and crystallizes repeated impressions into stable knowledge rules. In Chitragupta, this is the Samskaara consolidation engine running its five pattern detectors across session history. The Vedic insight: consolidation is not maintenance. It is the primary mechanism of learning.

**Pramana-Weighted Retrieval** -- Every edge in the knowledge graph carries its epistemological provenance (pratyaksha, anumana, shabda, anupalabdhi). During retrieval, edges are weighted by both relevance and pramana type. Direct observations outrank inferences. Inferences outrank testimony. And knowledge from absence (anupalabdhi) is explicitly surfaced rather than silently ignored. This transforms RAG from a relevance-only system into an epistemologically aware one.

**Vasana Crystallization** -- Detecting the moment when a repeated samskara (impression) hardens into a vasana (stable tendency). In the consolidation engine, this is the confidence threshold at which a pattern transitions from "observed tendency" to "behavioral default." The algorithm monitors observation frequency, temporal consistency, and contradiction rate to determine when crystallization has occurred. Once a vasana forms, it persists across sessions with minimal decay -- it becomes part of the agent's character.

**Sabha Consensus Protocol** -- Formal multi-agent deliberation using the Nyaya five-step syllogism. Each participating agent must structure its contribution as a complete argument (thesis, reason, example, application, conclusion), weighted by domain expertise and epistemological basis. Consensus is not majority vote but expertise-weighted convergence through structured argumentation. Disagreements trigger explicit rebuttal rounds rather than silent coordinator overrides.

---

## On Naming: The Dharma Lives in the Sanskrit

A word on our naming convention, because it confuses people who have not read this far.

Internally, every package and sub-component carries a Sanskrit name: Smriti (memory), Samskaara (consolidation), Bhava (affect), Dhyana (attention), Atma-Darshana (self-vision), Sankalpa (intention), Yantra (tool), Dharma (policy), Vayu (workflow), Sutra (communication), Niyanta (orchestrator). The complete list runs to thirty-plus names, each one precisely chosen from the Vedic lexicon.

Externally -- in API surfaces, documentation headers, and CLI commands -- we use English. `smriti.consolidate()`, not `samskaara.sankalita()`. The function signatures are readable by anyone who writes TypeScript.

The Sanskrit carries the dharma internally; the English carries the communication externally.

This is not bilingual decoration. It is a design constraint. When a developer names a new sub-component, they must find the Sanskrit term that captures its essence. This forces precision. You cannot name something "UtilityHelper" in Sanskrit -- the language does not tolerate vagueness about cognitive function. The naming process itself becomes a design review: if you cannot find the right Sanskrit word, you have not understood what you are building.

Every name in Chitragupta's architecture traces back to a specific textual source: Smriti from the Yoga Sutras, Dharma from the Bhagavad Gita, Chetana from the Sankhya Karika, Pramana from the Nyaya Sutras, Sabha from the Rig Veda. The names are citations. They point back to the frameworks that generated the architecture.

---

## Closing: Completing the Circle

Let us be direct about what we are claiming and what we are not.

We are not claiming that the Vedic rishis anticipated neural networks, transformer architectures, or gradient descent. They did not. They had no concept of silicon computation. What they had -- and what we lack -- is three thousand years of disciplined, multi-generational, internally debated analysis of what a mind is, how it processes information, how knowledge should be classified, how memory consolidates, how confidence should be calibrated, and how multiple cognitive agents should deliberate.

Modern AI research is doing the same work. We are building perception systems, reasoning engines, memory architectures, self-models, multi-agent coordination protocols, and knowledge classification taxonomies. We are doing in five years what the Vedic tradition did over fifty generations. And we are doing it without reading their notes.

The Antahkarana is a processing pipeline. The karma-samskara-vasana cycle is a reinforcement learning loop. The four states of consciousness are operational modes. The pramanas are epistemological confidence levels. The pancha vrittis are a data classification taxonomy. The triguna model is a system health vector. The Sabha is a deliberation protocol. The Nyaya syllogism is a structured argumentation format.

These are not analogies we are forcing onto the texts. These are structural isomorphisms that emerge when you take the texts seriously as cognitive architecture specifications -- which is what they were always intended to be.

We are not decorating code with Sanskrit names. We are completing a circle. The architecture follows the philosophy because the philosophy was always about the structure of mind. And mind -- whether biological or artificial -- has structure.

The Yoga Sutras open with *"atha yoga anushasanam"* -- "now, the discipline of yoga." The word **atha** means "now" -- but it implies readiness. It means: the prerequisites have been met, the student is prepared, the teaching can begin.

Three thousand years of cognitive architecture research is sitting in plain text, in Sanskrit, waiting for engineers who are ready to read it.

We think the prerequisites have been met. We think the teaching can begin.

---

*Chitragupta is open-source, written in TypeScript, and available on [GitHub](https://github.com/sriinnu/chitragupta). The Vedic architectural mappings described here are implemented across its packages -- Smriti (memory), Anina (agent), Chetana (consciousness), Samskaara (consolidation), Niyanta (orchestration), Sutra (communication), and Dharma (policy). If you are building agent systems and the framework described here resonates, we would welcome the conversation. Not as converts to a tradition, but as engineers who take good architecture seriously, wherever it comes from.*

---

**Sources cited**: Yoga Sutras of Patanjali (2.12-15, 4.8-11, 1.6); Mandukya Upanishad (verses 1-12); Sankhya Karika of Ishvarakrishna (verses 23-27); Vivekachudamani of Adi Shankaracharya; Nyaya Sutras of Gautama Rishi (Book 1); Bhagavad Gita (14.10); Rig Veda (10.191).
