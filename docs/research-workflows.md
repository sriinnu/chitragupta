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
- daily Nidra postprocess now derives one per-project research refinement digest from the loop summaries and experiment ledger, so overnight outcomes feed back into project memory as:
  - what worked
  - what failed
  - what to try next

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
