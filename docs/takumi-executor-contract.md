# Takumi Executor Contract

This document defines the minimum durable contract between Chitragupta and Takumi.

It is normative for the next implementation phase.
It does not claim that every field in this contract is already live in the current bridge.

The boundary is strict:

- Chitragupta is the hub and authority
- Takumi is the executor
- Scarlett supervises integrity

## Core Rule

Takumi executes inside an engine-owned envelope.

The preferred public bridge boundary is one canonical execution object:

- `execution.task.id`
- `execution.lane.id`

Top-level `taskId` and `laneId` remain transition aliases for compatibility callers.

Takumi does not become the authority for:

- task identity
- lane identity
- durable memory
- canonical artifacts
- route decisions

## Ownership Split

| Concern | Owner | Notes |
| --- | --- | --- |
| canonical task | Chitragupta | created and updated durably by the engine |
| lane lifecycle | Chitragupta | start, heartbeat, cancel, fail, complete |
| route authority | Chitragupta | includes execution envelope and fallback policy |
| local repo execution | Takumi | edit, test, validate, inspect |
| structured execution events | Takumi | emitted back to the engine |
| canonical artifact persistence | Chitragupta | artifacts may be produced by Takumi but are persisted and promoted by the engine |
| integrity supervision | Scarlett + Chitragupta | Scarlett reports, Chitragupta decides |

## Canonical Task

Chitragupta creates the task.

Minimum required fields:

- `taskId`
- `sessionId`
- `projectPath`
- `kind`
- `intent`
- `input`
- `constraints`
- `routeRequest`
- `inputArtifactIds`
- `createdAt`

Rules:

- `routeRequest` may contain `routeClass` or `capability`
- `routeRequest` does not grant Takumi sovereign provider/model choice
- Takumi receives the task; it does not invent canonical task truth locally

## Canonical Lane

Chitragupta owns the lane lifecycle.

Minimum lane fields:

- `laneId`
- `taskId`
- `executor`
- `executionBinding`
- `leaseOwner`
- `status`
- `startedAt`
- `finishedAt`
- `resumeToken`

Minimum control operations:

- `lane.start`
- `lane.heartbeat`
- `lane.complete`
- `lane.fail`
- `lane.cancel`

Rules:

- these are target protocol operations; the current bridge may map through existing daemon methods until the dedicated contract lands
- Takumi may run inside the lane
- Takumi may not redefine lane policy
- a lane must be resumable or explicitly terminal

## Execution Binding

The engine may attach an execution binding envelope to a lane.

That envelope may include:

- selected capability id
- selected provider id
- selected model id
- preferred provider/model set
- allowed provider/model set
- route class
- cross-provider constraints

Rules:

- the selected lane is authoritative
- an enforced envelope must preserve an authoritative selected capability/provider/model tuple when the engine supplied one
- the preferred set is guidance inside the allowed envelope
- a provider/model outside the allowed envelope is a contract violation
- if the enforced route/envelope cannot be represented safely through the structured bridge payload, the run must be rejected before execution starts
- if Takumi cannot honor the envelope, it must fail closed and report incompatibility
- the current bridge only has best-effort observational audit of used provider/model data; strict fail-closed enforcement requires Takumi to emit typed route/use fields directly

## Execution Events

Takumi reports typed progress back to Chitragupta.

Minimum streaming/update shape:

- `taskId`
- `laneId`
- `phase`
- `eventType`
- `message`
- `ts`

Rules:

- updates are additive, not canonical replacements
- progress events do not create task truth by themselves
- resumable execution should include checkpoint or cursor metadata when relevant
- the current bridge now preserves `taskId` and `laneId` on its compatibility streaming events even before Takumi emits the full native daemon-owned event contract itself
- the public router compatibility layer now also exposes a structured progress callback that carries the canonical `execution` object alongside `taskId` and `laneId`; the legacy text-only callback remains compatibility-only
- the public bridge/router surface now prefers a canonical `execution` object and still accepts explicit `taskId` / `laneId` aliases so compatibility callers do not break during migration
- the public router and Lucy result surfaces now treat the compatibility `execution` object plus `taskId`, `laneId`, `finalReport`, and `artifacts` as required normalized output for executed runs, while still carrying the full nested bridge payload for compatibility consumers
- enforced lanes now treat missing provider/model declarations as a contract violation rather than silently pretending the assigned lane was actually used
- Lucy and MCP coding surfaces now preserve those compatibility fields instead of collapsing them back to prose-only status, Lucy reuses the same task/lane identity across auto-fix retries so the full autonomous attempt chain stays correlated as one logical engine task, Lucy lifecycle events now carry that same identity on non-stream phases instead of limiting typed execution truth to streamed bridge progress, Lucy's episodic-memory and Akasha recording path now persists that same execution identity for durable auditability, and the public `coding_agent` surface can now accept upstream `execution`, `taskId`, or `laneId` while preserving typed execution identity in `plan-only` mode and the same typed report contract in executed modes even in plain CLI mode or when the routed execution throws before returning a normal result

## Final Execution Report

Takumi must emit one structured final report.

Minimum report shape:

- `execution`
- `taskId`
- `laneId`
- `status`
- `summary`
- `usedRoute`
- `selectedProviderId`
- `selectedModelId`
- `toolCalls`
- `validation`
- `artifacts`
- `error`

Rules:

- `usedRoute` must be auditable against the assigned lane
- `execution.task.id` and `execution.lane.id` are the canonical identity pair; top-level ids are compatibility aliases
- if Takumi declares a provider/model outside an enforced envelope, the engine treats that as failure
- prose alone is not enough for canonical completion
- the current bridge now emits a compatibility `finalReport` plus bridge-synthesized `patch` / `validation` / `log` artifacts on the public coding surface
- those fields are still compatibility output from Chitragupta's bridge, not proof that Takumi already emits the full native daemon-owned report contract itself

## Artifact Contract

Takumi produces artifacts.
Chitragupta persists and promotes artifacts.

Minimum artifact shape:

- `artifactId`
- `execution`
- `taskId`
- `laneId`
- `kind`
- `producer`
- `summary`
- `body` or `uri`
- `contentHash`
- `createdAt`
- `promoted`

Minimum artifact kinds:

- `plan`
- `patch`
- `validation`
- `review`
- `handoff`
- `log`

Rules:

- artifact identity must survive retries and replay
- `execution` is the canonical execution carrier; top-level ids remain compatibility aliases while the bridge still serves older consumers
- promoted artifacts remain engine-owned
- Takumi should not become the only place artifact truth exists

## Failure Semantics

Failure must be typed and durable.

Minimum failure cases:

- route incompatible
- tool/runtime failure
- validation failure
- operator cancel
- engine cancel
- lease expiry
- checkpoint resume required

Rules:

- fail closed when envelope cannot be honored
- do not downgrade a route violation into generic success prose
- failed execution should still emit typed artifacts when they exist

## Resume Semantics

Resume must not restart from scratch when a durable checkpoint exists.

Required resume truth:

- `taskId` remains stable
- `laneId` remains stable for the same lane
- checkpoint pointer or resume token remains engine-visible
- last durable event boundary remains inspectable

Rules:

- Takumi may keep local scratch state
- Chitragupta must remain able to recover the durable execution story without Takumi-only memory

## Explicit Non-Goals

This contract does not make Takumi:

- a second memory authority
- a sovereign router
- an artifact registry
- a control-plane database

It also does not make Chitragupta responsible for:

- repo-local UX details
- terminal ergonomics
- local tool wiring specifics that stay inside the executor

## First Vertical Slice

The smallest correct integration slice is:

1. Chitragupta creates a canonical task
2. Chitragupta resolves the lane
3. Chitragupta starts the lane
4. Takumi executes
5. Takumi emits typed artifacts and a final report
6. Chitragupta persists, audits, and promotes the result

## Takumi Work Items

Takumi should implement these in order:

1. accept a canonical task payload instead of inventing task truth locally
2. accept an engine-owned lane envelope and preserve its identifiers through the run
3. emit structured progress events with stable `taskId` and `laneId`
4. emit a typed final report instead of completion prose only
5. package artifacts explicitly as `plan`, `patch`, `validation`, `review`, `handoff`, or `log`
6. fail closed on provider/model or route mismatch instead of silently rerouting
7. return checkpoint or resume metadata whenever the executor can continue rather than restart

The shortest correct Takumi implementation is not “be smarter locally.”
It is “be stricter about execution and reporting.”

## Current Boundary Caveat

The current coding path is not yet this full contract.

Today:

- the public coding surface now returns a canonical engine-owned `execution` object plus compatibility `taskId` / `laneId` aliases, but the typed report/artifact payloads are still bridge-synthesized compatibility output rather than native Takumi emissions
- route-envelope auditing is best-effort and depends on bridge-observed declarations
- the engine can still resolve to the compatibility `tool.coding_agent` lane, which delegates to the generic local coding CLI router instead of the final strict Takumi executor contract

That is why this document is a target contract and a review bar, not a claim that the migration is already complete.

## Related Documents

- [consumer-contract.md](./consumer-contract.md)
- [coding-agent.md](./coding-agent.md)
- [hard-recovery-plan.md](./hard-recovery-plan.md)
- [vaayu-readiness-checklist.md](./vaayu-readiness-checklist.md)
