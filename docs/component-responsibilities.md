# Component Responsibilities

This document is the user-facing boundary map for the core Chitragupta runtime and its primary consumers.

Use it as a contract:
- `exists for` explains why a component should exist
- `owns` defines source-of-truth authority
- `must not own` prevents split-brain behavior

## Responsibility Matrix

| Component | Exists for | Owns | Must not own |
|---|---|---|---|
| **Chitragupta** | The sovereign runtime engine that coordinates continuity, routing, and trust boundaries. | Canonical session lifecycle, memory authority, provider/CLI routing policy, daemon bridge contracts, auth/scoping boundaries. | Consumer-specific UX, app presentation state, or app-local copies of canonical session/memory truth. |
| **Smriti** | Durable memory and continuity substrate. | Session ledger persistence, memory storage/retrieval indexes, write-through integrity for turns and memory artifacts. | Model/provider selection, UI behavior, agent policy decisions, or independent auth authority. |
| **Buddhi** | Structured decision intelligence. | Decision records with reasoning, confidence, alternatives, and provenance metadata. | Raw transcript storage, transport/session authority, or replacing Smriti as primary memory store. |
| **Lucy** | Live context shaping and anticipation for active work. | Runtime context assembly (including fresh/no-cache behavior), prompt-time hint composition, live guidance consumption. | Durable persistence ownership, auth/routing authority, or becoming a second memory database. |
| **Scarlett** | Runtime integrity, anomaly detection, and healing supervision. | Health probes, degradation detection, recovery/heal signaling, resilience state transitions. | User/workflow authority, durable session truth, or replacing Lucy/Smriti with a parallel control plane. |
| **Nidra** | Background consolidation and maintenance lifecycle. | Sleep-cycle orchestration, consolidation scheduling/execution, low-priority upkeep and compaction tasks. | Interactive user-turn orchestration, foreground routing decisions, or front-door auth/session ownership. |
| **Sutra (ACP layer)** | Peer-to-peer agent communication and capability-routed coordination. | Mesh actor addressing, peer/capability routing, and the communication substrate used by councils and research swarms. | Durable memory/session authority, final decision records, or consumer-specific UX policy. |
| **Sabha** | Formal council-style deliberation for hard or high-impact choices. | Deliberation state (participants, perspectives, proposals, challenges, votes, verdicts), mesh-backed consultation roles, and council provenance for outcomes. | Canonical auth/session ownership, replacing Buddhi for final decision records, or ad hoc app-local council forks. |
| **Prana Research Workflows** | Bounded experiment and self-improvement orchestration inside the engine. | Workflow structure, hard experiment budgets, council/evaluation sequencing, and daemon-first orchestration of research memory writes. | Becoming a second durable memory store, replacing Takumi as a coding executor, or consumer-owned experiment truth. |
| **PAKT** | Engine-managed text compression capability for compaction and context packing. | Compression and auto-pack execution when invoked through Chitragupta's runtime contract. | Canonical session storage, durable memory authority, routing policy, or consumer-owned continuity decisions. |
| **Vaayu** | Primary assistant experience surface consuming engine capabilities. | Assistant UX, channel behavior, user interaction flow, install/onboarding suggestions. | Canonical memory/session ledger, provider routing authority, bridge/auth policy, or local durable truth forks. |
| **Takumi** | Specialized coding consumer and executable coding capability. | Coding workflow execution, tool orchestration within coding tasks, code-task result streams. | Canonical memory/session/auth/routing authority, or becoming the system-of-record for continuity state. |

## Practical Boundary Rules

1. **One durable truth**
Chitragupta + Smriti hold canonical durable continuity. Consumers may cache for UX, but must not fork authority.

2. **One trust boundary**
Bridge identity, scopes, and auth decisions remain engine-owned. Consumers authenticate to the engine contract.

3. **One routing center**
Provider and execution-lane policy is engine-owned. Consumers request capability, not vendor-specific policy control.

4. **Faculties are engine-internal**
Lucy, Scarlett, Nidra, and Sabha are runtime faculties/services. Consumers consume their outputs; they do not re-implement them as parallel authorities.

5. **Record outcomes in the right place**
- Smriti: continuity and memory artifacts
- Buddhi: structured decisions and reasoning
- Sabha: deliberation process and council state

## Anti-Patterns To Avoid

- Consumer app writes its own canonical session IDs and later "syncs" back.
- Consumer bypasses daemon/auth scope contract with ad hoc local trust.
- Fallback path silently creates a second durable memory or council state.
- Runtime faculty (Lucy/Scarlett/Nidra/Sabha) duplicated in a consumer as an independent control plane.

## Quick Decision Check

Before adding a feature, ask:
- Does this create a second source of truth for session or memory state?
- Does this move auth/routing authority out of the engine?
- Does this duplicate a runtime faculty as a consumer-owned authority?

If yes, the design breaks this contract and should be refactored.

## Related docs

- [end-to-end-communication-flow.md](./end-to-end-communication-flow.md)
- [architecture.md](./architecture.md)
- [research-workflows.md](./research-workflows.md)
- [runtime-integrity.md](./runtime-integrity.md)
- [consumer-contract.md](./consumer-contract.md)
