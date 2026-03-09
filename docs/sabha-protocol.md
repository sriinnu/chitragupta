# Sabha Protocol

Sabha is Chitragupta's council layer.

It sits between:

- peer-to-peer coordination
- multi-agent deliberation
- recorded decision formation

## What Sabha Means Here

Sabha is not only an LLM risk gate.

The stronger model is:

- agents can consult peers
- peers can challenge proposals
- the system can gather perspectives before acting
- important outcomes can be recorded back into Buddhi and Smriti

That makes Sabha the formal council layer of the engine.

## What Exists Today

Chitragupta already has a real Sabha deliberation substrate:

- `SabhaEngine` in Sutra
- Nyaya-style structured deliberation
- challenge and response flow
- weighted voting
- escalation on no-consensus
- LLM-assisted deliberation helpers
- API and route surfaces for convene / deliberate style workflows
- daemon bridge methods for:
  - `sabha.ask`
  - `sabha.resume`
  - `sabha.submit_perspective`
  - `sabha.gather`
  - `sabha.deliberate`
  - `sabha.record`
  - `sabha.escalate`
- daemon-backed council routing on the main runtime surfaces:
  - CLI slash/interactive paths
  - `serve` HTTP routes
  - MCP collective tools
  - consumer bridge integrations

The surrounding mesh substrate also exists:

- actor ask/reply
- communication hub
- Samiti ambient channels
- peer messaging primitives

## What Sabha Is Becoming

The long-term protocol is broader than today's deliberation engine.

Target verbs:

- `ask`
  - consult one or more peers for context or judgment

- `gather`
  - collect perspectives, observations, or evidence

- `deliberate`
  - synthesize a conclusion from multiple inputs

- `record`
  - persist important rationale and outcome

- `escalate`
  - involve the human when policy, ambiguity, or risk requires it

- `repl.pull`
  - replicate current Sabha state without resuming pending mesh work

- `repl.apply`
  - apply replicated Sabha state into another node's persistent store

## Current Boundary

Today, Sabha is strongest as:

- a structured deliberation engine
- a route/API surface for council-style actions
- a live consultation loop where asked peers can submit structured perspectives and `gather` can report who has responded and who is still pending
- a conceptual bridge between mesh coordination and decision making

It is not yet the fully generalized peer-consultation protocol for every runtime surface.

That is an active evolution area.

## How Sabha Fits The Engine

- Chitragupta
  - owns the authority boundary

- Lucy
  - contributes intuition and anticipatory context

- Scarlett
  - contributes integrity and anomaly context

- Buddhi
  - records significant decisions and rationale

- Smriti
  - preserves durable memory and continuity

- Samiti
  - provides ambient channels

- Sutra mesh
  - provides transport and ask/reply primitives

Sabha is the formal council on top of those layers.

## When To Use Sabha

Use Sabha when work benefits from structured peer judgment:

- risky changes
- multi-step reasoning with challenge/response
- disagreement between agents or routes
- cross-domain decisions
- actions that may need explicit escalation

Do not require Sabha for every trivial local decision.

## Status

Current status is best described as:

- real
- useful
- broader than the old LLM-risk-gate framing
- revisioned and restart-durable at the daemon layer
- still narrower than the final mesh-native protocol

Current runtime truth also includes:

- a durable revisioned Sabha snapshot plus event log
- mesh-backed consultation with actor-origin attribution on accepted perspectives
- revision-checked mutation support through optional `expectedRevision` on mutating daemon `sabha.*` methods
- `sabha.resume` is the explicit operator-facing retry/resume surface for pending mesh consultations
- `sabha.get` and `sabha.gather` can stay inspection-first, while callers that want side effects use `sabha.resume`
- capability-routed participants pin to the actor that first satisfied the consultation, and retries stay on that actor instead of drifting to a different peer
- duplicate structured perspectives from the same participant are rejected instead of silently replacing earlier council input
- explicit `get`, `respond`, and `vote` operations in addition to `ask`, `gather`, `deliberate`, `record`, and `escalate`
- `sabha.repl.pull` for side-effect-free replication reads
- `sabha.repl.apply` for revisioned replicated snapshot application
- `sabha.repl.merge` now requires the intervening oplog when a remote snapshot is ahead of a replica that already has local history; a newer snapshot alone is treated as a conflict instead of silently skipping event continuity

Current limitation:

- this is still not a full multi-writer oplog/CAS merge protocol
- the current replication model is snapshot-plus-event-log, not canonical operation-event replay

If you are integrating with Chitragupta today, treat Sabha as a live deliberation capability and an expanding council contract.

## Read This With

- [runtime-constitution.md](./runtime-constitution.md)
- [current-status.md](./current-status.md)
- [p2p-mesh.md](./p2p-mesh.md)
- [runtime-integrity.md](./runtime-integrity.md)
