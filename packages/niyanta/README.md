# @chitragupta/niyanta

![Logo](../../assets/logos/niyanta.svg)

**नियन्ता (niyanta) -- Controller**

**Agent orchestrator with task routing, assignment strategies, planning, preset plans, metrics collection, multi-armed bandit strategy selection, autonomous self-healing orchestration, DAG workflow integration, and Kartavya behavioral auto-execution pipeline.**

Niyanta is Chitragupta's controller. When a task is too large or complex for a single agent, Niyanta decomposes it into subtasks, routes each subtask to the best-suited agent, and coordinates execution using one of several strategies -- round-robin, least-loaded, specialized, hierarchical, competitive racing, or swarm coordination. The `TaskRouter` uses Jaccard similarity to match tasks to agent capabilities. The `StrategyBandit` learns which orchestration strategy performs best through online experimentation using UCB1, Thompson Sampling, or LinUCB contextual bandits. The `AutonomousOrchestrator` wires everything together for fully autonomous strategy selection with self-healing, strategy banning, and state persistence. The `KartavyaEngine` provides behavioral auto-execution -- promoting observed patterns (vasanas) through rule proposals (niyamas) into automated duties (kartavyas) triggered by cron schedules, events, thresholds, or pattern matches. Preset plans for common workflows (code review, TDD, refactoring, bug hunting, documentation) are ready to use out of the box.

---

## Key Features

- **Orchestrator** -- `Orchestrator` class manages the full lifecycle of multi-agent task execution
- **Task routing** -- `TaskRouter` matches tasks to agents using `jaccardSimilarity` on capabilities
- **Assignment strategies** -- Round-robin, least-loaded, specialized, hierarchical decomposition, competitive race, swarm coordination
- **Planning** -- `decompose()` breaks tasks into subtasks, `suggestPlan()` recommends an execution plan
- **Preset plans** -- `CODE_REVIEW_PLAN`, `TDD_PLAN`, `REFACTOR_PLAN`, `BUG_HUNT_PLAN`, `DOCUMENTATION_PLAN`
- **Metrics** -- `MetricsCollector` tracks agent performance, latency, success rate, and resource usage
- **Swarm coordination** -- Multi-agent collaborative problem solving with result merging via `mergeSwarmResults()`
- **Strategy bandit** -- `StrategyBandit` with UCB1, Thompson Sampling, and LinUCB contextual bandit for online strategy selection
- **Autonomous orchestration** -- `AutonomousOrchestrator` with bandit-driven selection, strategy banning/cooldown, composite reward, and state persistence
- **DAG workflow integration** -- `DagWorkflow` adapter connecting Vayu's DAG engine with Niyanta's orchestration strategies
- **Task evaluator** -- `TaskEvaluator` for complexity estimation and strategy recommendation
- **Orchestration patterns** -- Pipeline, fan-out/fan-in, map-reduce, saga, and competitive patterns
- **Kartavya auto-execution** -- `KartavyaEngine` for behavioral automation with cron/event/threshold/pattern triggers, niyama proposals, approval pipeline, cooldown enforcement, rate limiting, and SQLite persistence

## Architecture

| Module | Purpose |
|--------|---------|
| `types.ts` | `Task`, `SubTask`, `AgentCapability`, `Plan`, `ExecutionResult`, `OrchestratorConfig` |
| `orchestrator.ts` | `Orchestrator` -- main orchestration engine, `OrchestratorError` |
| `router.ts` | `TaskRouter`, `jaccardSimilarity` -- capability-based task-to-agent matching |
| `strategies.ts` | `roundRobinAssign`, `leastLoadedAssign`, `specializedAssign`, `hierarchicalDecompose`, `competitiveRace`, `swarmCoordinate`, `mergeSwarmResults` |
| `planner.ts` | `decompose()`, `suggestPlan()` |
| `presets.ts` | `CODE_REVIEW_PLAN`, `TDD_PLAN`, `REFACTOR_PLAN`, `BUG_HUNT_PLAN`, `DOCUMENTATION_PLAN` |
| `metrics.ts` | `MetricsCollector` -- performance tracking |
| `strategy-bandit.ts` | `StrategyBandit` -- UCB1, Thompson Sampling, LinUCB contextual bandit for strategy selection |
| `orchestrator-autonomous.ts` | `AutonomousOrchestrator` -- self-healing orchestrator with bandit-driven selection, banning, persistence |
| `orchestrator-scaling.ts` | Scaling utilities for dynamic agent pool management |
| `orchestration-patterns.ts` | Reusable orchestration patterns: pipeline, fan-out, map-reduce, saga, competitive |
| `dag-workflow.ts` | `DagWorkflow` -- adapter connecting Vayu DAG engine with Niyanta orchestration |
| `evaluator.ts` | `TaskEvaluator` -- complexity estimation and strategy recommendation |
| `kartavya.ts` | `KartavyaEngine` -- behavioral auto-execution: niyama proposals, trigger evaluation, cooldown enforcement, SQLite persistence |

## API

### Orchestrator

```typescript
import { Orchestrator } from "@chitragupta/niyanta";

const orchestrator = new Orchestrator({
  agents: [analyzerAgent, coderAgent, testerAgent],
  strategy: "specialized",
  maxConcurrency: 3,
});

const result = await orchestrator.execute({
  description: "Refactor the authentication module",
  requirements: [
    "Extract JWT logic into a service",
    "Add unit tests",
    "Update documentation",
  ],
});

console.log(result.status);    // "completed"
console.log(result.subtasks);  // Individual subtask results
console.log(result.duration);  // Total execution time
```

### Task Router

```typescript
import { TaskRouter, jaccardSimilarity } from "@chitragupta/niyanta";

const router = new TaskRouter([
  { agentId: "coder", capabilities: ["typescript", "refactoring", "testing"] },
  { agentId: "reviewer", capabilities: ["code-review", "security", "best-practices"] },
  { agentId: "docs", capabilities: ["documentation", "markdown", "api-docs"] },
]);

const bestAgent = router.route({
  description: "Write unit tests for the parser",
  requiredCapabilities: ["typescript", "testing"],
});
// bestAgent === "coder"

// Direct similarity computation
const sim = jaccardSimilarity(
  new Set(["typescript", "testing"]),
  new Set(["typescript", "refactoring", "testing"])
);
// sim === 0.666...
```

### Assignment Strategies

```typescript
import {
  roundRobinAssign,
  leastLoadedAssign,
  specializedAssign,
  hierarchicalDecompose,
  competitiveRace,
  swarmCoordinate,
  mergeSwarmResults,
} from "@chitragupta/niyanta";

// Round-robin: distribute tasks evenly
const assignment = roundRobinAssign(tasks, agents);

// Least-loaded: assign to the agent with the lightest load
const agent = leastLoadedAssign(task, agents, loadStats);

// Specialized: match by capability similarity
const specialist = specializedAssign(task, agents);

// Hierarchical: decompose and assign recursively
const plan = await hierarchicalDecompose(complexTask, agents);

// Competitive: race multiple agents, take the first result
const winner = await competitiveRace(task, agents);

// Swarm: collaborative multi-agent problem solving
const swarmCtx = await swarmCoordinate(task, agents);
const merged = mergeSwarmResults(swarmCtx);
```

### Planning

```typescript
import { decompose, suggestPlan } from "@chitragupta/niyanta";

// Decompose a complex task into subtasks
const subtasks = await decompose(
  "Build a REST API with authentication and testing"
);

// Get a suggested execution plan
const plan = await suggestPlan(subtasks, availableAgents);
console.log(plan.steps);    // Ordered execution steps
console.log(plan.strategy); // Recommended strategy
```

### Preset Plans

```typescript
import {
  CODE_REVIEW_PLAN,
  TDD_PLAN,
  REFACTOR_PLAN,
  BUG_HUNT_PLAN,
  DOCUMENTATION_PLAN,
} from "@chitragupta/niyanta";

const orchestrator = new Orchestrator({ agents, strategy: "specialized" });

// Use a preset plan
await orchestrator.executePlan(CODE_REVIEW_PLAN, {
  target: "src/",
});
```

### Metrics

```typescript
import { MetricsCollector } from "@chitragupta/niyanta";

const metrics = new MetricsCollector();

metrics.recordTaskStart("agent-1", "task-1");
// ... agent works ...
metrics.recordTaskComplete("agent-1", "task-1", { success: true });

const report = metrics.report();
console.log(report.agentStats);   // Per-agent statistics
console.log(report.totalTasks);   // Total tasks processed
console.log(report.avgLatency);   // Average task duration
```

### Multi-Armed Bandit Strategy Selection

`StrategyBandit` learns which orchestration strategy performs best through online experimentation. It implements three complementary bandit algorithms, switchable at runtime:

**1. UCB1 (Upper Confidence Bound)** -- deterministic optimism in the face of uncertainty:

```
score(a) = mu(a) + c * sqrt( ln(N) / n(a) )
```

where `mu(a)` is the average reward of strategy `a`, `N` is total plays, `n(a)` is plays of strategy `a`, and `c` is the exploration constant (default `sqrt(2)`). Achieves O(ln N) regret -- provably optimal for the stochastic bandit setting (Auer et al., 2002). Unplayed strategies receive infinite score for forced exploration.

**2. Thompson Sampling** -- Bayesian exploration:

Each strategy maintains a `Beta(alpha, beta)` posterior distribution. On each round, a sample is drawn from each posterior and the highest wins. After observing reward `r` in [0, 1]: `alpha += r`, `beta += (1 - r)`. Thompson Sampling is Bayes-optimal and empirically matches or beats UCB1 in most settings.

**3. LinUCB (Contextual Linear Bandit)** -- context-aware selection:

```
score(a, x) = x^T * theta_a + alpha * sqrt( x^T * A_a^{-1} * x )
```

where `x` is a 6-dimensional feature vector `[bias, taskComplexity, agentCount, memoryPressure, avgLatency, errorRate]`, and `A_a = I + SUM(x_i * x_i^T)`. Uses Cholesky decomposition for numerically stable solves. From Li et al. (2010), "A contextual-bandit approach to personalized news article recommendation."

**API surface:**

- `selectStrategy(context?)` -- pick the best strategy using the current mode
- `recordReward(strategy, reward, context?)` -- update the model with observed reward in [0, 1]
- `getStats()` -- per-strategy statistics (`plays`, `averageReward`, `ucb1Score`, `alpha`, `beta`)
- `setMode(mode)` -- switch between `"ucb1"`, `"thompson"`, `"linucb"` at runtime
- `serialize()` / `deserialize(state)` -- persist and restore all learned state (including LinUCB matrices)

```typescript
import { StrategyBandit } from "@chitragupta/niyanta";
import type { BanditContext } from "@chitragupta/niyanta";

const bandit = new StrategyBandit();
bandit.setMode("linucb"); // or "ucb1" or "thompson"

// Build context features from the current environment
const context: BanditContext = {
	taskComplexity: 0.7,
	agentCount: 0.4,
	memoryPressure: 0.2,
	avgLatency: 0.5,
	errorRate: 0.1,
};

// Select a strategy
const strategy = bandit.selectStrategy(context);
console.log(`Selected: ${strategy}`);

// ... execute task with the selected strategy ...

// Record the outcome
bandit.recordReward(strategy, 0.85, context);

// Inspect learned statistics
const stats = bandit.getStats();
for (const s of stats) {
	console.log(`${s.name}: avg=${s.averageReward.toFixed(3)}, plays=${s.plays}`);
}

// Persist and restore
const state = bandit.serialize();
const newBandit = new StrategyBandit();
newBandit.deserialize(state); // warm start, no re-exploration needed
```

### Autonomous Orchestrator

`AutonomousOrchestrator` wires the `StrategyBandit` into the orchestration loop for fully autonomous strategy selection. It learns which strategies work best through bandit feedback, self-heals by retrying with different strategies on failure, and persists its learned state across sessions.

**Reward computation** -- after each task, a composite reward in [0, 1] is computed:

```
reward = successWeight * success
       + speedWeight * max(0, 1 - actualTime / expectedTime)
       + costWeight * max(0, 1 - actualCost / budgetCost)
```

Default weights: success 0.5, speed 0.3, cost 0.2. All configurable.

**Strategy banning** -- when a strategy's failure rate exceeds `banFailureThreshold` (default 0.5) over at least `banMinTasks` (default 10) tasks, it is temporarily banned for `banDurationMs` (default 5 minutes). Expired bans are auto-pruned. If all strategies are banned, falls back to `"round-robin"`.

**Task complexity estimation** -- uses a weighted combination of description length (0.25), dependency count (0.20), priority weight (0.25), and keyword-based analysis (0.30) with known complexity keywords (`refactor: 0.8`, `rewrite: 0.9`, `migrate: 0.85`, `test: 0.5`, etc.).

**Persistence** -- `saveState()` / `loadState()` serialize bandit state, performance history, and active bans to JSON. Auto-save triggers every `autoSaveInterval` tasks (default 10).

```typescript
import { AutonomousOrchestrator } from "@chitragupta/niyanta";
import type { AutonomousOrchestratorConfig } from "@chitragupta/niyanta";

const auto = new AutonomousOrchestrator({
	banditMode: "linucb",
	successWeight: 0.5,
	speedWeight: 0.3,
	costWeight: 0.2,
	banFailureThreshold: 0.5,
	banMinTasks: 10,
	banDurationMs: 300_000,
	autoSaveInterval: 10,
	autoSavePath: ".chitragupta/bandit-state.json",
});

// Restore learned state from a previous session
await auto.loadState(".chitragupta/bandit-state.json");

// Select the best strategy for a task
const strategy = auto.selectStrategy(task, orchestratorStats);
console.log(`Using strategy: ${strategy}`);

// ... execute the task with the selected strategy ...

// Record the outcome -- updates bandit, checks bans, triggers auto-save
auto.recordOutcome(task, result, strategy);

// Inspect strategy performance
const stats = auto.getBanditStats();
for (const s of stats) {
	console.log(`${s.name}: avg=${s.averageReward.toFixed(3)}, plays=${s.plays}`);
}

// View active bans
const bans = auto.getActiveBans();
for (const ban of bans) {
	console.log(`BANNED: ${ban.strategy} -- ${ban.reason} (expires ${new Date(ban.expiresAt).toISOString()})`);
}

// Manually lift a ban
auto.unbanStrategy("swarm");

// Get per-strategy performance history
const history = auto.getPerformanceHistory("specialized");

// Persist learned state
await auto.saveState(".chitragupta/bandit-state.json");
```

## Kartavya -- Behavioral Auto-Execution

Kartavya (कर्तव्य -- Duty/Obligation) represents the highest level of behavioral automation in Chitragupta's promotion chain:

```
samskara (observation)  -->  vasana (crystallized tendency)
  -->  niyama (proposed rule)  -->  kartavya (auto-executed duty)
```

A kartavya is a repeatable action triggered by cron schedules, events, threshold conditions, or pattern matches. Kartavyas are promoted from vasanas through an explicit approval pipeline (or auto-approved when confidence is extremely high).

**Lifecycle:**
```
proposed --> approved --> active --> paused --> retired
                                     |
                                  completed / failed
```

**Four trigger types:**

| Trigger | Description | Example |
|---------|-------------|---------|
| `cron` | Time-based scheduling | `"0 */2 * * *"` (every 2 hours) |
| `event` | React to named events | `"file:saved"`, `"test:failed"` |
| `threshold` | Fire when a metric crosses a value | `"error_rate > 0.1"` |
| `pattern` | Match against recent activity patterns | `"lint.*fix.*commit"` |

**Four action types:**

| Action | Description |
|--------|-------------|
| `tool_sequence` | Execute a sequence of tools |
| `vidhi` | Run a stored Vidhi procedure |
| `command` | Execute a shell command |
| `notification` | Send an alert or notification |

**Safety features:**
- Two-tier config: user defaults clamped by system hard ceilings (max 100 active, max 60/hour, min 10s cooldown)
- FNV-1a hashed deterministic IDs
- Rate limiting with per-kartavya cooldowns
- Auto-promotion requires confidence >= 0.95
- SQLite-compatible persistence via duck-typed DatabaseLike interface

```typescript
import { KartavyaEngine } from "@chitragupta/niyanta";
import type {
	Kartavya,
	NiyamaProposal,
	KartavyaConfig,
	TriggerContext,
} from "@chitragupta/niyanta";

const engine = new KartavyaEngine({
	maxActive: 20,
	minConfidenceForProposal: 0.7,
	minConfidenceForAutoApprove: 0.95,
	defaultCooldownMs: 300_000,
	maxExecutionsPerHour: 10,
	enableAutoPromotion: true,
});

// Propose a niyama from a vasana observation
const proposal: NiyamaProposal = engine.proposeNiyama(
	"vasana-abc123",
	"auto-lint",
	"Automatically lint files on save",
	{ type: "event", condition: "file:saved", cooldownMs: 60_000 },
	{ type: "command", payload: { cmd: "npm run lint" } },
	["User runs lint after 95% of file saves"],
);

// Approve the niyama -- becomes an active kartavya
const kartavya: Kartavya = engine.approveNiyama(proposal.id);
console.log(kartavya.status); // "active"

// Evaluate triggers against the current context
const ready = engine.evaluateTriggers({
	now: Date.now(),
	events: ["file:saved"],
	metrics: { error_rate: 0.05 },
	patterns: ["edit lint commit"],
});

for (const k of ready) {
	console.log(`Triggered: ${k.name}`);
}

// Record execution outcomes
engine.recordSuccess(kartavya.id);
engine.recordFailure(kartavya.id);

// Auto-promote vasanas with high confidence
engine.autoPromote([
	{ id: "vas-1", tendency: "format-on-save", description: "Format files", strength: 0.96, predictiveAccuracy: 0.95 },
]);

// Pause/retire kartavyas
engine.pause(kartavya.id);
engine.retire(kartavya.id);

// List active kartavyas
const active = engine.listActive();
const all = engine.listAll();

// Persist to SQLite (duck-typed interface)
engine.persist(sqliteDb);
engine.restore(sqliteDb);
```

---

[Back to Chitragupta root](../../README.md)
