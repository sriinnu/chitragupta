# Research Workflows

This document explains how daemon-first nervous-system research loops work inside Chitragupta.

Current as of March 8, 2026.

## Why this exists

Chitragupta should not only remember and deliberate. It should also support bounded self-improvement and experiment loops without creating a second authority in Takumi or Vaayu.

The runtime now exposes three daemon-first workflow templates through Prana:
- `autoresearch`
- `autoresearch-overnight`
- `acp-research-swarm`

These belong in the nervous system because they compose:
- Lucy: live context and experiment shaping
- Scarlett: integrity constraints and bounded execution posture
- Smriti: durable experiment memory
- Akasha: reusable collective traces
- Sabha: structured peer consultation
- Prana: deterministic orchestration
- PAKT: context/log compression

## Workflow templates

### `autoresearch`

Purpose:
- define a bounded experiment scope
- convene an ACP/Sabha council
- capture a baseline metric
- run a hard time-boxed experiment
- evaluate keep/discard against the metric delta
- compress experiment context with PAKT
- persist the result into Smriti and Akasha

Default shape:
1. `autoresearch-scope`
2. `acp-research-council`
3. `autoresearch-baseline`
4. `autoresearch-run`
5. `autoresearch-evaluate`
6. `pakt-pack-research-context`
7. `autoresearch-record`

### `autoresearch-overnight`

Purpose:
- run a bounded overnight research loop with a small planner/executor council
- carry compacted context forward between rounds
- stop early when improvement stalls
- record each round durably into the research ledger

Default shape:
1. `autoresearch-scope`
2. `acp-research-council`
3. `autoresearch-baseline`
4. `autoresearch-overnight`

Default overnight controls:
- `researchRounds: 6`
- `researchAgentCount: 2`
- `researchStopAfterNoImprovementRounds: 2`
- `researchPlannerRouteClass: coding.deep-reasoning`
- `researchExecutionRouteClass: tool.use.flex`

The overnight loop keeps one canonical `loopKey`, records `roundNumber` and `totalRounds`, and uses daemon-first `compression.unpack_context` / `compression.normalize_context` when reusing packed carry context between rounds.

It also persists an exact resumable checkpoint for the active phase through:
- `research.loops.checkpoint.get`
- `research.loops.checkpoint.list`
- `research.loops.checkpoint.save`
- `research.loops.checkpoint.clear`

Operator inspection surfaces:
- `research.loops.active`
  - lists current daemon-owned loop control state
  - shows whether a loop is resumable without reopening it
- `research.loops.get`
  - loads one specific daemon-owned loop control record
  - returns the same bounded `resumeContext` used by checkpoint inspection
  - also returns a machine-usable `resumePlan` so a caller can distinguish "resume rounds" from "inspect failure" without parsing prose
- `research.loops.checkpoint.get`
  - loads one specific overnight loop checkpoint
  - returns a bounded `resumeContext` alongside the raw checkpoint row
  - also returns a machine-usable `resumePlan` describing the next safe recovery action
- `research.loops.checkpoint.list`
  - lists recent overnight loop checkpoints
  - returns the same bounded `resumeContext` so timeout pickup does not require raw checkpoint spelunking
  - also returns the corresponding `resumePlan` for automated pickup tooling
- `agent.tasks.checkpoint.list`
  - lists recent generic agent task checkpoints
  - surfaces the last durable phase plus recent event breadcrumbs for timeout pickup
  - includes a machine-usable `resumePlan` for the next safe action (`resume-tool`, `resume-subagent`, `resume-error-handling`, and so on)
- `agent.tasks.checkpoint.get`
  - loads one specific generic agent task checkpoint
  - returns the same bounded `resumeContext` so operators can inspect exactly where a timed-out task should resume
  - also returns a `resumePlan` so daemon-first automation does not have to reconstruct next steps from text

That means a timed-out or interrupted overnight loop can continue from the last durable phase boundary instead of replaying already-recorded rounds from scratch.

It also tracks:
- `totalBudgetMs`
- `totalDurationMs`
- `keptRounds`
- `revertedRounds`
- attempt-safe round ledger metadata:
  - `experimentKey`
  - `attemptKey`
  - `attemptNumber`
  - `status`
  - `errorMessage`

Fail-closed stop reasons:
- `no-improvement`
- `budget-exhausted`
- `cancelled`
- `unsafe-discard`
- `round-failed`

That means the workflow will stop instead of pretending success if:
- cumulative overnight runtime exceeds the bounded total budget
- an operator or daemon-owned loop control path requests cancellation
- a discarded round cannot be safely reverted
- a round fails after execution starts and the failed attempt has to be preserved instead of being collapsed into the previous round's history

Interrupt semantics:
- the overnight loop registers a canonical daemon control record through:
  - `research.loops.start`
  - `research.loops.heartbeat`
  - `research.loops.cancel`
  - `research.loops.complete`
- `loopKey` is treated as an immutable run id:
  - terminal keys are not reopened
  - a new run must use a new `loopKey`
- daemon registration is mandatory:
  - if `research.loops.start` cannot be registered with the daemon, the loop does not continue with local-only control state
- each loop also owns a local `AbortController`
- cancellation is honored:
  - before a round starts
  - during a running round
  - during closure steps between:
    - `packResearchContext`
    - `recordResearchOutcome`
    - `compression.unpack_context`
    - `compression.normalize_context`
- a late heartbeat cannot revive a loop once daemon state is terminal (`completed` or `cancelled`)
- terminal completion records `stopReason: cancelled` instead of falling back to `max-rounds`
- local interrupt state is only cleared after daemon completion succeeds:
  - a transient `research.loops.complete` failure leaves the local loop handle available for retry or inspection
- loop best-metric progress only advances after the round crosses the durable outcome-record boundary
- the checkpoint/resume contract is currently strongest for overnight research, but generic long-running agent execution now has a real prompt-time pickup path too:
  - overnight research can resume from a durable phase checkpoint
  - operators can inspect active loop state through `research.loops.active` or `research.loops.get` before deciding whether to resume or abandon a run
  - Sabha can resume pending consultations through `sabha.resume`
  - generic long-running agent tasks now persist daemon-owned task checkpoints, carry forward durable phase/status metadata, keep a bounded recent-event trail, and inject that resume context into the next prompt run
  - operators can inspect those generic checkpoints through `agent.tasks.checkpoint.list` or `agent.tasks.checkpoint.get` instead of guessing where a timed-out run last made safe progress
  - serve/API operators can inspect the same state through `GET /api/agent/tasks/checkpoints` and `GET /api/agent/tasks/checkpoints/{taskKey}`
  - the same daemon surfaces also return a machine-usable `resumePlan`, so pickup can be automated at the phase boundary instead of only narrated in prompt text
  - generic task pickup is now phase-aware plus event-aware rather than full semantic replay, so complex side effects may still need explicit task-specific resume logic
  - the remaining hardening work is native abort plumbing in every closure-side effect and richer semantic resume where phase breadcrumbs are still not enough
- daily Nidra postprocess now derives one per-project research refinement digest from the loop summaries and experiment ledger, so overnight outcomes feed back into project memory as:
  - what worked
  - what failed
  - what to try next
- `research.outcome.record` now also applies bounded immediate semantic repair pressure:
  - the canonical outcome write remains first
  - selective re-embedding is daemon-owned and best-effort
  - only the touched day plus monthly/yearly project artifacts are considered
  - same-epoch quality debt repair now uses the active research refinement budget, so heavier overnight pressure can widen repair without jumping to a global reindex
  - that gives the loop a fast self-heal path without turning one recorded experiment into a global re-index
- overnight loop summaries now persist optimizer-facing metadata as first-class state:
  - per-round objective scores
  - explicit stop-condition hits
  - Pareto frontier annotations across the recorded rounds
  - durable `resumePlan` and checkpoint state so the next run can continue from the last safe phase instead of re-deriving progress from logs alone
  - when a live checkpoint is gone, fallback resume first trusts the persisted loop summary and overlays the latest durable round slice; without a checkpoint or summary, it is still only a bounded recent-tail reconstruction
- research-originated repair now has a durable deferred lane too:
  - immediate repair still runs inline for the touched day/project horizon
  - any leftover semantic quality debt is persisted as `queuedResearch`
  - that queue now stores the exact deferred repair intent when inline repair degrades, so retry drains can replay the narrowed repair plan instead of reconstructing a broader one from scope alone
  - daily daemon postprocess drains that queue in bounded retry order and carries cap-overflow scopes forward durably instead of dropping them
- daemon-owned overnight scheduling now has its own durable queue/lease layer:
  - `research.loops.enqueue` persists queued loop intent together with the loop’s objective registry, stop-condition registry, and update budgets
  - `research.loops.schedule.get` reads the durable queue row for one `loopKey`
  - `research.loops.dispatchable` lists queued loops whose lease is free or expired so a resident scheduler can resume from durable state instead of re-deriving work from scratch
  - the resident daemon now polls that queue on `researchDispatchMinutes`, dispatches one loop at a time, and waits until semantic refresh or daily consolidation are idle before starting new overnight work
  - resident dispatch injects a process-unique `researchLeaseOwner`, and Prana forwards that owner through `research.loops.start` plus `research.loops.heartbeat` so overlapping daemon workers do not collapse onto one shared lease identity
  - queued rows must carry a durable `workflowContext`; when that envelope is missing or references an unknown workflow, resident dispatch fails closed and marks the schedule `dispatch-failed`
- daily daemon postprocess now treats research-originated repair as a bounded queue:
  - it first derives one bounded refinement budget from overnight loop summaries, experiment outcomes, and outstanding queue pressure
  - per-project refinement scopes are sorted by `priorityScore`
  - cap-overflow scopes are re-queued before the queue drain so one cycle never silently loses them
  - `queuedResearch` debt is drained after the primary daily and project repair pass, subject to the same remaining project budget for that cycle
  - remote sync remains gated while outstanding repair backlog, queue carry-forward, or epoch refresh incompletion still exists
  - the postprocess result now exposes the exact daemon governor it used:
    - phase order
    - merged budget envelope
    - `researchSignalCount`
    - `queuedDrainLimit`
    - `remoteHoldReasons`
- timeout pickup is phase-safe rather than omniscient:
  - durable checkpoints plus `resumePlan` preserve the last safe phase boundary
  - they do not yet replay every closure-side effect semantically
  - the remaining hardening work is abort-plumbed closure IO and richer semantic replay where phase plus breadcrumbs are still not enough

### `acp-research-swarm`

Purpose:
- use Sutra/Sabha as a peer-council planning layer before execution
- establish a bounded plan with explicit roles
- compress the council output
- persist the council result for later reuse

Default shape:
1. `autoresearch-scope`
2. `acp-research-council`
3. `pakt-pack-research-context`
4. `autoresearch-record`

## ACP in Chitragupta

ACP-style subagents map to Chitragupta's existing runtime primitives:
- Sutra: inter-agent communication protocol
- Mesh: peer routing and capability addressing
- Sabha: formal council/deliberation state

In this system, ACP does not mean a second runtime. It means Chitragupta uses Sutra/Mesh for peer communication and Sabha for council state inside one daemon-first engine contract.

Default council roles in `acp-research-council` are dynamic.

Standard bounded research defaults to a five-role council:
- `planner`
- `executor`
- `evaluator`
- `skeptic`
- `recorder`

The overnight loop intentionally narrows that to a two-agent planner/executor council so the run stays cheap and repeatable while still preserving structured skepticism through the recorded verdict and measured baseline delta.

## Bounded experiment contract

The workflow is intentionally constrained.

Default scope:
- target files: `train.py`
- immutable files: `prepare.py`
- metric: `val_bpb`
- objective: `minimize`
- budget: `300000ms`

This matches the useful part of the `autoresearch` pattern:
- small editable surface
- hard runtime budget
- measurable improvement rule
- keep/discard loop

Daemon-first council execution now also binds the run to:
- a canonical engine session through `session.open`
- the canonical project path instead of a drifting ad hoc cwd
- optional lineage reuse via `researchParentSessionId` and `researchSessionLineageKey`
- the engine route class `research.bounded`
- the engine-selected capability `engine.research.autoresearch`
- a second execution lane, defaulting to `tool.use.flex`, that is resolved in the same daemon `route.resolveBatch` call and must also resolve to a concrete engine-selected capability before a bounded run is allowed to execute

Bounded research now fails closed when:
- `session.open` does not return a canonical engine session id
- the bounded workflow lane does not resolve to `engine.research.autoresearch`
- the execution lane resolves to a discoverable-only or non-executable result

That means Prana keeps orchestration responsibility, but Chitragupta remains the authority over whether the bounded research lane is selected at all.

## Where Takumi fits

Takumi remains the coding executor.

Chitragupta owns:
- research workflow structure
- bounded scope and policy
- durable experiment memory
- council semantics
- compression policy

Takumi may execute code edits or runs inside that envelope, but it is not the source of truth for the experiment ledger.

## Where Vaayu fits

Vaayu should surface these workflows as operator UX and later richer control surfaces.

Vaayu should not become the durable authority for:
- experiment memory
- council state
- routing/auth policy

## Memory and provenance

`autoresearch-record` writes the result through the daemon when available, and only uses the local Smriti/Sutra fallback when the daemon is unavailable:
- project memory in Smriti
- an Akasha trace for later collective reuse

Raw logs remain transient unless separately preserved.
The durable record is the experiment summary with:
- topic
- hypothesis
- command
- target/immutable files
- baseline
- observed metric
- delta
- keep/discard decision
- council verdict
- compression metadata
- execution-binding provenance for discovery-backed lanes

Daily postprocess now also writes a derived research refinement digest per project, so raw loop records are not the only thing Nidra leaves behind.

## PAKT

PAKT is used here as an engine-managed capability.
It compresses experiment context so future runs or handovers can consume a smaller, provenance-preserving summary.
If the daemon is reachable, its `compression.pack_context` decision is authoritative.
Local packing only activates when the daemon is unavailable.
The packed research record now preserves the compacted payload itself plus the engine-selected provider/model envelope used for execution, including the selected provider/model pair and the preferred allowed set returned by the daemon route contract.
Packed blocks can now be normalized or unpacked through daemon compression methods before read-side reuse, so the workflow does not recursively wrap already-packed context.
The overnight loop now records failed attempts separately instead of overwriting the previous successful round record, which keeps retry history auditable and gives Nidra later material to consolidate.

PAKT does not become the memory authority.
Smriti remains canonical.

## Experiment provenance

Bounded research records now also preserve git provenance:
- `gitBranch`
- `gitHeadCommit`
- `gitDirtyBefore`
- `gitDirtyAfter`

The workflow now fails closed if the bounded run changes git refs during execution.
That protects the experiment ledger from claiming one branch or commit lineage while the run actually mutated into another.

## Nervous-system fit

These workflows sit in the nervous system because they cross multiple faculties:
- Lucy: anticipatory experiment context
- Scarlett: bounded integrity posture
- Sabha: peer consultation and skepticism
- Smriti/Akasha: durable learning
- Nidra: later consolidation of experiment outcomes

This is the correct boundary:
- Chitragupta owns the daemon bridge, workflow, memory, and council semantics
- Takumi executes inside the envelope
- Vaayu orchestrates and later presents the experience

## Related docs

- [architecture.md](./architecture.md)
- [component-responsibilities.md](./component-responsibilities.md)
- [end-to-end-communication-flow.md](./end-to-end-communication-flow.md)
- [current-status.md](./current-status.md)
