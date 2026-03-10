# Current Status

As of 2026-03-07, this is the runtime truth for Chitragupta.

This document exists because internal planning notes moved faster than the public docs.
It states what is live, what is partial, and what is still open.

## What Is Live

- The daemon is the primary single-writer authority for persistent state.
- Main runtime surfaces use daemon-backed session and memory paths by default.
- Socket RPC now uses bridge-token authentication with method scopes.
- Lucy and Scarlett are real runtime faculties inside the engine, not coding-agent-only features.
- Shared live Lucy context exists in the daemon, is exposed through daemon read APIs, and now honors project-scoped queries so one project's live regression state does not bleed into another project's prompt path.
- TUI, API, and serve now prime the daemon Scarlett notification bridge during startup instead of waiting for a later Transcendence lookup to initialize live anomaly and heal signals.
- Akasha, Buddhi, and Nidra have daemon-backed runtime paths for the main CLI, API, and serve flows.
- Day, monthly, and yearly consolidation artifacts now embed source-session provenance while keeping raw sessions as canonical truth.
- Day-file recall can now surface source session IDs for drill-down instead of returning an untraceable summary only.
- Day consolidation now compacts low-signal sessions in the derived day view for readability, but that compaction does not delete or rewrite canonical raw sessions.
- Nidra deep sleep now preserves its pending session set across restarts and hands Swapna the exact pending session IDs per project instead of re-expanding to unrelated recent sessions.
- Canonical session creation now defaults to isolated lineage for CLI, API, serve, and internal agent paths so many tabs or CLIs do not accidentally collapse into one cognitive thread.
- Same-day session reuse is now explicit lineage behavior instead of an accidental side effect. Legacy MCP reuse remains supported through explicit lineage metadata.
- Shared collaboration sessions are now explicit:
  - daemon `session.collaborate`
  - serve/API `POST /api/sessions/collaborate`
  - same-day lineage reuse is now a named operator action instead of an implicit side effect
- Serve and API session surfaces now expose explicit lineage controls instead of relying on incidental reuse:
  - `sessionId`
  - `clientKey`
  - `sessionLineageKey` / `lineageKey`
  - `sessionReusePolicy`
  - `x-session-id`
  - `x-chitragupta-client`
  - `x-chitragupta-lineage`
- Curated day/monthly/yearly consolidation artifacts are now the semantic-sync source of truth. Raw noisy activity is not treated as the canonical vector mirror input.
- The engine now owns the remote semantic mirror path for curated consolidation artifacts and exposes:
  - `semantic.sync_status`
  - `semantic.sync_curated`
- The daemon now exposes consumer-facing bridge methods for runtime introspection and session aliases.
- The daemon now exposes engine-owned route classes on top of the capability surface:
  - `route.classes`
  - `route.resolve` can resolve either a raw capability or a named engine route class
- `route.resolve` now also returns `discoveryHints` plus an optional `executionBinding` envelope so kosha-discovery contributes provider/model inventory, cheapest-route guidance, and the selected provider/model pair the consumer should honor alongside the engine-selected lane
  - `route.resolveBatch` now resolves multiple named lanes in one call for consumers such as Takumi
  - examples:
    - `coding.fast-local`
    - `coding.review.strict`
    - `coding.validation-high-trust`
    - `memory.semantic-recall`
    - `chat.local-fast`
    - `chat.flex`
    - `tool.use.flex`
    - `research.bounded`
- The daemon now exposes engine-owned provider/model discovery methods backed by `kosha-discovery`:
  - `discovery.info`
  - `discovery.providers`
  - `discovery.models`
  - `discovery.roles`
  - `discovery.cheapest`
  - `discovery.routes`
  - `discovery.capabilities`
  - `discovery.health`
  - `discovery.refresh`
- Discovery is engine-owned input, not final routing authority:
  - Chitragupta keeps route resolution authority
  - kosha-discovery contributes provider/model inventory, route availability, and pricing health
  - `discovery.info` now exposes stable control-plane metadata such as `schemaVersion`, `routingAuthority`, `snapshotTtlMs`, and `cacheAgeMs` so consumers can inspect freshness without mutating discovery state
  - discovery-aware route resolution can materialize discovered models into temporary routeable capabilities when the engine lane is generic enough (`model.chat`, `model.tool-use`, `chat.flex`, `tool.use.flex`)
  - legacy requests like `chat` and `function_calling` are normalized onto engine `model.*` lanes before routing, so discovery-backed selection is real instead of hint-only
  - preferred discovered candidates now keep discovery ordering, not just boolean preference membership
  - Takumi-style coding lanes can now receive a discovery-backed execution envelope with preferred providers/models while still leaving final route authority with Chitragupta
  - read queries use cached discovery state; `discovery.refresh` is the explicit write path
  - cached discovery state now expires on a short TTL instead of staying sticky forever between refreshes
  - consumers such as Takumi and external Vaayu can ask for route classes instead of hardcoding provider/model vendor choices
  - Takumi now treats compatible engine-selected model/runtime lanes as authoritative execution envelopes instead of rejecting them as non-Takumi overrides
- The daemon now exposes engine-owned compression methods backed by PAKT:
  - `compression.status`
  - `compression.compress`
  - `compression.auto`
  - `compression.pack_context`
  - `compression.normalize_context`
  - `compression.unpack_context`
- Compression is engine-owned:
  - `pakt-core` is the preferred compression runtime and stdio `pakt` is the supported fallback
  - the default runtime only flips on when one of those runtimes is actually available
  - routing drops the PAKT capability out of normal selection when no healthy compression runtime is available
  - compressed output remains derived data with provenance requirements
  - live-context packing now prefers the daemon compression surface and only falls back to a local in-process packer when the daemon path is unavailable
  - a daemon `packed: false` decision is authoritative and must not trigger local repacking while the daemon is reachable
  - `lucy.live_context` now returns daemon-authored packed guidance and prediction blocks, so CLI and MCP paths do not rebuild those blocks locally when the daemon already produced them
  - daemon-authored wrapped packed blocks can now be normalized or unpacked before reuse instead of being blindly nested or treated as opaque strings
  - Takumi live prompt synthesis now also packs bulky episodic-hint and recent-decision sections through the same daemon-first packing path instead of only packing repo maps and file excerpts
  - enforced Takumi route envelopes now fail closed before spawn if the authoritative engine lane cannot be transported safely through the structured bridge contract
- Curated day/monthly/yearly consolidation artifacts can now carry a PAKT-packed derived summary for transport and context packing.
  - raw sessions remain canonical
  - embeddings stay on the original curated summary text
  - packed summaries are additive derived payloads, not semantic truth
- Swapna/Nidra compaction can now also emit a derived packed compaction summary when compression is available.
- The engine now exposes Prana-native daemon-first research workflows instead of treating bounded experiment loops as an external pattern only:
  - `autoresearch`
  - `acp-research-swarm`
  - Prana research councils now bind to canonical daemon sessions, preserve optional parent-session and lineage metadata, and use the `research.bounded` lane, which resolves to the engine-owned `engine.research.autoresearch` capability under approval-gated policy
- bounded research now resolves both the workflow lane and the execution lane through one daemon `route.resolveBatch` call, then fails closed if the daemon does not return an executable engine-selected capability for the run
- bounded research now also fails closed when `session.open` does not return a canonical engine session id, instead of continuing with advisory-only route metadata
- bounded research now records git provenance in the durable experiment ledger:
  - `gitBranch`
  - `gitHeadCommit`
  - `gitDirtyBefore`
  - `gitDirtyAfter`
- bounded research now fails closed when git refs change during execution instead of silently treating a mutated branch as the same experiment lineage
- bounded research records now include the packed context payload itself when PAKT packing succeeds, so later recall can inspect the derived compacted context directly without losing provenance to the run/session metadata
- research records now keep execution-binding provenance, including preferred discovered providers/models when a discovery-backed execution lane was selected
- bounded research execution now also receives the engine-selected lane directly through its process environment, including selected provider/model ids and preferred discovered candidates, so the runtime behavior matches the recorded route provenance instead of treating it as metadata only
- ACP-style subagents now map to engine-owned Sutra/Sabha council roles rather than a second runtime:
  - `planner`
  - `executor`
  - `evaluator`
  - `skeptic`
  - `recorder`
- Research workflow outcomes can now be persisted into project memory and Akasha through the daemon-backed workflow path instead of requiring an external flat experiment ledger.
- The daemon now exposes live Sabha contract methods:
  - `sabha.ask`
  - `sabha.get`
  - `sabha.resume`
  - `sabha.submit_perspective`
  - `sabha.gather`
  - `sabha.deliberate`
  - `sabha.respond`
  - `sabha.vote`
  - `sabha.record`
  - `sabha.escalate`
  - `sabha.repl.pull`
  - `sabha.repl.apply`
  - `sabha.repl.merge`
- `sabha.ask` and `sabha.gather` are no longer only local bookkeeping:
  - peers can now submit structured perspectives back into Sabha state
  - built-in mesh consultation actors back memory/session consultation roles by default
  - gather/get surfaces now expose:
    - `revision`
    - `perspectives`
    - `recentEvents`
    - `respondedParticipantIds`
    - `pendingParticipantIds`
    - `consultationSummary`
- Sabha state is now revisioned and journaled:
  - daemon persistence keeps a `sabha_event_log` alongside the current snapshot
  - restart restore keeps revision/event history instead of only the last raw snapshot
  - mesh-backed perspectives now carry actor-origin metadata such as `meshReplyFrom`
  - mutating `sabha.*` calls can now reject stale writers via `expectedRevision`
  - remote-ahead Sabha merges now require the intervening oplog when the replica already has local history; a newer snapshot by itself is no longer enough to fast-forward a non-empty replica
  - `sabha.resume` is the explicit retry/resume contract for pending mesh consultations
  - `sabha.get` / `sabha.gather` remain inspection-focused and only resume when a caller opts in
  - pending mesh consultations can resume after restart instead of dying with the old daemon process
  - same-owner pending mesh leases now resume immediately during forced recovery instead of waiting for lease expiry
  - capability-routed participants pin to the actor that first replied, and retries stay on that actor instead of silently rebinding to a different peer
  - stale pinned capability actors can now fall back to fresh capability resolution instead of wedging the consultation on a dead peer
  - duplicate structured perspectives from the same participant are rejected instead of silently replacing earlier council input
  - replicated reads can now use `sabha.repl.pull` without resuming pending mesh consultations as a read-side effect
  - replicated snapshots can now be applied through `sabha.repl.apply` and rehydrated into runtime state
  - replicated peers can now use `sabha.repl.merge` to fast-forward on matching oplog ancestry instead of treating every higher revision as a blind snapshot overwrite
- Sabha recordings now carry consultation provenance into Buddhi metadata instead of only the final round verdict.
- Main CLI, API, serve, and MCP-facing Sabha paths now resolve through the daemon-backed council contract by default.
- MCP transport support now includes:
  - `stdio`
  - legacy `sse`
  - `streamable-http`
- MCP, serve, and TUI mesh observability in one CLI process now read from one shared mesh runtime snapshot instead of separate local views.
- Root build and engine verification are production-shaped:
  - `pnpm run build:check`
  - `pnpm run build`
  - `pnpm run verify:engine`

## What Is Strong

- Session and memory sovereignty
  - durable session truth belongs to Chitragupta
  - session-scoped content lives in the session ledger, not ad hoc memory files
  - HTTP memory routes go through daemon-backed APIs
  - derived consolidation artifacts link back to canonical raw sessions instead of replacing them

- Runtime boundaries
  - daemon socket auth is explicit
  - write fallback is fail-closed by default
  - local fallback is an operator override, not the normal path
  - compression and compaction policy stays inside the engine instead of moving into Vaayu or Takumi
  - bounded research loops and ACP-style council planning now stay inside the engine contract through a daemon-first path instead of moving into Takumi or Vaayu

- Nervous-system substrate
  - Scarlett emits anomaly and heal signals
  - Lucy consumes daemon-backed live context
  - Buddhi records higher-signal decisions
- MCP tool execution now gets Lucy live guidance and Vasana context preambles on generic task tools instead of bypassing the nervous system entirely
- MCP tool execution now also feeds Buddhi decision recording and Triguna health updates through the daemon-backed path
- MCP guidance now shapes generic tool execution input before the tool runs instead of only decorating the response afterward
- plain Lucy live guidance now follows the same engine-owned PAKT packing policy as the MCP wrapper and Lucy bridge paths
- Transcendence and Vasana prompt-enrichment blocks now follow that same daemon-first packing path before falling back to local packing
- Lucy auto-fix now uses that same daemon-first packing path for bulky failure output before issuing a follow-up repair task, instead of always dumping a raw trailing log tail into the fix prompt
- Takumi prompt synthesis now normalizes previously packed context before reusing it, so PAKT-authored repo or hint blocks are expanded for reuse instead of being blindly nested into another packed section
- Takumi prompt synthesis now applies that same daemon-first packing policy to bulky repo-map and file-context sections, and preserves packed Lucy hints instead of clipping them to generic hint length
- Takumi bridge execution can now honor explicit engine-owned route classes and refuses to override a non-Takumi engine-selected coding lane
- explicit Takumi engine-route requests now fail closed if daemon route resolution fails or if the engine selected Takumi but the Takumi bridge is unavailable
- Takumi now also performs a best-effort post-run contract audit: if the child process explicitly declares a provider or model outside an enforced engine-selected lane envelope, the bridge fails the run instead of silently accepting the contradiction
- a canonical coding session now defaults the coding path onto inferred engine route classes even when the caller did not pass one explicitly
- if that inferred engine route resolves to the local `tool.coding_agent` lane, the Takumi bridge now respects the decision and falls back to the generic local coding CLI path instead of failing
  - Smriti session integrity is materially stronger than earlier note snapshots
  - Scarlett now probes semantic-sync lag and recall drift for curated consolidation artifacts and can trigger semantic reindex repair
  - local mesh actors stay alive under the gossip layer instead of degrading to suspect/dead in long-lived MCP sessions
  - capability routing is active even before full P2P bootstrap, so local mesh actors can be addressed by capability as well as by actor id
  - MCP mode can bootstrap real P2P networking too when `CHITRAGUPTA_MESH_*` configuration is present
  - Prana can now orchestrate bounded research loops as part of the nervous system, combining Lucy context, ACP/Sutra/Sabha skepticism, Smriti/Akasha memory, and PAKT compression in one daemon-first engine path with canonical project/session binding and local fallback only when the daemon is unavailable

- Build and release hygiene
  - root build order is dependency-audited
  - engine verification exists as a reusable operator gate

## What Is Partial

- Scarlett and Lucy are connected in practice, but they are still not one perfectly unified live mind across every possible embedding surface.
- Sabha is real as a deliberation engine and now executes some consultation roles through built-in mesh actors, but it is still narrower than the long-term fully general peer-to-peer council protocol.
- Takumi integration is real through compatibility paths, but the dedicated bridge protocol is still incomplete.
- Vaayu is correctly framed as the primary consumer, but the full consumer contract is still being tightened and documented.
- Proactive memory surfacing exists through Lucy/live-context paths, but not every future push-style behavior is fully generalized.
- Same-session multi-writer semantics are storage-safe, but still cognitively noisy if many tabs intentionally share one session thread.

## What Is Still Open

- Full Sabha protocol expansion:
  - broader peer-to-peer execution behind `ask` and `gather`
  - richer cross-agent evidence collection
  - broader runtime adoption outside the current daemon contract
  - fuller multi-node merge / operation-log semantics beyond the current revisioned snapshot-plus-event-log model

- First-class local runtime control plane:
  - daemon now exposes `runtime.local_status` and `runtime.local_policy`
  - capability health for `engine.local.llamacpp` and `engine.local.ollama` now reflects live endpoint probes instead of static `unknown`
  - the engine policy prefers `llama.cpp` and keeps `Ollama` as a convenience fallback
  - not every higher-level consumer routing path is fully migrated to engine-selected local-runtime lanes yet
- Deeper PAKT adoption:
  - extend the current curated-summary and Swapna compaction packing paths into more Nidra/Smriti flows
  - expose richer operator insight around compression availability and failures

- Dedicated Takumi adapter protocol beyond CLI-compatible bridging

- Remaining transport hardening and compatibility work:
  - broader auth consistency and operator UX across all transport surfaces
  - wider remote-registry adoption of non-stdio MCP transports

- Fully unified cross-surface live nervous-system behavior for every non-standard embedding path
- Richer multi-tab collaboration UX above the existing explicit lineage/session controls

## P-Track Status

- `P0 auth`
  - materially live for daemon socket auth and serve/runtime boundaries
  - still not the final word for every transport surface

- `P1 memory aging / importance`
  - materially live in Smriti

- `P2 proactive memory surfacing`
  - materially live through Lucy guidance and daemon-backed live-context lookup
  - not yet the final push-everywhere form

- `P3 encrypted cross-device sync`
  - present in the library layer
  - higher-level operational UX is still less finished than the core implementation

- `P4 sessions and memory docs`
  - done in substance

- `P5 Leiden`
  - done

- `P6 triguna to routing influence`
  - materially present

- `P7 daemon restart resilience`
  - materially improved
  - still worth deeper end-to-end hardening over time

- `P8 publish and subtree hygiene`
  - materially present

- `P9 nervous-system blockers`
  - mixed
  - several older blockers are closed
  - a few transport and cross-surface gaps remain

## Why Older Notes Drift

Some older notes mixed four different things:

- shipped code
- intended architecture
- cross-repo backlog
- stale statements copied forward from earlier snapshots

This file is the normalized public version of the runtime truth.

## Read This With

- [runtime-constitution.md](./runtime-constitution.md)
- [consumer-contract.md](./consumer-contract.md)
- [runtime-integrity.md](./runtime-integrity.md)
- [coding-agent.md](./coding-agent.md)
