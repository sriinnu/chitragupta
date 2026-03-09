# Research Workflows

This document explains how daemon-first nervous-system research loops work inside Chitragupta.

Current as of March 8, 2026.

## Why this exists

Chitragupta should not only remember and deliberate. It should also support bounded self-improvement and experiment loops without creating a second authority in Takumi or Vaayu.

The runtime now exposes two daemon-first workflow templates through Prana:
- `autoresearch`
- `acp-research-swarm`

These belong in the nervous system because they compose:
- Lucy: live context and experiment shaping
- Scarlett: integrity constraints and bounded execution posture
- Smriti: durable experiment memory
- Akasha: reusable collective traces
- Sabha: structured peer consultation
- Prana: deterministic orchestration
- PAKT: context/log compression

## The two workflow templates

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

Default council roles in `acp-research-council`:
- `planner`
- `executor`
- `evaluator`
- `skeptic`
- `recorder`

These roles produce a bounded council verdict before an experiment result is trusted.

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
- a second execution lane, defaulting to `tool.use.flex`, that must also resolve to a concrete engine-selected capability before a bounded run is allowed to execute

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

## PAKT

PAKT is used here as an engine-managed capability.
It compresses experiment context so future runs or handovers can consume a smaller, provenance-preserving summary.
If the daemon is reachable, its `compression.pack_context` decision is authoritative.
Local packing only activates when the daemon is unavailable.

PAKT does not become the memory authority.
Smriti remains canonical.

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
