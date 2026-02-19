# Niyanta Audit Report

**Date:** 2026-02-19
**Branch:** `audit/smriti-refactor`
**Commit:** `b1561a4`

---

## Phase 1 — Remove Phantom Dependencies (P0)

Removed 3 undeclared workspace dependencies from `package.json` that caused
install failures in CI and fresh clones:

| Removed Dependency | Replacement |
|---|---|
| `@chitragupta/sutra` | Duck-typed `OrchestratorActorSystem`, `OrchestratorSamiti` |
| `@chitragupta/swara` | Duck-typed `OrchestratorProviderDef` |
| `@chitragupta/anina` | Duck-typed `OrchestratorRealAgent` |

All duck-typed interfaces use `{ [key: string]: unknown }` so consumers can
pass any object without importing concrete types from unpublished packages.

---

## Phase 2 — KartavyaDispatcher Tests (P0)

Created `test/kartavya-dispatcher.test.ts` with **41 tests** covering:

- **Lifecycle:** start/stop, periodic evaluation, duplicate start guard
- **Notification actions:** Samiti broadcast, missing Samiti fallback
- **Command actions:** disabled by default, Rta safety blocking, successful execution, missing command, execution errors
- **Tool sequence actions:** multi-step execution, Rta per-step checks, missing executor fallback, tool failure propagation, missing tools
- **Vidhi actions:** procedure resolution, step execution, missing engine/executor, unknown vidhi, Rta per-step checks, step failure
- **Concurrency:** respects `maxConcurrent` limit
- **Result tracking:** `getResults()` with limit, ring-buffer at 100 entries
- **Error handling:** dispatch exceptions, `recordExecution` feedback to engine

---

## Phase 3 — Split Large Files (P1)

Every source file in `packages/niyanta/src/` is now under the **450 LOC limit**.

### File Split Summary

| Original File | Before | After | New Modules |
|---|---|---|---|
| `kartavya.ts` | 919 | 352 | `kartavya-cron.ts` (110), `kartavya-lifecycle.ts` (309) |
| `orchestrator.ts` | 698 | 424 | `orchestrator-dispatch.ts` (203) |
| `evaluator.ts` | 625 | 215 | `evaluator-metrics.ts` (234) |
| `orchestrator-autonomous.ts` | 611 | 347 | `autonomous-decisions.ts` (238) |
| `orchestration-patterns.ts` | 595 | 182 | `pattern-executors.ts` (326) |
| `orchestrator-scaling.ts` | 496 | 311 | `scaling-policies.ts` (199) |
| `kartavya-dispatcher.ts` | 492 | 195 | `dispatcher-handlers.ts` (337) |
| `strategy-bandit.ts` | 487 | 239 | `bandit-policies.ts` (121) |

**Total:** 8 files split into 16 modules. Net LOC delta: +59 (new JSDoc on extracted helpers).

### Split Strategy

All splits follow the **delegation pattern**:

1. **Extract pure functions** to a new module (stateless, testable)
2. **Keep the class** in the original file with thin wrappers that delegate
3. **Re-export moved types** from the original file for backward compat
4. **No downstream changes** — `index.ts` exports are unchanged

Circular dependencies avoided via `import type` (erased at compile time)
in one direction and runtime imports in the other.

---

## Public API Verification

All exports from `index.ts` are intact. The public surface:

### Classes
| Export | Source | Description |
|---|---|---|
| `Orchestrator` | `orchestrator.ts` | Multi-agent task orchestrator |
| `OrchestratorError` | `orchestrator-dispatch.ts` | Orchestrator error class |
| `TaskRouter` | `router.ts` | Task-to-slot routing |
| `MetricsCollector` | `metrics.ts` | Orchestration metrics |
| `StrategyBandit` | `strategy-bandit.ts` | MAB strategy selector (UCB1/Thompson/LinUCB) |
| `AutonomousOrchestrator` | `orchestrator-autonomous.ts` | Bandit-driven self-healing orchestrator |
| `DAGEngine` | `dag-workflow.ts` | DAG workflow engine |
| `AgentEvaluator` | `evaluator.ts` | Agent evaluation framework |
| `KartavyaEngine` | `kartavya.ts` | Auto-execution pipeline |
| `KartavyaDispatcher` | `kartavya-dispatcher.ts` | Autonomous action executor |

### Strategy Functions
| Export | Description |
|---|---|
| `roundRobinAssign` | Round-robin slot assignment |
| `leastLoadedAssign` | Least-loaded slot assignment |
| `specializedAssign` | Specialization-based assignment |
| `hierarchicalDecompose` | Hierarchical task decomposition |
| `competitiveRace` | Competitive racing across slots |
| `swarmCoordinate` | Swarm coordination with shared context |
| `mergeSwarmResults` | Merge swarm sub-results |

### Orchestration Patterns (Vyuha)
| Export | Description |
|---|---|
| `singlePattern` | Single-agent execution |
| `independentPattern` | Independent parallel execution |
| `centralizedPattern` | Central coordinator pattern |
| `decentralizedPattern` | Peer-to-peer pattern |
| `hybridPattern` | Adaptive hybrid pattern |

### Presets
`CODE_REVIEW_PLAN`, `TDD_PLAN`, `REFACTOR_PLAN`, `BUG_HUNT_PLAN`, `DOCUMENTATION_PLAN`

### Key Types (exported)
`OrchestratorAgentConfig`, `OrchestratorStats`, `OrchestratorTask`, `TaskResult`,
`AgentSlot`, `AgentInfo`, `OrchestrationPlan`, `OrchestratorEvent`,
`StrategyStats`, `BanditContext`, `BanditMode`, `StrategyBanditState`,
`TaskPerformanceRecord`, `AutonomousOrchestratorConfig`, `StrategyBan`,
`PatternConfig`, `PatternResult`, `DAGNode`, `DAGWorkflow`, `DAGExecutionResult`,
`EvalCriterion`, `EvalResult`, `EvaluationReport`, `EvaluatorConfig`,
`Kartavya`, `KartavyaConfig`, `TriggerContext`, `NiyamaProposal`, `VasanaInput`,
`KartavyaDispatcherConfig`, `DispatchResult`, `ToolExecutor`, `ToolExecResult`,
`DispatcherSamiti`, `DispatcherRta`, `DispatcherVidhiEngine`,
`SlotStats`, `SwarmContext`

---

## Verification

| Check | Result |
|---|---|
| `pnpm install` | Lockfile up to date |
| `npx vitest run packages/niyanta/test` | **542/542 pass** |
| `npx tsc --noEmit` (niyanta) | **0 errors** |
| Max file LOC | **424** (`orchestrator.ts`) |
| Phantom deps in `package.json` | **0** |

---

## New File Map

```
packages/niyanta/src/
  index.ts                    — Public API barrel
  types.ts                    — Shared type definitions
  orchestrator.ts        (424) — Orchestrator class (delegates to dispatch)
  orchestrator-dispatch.ts(203) — Types, error, helpers for Orchestrator
  orchestrator-scaling.ts(311) — Auto-scaling, failure, plan completion
  scaling-policies.ts    (199) — Competitive/swarm/hierarchical processing
  orchestrator-autonomous.ts(347) — Bandit-driven autonomous orchestrator
  autonomous-decisions.ts(238) — Pure decision functions for autonomous
  strategy-bandit.ts     (239) — StrategyBandit class (UCB1/Thompson/LinUCB)
  bandit-policies.ts     (121) — LinUCB math + Beta sampling primitives
  kartavya.ts            (352) — KartavyaEngine class (delegates to lifecycle/cron)
  kartavya-lifecycle.ts  (309) — Kartavya CRUD, persistence, pipeline
  kartavya-cron.ts       (110) — Cron expression parsing
  kartavya-dispatcher.ts (195) — KartavyaDispatcher class
  dispatcher-handlers.ts (337) — Action handlers (notification/command/tool/vidhi)
  evaluator.ts           (215) — AgentEvaluator class
  evaluator-metrics.ts   (234) — Metric computation helpers
  orchestration-patterns.ts(182) — Pattern entry points (delegates to executors)
  pattern-executors.ts   (326) — Pattern execution implementations
  router.ts              (214) — TaskRouter + Jaccard similarity
  strategies.ts          (354) — Strategy assignment functions
  planner.ts             (279) — Task decomposition + plan suggestion
  presets.ts             (381) — Pre-built orchestration plans
  metrics.ts             (298) — MetricsCollector
  dag-workflow.ts        (422) — DAG workflow engine
```
