# End-to-End Communication Flow

This guide explains how Chitragupta moves information from user input to durable memory, background consolidation, collaboration, and semantic sync.

Current as of March 7, 2026.

---

## The 10-second model

- Clients (CLI, MCP hosts, Hub, bridge consumers) do not write durable state directly.
- The daemon is the communication hub and single durable-write authority.
- Sessions and memory live in Smriti (session ledger, memory files, SQLite indexes, vectors, graph).
- Lucy and Scarlett are live runtime faculties that shape context and integrity behavior.
- Nidra runs background consolidation.
- Sabha handles structured multi-agent deliberation.
- Semantic mirror keeps curated memory artifacts queryable locally and optionally remotely.

---

## Who talks to whom

| Component | Primary role | Talks to |
| --- | --- | --- |
| Clients | User interaction surfaces | Daemon RPC and/or local HTTP routes |
| Daemon | Routing, auth, method scopes, single-writer access | Smriti, Anina, Sabha engine, Scarlett/Lucy services |
| Sessions (Smriti) | Canonical turn ledger | Daemon `session.*` and `turn.*` methods |
| Memory (Smriti) | Global/project/agent durable memory and recall | Daemon `memory.*`, `context.*`, `day.*` methods |
| Lucy | Live predictive context for current work | Reads shared Scarlett + Akasha-derived signals |
| Scarlett | Integrity probes and heal/recovery signaling | Writes warnings/corrections, notifies daemon clients |
| Nidra | Sleep-cycle lifecycle and consolidation orchestration | Driven by daemon `touch`/`notify_session` and timers |
| Sabha | Council deliberation and consensus/evidence flow | Daemon `sabha.*` methods and client notifications |
| Semantic mirror | Curated vector/search mirror of consolidated artifacts | Daemon `semantic.sync_status` / `semantic.sync_curated` |

---

## 1. Client-to-response flow (foreground path)

```text
User in client
  -> client sends request/turn to daemon
  -> daemon authenticates and authorizes method scope
  -> daemon resolves/opens session (or creates one)
  -> daemon appends turn to Smriti session ledger
  -> daemon serves memory/context reads for prompt shaping
  -> model/tool execution happens in the active runtime surface
  -> assistant turn is written back through daemon
  -> response returns to client
```

### What this means in practice

1. Client opens or resumes a session via `session.open`/`session.create`.
2. Client writes turns via `turn.add` (or `session.turn`).
3. Daemon persists session and turn data through Smriti.
4. Context is loaded through read methods such as `context.load`, `memory.recall`, `memory.unified_recall`, `day.show`, and `day.search`.
5. Client receives the assembled response and keeps rendering/UI state locally.

Durable truth is now shared across all connected clients because they are writing through one authority.

---

## 2. Sessions and memory communication

### Sessions

- Session identity and turn history are canonical in Smriti.
- The daemon exposes session lifecycle methods (`session.list`, `session.show`, `session.open`, `session.create`, `session.delete`, `turn.add`, `turn.list`, `turn.since`).
- This allows one client to continue where another left off without split session state.

### Memory

- Durable memory scopes: global, project, agent.
- The daemon provides read/write methods (`memory.get`, `memory.append`, `memory.write`, `memory.delete`, `memory.search`, `memory.recall`, `memory.unified_recall`).
- Day files (`day.list`, `day.show`, `day.search`) are human-readable consolidated memory artifacts layered on top of raw sessions.

---

## 3. Lucy and Scarlett communication

### Scarlett path (integrity)

- Scarlett runs internal probes (database health, Nidra heartbeat, consolidation queue, memory pressure, semantic sync drift).
- When a probe is unhealthy, Scarlett emits anomaly/heal signals through daemon notifications.
- Scarlett also writes warning/correction traces so integrity events become durable and queryable later.

### Lucy path (live intuition)

- Lucy live context is served via `lucy.live_context`.
- It merges persisted Scarlett-related regression signals with live daemon-scoped signals.
- Output includes predictions, optional fuzzy hit, and active live signals for the current query/scope.

In short: Scarlett detects and records integrity issues; Lucy consumes that signal stream to shape present-time context.

---

## 4. Nidra communication (background lifecycle)

Nidra is the daemon's background state machine:

- `LISTENING` — watches activity
- `DREAMING` — runs lighter consolidation paths
- `DEEP_SLEEP` — runs heavier maintenance/consolidation work

### Inputs to Nidra

- Foreground traffic drives `nidra.touch`.
- Logical session activity drives `nidra.notify_session`.
- Deep-sleep thresholding uses unique logical sessions, not repeated notifications for the same session.
- Scheduled timers trigger phase transitions and periodic consolidation windows.

### Outputs from Nidra

- Consolidation events emitted back through daemon event channels.
- Day consolidation and Swapna consolidation outputs in Smriti.
- Periodic monthly/yearly consolidation and archive tasks.
- Optional semantic mirror sync step after curated artifacts are updated.

Nidra makes memory growth and consolidation continuous, even when no single client stays active long-term.

---

## 5. Sabha communication (multi-agent deliberation)

Sabha is the council layer exposed through daemon `sabha.*` methods.

Typical flow:

1. A client convenes a council with `sabha.ask`.
2. Built-in or remote mesh peers can be consulted during `ask` / `gather`.
3. Participants submit perspectives with `sabha.submit_perspective`.
4. Clients inspect state with `sabha.gather` / `sabha.get`, and explicitly resume pending mesh work with `sabha.resume` when they want side effects.
5. Deliberation proceeds with challenge/respond/vote operations.
6. Result is concluded or escalated.
7. Active Sabha state is persisted by the daemon with a revisioned snapshot plus event log so an in-flight council can survive daemon restart.
8. Pending mesh consultations can resume on restart or on a later `sabha.resume`, and capability-routed participants stay pinned to the actor that first replied unless the mesh proves that target dead or unavailable.
9. `sabha.record` persists the final deliberation outcome and rationale into durable decision/memory paths.

The daemon can also push Sabha notifications (`sabha.consult`, `sabha.updated`, `sabha.recorded`, `sabha.escalated`) to connected clients, so council state stays synchronized.

---

## 6. Semantic mirror communication

Semantic mirror is a derived layer for fast semantic retrieval of curated memory artifacts.

### Source of truth for semantic mirror

- Curated consolidation artifacts (daily/monthly/yearly) with provenance metadata.
- Not raw turn exhaust directly.

### Flow

1. Consolidation generates/updates curated artifacts.
2. Local semantic sync is inspected/repaired for those artifacts.
3. Optional remote mirror sync pushes curated vectors/payloads.
4. Sync status and repair are exposed via:
   - `semantic.sync_status`
   - `semantic.sync_curated`

This keeps semantic retrieval aligned with provenance-bearing consolidated memory while preserving drill-down to canonical sessions.

---

## 7. End-to-end timeline example

```text
Client A starts work
  -> session.open (created)
  -> turn.add (user + assistant turns)
  -> memory/context reads for better replies

Client B joins later
  -> session.collaborate or POST /api/sessions/collaborate
  -> session.list / session.show / memory.recall
  -> sees the same durable continuity

Background daemon cycle
  -> Nidra DREAMING/DEEP_SLEEP
  -> day + Swapna + periodic consolidation updates
  -> semantic.sync_curated refresh

Complex decision appears
  -> sabha.ask + submit_perspective + deliberate
  -> sabha.record persists rationale

Integrity issue appears
  -> Scarlett probe warning + trace
  -> lucy.live_context includes new live signal
```

---

## Operational guarantees (user-facing)

- One durable writer: daemon-owned persistence paths.
- Shared continuity: clients read/write through the same session and memory authority.
- Background consolidation: Nidra runs regardless of one client session lifetime.
- Inspectable council reasoning: Sabha state and outcomes are queryable.
- Integrity-aware context: Scarlett health signals can influence Lucy live context.
- Provenance-aware semantic layer: semantic mirror tracks curated artifacts with source links.

---

## 8. Research and ACP workflow flow

Engine-native research loops now run through Prana workflow templates instead of staying as app-local scripts.

Typical `autoresearch` flow:

```text
Operator or internal trigger
  -> Prana workflow `autoresearch`
  -> autoresearch-scope defines target files, immutable files, metric, and hard budget
  -> acp-research-council fetches Lucy live context from the daemon and convenes Sutra/Sabha roles
  -> bounded experiment runs
  -> metric delta is evaluated
  -> daemon compression.pack_context optionally packs run context with PAKT
  -> daemon memory.append + akasha.leave persist the outcome
```

Typical `acp-research-swarm` flow:

```text
Operator or internal trigger
  -> Prana workflow `acp-research-swarm`
  -> Sutra/Sabha roles build a bounded research plan
  -> daemon compression.pack_context packs the council context
  -> daemon memory.append + akasha.leave persist the council outcome
```

This keeps the boundary clean:
- Chitragupta owns the daemon bridge, workflow, memory, and council state
- Takumi can execute code inside the envelope
- Vaayu orchestrates the workflow and can later present and control the experience

---

## Related docs

- [architecture.md](./architecture.md)
- [component-responsibilities.md](./component-responsibilities.md)
- [research-workflows.md](./research-workflows.md)
- [runtime-constitution.md](./runtime-constitution.md)
- [runtime-integrity.md](./runtime-integrity.md)
- [consumer-contract.md](./consumer-contract.md)
- [sabha-protocol.md](./sabha-protocol.md)
- [api.md](./api.md)
