# Hard Recovery Plan

This document defines the recovery path from a broad, partially integrated architecture into a tighter product-ready engine.

It is intentionally execution-first.
It does not add new conceptual subsystems.
It is a recovery plan, not a claim that each target is already complete.

## Core Rule

I treat Chitragupta as the authority and recovery anchor.

That means I do not recover product pace by:

- adding more faculties
- adding more executor-local policy
- adding more prompt folklore

I recover product pace by closing the missing vertical slices:

1. task
2. research
3. repair
4. consumer contracts

## Product Problem

The current substrate is stronger than the product shape.

That creates three failure patterns:

1. capabilities exist, but users cannot rely on one narrow end-to-end flow
2. executor/runtime boundaries drift, so retries and routing become ambiguous
3. autonomy looks broader in notes than it is in durable runtime truth

The recovery plan corrects those three patterns directly.

## Recovery Targets

The recovery finishes when these are true.

### 1. Task Vertical

The engine can:

- create a canonical task
- assign a lane
- attach memory and prior artifacts
- receive execution reports
- persist promoted artifacts
- resume after interruption without forking task truth

### 2. Research Vertical

The engine can:

- enqueue bounded research work durably
- dispatch through a resident daemon scheduler
- checkpoint and resume by loop identity
- apply stop conditions consistently
- preserve optimizer policy identity across resume
- persist outcomes as first-class artifacts and memory inputs

### 3. Repair Vertical

The engine can:

- detect semantic drift
- queue exact repair intent durably
- avoid dropping queued repair under caps or parse failures
- heal before remote semantic sync overclaims completion
- reindex automatically when the active embedding epoch changes

### 4. Consumer Vertical

External consumers can:

- ask for engine-owned lanes
- execute inside an engine-owned envelope
- report typed artifacts and validation back
- avoid becoming a second memory or routing authority

## Recovery Phases

### Phase 1. Engine Truth

I close engine-owned invariants first.

Required outcomes:

- semantic refresh must gate remote sync truth
- capped refinement scopes must carry forward durably
- repair intent upserts must preserve the richer exact intent
- broad exclusion must not delete narrower exact replay
- one shared refinement governor must order:
  - date repair
  - research repair
  - queued repair
  - epoch refresh
- resume must reconstruct truth without stale policy drift

Exit bar:

- full readiness green
- targeted failure-path tests green
- docs match runtime truth

### Phase 2. Executor Boundary

I make Takumi a strict executor, not a shadow hub.

Required outcomes:

- Chitragupta owns canonical task creation
- Chitragupta owns lane lifecycle and route authority
- Takumi emits typed execution reports and artifacts
- artifact promotion remains engine-owned
- executor route drift fails closed

Exit bar:

- typed contract documented
- public coding/runtime surfaces expose engine-owned execution objects, not only bridge prose:
  - canonical `taskId`
  - canonical `laneId`
  - durable resume state
  - typed final report/artifact envelopes
- replay/resume story is explicit

### Phase 3. Resident Autonomy

I make autonomy daemon-owned and durable.

Required outcomes:

- resident scheduler owns dispatch planning
- workers run under lease identity
- stop conditions and objectives are first-class policy
- optimizer state survives interruption and resume
- research outcomes feed next-day refinement

Exit bar:

- no silent queue drops
- no ambiguous stop truth
- no executor-local orphan state

### Phase 4. Consumer Launch

I only move to external Vaayu once the engine contract is stable.

Required outcomes:

- Vaayu consumes engine sessions and memory
- Vaayu consumes Lucy and Scarlett signals
- Vaayu does not own durable routing or memory
- Takumi and Vaayu both integrate against the same engine rule set

Exit bar:

- pre-Vaayu checklist passes
- consumer contract and task contract stay aligned

## Non-Negotiable Engineering Rules

I keep these rules active while recovering the product:

- exported seams must have JSDoc
- non-obvious logic must have inline comments
- docs must describe live runtime truth, not aspirations
- local-only files stay local
- pushes only happen from a clean tree
- review findings outrank optimism

## What I Freeze During Recovery

I do not add new high-level faculties unless they close one of the recovery targets.

That means:

- no new autonomy labels unless they have runtime contracts
- no new optimizer language unless the policy is persisted and test-covered
- no new consumer-specific control planes

## What Counts As Done

I only mark this recovery done when the engine is trustworthy in daily use, not when the notes sound coherent.

The practical bar is:

1. one reliable task flow
2. one reliable research flow
3. one reliable repair flow
4. one stable executor contract
5. one stable pre-Vaayu engine boundary

## Related Documents

- [consumer-contract.md](./consumer-contract.md)
- [takumi-executor-contract.md](./takumi-executor-contract.md)
- [vaayu-readiness-checklist.md](./vaayu-readiness-checklist.md)
- [research-workflows.md](./research-workflows.md)
- [current-status.md](./current-status.md)
