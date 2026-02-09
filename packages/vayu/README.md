# @chitragupta/vayu

![Logo](../../assets/logos/vayu.svg)

**वायु (vayu) -- Wind / Life-Force**

**Workflow DAG engine with topological execution, parallel step processing, worker thread pools (Shramika), 25 Chitragupta node adapters, 5 built-in lifecycle workflow templates, and disk persistence.**

Vayu is Chitragupta's wind -- it drives multi-step workflows forward. Define workflows as directed acyclic graphs (DAGs) where each step declares its dependencies. Vayu validates the DAG, computes the topological order, identifies the critical path, and executes steps in parallel where possible. The Shramika worker pool offloads CPU-intensive tasks to Node.js worker threads. Twenty-five Chitragupta node adapters wrap every subsystem (memory, consciousness, skills, security, performance) as Vayu step handlers, and five built-in lifecycle workflow templates encode core operational pipelines.

---

## Key Features

- **DAG validation** -- `validateDAG()` detects cycles, missing dependencies, and unreachable nodes
- **Topological execution** -- `topologicalSort()` and `getExecutionLevels()` for ordered and parallel execution
- **Critical path analysis** -- `getCriticalPath()` identifies the longest dependency chain
- **Workflow builder** -- Fluent `WorkflowBuilder` and `StepBuilder` for constructing workflows in code
- **Workflow executor** -- `WorkflowExecutor` runs workflows with step-level parallelism and error handling
- **Built-in templates** -- `CODE_REVIEW_WORKFLOW`, `REFACTOR_WORKFLOW`, `BUG_FIX_WORKFLOW`, `DEPLOY_WORKFLOW`
- **Shramika worker pool** -- `WorkerPool` manages Node.js worker threads for CPU-bound parallel execution with task queuing, timeouts, and stats
- **Chitragupta node adapters** -- 25 adapters wrapping subsystem modules as Vayu step handlers via `NODE_ADAPTERS` registry and `executeNodeAdapter()`
- **Chitragupta workflow templates** -- 5 lifecycle DAGs: Consolidation, Self-Report, Learning, Guardian Sweep, Full Cycle
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
| `chitragupta-nodes.ts` | **25 node adapters** wrapping Chitragupta subsystems as step handlers |
| `chitragupta-workflows.ts` | **5 lifecycle workflow templates** (Consolidation, Self-Report, Learning, Guardian Sweep, Full Cycle) |

### Chitragupta Node Adapters (25 adapters)

| Adapter | Subsystem | Purpose |
|---------|-----------|---------|
| `nidra-wake` / `nidra-sleep` | Lifecycle | Wake/sleep the Nidra daemon |
| `vasana-scan` / `vasana-top-n` | Memory | Scan/retrieve behavioral tendencies |
| `svapna-consolidate` | Memory | Run memory consolidation (pattern detection + compression) |
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

### Chitragupta Workflow Templates (5 templates)

| Template | ID | Description | Steps |
|----------|----|-------------|-------|
| **Consolidation** | `consolidation` | Nidra sleep cycle: wake, scan vasanas, consolidate, deposit to Akasha, sleep | 6 |
| **Self-Report** | `self-report` | Atman self-assessment: parallel collection of consciousness, health, tendencies, skills, memory -- merged into unified report | 7 |
| **Learning** | `learning` | Shiksha pipeline: Vimarsh NLU -> Praptya source -> Nirmana build -> Suraksha scan -> Register | 5 |
| **Guardian Sweep** | `guardian-sweep` | Lokapala sweep: parallel security/performance/correctness -> merge -> Sabha deliberation -> apply fixes | 6 |
| **Full Cycle** | `full-cycle` | Complete lifecycle: self-report -> guardian sweep -> consolidation -> learning check -> health report | 5 |

## API

### Building a Workflow

```typescript
import { WorkflowBuilder, StepBuilder } from "@chitragupta/vayu";

const workflow = new WorkflowBuilder("deploy-pipeline")
  .description("Build, test, and deploy the application")
  .step(
    new StepBuilder("lint")
      .description("Run linter")
      .action(async (ctx) => {
        await ctx.exec("npm run check");
      })
  )
  .step(
    new StepBuilder("test")
      .description("Run test suite")
      .dependsOn("lint")
      .action(async (ctx) => {
        await ctx.exec("npm test");
      })
  )
  .step(
    new StepBuilder("build")
      .description("Build for production")
      .dependsOn("lint")
      .action(async (ctx) => {
        await ctx.exec("npm run build");
      })
  )
  .step(
    new StepBuilder("deploy")
      .description("Deploy to production")
      .dependsOn("test", "build")
      .action(async (ctx) => {
        await ctx.exec("npm run deploy");
      })
  )
  .build();
```

### DAG Analysis

```typescript
import {
  validateDAG,
  topologicalSort,
  getExecutionLevels,
  getCriticalPath,
} from "@chitragupta/vayu";

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
import { WorkflowExecutor } from "@chitragupta/vayu";

const executor = new WorkflowExecutor();

const result = await executor.run(workflow, {
  onStepStart: (step) => console.log(`Starting: ${step.id}`),
  onStepComplete: (step) => console.log(`Done: ${step.id}`),
  onStepError: (step, err) => console.error(`Failed: ${step.id}`, err),
});

console.log(`Workflow ${result.status}`);
console.log(`Duration: ${result.duration}ms`);
```

### Chitragupta Lifecycle Workflows

```typescript
import {
  CONSOLIDATION_WORKFLOW,
  SELF_REPORT_WORKFLOW,
  LEARNING_WORKFLOW,
  GUARDIAN_SWEEP_WORKFLOW,
  FULL_CYCLE_WORKFLOW,
  getChitraguptaWorkflow,
  listChitraguptaWorkflows,
} from "@chitragupta/vayu";

// List all lifecycle workflows
const templates = listChitraguptaWorkflows();
for (const t of templates) {
  console.log(`${t.id}: ${t.name} (${t.stepCount} steps)`);
}

// Get a specific workflow
const wf = getChitraguptaWorkflow("self-report");

// Execute the full lifecycle cycle
const executor = new WorkflowExecutor();
await executor.run(FULL_CYCLE_WORKFLOW);
```

### Chitragupta Node Adapters

```typescript
import {
  executeNodeAdapter,
  NODE_ADAPTERS,
} from "@chitragupta/vayu";
import type { NodeContext, NodeResult } from "@chitragupta/vayu";

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
console.log(Object.keys(NODE_ADAPTERS)); // 25 adapter keys
```

### Shramika Worker Pool

```typescript
import { WorkerPool } from "@chitragupta/vayu";
import type { WorkerPoolConfig, WorkerPoolStats } from "@chitragupta/vayu";

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
} from "@chitragupta/vayu";

const executor = new WorkflowExecutor();
await executor.run(CODE_REVIEW_WORKFLOW);
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
} from "@chitragupta/vayu";

await saveWorkflow(workflow);
const loaded = await loadWorkflow("deploy-pipeline");
const all = await listWorkflows();

await saveExecution(executionResult);
const history = await listExecutions("deploy-pipeline");
```

### Visualization

```typescript
import { renderDAG } from "@chitragupta/vayu";

const ascii = renderDAG(workflow);
console.log(ascii);
// Renders a visual representation of the DAG
```

---

[Back to Chitragupta root](../../README.md)
