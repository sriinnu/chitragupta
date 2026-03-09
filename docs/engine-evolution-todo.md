# Engine Evolution Todo

This file tracks core-engine closure work that should not disappear into ad hoc notes.

## Done

- [x] Keep raw sessions canonical while making day/monthly/yearly consolidation artifacts carry source-session provenance.
- [x] Surface source session IDs from consolidated day-file recall so summaries remain drill-down capable.
- [x] Keep project-scoped Lucy live context from bleeding across projects on the daemon path.
- [x] Persist Nidra deep-sleep counters and pending sessions across daemon restarts.
- [x] Make deep-sleep Swapna runs use the exact pending session IDs per project instead of broadening to unrelated recent sessions.
- [x] Fail closed on daemon bridge reads and writes in production unless explicit local fallback is enabled.
- [x] Define stricter session-lineage defaults so CLI, API, serve, and internal agent paths do not accidentally share one session thread across many tabs or CLIs.
- [x] Promote only curated deep-sleep and periodic consolidation artifacts into the semantic/vector integrity path instead of trusting noisy raw activity.
- [x] Make Scarlett monitor semantic-sync lag and recall drift as first-class integrity signals and repair via semantic reindex.
- [x] Add explicit operator-facing session-lineage controls and docs for intentional same-session collaboration across many tabs or CLIs.
- [x] Make Nidra promote curated consolidated artifacts into the remote semantic layer on a first-class engine-owned path, not only adapter-specific sync flows.
- [x] Make `sabha.ask` and `sabha.gather` carry real peer consultation state by accepting structured peer perspectives and tracking pending/responded participants.
- [x] Prime the daemon-backed Scarlett/Lucy live notification bridge during TUI, API, and serve startup instead of waiting for lazy Transcendence access.
- [x] Compact low-signal sessions in derived day artifacts while keeping metadata-based freshness checks and raw-session provenance intact.
- [x] Persist active Sabha consultations, participant bindings, and submitted perspectives so in-flight councils survive daemon restart.
- [x] Use unique logical sessions for Nidra deep-sleep thresholds instead of repeated notifications on the same session.
- [x] Keep wake-up session notifications and partially unprocessed deep-sleep session IDs across the next LISTENING phase instead of dropping them.
- [x] Audit TypeScript project references in the root workspace build graph, not only package.json imports.
- [x] Register PAKT as an engine-owned compression capability with a daemon compression surface and routing metadata.
- [x] Make PAKT runtime availability/routing honest so the engine does not overclaim compression support when the runtime or required tools are missing.
- [x] Use PAKT to produce derived packed summaries for curated consolidation artifacts without replacing canonical sessions or semantic embeddings.
- [x] Prefer direct `pakt-core` integration inside Smriti and keep stdio `pakt` as the fallback runtime for engine-owned compression.
- [x] Add engine-native `autoresearch` and `acp-research-swarm` workflows so bounded experiment loops and ACP-style councils live inside the nervous system instead of as external-only patterns.
- [x] Persist bounded research outcomes through project memory and Akasha from the engine-owned workflow path.
- [x] Keep Prana research workflows on one canonical project/session path, propagate optional parent-session and lineage metadata into `session.open`, and treat daemon `compression.pack_context` as authoritative while the daemon is reachable.
- [x] Make the `research.bounded` route class operational instead of decorative by blocking bounded experiment execution when no executable engine lane is selected.
- [x] Resume same-owner pending Sabha mesh leases immediately after restart, and fall back from stale pinned capability actors to fresh capability resolution when necessary.
- [x] Add revision-checked Sabha mutation semantics, restart-time mesh consultation resume, and actor pinning for capability-routed council participants.
- [x] Split collaboration REST route registration into route-group modules while keeping `mountCollaborationRoutes()` as the single public facade and preserving exact response shapes.
- [x] Extract deterministic session-store helpers, agent prompt/event helpers, and PAKT runtime internals so those core files stay under the LOC cap without changing their public APIs.
- [x] Extract fact-extractor helpers, daemon socket bind helpers, daemon session helpers, and Nidra runtime-state helpers so those core files stay under the LOC cap without changing runtime behavior.
- [x] Extract mesh-router shared types/constants, main-session lifecycle hooks, daemon client shared types/errors, and autonomous MCP config helpers so those core files stay under the LOC cap without changing runtime behavior.
- [x] Finish the current non-test TypeScript LOC/hygiene sweep so every core file is at or under the 450-line cap.

## Next

- [ ] Push Sabha past restart-safe mesh consultation into fuller distributed merge / oplog semantics across multiple active nodes.
- [x] Add side-effect-free `sabha.repl.pull` and revisioned `sabha.repl.apply` so replicated Sabha state can move between nodes without resuming pending mesh work as a read-side effect.
- [x] Add first-class local runtime support for both `llama.cpp` and `Ollama` in the engine control plane.
- [x] Make `llama.cpp` the default performance-first local inference backend once the control plane lands.
- [x] Keep `Ollama` as a supported convenience/distribution adapter and fallback local runtime, without moving routing authority out of Chitragupta.
- [x] Route live-context packing through the daemon-owned compression surface first and fall back locally only when the daemon path is unavailable.
- [x] Apply that same daemon-first packing path to Transcendence and Vasana prompt enrichment so serve/API/agent prompt assembly stays aligned with MCP/Lucy behavior.
- [x] Apply that same daemon-first packing path to Takumi prompt synthesis for bulky repo/file context, and preserve packed Lucy hints as packed hints instead of truncating them to generic short-hint limits.
- [ ] Extend the engine-owned PAKT compression lane from curated-summary packing into more Nidra and Smriti compaction flows.
- [x] Tighten the `research.bounded` control-plane lane so discovery and route resolution influence capability selection materially, not only as advisory hints.
- [x] Make discovery-managed flex lanes (`chat.flex`, `tool.use.flex`) prefer healthy discovered capabilities first and support explicit `preferredModelId`/`preferredModelIds` hints without moving routing authority out of Chitragupta.
- [x] Persist packed research context into derived bounded-research records so recall can reuse the daemon-approved compacted context directly.
- [ ] Tighten Vaayu and Takumi consumer contracts around canonical sessions, bridge scopes, and provenance-aware recall.
- [x] Make explicit Takumi engine-route requests fail closed when daemon route resolution fails or when the engine selected Takumi but the Takumi bridge is unavailable.
- [x] Move the interactive agent and MCP `coding_agent` surfaces onto the same session-aware engine route-class path so route resolution governs execution beyond the original Takumi bridge entrypoint.
- [ ] Add richer operator UX above the current lineage controls for intentional same-session collaboration across many tabs or CLIs.
