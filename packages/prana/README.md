# @chitragupta/prana

![Logo](../../assets/logos/prana.svg)

**प्राण (prana) -- Life Force / Vital Breath**

**Workflow DAG engine with topological execution, parallel step processing, worker thread pools (Shramika), 33 Chitragupta node adapters, 8 engine workflow templates, and disk persistence.**

Prana is Chitragupta's workflow motion layer. It drives multi-step workflows forward as directed acyclic graphs (DAGs), validates execution order, computes the critical path, and runs independent steps in parallel where possible. The Shramika worker pool offloads CPU-intensive tasks to Node.js worker threads. Thirty-three Chitragupta node adapters wrap every subsystem (memory, consciousness, skills, security, performance, and bounded research) as Prana step handlers, and eight engine workflow templates encode both lifecycle and research operational pipelines.

---

## Key Features

- **DAG validation** -- `validateDAG()` detects cycles, missing dependencies, and unreachable nodes
- **Topological execution** -- `topologicalSort()` and `getExecutionLevels()` for ordered and parallel execution
- **Critical path analysis** -- `getCriticalPath()` identifies the longest dependency chain
- **Workflow builder** -- Fluent `WorkflowBuilder` and `StepBuilder` for constructing workflows in code
- **Workflow executor** -- `WorkflowExecutor` runs workflows with step-level parallelism and error handling
- **Built-in templates** -- `CODE_REVIEW_WORKFLOW`, `REFACTOR_WORKFLOW`, `BUG_FIX_WORKFLOW`, `DEPLOY_WORKFLOW`
- **Shramika worker pool** -- `WorkerPool` manages Node.js worker threads for CPU-bound parallel execution with task queuing, timeouts, and stats
- **Chitragupta node adapters** -- 33 adapters wrapping subsystem modules as Prana step handlers via `NODE_ADAPTERS` registry and `executeNodeAdapter()`
- **Chitragupta workflow templates** -- 8 engine DAGs: 5 lifecycle workflows plus daemon-first `autoresearch`, `autoresearch-overnight`, and `acp-research-swarm`
- **Persistence** -- Save/load workflows and execution history to disk
- **Visualization** -- `renderDAG()` produces an ASCII representation of the workflow graph

## Architecture

| Module | Purpose |
|--------|---------|
| `types.ts` | `Workflow`, `WorkflowStep`, `StepStatus`, `ExecutionResult` |
| `dag.ts` | `validateDAG()`, `topologicalSort()`, `getExecutionLevels()`, `getCriticalPath()` |
| `executor.ts` | `WorkflowExecutor` -- runs workflows with parallelism |
| `builder.ts` | `WorkflowBuilder`, `StepBuilder` -- fluent workflow construction |
| `templates.ts` | Built-in workflow templates (code review, refactor, bug fix, deploy) |
| `persistence.ts` | `saveWorkflow()`, `loadWorkflow()`, `listWorkflows()`, `saveExecution()`, `loadExecution()`, `listExecutions()` |
| `visualize.ts` | `renderDAG()` -- ASCII workflow visualization |
| `worker-pool.ts` | **Shramika** -- `WorkerPool` for CPU-bound parallel execution with task queuing |
| `chitragupta-nodes.ts` | **33 node adapters** wrapping Chitragupta subsystems as step handlers |
| `chitragupta-workflows.ts` | **7 engine workflow templates** (5 lifecycle workflows plus `autoresearch` and `acp-research-swarm`) |

### Chitragupta Node Adapters (33 adapters)

| Adapter | Subsystem | Purpose |
|---------|-----------|---------|
| `nidra-wake` / `nidra-sleep` | Lifecycle | Wake/sleep the Nidra daemon |
| `vasana-scan` / `vasana-top-n` | Memory | Scan/retrieve behavioral tendencies |
| `swapna-consolidate` | Memory | Run memory consolidation (pattern detection + compression) |
| `akasha-deposit` | Memory | Deposit consolidated data into long-term GraphRAG |
| `kala-chakra-context` | Context | Gather temporal/context window state |
| `chetana-state` | Consciousness | Gather Chetana consciousness state |
| `triguna-health` | Health | Gather Triguna system health metrics |
| `skill-stats` / `memory-stats` | Stats | Gather skill ecosystem and memory statistics |
| `merge-report` / `format-output` | Reporting | Merge + format multi-step report output |
| `vimarsh-analyze` | Shiksha | NLU analysis for skill learning |
| `praptya-source` / `nirmana-build` | Shiksha | Source discovery and skill construction |
| `suraksha-scan` / `register-skill` | Shiksha | Security scan and registry enrollment |
| `rakshaka-security` | Guardian | Rta/Dharma security sweep |
| `gati-performance` | Guardian | Process memory and performance analysis |
| `satya-correctness` | Guardian | Correctness validation checks |
| `merge-findings` / `sabha-deliberation` | Guardian | Merge findings and Sabha-style deliberation |
| `apply-fixes` | Guardian | Apply recommended fixes from deliberation |
| `health-report` | Lifecycle | Generate final health report |
| `learning-check` | Lifecycle | Check for pending learning opportunities |
| `autoresearch-scope` / `autoresearch-baseline` / `autoresearch-run` / `autoresearch-evaluate` / `autoresearch-record` | Research | Bound, execute, score, and persist daemon-first experiment loops |
| `acp-research-council` | Sutra / Sabha | Run ACP-style peer-council planning and skepticism before experiments through the daemon contract |
| `pakt-pack-research-context` | Compression | Pack research context with engine-owned PAKT through the daemon compression surface when available |

Research nodes keep one canonical project/session path:
- the daemon session binds to the canonical project root
- `researchCwd` may narrow execution inside that project, but may not escape it
- optional `researchParentSessionId` and `researchSessionLineageKey` propagate lineage into the engine session ledger
- `route.resolveBatch` is used for the bounded workflow lane plus the execution lane so Prana does not rebuild route policy locally
- bounded research records now also persist git provenance (`gitBranch`, `gitHeadCommit`, `gitDirtyBefore`, `gitDirtyAfter`) and fail closed when git refs mutate during a bounded run
- packed research context can now be normalized or unpacked on the read side through daemon compression methods instead of being recursively nested
- the returned execution envelope now preserves the selected provider/model pair and the preferred allowed set for the bounded run
- daemon `compression.pack_context` is authoritative while the daemon is reachable

### Chitragupta Workflow Templates (7 templates)

| Template | ID | Description | Steps |
|----------|----|-------------|-------|
| **Consolidation** | `consolidation` | Nidra sleep cycle: wake, scan vasanas, consolidate, deposit to Akasha, sleep | 6 |
| **Self-Report** | `self-report` | Atman self-assessment: parallel collection of consciousness, health, tendencies, skills, memory -- merged into unified report | 7 |
| **Learning** | `learning` | Shiksha pipeline: Vimarsh NLU -> Praptya source -> Nirmana build -> Suraksha scan -> Register | 5 |
| **Guardian Sweep** | `guardian-sweep` | Lokapala sweep: parallel security/performance/correctness -> merge -> Sabha deliberation -> apply fixes | 6 |
| **Full Cycle** | `full-cycle` | Complete lifecycle: self-report -> guardian sweep -> consolidation -> learning check -> health report | 5 |
| **Autoresearch** | `autoresearch` | Bounded experiment loop: scope -> ACP/Sabha council -> baseline -> run -> evaluate -> PAKT pack -> record | 7 |
| **Autoresearch Overnight** | `autoresearch-overnight` | Two-agent overnight loop: scope -> council -> baseline -> repeated bounded rounds with carry-context reuse and early stop | 4 |
| **ACP Research Swarm** | `acp-research-swarm` | ACP/Sutra peer-council planning: scope -> council -> PAKT pack -> record | 4 |

## API

### Building a Workflow

```typescript
import { WorkflowBuilder, StepBuilder } from "@chitragupta/prana";

const workflow = new WorkflowBuilder("deploy-pipeline", "Deploy Pipeline")
  .describe("Build, test, and deploy the application")
  .step("lint", "Run linter")
    .shell("npm run check")
    .done()
  .step("test", "Run test suite")
    .shell("npm test")
    .dependsOn("lint")
    .done()
  .step("build", "Build for production")
    .shell("npm run build")
    .dependsOn("lint")
    .done()
  .step("deploy", "Deploy to production")
    .shell("npm run deploy")
    .dependsOn("test", "build")
    .done()
  .build();
```

### DAG Analysis

```typescript
import {
  validateDAG,
  topologicalSort,
  getExecutionLevels,
  getCriticalPath,
} from "@chitragupta/prana";

const validation = validateDAG(workflow);
if (!validation.valid) {
  console.error("Invalid workflow:", validation.errors);
}

// Get execution order
const order = topologicalSort(workflow);
// ["lint", "test", "build", "deploy"]

// Get parallel execution levels
const levels = getExecutionLevels(workflow);
// [["lint"], ["test", "build"], ["deploy"]]

// Find the critical path
const critical = getCriticalPath(workflow);
// ["lint", "test", "deploy"]
```

### Executing a Workflow

```typescript
import { WorkflowExecutor } from "@chitragupta/prana";

const executor = new WorkflowExecutor();

const result = await executor.execute(workflow, {
  onStepStart: (step) => console.log(`Starting: ${step.id}`),
  onStepComplete: (step) => console.log(`Done: ${step.id}`),
  onStepError: (step, err) => console.error(`Failed: ${step.id}`, err),
});

console.log(`Workflow ${result.status}`);
console.log(`Duration: ${result.duration}ms`);
```

### Chitragupta Engine Workflows

```typescript
import {
  CONSOLIDATION_WORKFLOW,
  SELF_REPORT_WORKFLOW,
  LEARNING_WORKFLOW,
  GUARDIAN_SWEEP_WORKFLOW,
  FULL_CYCLE_WORKFLOW,
  AUTORESEARCH_WORKFLOW,
  AUTORESEARCH_OVERNIGHT_WORKFLOW,
  ACP_RESEARCH_SWARM_WORKFLOW,
  getChitraguptaWorkflow,
  listChitraguptaWorkflows,
} from "@chitragupta/prana";

// List all lifecycle workflows
const templates = listChitraguptaWorkflows();
for (const t of templates) {
  console.log(`${t.id}: ${t.name} (${t.stepCount} steps)`);
}

// Get a specific workflow
const wf = getChitraguptaWorkflow("self-report");

// Execute the full lifecycle cycle
const executor = new WorkflowExecutor();
await executor.execute(FULL_CYCLE_WORKFLOW);

// Execute a bounded research loop
await executor.execute(AUTORESEARCH_WORKFLOW);

// Execute the two-agent overnight refinement loop
await executor.execute(AUTORESEARCH_OVERNIGHT_WORKFLOW);
```

### Chitragupta Node Adapters

```typescript
import {
  executeNodeAdapter,
  NODE_ADAPTERS,
} from "@chitragupta/prana";
import type { NodeContext, NodeResult } from "@chitragupta/prana";

// Execute a specific adapter
const ctx: NodeContext = {
  projectPath: "/my/project",
  stepOutputs: {},
  extra: { chetana: myChetanaInstance },
};

const result: NodeResult = await executeNodeAdapter("chetana-state", ctx);
console.log(result.ok);      // true
console.log(result.summary);  // "Chetana state gathered"
console.log(result.durationMs);

// List all available adapters
console.log(Object.keys(NODE_ADAPTERS)); // 33 adapter keys
```

### Shramika Worker Pool

```typescript
import { WorkerPool } from "@chitragupta/prana";
import type { WorkerPoolConfig, WorkerPoolStats } from "@chitragupta/prana";

const pool = new WorkerPool({
  size: 4,           // 4 worker threads
  taskTimeout: 30000, // 30s timeout per task
  maxQueueSize: 1000, // Max queued tasks
});

// Submit a task
const result = await pool.submit({
  id: "task-1",
  type: "analyze",
  data: { file: "src/parser.ts" },
});

console.log(result.success); // true
console.log(result.data);     // Worker's response
console.log(result.duration); // Execution time in ms

// Check pool stats
const stats: WorkerPoolStats = pool.stats();
console.log(stats.activeWorkers, stats.idleWorkers, stats.queuedTasks);

// Drain and shut down
await pool.drain();
```

### Built-in Templates

```typescript
import {
  CODE_REVIEW_WORKFLOW,
  REFACTOR_WORKFLOW,
  BUG_FIX_WORKFLOW,
  DEPLOY_WORKFLOW,
} from "@chitragupta/prana";

const executor = new WorkflowExecutor();
await executor.execute(CODE_REVIEW_WORKFLOW);
```

### Persistence

```typescript
import {
  saveWorkflow,
  loadWorkflow,
  listWorkflows,
  saveExecution,
  loadExecution,
  listExecutions,
} from "@chitragupta/prana";

await saveWorkflow(workflow);
const loaded = await loadWorkflow("deploy-pipeline");
const all = await listWorkflows();

await saveExecution(executionResult);
const history = await listExecutions("deploy-pipeline");
```

### Visualization

```typescript
import { renderDAG } from "@chitragupta/prana";

const ascii = renderDAG(workflow);
console.log(ascii);
// Renders a visual representation of the DAG
```

---

[Back to Chitragupta root](../../README.md)
