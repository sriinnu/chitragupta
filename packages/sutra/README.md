# @chitragupta/sutra

![Logo](../../assets/logos/sutra.svg)

**सूत्र (sutra) -- Thread / Formula**

**Inter-agent communication hub with 4-lane mailboxes, SWIM gossip, pub/sub, Samiti ambient channels, Sabha multi-agent deliberation, Sandesha input routing, and Banker's deadlock prevention.**

Sutra is Chitragupta's communication fabric. When multiple agents work together -- whether in a fan-out pattern, a pipeline, a map-reduce job, a distributed saga, or a gossip protocol -- Sutra provides the primitives. The `CommHub` manages channels, locks, semaphores, barriers, and shared memory regions. **Samiti** provides persistent, topic-based ambient channels for collective intelligence. **Sabha** implements a structured deliberation protocol based on Nyaya logic for multi-agent decision-making. Built-in patterns handle the most common multi-agent coordination scenarios, including deadlock detection, resolution, and prevention.

---

## Key Features

- **Communication hub** -- `CommHub` central message broker with typed channels and envelopes
- **Channels** -- Named message channels for agent-to-agent communication
- **Synchronization** -- Locks, semaphores, and barriers for coordination
- **Shared memory** -- Named memory regions for inter-agent data sharing
- **Samiti ambient channels** -- Persistent, topic-based channels with ring buffers, severity/time filtering, TTL pruning, real-time listeners, and 5 default channels (#security, #performance, #correctness, #style, #alerts)
- **Sabha deliberation** -- Multi-agent deliberation protocol based on Nyaya logic with Panchavayava (5-limbed syllogism), Hetvabhasa fallacy detection (5 classical fallacies), weighted voting, and consensus thresholds
- **Deadlock detection** -- `detectDeadlocks()` finds circular lock dependencies, `resolveDeadlock()` breaks them
- **Deadlock prevention** -- `BankersAlgorithm` proactively ensures the system never enters an unsafe state (Dijkstra's Banker's Algorithm)
- **Coordination patterns** -- `fanOut`, `pipeline`, `mapReduce`, `saga`, `election`, `gossip`
- **Input routing** -- `SandeshaRouter` routes sub-agent input requests with FIFO queue, timeouts, and parent interception

## Architecture

| Module | Purpose |
|--------|---------|
| `types.ts` | `AgentEnvelope`, `Channel`, `Lock`, `Semaphore`, `Barrier`, `SharedMemoryRegion`, `HubConfig`, `HubStats`, `SagaStep`, `ResultCollector` |
| `hub.ts` | `CommHub` -- central communication broker |
| `deadlock.ts` | `detectDeadlocks()`, `resolveDeadlock()` |
| `deadlock-prevention.ts` | `BankersAlgorithm` -- proactive deadlock prevention via safe-state analysis |
| `patterns.ts` | `fanOut`, `pipeline`, `mapReduce`, `saga`, `election`, `gossip` |
| `sandesha.ts` | `SandeshaRouter` -- sub-agent input routing with FIFO queue and timeouts |
| `samiti.ts` | **NEW** -- `Samiti` -- ambient communication channels with ring buffers, TTL, real-time listeners |
| `sabha.ts` | **NEW** -- `SabhaEngine` -- multi-agent deliberation with Nyaya logic, fallacy detection, weighted voting |

## Samiti -- Ambient Communication Channels

Named after the Vedic samiti -- the assembly of the people, where every voice echoes through the hall and the wisest words linger longest. Samiti provides persistent, topic-based channels where agents broadcast observations (security findings, performance regressions, style violations) and other agents or systems listen asynchronously.

**Key design:**
- Ring buffer storage (bounded history per channel)
- FNV-1a deterministic message IDs
- Lazy TTL pruning on read
- Real-time listener callbacks with error isolation
- 5 default channels: `#security`, `#performance`, `#correctness`, `#style`, `#alerts`
- Configurable hard ceilings: max 100 channels, 10K messages/channel, 1MB/message, 50 subscribers/channel

```typescript
import { Samiti } from "@chitragupta/sutra";
import type { SamitiMessage, SamitiChannel, ListenOptions } from "@chitragupta/sutra";

const samiti = new Samiti({ maxChannels: 20, defaultMaxHistory: 100 });

// Listen for security alerts in real-time
const unsub = samiti.onMessage("#security", (msg) => {
  if (msg.severity === "critical") escalate(msg);
});

// Broadcast a finding
const msg = samiti.broadcast("#security", {
  sender: "anveshi-agent",
  severity: "warning",
  category: "credential-leak",
  content: "Hardcoded API key detected in config.ts:42",
});

// Query recent critical alerts
const criticals = samiti.listen("#security", {
  severity: "critical",
  since: Date.now() - 3_600_000,
  limit: 10,
});

// Subscribe/unsubscribe agents to channels
samiti.subscribe("#performance", "monitor-agent");
samiti.unsubscribe("#performance", "monitor-agent");

// Create custom channels
samiti.createChannel("#deployment", "Deployment events and rollbacks", 200);

// Prune expired messages across all channels
const pruned = samiti.pruneExpired();

// Get system stats
const stats = samiti.stats();
console.log(stats.channels, stats.totalMessages, stats.subscribers);

unsub(); // Clean up real-time listener
samiti.destroy(); // Full cleanup
```

## Sabha -- Multi-Agent Deliberation Protocol

In the Vedic tradition, a Sabha is the assembly hall where learned scholars gather under strict procedural discipline to debate matters of dharma, artha, and nyaya. The `SabhaEngine` provides structured deliberation for multi-agent decision-making.

**Protocol flow:**
```
convene() -> propose(Panchavayava) -> challenge(Hetvabhasa) -> respond()
    |                                                           |
  vote(weighted) <----------------------------------------------
    |
conclude() -> accepted | rejected | escalated
```

**Weighted voting formula:**
```
weightedScore = SUM(vote.weight * sign(position))
normalizedScore = weightedScore / SUM(|vote.weight|)
verdict = score >= threshold -> accepted
          score <= -threshold -> rejected
          else -> no-consensus (escalated)
```

**Five Hetvabhasa (logical fallacies) detected via zero-cost NLU:**

| Fallacy | Sanskrit | Detection Method |
|---------|----------|------------------|
| Unestablished | Asiddha | Hetu keywords not grounded in udaharana |
| Contradictory | Viruddha | Hetu negation overlapping with pratijna |
| Inconclusive | Anaikantika | Over-broad universal quantifiers in hetu |
| Circular | Prakarana-sama | Jaccard similarity > 0.8 between pratijna and nigamana |
| Untimely | Kalatita | Past-tense hetu with future-oriented pratijna |

```typescript
import { SabhaEngine } from "@chitragupta/sutra";
import type { Sabha, NyayaSyllogism, SabhaParticipant } from "@chitragupta/sutra";

const engine = new SabhaEngine({ maxRounds: 3, consensusThreshold: 0.67 });

// Convene an assembly
const sabha = engine.convene("Should we refactor the auth module?", "orchestrator", [
  { id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
  { id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
  { id: "anveshi", role: "observer", expertise: 0.7, credibility: 0.8 },
]);

// Submit a proposal using the Panchavayava (5-limbed syllogism)
engine.propose(sabha.id, "kartru", {
  pratijna: "The auth module should be refactored.",
  hetu: "Because it has accumulated technical debt and high cyclomatic complexity.",
  udaharana: "Wherever modules have high complexity, refactoring improves maintainability, as in the payment module.",
  upanaya: "The auth module has high cyclomatic complexity.",
  nigamana: "Therefore, the auth module should be refactored.",
});

// Challenge a step (auto-checks for logical fallacies)
const challenge = engine.challenge(sabha.id, "parikshaka", "hetu",
  "The complexity metric alone does not justify the cost of refactoring.");

// Respond to challenge
engine.respond(sabha.id, 0, "The complexity is coupled with 12 known bugs in this module.");

// Cast weighted votes
engine.vote(sabha.id, "kartru", "support", "Proposer stands by the argument.");
engine.vote(sabha.id, "parikshaka", "support", "Response addressed the concern.");
engine.vote(sabha.id, "anveshi", "support", "Evidence is convincing.");

// Conclude and get verdict
const concluded = engine.conclude(sabha.id);
console.log(concluded.finalVerdict); // "accepted"

// Get a human-readable explanation
const explanation = engine.explain(sabha.id);
console.log(explanation);
```

## Communication Hub

```typescript
import { CommHub } from "@chitragupta/sutra";
import type { HubConfig } from "@chitragupta/sutra";

const hub = new CommHub({
  maxChannels: 100,
  maxLocks: 50,
});

// Create a channel
const channel = hub.createChannel("code-review");

// Send a message
hub.send("code-review", {
  from: "orchestrator",
  to: "reviewer-1",
  payload: { file: "src/parser.ts", action: "review" },
});

// Receive messages
const envelope = await hub.receive("code-review", "reviewer-1");
console.log(envelope.payload);

// Get hub statistics
const stats: HubStats = hub.stats();
```

### Coordination Patterns

```typescript
import {
  fanOut,
  pipeline,
  mapReduce,
  saga,
  election,
  gossip,
} from "@chitragupta/sutra";

// Fan-out: distribute work to multiple agents
const results = await fanOut(hub, {
  task: "Review these files",
  agents: ["reviewer-1", "reviewer-2", "reviewer-3"],
  files: ["a.ts", "b.ts", "c.ts"],
});

// Pipeline: sequential processing through agents
const output = await pipeline(hub, [
  { agent: "analyzer", task: "Analyze code" },
  { agent: "refactorer", task: "Apply refactoring" },
  { agent: "tester", task: "Run tests" },
]);

// Map-reduce: parallel map, then reduce
const summary = await mapReduce(hub, {
  mapAgents: ["worker-1", "worker-2"],
  reduceAgent: "aggregator",
  data: chunks,
});

// Saga: distributed transaction with compensation
const sagaResult = await saga(hub, [
  {
    agent: "db-agent",
    action: "migrate",
    compensate: "rollback",
  },
  {
    agent: "api-agent",
    action: "deploy",
    compensate: "undeploy",
  },
]);
```

### Deadlock Detection

```typescript
import { detectDeadlocks, resolveDeadlock } from "@chitragupta/sutra";

// Check for deadlocks
const deadlocks = detectDeadlocks(hub);

if (deadlocks.length > 0) {
  for (const dl of deadlocks) {
    console.log(`Deadlock: ${dl.agents.join(" -> ")}`);
    resolveDeadlock(hub, dl);
  }
}
```

### Leader Election and Gossip

```typescript
import { election, gossip } from "@chitragupta/sutra";

// Elect a leader among agents
const leader = await election(hub, {
  candidates: ["agent-1", "agent-2", "agent-3"],
});
console.log(`Leader: ${leader}`);

// Gossip protocol for state dissemination
await gossip(hub, {
  agents: ["agent-1", "agent-2", "agent-3"],
  state: { version: 2, config: updatedConfig },
});
```

### Banker's Algorithm (Deadlock Prevention)

While `deadlock.ts` provides DFS-based deadlock *detection* (a reactive approach -- finding circular lock dependencies after they form), `deadlock-prevention.ts` implements Dijkstra's Banker's Algorithm for deadlock *prevention* (a proactive approach -- ensuring the system never enters an unsafe state in the first place).

Before granting any resource request, the `BankersAlgorithm` class simulates the allocation and checks whether a **safe sequence** exists -- an ordering of all processes where each can complete given currently available resources plus those freed by all previously completed processes. If no safe sequence exists, the request is denied, guaranteeing no deadlock can occur.

```typescript
import { BankersAlgorithm } from "@chitragupta/sutra";
import type { BankerState, RequestResult } from "@chitragupta/sutra";

const banker = new BankersAlgorithm();

// Register system resources
banker.addResource("cpu", 4);
banker.addResource("memory", 8);
banker.addResource("gpu", 2);

// Agents declare their maximum resource needs upfront
banker.declareMaximum("agent-1", { cpu: 2, memory: 4, gpu: 1 });
banker.declareMaximum("agent-2", { cpu: 3, memory: 3, gpu: 1 });

// Request resources -- granted only if the resulting state is safe
const result: RequestResult = banker.requestResource("agent-1", {
	cpu: 1,
	memory: 2,
});

if (result.granted) {
	console.log("Resources allocated to agent-1");
	banker.releaseResource("agent-1", { cpu: 1, memory: 2 });
} else {
	console.log(`Denied: ${result.reason}`);
}

// Check if the current global state is safe
console.log(`System is safe: ${banker.isSafeState()}`);
```

### Input Routing (Sandesha)

```typescript
import { SandeshaRouter } from "@chitragupta/sutra";
import type { InputRequest, InputResponse } from "@chitragupta/sutra";

const router = new SandeshaRouter(hub, {
	defaultTimeout: 30_000,
	maxPending: 10,
});

// Sub-agent requests input
const response = await router.requestInput({
	agentId: "coder-1",
	prompt: "Which test framework? (vitest/jest)",
	defaultValue: "vitest",
	timeout: 15_000,
});

// TUI or parent resolves the request
router.resolveInput(requestId, "vitest");

// Check pending requests
const pending = router.getPendingRequests();
console.log(`${router.pendingCount} requests waiting`);

// Cleanup
router.destroy();
```

---

[Back to Chitragupta root](../../README.md)
