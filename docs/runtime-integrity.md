# Runtime Integrity and Nervous-System Wiring

This document describes the current runtime wiring for Chitragupta's internal integrity loops and self-healing paths.

It is intentionally concrete. The goal is to document what the running system does today, not the full conceptual mythology around the subsystem names.

Current as of March 7, 2026.

---

## Why this exists

Chitragupta has multiple subsystems that are valuable on their own, but the operational behavior depends on how they are wired together.

This document focuses on the integrity path:

- how signals are observed
- how decisions are recorded
- how traces are persisted
- how runtime health is maintained
- how recovery happens after faults

---

## Provenance and Scope

This document is intentionally narrower than the mythology around the subsystem names.

- It describes source-backed runtime wiring in this repository.
- It does not treat planned daemon or Takumi binding work as implemented unless the code path exists today.
- It uses research and adjacent-system lineage as context, not as a claim that the integrity loop was copied from pi-mono or directly imported from a paper.

For this document, the useful provenance split is:

| Provenance type | What it means here |
| --- | --- |
| Chitragupta-native composition | The Buddhi/Akasha/Nidra/Triguna/Lokapala integrity loop as assembled in this repo |
| Adjacent product lineage | Some operator and coding-agent workflow patterns that sit in the same ecosystem as tools such as pi-mono |
| Research grounding | External papers that justify or inspire parts of the design without implying a direct implementation of the whole loop |

---

## Core components

| Component | Runtime role today |
| --- | --- |
| Buddhi | Records significant tool-selection decisions from agent events |
| Akasha | Shared trace store for warnings, patterns, and operational findings |
| Nidra | Idle-state lifecycle manager for touch/session tracking and deep-sleep maintenance |
| Triguna | Health/state signal source for the runtime |
| Lokapala | Guardian findings for correctness, security, and performance |
| Autonomous MCP manager | Circuit breaking, quarantine, recovery, and rediscovery for MCP servers |

---

## Current live wiring

### 1. Skill-gap and guardian findings -> Akasha

Two important integrity sources now leave real Akasha traces instead of staying local-only:

| Source | Current write path |
| --- | --- |
| Missing-tool / skill-gap events | `wireSkillGapRecorder()` -> `leaveAkashaTrace()` -> Akasha `leave()` -> immediate SQLite persist |
| Lokapala warning/critical findings | `onFinding()` subscription -> `leaveAkashaTrace()` -> Akasha `leave()` -> immediate SQLite persist |

This matters because the findings become queryable by other runtime surfaces instead of being trapped inside a local callback, and they no longer depend on a single mutable Akasha event hook for durability.

### 2. Buddhi decision capture

Buddhi is now wired to agent event flow for significant tool executions.

Current behavior:

- listens to `tool:done`
- ignores low-signal tools such as simple reads and globs
- records decisions for higher-signal actions such as `write`, `edit`, `bash`, `coding_agent`, `sabha_deliberate`, and `chitragupta_prompt`

This gives the runtime a durable audit trail for tool-selection decisions instead of treating them as transient event noise.

In serve mode, the session identity is now the real Smriti session id for the active chat, not a synthetic constant shared across unrelated turns.

### 3. Sabha consultation integrity

Sabha consultation is now more than a local deliberation record.

Current behavior:

- `sabha.ask` can notify bound peers
- `sabha.resume` can explicitly retry or resume pending mesh consultations
- consulted peers can now submit structured perspectives back into Sabha state
- `sabha.gather` and `sabha.get` expose:
  - `perspectives`
  - `respondedParticipantIds`
  - `pendingParticipantIds`
  - `consultationSummary`
- `sabha.record` now carries consultation provenance into Buddhi metadata instead of only the final verdict

This matters because council-style reasoning is now inspectable and partially auditable before a final vote or escalation happens.

### 4. Triguna health actuation

Triguna health events can now flow through the serve-mode actuator path:

- Chetana emits health-related events
- `createTrigunaHandler()` routes them into `TrigunaActuator`
- the actuator can then interact with Kaala and Samiti

This is the current integrity/control path for translating internal health signals into runtime action.

The main runtime surfaces now also prime the daemon Scarlett notification bridge during startup, so live anomaly and heal signals begin flowing before a later Transcendence lookup happens to touch the predictive path.

### 5. Nidra lifecycle tracking

Serve-mode Nidra behavior is now tied to real prompt traffic:

- `touch()` is called on every serve prompt
- `notifySession()` is called once per logical serve chat session, not once per prompt

That keeps idle/deep-sleep transitions aligned with real session behavior instead of inflated prompt counts.

### 6. Deep-sleep maintenance

Nidra's deep-sleep hook now performs operational maintenance work:

- WAL checkpoint
- VACUUM
- FTS optimize
- consolidation pruning
- exact pending-session grouping by project before Swapna runs
- clearing only the pending session IDs that were actually processed

Deep sleep no longer broadens the maintenance scope to unrelated recent sessions when an exact pending-session set is available.

This is the current runtime hygiene path for keeping the local persistence layer healthy over time.

### 7. Live prompt integrity

The Anina agent now rebuilds its effective system prompt on every prompt turn from:

1. base system prompt
2. fresh memory prompt context
3. soul prompt, if available

If a later refresh fails, the agent falls back to the last successful memory prompt context.

That behavior favors current state while still degrading safely under a transient memory-load failure.

### 7. Autonomous MCP self-healing

The autonomous MCP manager now has a real recovery loop after quarantine expiry:

- startup overrides rebuild the circuit breaker instead of being ignored
- a periodic sweep checks expired quarantines
- recovery attempts actually restart or start servers where appropriate
- successful recovery clears quarantine and crash-history state
- failed recovery remains quarantined for later retries

This is the current self-healing path for MCP infrastructure.

### 8. Semantic mirror integrity

Scarlett now treats semantic sync drift as a first-class integrity problem.

Current behavior:

- curated day/monthly/yearly consolidation artifacts are the semantic mirror source of truth
- Scarlett probes whether those curated artifacts are missing, stale, or drifted in the semantic layer
- the daemon exposes semantic inspection and repair methods
- repair can reindex the local curated semantic layer and mirror curated artifacts to the remote semantic store
- low-signal session compaction happens before day-artifact promotion, while provenance and raw-session recovery stay intact

This keeps semantic recall aligned with provenance-bearing consolidated memory instead of trusting raw noisy turn exhaust.

---

## Integrity flow

The current integrity loop looks like this:

```text
runtime signal
  -> event handler
  -> Buddhi / Akasha / Nidra / actuator path
  -> durable record or maintenance action
  -> later recall, monitoring, or recovery
```

More concretely:

```text
tool failure or missing tool
  -> skill-gap recorder
  -> Akasha trace
  -> Vidya gap tracking

guardian warning
  -> Lokapala finding
  -> Akasha trace

significant tool completion
  -> Buddhi decision record

serve prompt activity
  -> Nidra touch/session update

deep sleep pending sessions
  -> exact per-project Swapna run
  -> curated artifact with source-session provenance
  -> semantic mirror sync / repair eligibility

MCP crash or repeated failure
  -> circuit breaker / quarantine
  -> scheduled recovery attempt

semantic drift or missing curated vector
  -> Scarlett semantic probe
  -> semantic repair / remote mirror sync
```

---

## What is still split

The internal integrity story is materially better, but not fully unified yet.

| Split link | Current reality |
| --- | --- |
| Scarlett -> Lucy predictive context | Scarlett-side health signals and Lucy-side predictive context still do not share one process-wide Transcendence instance, but they now bridge through persisted Scarlett warning traces that the CLI ingests into Transcendence refreshes |
| Runtime integrity vs coding bridge | The coding path consumes some Lucy behavior, but Lucy/Scarlett are broader internal runtime concepts than the Takumi bridge alone |
| Takumi contract | Takumi integration is still based on CLI compatibility rather than a dedicated protocol designed for internal runtime coordination |
| Planned daemon binding | The daemon now ships an initial binding surface with server push, `observe.batch`, predictions, health, and heal reporting, but the full Takumi-side coordination loop from the internal note is still incomplete |

---

## Recommended reading order

1. [coding-agent.md](./coding-agent.md) for user-facing coding-path behavior
2. [architecture.md](./architecture.md#current-runtime-wiring) for system-wide runtime placement
3. [research.md](./research.md) for paper-level grounding and provenance semantics
4. this document for the concrete integrity and nervous-system links

---

## Source references

- `packages/cli/src/nervous-system-wiring.ts`
- `packages/cli/src/main-serve-helpers.ts`
- `packages/cli/src/main-serve-mode.ts`
- `packages/cli/src/routes/collaboration.ts`
- `packages/cli/src/modes/mcp-subsystems.ts`
- `packages/anina/src/agent.ts`
- `packages/anina/src/memory-bridge.ts`
- `packages/daemon/src/entry.ts`
- `packages/daemon/src/services-semantic.ts`
- `packages/tantra/src/mcp-autonomous.ts`
- `packages/tantra/src/mcp-autonomous-internals.ts`
- `packages/smriti/src/remote-semantic-sync.ts`
- `packages/smriti/src/swapna-consolidation.ts`
- `packages/anina/src/chitragupta-daemon.ts`
