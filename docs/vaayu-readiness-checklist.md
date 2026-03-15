# Vaayu Readiness Checklist

This document defines the engine bar that must be met before I treat external Vaayu work as the next primary phase.

Vaayu should sit on a stable engine.
It should not absorb unresolved engine ambiguity.

## Core Rule

I do not shift to Vaayu because the architecture sounds ready.

I shift to Vaayu when the Chitragupta contract is stable enough that Vaayu can stay thin and trustworthy.

## Engine Readiness Gates

### 1. Session and Memory Authority

Chitragupta must be the only durable authority for:

- canonical sessions
- project memory
- cross-project memory
- promoted artifacts

Required bar:

- consumer surfaces use engine sessions
- consumer-local state is explicitly ephemeral
- no shadow durable session truth exists

### 2. Routing and Lane Authority

Chitragupta must own:

- route resolution
- lane lifecycle
- execution envelopes
- fallback policy

Required bar:

- consumers request semantic lanes, not vendor choices
- engine-selected envelopes are enforced through typed runtime data, not only best-effort bridge observation
- route drift is auditable

### 3. Repair and Self-Heal Truth

Chitragupta must be able to:

- detect semantic drift
- queue repair intent durably
- auto-refresh on embedding epoch change
- avoid overclaiming healed state before refresh completes

Required bar:

- remote sync gates on full refresh completion
- queued repair survives caps, retries, and parse failures
- epoch changes trigger refresh and reindex without operator intervention

### 4. Research and Resident Autonomy

Chitragupta must provide a bounded daemon-owned research loop.

Required bar:

- resident scheduler exists
- lease identity exists
- checkpoints/resume are durable
- objective and stop policy are persisted
- outcomes feed refinement

### 5. Executor Contract

Takumi must already be a strict executor against the engine contract.

Required bar:

- canonical task stays engine-owned
- lane lifecycle stays engine-owned
- Takumi emits typed reports and artifacts
- public coding/runtime surfaces expose canonical `taskId`, `laneId`, and durable resume state
- executor cannot silently reroute behind a compatibility lane without that being explicit in the engine contract

## Vaayu Readiness Questions

I should be able to answer yes to all of these before Vaayu becomes the main focus.

1. Can Vaayu open and continue only engine-owned sessions?
2. Can Vaayu request capabilities without becoming a routing authority?
3. Can Vaayu consume Lucy and Scarlett signals directly from the engine?
4. Can Vaayu rely on engine-owned recall and promoted artifacts instead of app-local memory?
5. Can Vaayu survive daemon degradation without silently forking durable truth?

## What Vaayu Is Allowed To Own

Vaayu should remain strong in:

- assistant UX
- channels
- install suggestions
- user-facing orchestration
- presentation of Lucy and Scarlett signals

Vaayu should not own:

- durable memory
- canonical sessions
- routing authority
- long-term artifact truth

## Release Bar Before Vaayu

Before I switch to Vaayu as the main workstream, I want:

1. full readiness gates green on Chitragupta
2. current research and repair docs aligned with runtime truth
3. Takumi contract documented and reflected in the runtime through engine-owned execution objects and typed reports
4. no known split-brain session or routing path
5. current review findings closed or explicitly recorded as accepted risk

## Related Documents

- [vaayu-integration.md](./vaayu-integration.md)
- [consumer-contract.md](./consumer-contract.md)
- [takumi-executor-contract.md](./takumi-executor-contract.md)
- [hard-recovery-plan.md](./hard-recovery-plan.md)
