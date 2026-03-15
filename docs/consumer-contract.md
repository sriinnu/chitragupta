# Consumer Contract

This document defines how external products and adapters integrate with Chitragupta.

Use it for:

- Vaayu
- Takumi
- future app bridges
- service adapters
- protocol clients

## Core Rule

Chitragupta is the engine.

Consumers integrate with the engine.
They do not become the authority for:

- durable memory
- canonical sessions
- routing policy
- bridge auth
- runtime integrity

## Runtime Roles

- Chitragupta
  - core engine
  - durable truth
  - runtime authority

- Vaayu
  - primary personal-assistant consumer
  - UX, channels, install suggestions

- Takumi
  - specialized coding consumer
  - executable capability the engine may route into

- Lucy
  - intuition
  - anticipation
  - live context shaping

- Scarlett
  - integrity
  - healing
  - anomaly sensing

- Sabha
  - council and peer-consultation layer

## Auth Model

Bridge clients should identify themselves explicitly.

Current model:

- daemon socket / named pipe
  - `auth.handshake`
  - bridge token
  - method scopes

- serve HTTP
  - serve-surface auth
  - separate from daemon socket auth

- MCP HTTP/SSE
  - bridge-token family plus transport checks

The long-term rule is:

- no anonymous durable-write clients
- no implicit second authority
- no app-local shadow auth for engine-owned operations

## Session Model

Chitragupta owns the canonical session ledger.

Consumers may attach metadata, but should not fork session truth.

Recommended shape:

- engine session
  - canonical user/project continuity

- consumer session metadata
  - app-specific annotations
  - UI or workflow details

- task or run id
  - ephemeral consumer execution unit

- subagent or council lineage
  - attached beneath the canonical engine session

Rule:

- session-scoped content belongs in the session ledger
- session-scoped content is not a standalone memory file

Session lineage defaults:

- CLI, API, serve, and internal agent-created sessions default to `isolated`
- consumers should only request `same_day` reuse when they are intentionally resuming the same cognitive thread
- many tabs in one project should usually mean many session IDs, not one shared session
- if a consumer wants shared continuity, it should pass explicit lineage metadata instead of relying on incidental reuse

### Lineage Controls

Canonical lineage controls:

- `sessionId`
  - explicit existing session to resume
- `clientKey`
  - stable client identity for one tab, window, or adapter actor
- `sessionLineageKey`
  - explicit lineage identifier for intentional same-thread reuse
- `lineageKey`
  - accepted alias on serve HTTP inputs
- `sessionReusePolicy`
  - `isolated` or `same_day`

Current serve HTTP headers:

- `x-session-id`
- `x-chitragupta-client`
- `x-chitragupta-lineage`

Current defaults by surface:

- CLI
  - isolated by default
- API
  - isolated by default
- serve
  - isolated by default unless the caller passes explicit session or lineage controls
- MCP
  - may reuse `same_day` continuity when the bridge can derive a stable MCP client identity and corresponding lineage metadata
  - explicit lineage metadata is still the clearest contract, but the current MCP path is not a pure opt-in-only model

Consumer rule:

- persist the returned `sessionId`
- reuse it only when you mean the same cognitive thread
- do not assume same project means same session

## Memory Model

Durable memory belongs to Chitragupta.

Engine-owned durable memory:

- identity and preferences
- project memory
- cross-project memory
- Akasha traces
- Buddhi decisions
- session transcripts and continuity

Consumer-owned ephemeral state:

- UI state
- temporary render state
- per-run local execution scratch
- short-lived adapter cache

Rule:

- durable truth stays in the engine
- disposable working state may stay local to the consumer

### Semantic Mirror

The semantic/vector layer is derived memory, not canonical truth.

Current engine rule:

- raw sessions remain canonical
- curated day/monthly/yearly consolidation artifacts are the semantic mirror source of truth
- consolidated artifacts keep `sourceSessionIds` so recall can drill back into raw sessions
- day artifacts may compact low-signal session detail for readability, so consumers must use canonical session APIs for full replay
- remote semantic sync is engine-owned, not consumer-owned

Consumer implication:

- consumers may request recall and sync status
- consumers should not upsert raw turn exhaust into the remote semantic mirror directly

## Capability Model

Consumers should ask for capabilities, not vendor names.

Good:

- `assistant.reply`
- `memory.recall`
- `predict.next`
- `health.status`
- `bridge.info`
- `bridge.capabilities`
- `route.classes`
- `route.resolve`
- `session.open`
- `session.turn`
- `compression.status`
- `compression.compress`
- `compression.auto`
- `compression.pack_context`
- `compression.normalize_context`
- `compression.unpack_context`
- `sabha.ask`
- `sabha.resume`
- `sabha.submit_perspective`
- `sabha.gather`
- `sabha.record`
- `sabha.escalate`
- `sabha.repl.pull`
- `sabha.repl.apply`

Bad:

- "always use provider X"
- "store durable state in app-local memory first"
- "pick vendor Y in the consumer and let the engine reconcile later"

## Local-First Policy

Routing policy belongs to the engine.

Default order:

1. deterministic local logic
2. local tools, indexes, and CLIs
3. local models
4. remote providers

Consumers may request constraints.
They should not become the global routing authority.

## Compression Contract

Compression is engine-owned too.

Current rule:

- Chitragupta may invoke PAKT as an executable compression capability
- `pakt-core` is the preferred engine-owned runtime; stdio `pakt serve --stdio` is the supported fallback
- the daemon exposes `compression.pack_context` for live-context packing, and engine surfaces should treat the daemon response as authoritative while it is reachable
- `compression.normalize_context` and `compression.unpack_context` now exist for consumers that need to safely reuse or expand already-packed context instead of layering packed payloads on top of packed payloads
- local in-process packing is only the daemon-unavailable fallback, not a bypass for a daemon-side `packed: false` decision
- daemon-authored Lucy guidance/prediction blocks should be reused verbatim by consumers instead of being rebuilt locally from raw predictions/signals when the daemon already provided them
- live Takumi prompt synthesis should use that same daemon-first packing path for bulky repo/file context, episodic hint sections, and recent-decision sections, while preserving packed Lucy hint blocks instead of collapsing them to generic short-hint limits
- consumers that reuse previously packed live context should normalize it first instead of blindly nesting packed payloads into another packed section
- auxiliary env exports are intentionally best-effort and may omit bulky raw context instead of bypassing the engine-owned packing policy
- consumers should inspect `compression.status` / `runtime.compression_policy` instead of assuming a specific runtime is always available
- consumers should request compression from the engine instead of inventing their own durable compaction lane
- compressed outputs remain derived artifacts and must preserve provenance back to canonical session or consolidation sources
- curated consolidation artifacts may include a derived PAKT-packed summary for transport/context packing, but semantic embeddings remain based on the original curated summary text

## Discovery-Aware Route Classes

The engine may use `kosha-discovery` to widen generic model lanes without handing routing authority to consumers.

Current examples:

- `chat.flex`
- `tool.use.flex`

Contract:

- consumers request the semantic lane
- the daemon may materialize discovered models into temporary routeable capabilities
- `route.resolve` still returns one engine-selected lane plus attached `discoveryHints`
- `discovery.info` should be treated as cached control-plane state and may expose freshness metadata such as schema version, TTL, routing authority, and cache age
- for `chat.flex` and `tool.use.flex`, the daemon now prefers healthy discovered capabilities first instead of treating discovery as a weak afterthought
- callers may pass `preferredModelId` or `preferredModelIds` inside the route-resolution context to express a discovery preference; the engine may hard-pin the matching healthy discovered capability, but the decision still belongs to Chitragupta
- consumers should not bypass this by hardcoding provider/model choices as a second authority
- consumers that want strict engine-lane enforcement should pass an explicit `routeClass` or `capability` together with the canonical `sessionId`
- when a canonical coding `sessionId` exists but no explicit `routeClass` is supplied, the coding path may infer a default engine route class from the task before resolving the lane
- bounded research is stricter: it now resolves both the workflow lane (`research.bounded`) and the execution lane (default `tool.use.flex`) through one daemon `route.resolveBatch` call before execution proceeds
- bounded research records now persist the packed context block itself when the daemon-approved PAKT path succeeds, so recall can reuse the derived compacted context without reconstructing it from raw logs
- bounded research records now also persist execution-binding provenance such as preferred discovered providers/models when a discovery-backed execution lane was selected
- bounded research records now persist git provenance (`gitBranch`, `gitHeadCommit`, dirty-state before/after) and fail closed if git refs change during the bounded run
- a Takumi bridge caller must fail closed when the engine resolves a non-Takumi lane instead of overriding that decision locally
- if the engine resolves the request to the local `tool.coding_agent` lane, the caller should respect that and fall back to the local coding CLI path instead of treating the result as a policy error
- if the engine resolves the request to a compatible model/runtime lane such as `discovery.model.*` or `engine.local.*`, the Takumi bridge may still execute, but only inside that engine-selected envelope and without overriding the selected lane locally
- a Takumi bridge caller must also fail closed when explicit engine-route resolution was requested but the daemon route lookup fails, or when the engine selected Takumi and the Takumi bridge is unavailable
- a Takumi bridge caller must also fail closed when an enforced route or enforced route envelope cannot be transported through the structured bridge contract without dropping authoritative engine selections
- when Takumi explicitly reports a provider or model outside an enforced engine-selected lane, the bridge should treat that as a contract violation and fail closed instead of accepting the run

## Sabha Replication Contract

Sabha replication is engine-owned too.

Current methods:

- `sabha.repl.pull`
  - side-effect-free replication read
  - does not resume pending mesh consultations
  - may return a snapshot when the caller is stale

- `sabha.repl.apply`
  - applies a replicated Sabha snapshot into local persistent state
  - refreshes runtime state from that persisted snapshot
  - uses revision checks to reject stale writers

Current limitation:

- replication is revisioned and journaled, but not yet a full operation-log merge protocol for multi-node concurrent writers

## Fallback Policy

Normal mode is daemon-first.

That means:

- daemon owns persistent writes
- writes fail closed when daemon authority is unavailable
- local fallback is explicit and narrow

Consumers should surface degraded mode instead of silently creating a second durable truth.

## Vaayu

Vaayu should be thin where continuity matters and specialized where UX matters.

Vaayu should:

- connect to the daemon
- open or resume engine-owned sessions
- report turns and observations back to the engine
- consume Lucy and Scarlett signals
- suggest installs or setup improvements when useful

Vaayu should not:

- fork durable memory
- own routing policy
- become a second auth authority

## Takumi

Takumi is modeled as both:

- a consumer of Chitragupta
- an executable capability the engine may route into

Takumi may own:

- coding workflow UX
- repo-local execution flow
- per-run scratch state

Takumi should not own:

- durable memory
- canonical session truth
- bridge auth authority
- global routing policy
- canonical execution identity beyond the engine-owned `execution.task.id` / `execution.lane.id` it was given

Takumi route policy rule:

- Takumi may schedule subtasks locally inside an engine-approved lane
- Takumi should not replace an engine-selected lane with its own provider choice when the caller supplied an explicit route class or capability for resolution
- when the engine resolves a non-Takumi lane, the Takumi bridge should stop and report the policy result instead of forcing execution through the bridge
- bridge callers should prefer the canonical `execution` object at the boundary and treat top-level `taskId` / `laneId` as transition aliases only

### Takumi Extensions

Takumi should host Takumi-local extensions.

That is the right place for:

- TUI and editor behavior
- slash commands and shortcuts
- repo-local workflow helpers
- coding-specific tool injection
- model-switching UX
- side-agent behaviors that are local to Takumi

Takumi extensions should call back into Chitragupta for engine-owned concerns.
They should not create a second durable authority for:

- memory
- sessions
- auth
- routing
- health governance

Rule:

- Takumi-local behavior belongs in Takumi extensions
- engine-wide authority belongs in Chitragupta services and bridges

## Current Bridge Surface

Current consumer-facing daemon methods now include:

- `bridge.info`
  - engine authority and auth snapshot

- `bridge.capabilities`
  - grouped method surface for consumers

- `route.classes`
  - named engine-owned route lanes for stable consumer behavior

- `route.resolve`
  - resolves a route class or raw capability to the engine-selected lane
  - also returns optional `discoveryHints`, so provider/model inventory and cheapest-route guidance stay attached to the engine decision
  - may return an `executionBinding` envelope when the selected lane is an executor such as Takumi and the engine wants the consumer to stay inside a discovery-backed model/provider set
  - that envelope can now carry both the preferred provider/model set and the currently selected provider/model pair the consumer should honor
  - coding/Takumi consumers should carry the resulting execution decision forward as one canonical `execution` object instead of inventing fresh task/lane ids per bridge surface
  - consumers that request explicit engine-route enforcement should treat route-resolution failure as a hard stop, not as permission to fall back to a local vendor choice

- `route.resolveBatch`
  - resolves multiple route classes in one daemon call
  - intended for consumers with role-based planners/workers/reviewers so they do not rebuild route policy locally

- `session.open`
  - consumer-friendly open-or-create session alias
  - defaults to isolated lineage unless explicit same-day reuse metadata is supplied

- `session.turn`
  - consumer-friendly turn append alias

- `session.show`
  - canonical session retrieval remains source-of-truth drill-down for consolidated recall

- `lucy.live_context`
  - live Scarlett/Lucy context lookup
  - pass `project` when the consumer is operating inside a concrete repo or project boundary
  - project-scoped calls still see global Scarlett health signals, but they do not inherit another project's scoped live regression state

- `sabha.ask`
  - convene a council consultation

- `sabha.resume`
  - explicitly retry or resume pending mesh-backed council work
  - use this when the caller wants side effects; keep `sabha.get` and `sabha.gather` for inspection-first reads

- `sabha.submit_perspective`
  - let a consulted peer submit structured feedback into Sabha state
  - use this instead of ad hoc side-channel feedback when the consumer participates in a council

- `sabha.gather`
  - gather the current state and collected perspectives of a Sabha
  - includes `perspectives`, `respondedParticipantIds`, `pendingParticipantIds`, and `consultationSummary`

- `sabha.deliberate`
  - run a deliberation round

- `sabha.record`
  - persist Sabha outcomes into Buddhi

- `sabha.escalate`
  - escalate to external authority or human review

## Non-Goals

This contract is not trying to:

- make every consumer identical
- forbid consumer specialization
- remove local ephemeral state
- force every UI surface into one implementation

The point is narrower:

- one engine
- one durable truth
- many consumers

## Read This With

- [runtime-constitution.md](./runtime-constitution.md)
- [current-status.md](./current-status.md)
- [vaayu-integration.md](./vaayu-integration.md)
- [coding-agent.md](./coding-agent.md)
- [takumi-executor-contract.md](./takumi-executor-contract.md)
- [hard-recovery-plan.md](./hard-recovery-plan.md)
- [vaayu-readiness-checklist.md](./vaayu-readiness-checklist.md)
