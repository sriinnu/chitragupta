# API Reference

Chitragupta exposes four interface layers: a **CLI** with command groups and interactive slash commands, an **MCP server** with tool surfaces for integration with Claude Code and other MCP clients, a **REST API** served via `chitragupta serve`, and a **Hub web dashboard** for visual monitoring and device pairing. This document is the canonical reference for public-facing interface families; exact tool/endpoint counts can vary by release.

For architectural context see [architecture.md](./architecture.md). For algorithmic details see [algorithms.md](./algorithms.md). For the Vedic model taxonomy see [vedic-models.md](./vedic-models.md).

Engine model:

- Chitragupta is the authority for durable sessions, memory, routing policy, and bridge auth.
- Vaayu and Takumi are consumers of the engine, not the owners of durable truth.
- The daemon is the primary single-writer runtime surface for stateful operations.
- The daemon now also exposes consumer-facing bridge methods for runtime capabilities and Sabha council operations.

See also:
- [runtime-constitution.md](./runtime-constitution.md)
- [consumer-contract.md](./consumer-contract.md)
- [current-status.md](./current-status.md)

---

## Table of Contents

1. [CLI Commands](#1-cli-commands)
2. [Interactive Slash Commands](#2-interactive-slash-commands)
3. [MCP Tools](#3-mcp-tools)
4. [REST API Endpoints](#4-rest-api-endpoints)
5. [MCP Resources and Prompts](#5-mcp-resources-and-prompts)

For exact serve-mode endpoint availability in your running build, use `GET /api/openapi.json`.
For exact MCP tool availability in your running build, inspect the tool list from your MCP client (`/mcp` in interactive mode).

Daemon consumer bridge methods:

- `bridge.info`
- `bridge.capabilities`
- `route.classes`
- `route.resolve`
- `route.resolveBatch`
- `session.open`
- `session.collaborate`
- `session.turn`
- `agent.tasks.checkpoint.list`
- `agent.tasks.checkpoint.get`
- `lucy.live_context`
- `compression.status`
- `compression.compress`
- `compression.auto`
- `semantic.sync_status`
- `semantic.sync_curated`
- `sabha.ask`
- `research.loops.get`
- `research.loops.active`
- `research.loops.schedule.get`
- `research.loops.dispatchable`
- `research.loops.checkpoint.get`
- `research.loops.checkpoint.list`
- `sabha.resume`
- `sabha.submit_perspective`
- `sabha.gather`
- `sabha.deliberate`
- `sabha.record`
- `sabha.escalate`

Notes:

- `lucy.live_context` accepts an optional `project` so live Scarlett/Lucy guidance can stay inside the current project boundary while still reflecting global engine health.
- `route.resolve` now returns the engine-selected lane, optional `discoveryHints`, and an optional discovery-backed `executionBinding` envelope for consumers such as Takumi.
- That `executionBinding` envelope can include the engine-selected provider/model pair as well as the preferred allowed set, so consumers can honor discovery without becoming routing authorities.
- `route.resolveBatch` resolves multiple named lanes in one call so a consumer can ask for planner/worker/reviewer envelopes without re-implementing engine routing locally.
- bounded Prana research workflows now use `route.resolveBatch` for both the workflow lane and the execution lane, and persist the chosen execution-binding provenance into the derived record.
- Day-file and consolidated-artifact recall paths can include `sourceSessionIds` so callers can drill from derived memory back into canonical raw sessions.
- Day-file summaries may compact low-signal sessions for readability; use `sourceSessionIds` and canonical session APIs when full-fidelity replay is required.
- `semantic.sync_status` and `semantic.sync_curated` operate on curated day/monthly/yearly consolidation artifacts, not raw turns.
- curated semantic artifacts may include a derived `packedSummary` payload produced by the engine-owned PAKT lane; embeddings still use the original curated summary text.
- the compression policy is runtime-aware: `pakt-core` is preferred and stdio `pakt` is the supported fallback.
- Swapna/Nidra compaction can also emit a derived packed compaction summary; raw turns and raw sessions remain canonical.
- live Takumi prompt synthesis now also uses the daemon-first packing path for bulky episodic-hint and recent-decision sections.
- `sabha.submit_perspective` lets a consulted peer write structured council feedback back into Sabha state.
- `sabha.gather` / `sabha.get` now include consultation fields such as `perspectives`, `respondedParticipantIds`, `pendingParticipantIds`, and `consultationSummary`.
- `sabha.resume` is the explicit contract for retrying or resuming pending mesh consultations without overloading read-only `sabha.get`.
- Sabha inspection surfaces now also include a machine-usable `resumePlan` so callers can distinguish "resume mesh dispatches", "await perspectives", and "inspect failed dispatches" without replaying the event log themselves.
- use `session.collaborate` or `POST /api/sessions/collaborate` when multiple tabs or agents should intentionally share one same-day lineage thread.
- use `agent.tasks.checkpoint.list` or `agent.tasks.checkpoint.get` to inspect timed-out generic agent work before retrying from scratch. Both now return a bounded `resumeContext` plus a machine-usable `resumePlan` alongside the raw durable checkpoint row.
- the same generic timeout/pickup state is now available over HTTP through:
  - `GET /api/agent/tasks/checkpoints`
  - `GET /api/agent/tasks/checkpoints/{taskKey}?project=...`
- use `research.loops.active` or `research.loops.get` to inspect current daemon loop ownership and whether an overnight run is resumable.
- `research.loops.get`, `research.loops.active`, `research.loops.checkpoint.get`, and `research.loops.checkpoint.list` now return a bounded `resumeContext` plus a machine-usable `resumePlan` so timeout pickup does not depend on raw checkpoint JSON alone.
- overnight loop summaries and persisted research records now carry optimizer-facing metadata:
  - per-round objective scores
  - explicit stop-condition hits
  - Pareto frontier annotations
- daemon-owned loop scheduling now also has a durable queue/lease surface:
  - `research.loops.enqueue` persists a queued overnight loop with its objective registry, stop conditions, and update budgets
  - `research.loops.schedule.get` inspects the durable queue/lease row for one `loopKey`
  - `research.loops.dispatchable` lists queued loops whose lease is free or expired so a resident scheduler can pick them up deterministically
  - the resident daemon now polls that dispatchable queue on `researchDispatchMinutes`, dispatches at most one loop at a time, and refuses to guess when the persisted workflow envelope is incomplete
  - resident dispatch also injects a process-unique `researchLeaseOwner`, and the overnight loop now forwards that owner through daemon start plus heartbeat control calls
- `research.outcome.record` is no longer ledger-only:
  - it can trigger bounded immediate semantic repair for the touched day and project horizon
  - any residual quality debt is persisted as deferred `queuedResearch` repair work
  - degraded inline repair now persists the exact deferred repair intent, not only the coarse scope identifiers
  - the daemon’s daily postprocess later drains that durable queue under the remaining cycle budget, carries capped-overflow scopes forward durably, and only allows clean remote semantic sync after outstanding repair backlog plus epoch-refresh completion are both clear
- daily daemon postprocess now returns an explicit refinement governor summary:
  - fixed phase order: `date-repair`, `research-repair`, `queued-repair`, `epoch-refresh`
  - the merged budget envelope actually used for that cycle
  - the bounded `researchSignalCount` and `queuedDrainLimit`
  - machine-usable `remoteHoldReasons` instead of only a boolean skip flag
- semantic refresh is epoch-aware:
  - stale embedding generations are tracked separately from content drift
  - curated semantic repair can be triggered by epoch drift, MDL quality debt, or research-originated refinement pressure
  - same-epoch quality debt repair now honors the active research refinement budget before widening repair
  - remote semantic publish is gated on full epoch-refresh completion, not only on deferred-quality counts
  - timeout pickup remains phase-safe rather than fully semantic for every closure-side effect; callers should treat `resumePlan` as the authoritative next action, not as proof that every prior tail action already replayed

---

## 1. CLI Commands

### Top-level Options

```
chitragupta [options] [command]
```

| Flag | Description |
|------|-------------|
| `-p, --print <prompt>` | Print mode: respond and exit |
| `-c, --continue` | Continue the last session |
| `-r, --resume` | Resume a session (interactive picker) |
| `-m, --model <model>` | Override the default model |
| `--provider <id>` | Override the default provider |
| `--profile <id>` | Override the agent profile |
| `--no-memory` | Disable memory loading |
| `-v, --version` | Show version |

### Command Groups

#### `provider` -- LLM Provider Management

| Command | Description |
|---------|-------------|
| `provider list` | List all registered providers with their models and configuration status |
| `provider add <provider-id>` | Guide the user through configuring a provider |
| `provider test <provider-id>` | Test a provider connection |

#### `session` -- Session Management

| Command | Description |
|---------|-------------|
| `session list` | List sessions for the current project |
| `session show <session-id>` | Display a full session transcript |
| `session search <query>` | Search sessions by query string |
| `session export <session-id> [--format json\|md] [--output file]` | Export a session |
| `session import <file>` | Import a session from an exported file |

#### `memory` -- Memory Management

| Command | Description |
|---------|-------------|
| `memory show` | Display the current project memory |
| `memory edit` | Open the project memory in `$EDITOR` |
| `memory search <query>` | Search all memory files across projects |

#### `agent` -- Agent Profile Management

| Command | Description |
|---------|-------------|
| `agent list` | List all available agent profiles (built-in and custom) |
| `agent create <name>` | Create a new custom agent profile interactively |
| `agent use <profile-id>` | Switch the active agent profile |

#### `config` -- Configuration

| Command | Description |
|---------|-------------|
| `config` | Display the current configuration |
| `config set <key> <value>` | Set a configuration value (dot-notation keys) |

#### `mcp` -- MCP Server Management

| Command | Description |
|---------|-------------|
| `mcp list` | List all configured MCP servers (global and project) |
| `mcp add <id> <command> [args...] [--project] [--name <name>]` | Add a stdio MCP server |
| `mcp remove <id> [--project]` | Remove MCP server |
| `mcp test <id>` | Test MCP server connection using its configured transport |

Notes:

- `mcp add` is the convenience path for stdio servers.
- HTTP MCP servers (`sse` and `streamable-http`) can be declared directly in `mcp.json`.
- `mcp test` now respects the configured transport instead of assuming stdio.

#### `orchestrate` -- Multi-Agent Orchestration

| Command | Description |
|---------|-------------|
| `orchestrate <plan-file \| preset-name>` | Run an orchestration plan |
| `orchestrate presets` | List built-in presets (code-review, tdd, refactor, bug-hunt, documentation) |

#### `workflow` -- DAG Workflow Engine

| Command | Description |
|---------|-------------|
| `workflow run <file \| template-name>` | Execute a workflow DAG |
| `workflow list` | List saved workflows |
| `workflow validate <file>` | Validate a workflow definition |
| `workflow templates` | List built-in templates (`code-review`, `refactor`, `bug-fix`, `deploy`, `autoresearch`, `acp-research-swarm`) |

#### `skill` -- Skill Format Converter (Setu)

| Command | Description |
|---------|-------------|
| `skill detect <file>` | Detect skill file format |
| `skill import <file> [--output <dir>]` | Import skill to vidhya format |
| `skill export <file> --format <claude\|gemini> [--output <file>]` | Export to other formats |
| `skill convert <file> --to <vidhya\|claude\|gemini> [--output <file>]` | Convert between formats |

#### `skills` -- Skill Security Pipeline

| Command | Description |
|---------|-------------|
| `skills pending` | List quarantined skills awaiting review |
| `skills approve <id>` | Promote skill to ecosystem |
| `skills reject <id> [reason]` | Reject and archive skill |
| `skills list` | List approved skills |
| `skills health` | Show health reports (evolution) |
| `skills scan <file>` | Run Suraksha security scanner |
| `skills ingest <path>` | Discover and quarantine skills from directory |
| `skills learn <query>` | Autonomously learn a new skill (Shiksha) |

#### `plugin` -- Plugin Management

| Command | Description |
|---------|-------------|
| `plugin list` | List installed plugins |
| `plugin load` | Load and display plugin info |
| `plugin install` | Show installation instructions |
| `plugin remove` | Show removal instructions |

### Server Modes

| Command | Description |
|---------|-------------|
| `serve [--port 3141] [--host localhost]` | HTTP API server + Hub dashboard |
| `mcp-server [--stdio\|--sse\|--streamable-http] [--port 3001] [--project <path>] [--agent] [--name <name>]` | MCP server |

---

## 2. Interactive Slash Commands

43 commands available during an interactive session.

### Basic

| Command | Description |
|---------|-------------|
| `/help` | Show command help |
| `/model <name>` | Switch model |
| `/thinking <level>` | Set thinking level (`none\|low\|medium\|high`) |
| `/compact` | Compact conversation context |
| `/memory [search <q>]` | Show/search project memory |
| `/clear` | Clear conversation |
| `/status` | Show session stats |
| `/agents` | Show agent tree |
| `/delegate <profile> <task>` | Spawn sub-agent |
| `/cost` | Show cost breakdown |
| `/diff` | Show recent file changes |
| `/mcp` | Show MCP server status |
| `/branch` | Branch current session |
| `/tree` | Show session tree |
| `/quit` / `/exit` / `/q` | Exit |

### Specialized Agents

| Command | Description |
|---------|-------------|
| `/code <task>` | Spawn Kartru (coding agent) |
| `/review [files...]` | Spawn Parikshaka (review agent) |
| `/debug <error>` | Spawn Anveshi (debug agent) |
| `/research <question>` | Spawn Shodhaka (research agent) |
| `/refactor <desc>` | Spawn Parikartru (refactor agent) |
| `/docs [task]` | Spawn Lekhaka (docs agent) |

### Self-Evolution (Phase 1)

| Command | Description |
|---------|-------------|
| `/vasana [id]` | List/inspect vasanas (behavioral tendencies) |
| `/nidra` | Nidra sleep daemon status |
| `/vidhi [name]` | List/inspect learned procedures |
| `/pratyabhijna` | Self-recognition narrative |

### Intelligence (Phase 2)

| Command | Description |
|---------|-------------|
| `/turiya [routing]` | Model routing stats |
| `/health` | Triguna health status |
| `/rta [audit]` | Invariant rules / audit log |
| `/buddhi [explain <id>]` | Decisions + Nyaya reasoning |

### Collective Intelligence (Phase 3)

| Command | Description |
|---------|-------------|
| `/samiti` | Ambient communication channels |
| `/sabha` | Sabha deliberation protocol |
| `/lokapala` | Lokapala guardian agents |
| `/akasha` | Akasha knowledge field traces |

### Autonomy (Phase 4)

| Command | Description |
|---------|-------------|
| `/kartavya` | Auto-execution pipeline |
| `/kala` | Kala Chakra temporal awareness |

### Meta

| Command | Description |
|---------|-------------|
| `/chetana` | Consciousness visualization |
| `/atman` | Complete agent soul report |
| `/vidya` | Vidya skill ecosystem dashboard |
| `/learn <query>` | Autonomous skill learning |
| `/skill <sub> <file>` | Setu skill porter |
| `/skills <sub>` | Skill security pipeline |
| `/workflow [sub]` | Prana workflows |
| `/stats` | Codebase power stats |

---

## 3. MCP Tools

MCP tools are exposed via the `chitragupta-mcp` binary and support `stdio`, legacy `sse`, and `streamable-http` transports. Tool inventory can vary by package version and enabled subsystems.

### File and Shell Tools (12)

#### `bash`

Execute shell command, captures stdout/stderr.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | yes | Shell command to execute |
| `cwd` | string | no | Working directory |
| `timeout` | number | no | Timeout in milliseconds |

#### `read`

Read file contents with line numbers.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Absolute file path |
| `startLine` | number | no | First line to read |
| `endLine` | number | no | Last line to read |

#### `write`

Create or overwrite a file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Absolute file path |
| `content` | string | yes | File content |

#### `edit`

Surgical text replacements within a file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Absolute file path |
| `edits` | array | yes | Array of `{oldText, newText}` objects |

#### `grep`

Search file contents with regex.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | yes | Regex pattern |
| `path` | string | no | Directory to search |
| `include` | string | no | Glob include filter |
| `fileType` | string | no | File type filter |
| `maxResults` | number | no | Maximum results |
| `contextLines` | number | no | Context lines around match |
| `invert` | boolean | no | Invert match |

#### `find`

Find files by glob patterns.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `patterns` | string[] | yes | Glob patterns |
| `path` | string | no | Root directory |
| `maxResults` | number | no | Maximum results |

#### `ls`

List directory contents.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | no | Directory path |
| `recursive` | boolean | no | Recurse into subdirectories |
| `maxDepth` | number | no | Maximum recursion depth |

#### `diff`

Unified diff between files or content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_a` | string | yes | First file path |
| `file_b` | string | no | Second file path |
| `content_b` | string | no | Content to compare against |
| `contextLines` | number | no | Context lines |

#### `watch`

Watch files for changes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | no | Path to watch |
| `durationMs` | number | no | Watch duration in milliseconds |
| `recursive` | boolean | no | Watch recursively |

#### `memory`

Read, write, append, or search memory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | yes | `read`, `write`, `append`, or `search` |
| `scope` | enum | yes | `global`, `project`, or `agent` |
| `content` | string | no | Content for write/append |
| `query` | string | no | Search query |

#### `session`

Session management operations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | yes | `list`, `show`, `search`, or `branch` |
| `sessionId` | string | no | Session identifier |
| `query` | string | no | Search query |
| `branchName` | string | no | Branch name |

#### `project_analysis`

Analyze project structure and dependencies.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | no | Project root path |
| `skipGit` | boolean | no | Skip git analysis |
| `skipDependencies` | boolean | no | Skip dependency analysis |
| `maxFiles` | number | no | Maximum files to analyze |

### Chitragupta Memory Tools (5)

#### `chitragupta_memory_search`

Search project memory (GraphRAG-backed).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `limit` | number | no | Maximum results |

#### `chitragupta_session_list`

List recent sessions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | no | Maximum sessions to return |

#### `chitragupta_session_show`

Show session by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | yes | Session identifier |
| `turnLimit` | number | no | Maximum turns to return |

#### `chitragupta_prompt`

Delegate task to agent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | yes | Prompt message |
| `provider` | string | no | Provider override |
| `model` | string | no | Model override |

#### `chitragupta_handover`

Generate a work-state handover summary for session continuity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | no | Session to summarize |
| `turnWindow` | number | no | Number of recent turns to include |

### Collective Intelligence Tools (8)

#### `samiti_channels`

List or query ambient communication channels.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channel` | string | no | Specific channel name |
| `limit` | number | no | Maximum messages |

#### `samiti_broadcast`

Broadcast a message to a channel.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channel` | string | yes | Target channel |
| `content` | string | yes | Message content |
| `severity` | enum | no | `info`, `warning`, or `critical` |

#### `sabha_deliberate`

Initiate multi-agent deliberation on a proposal.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `proposal` | string | yes | Deliberation proposal |
| `agents` | string[] | no | Agent profiles to involve |

#### `akasha_traces`

Query stigmergic knowledge traces.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `type` | enum | no | `solution`, `warning`, `shortcut`, `pattern`, `correction`, or `preference` |
| `limit` | number | no | Maximum results |

#### `akasha_deposit`

Deposit a knowledge trace into the Akasha field.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | Trace content |
| `type` | enum | yes | `solution`, `warning`, `shortcut`, `pattern`, `correction`, or `preference` |
| `topics` | string[] | yes | Topic tags |

#### `vasana_tendencies`

List behavioral patterns (vasanas).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | no | Maximum results |

#### `health_status`

Return current Triguna health status. No parameters.

#### `atman_report`

Generate complete agent self-report. No parameters.

#### `chitragupta_recall`

Search across Chitragupta's memory layers for prior sessions, memory entries, day files, and Akasha traces.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Natural-language recall query |
| `project` | string | no | Optional project-path filter |
| `limit` | number | no | Maximum results. Default `5` |
| `noCache` | boolean | no | Skip Transcendence predictive hits and search live memory layers only |
| `fresh` | boolean | no | Alias for `noCache` |

Operational notes:

- `noCache` and `fresh` have the same effect.
- When neither flag is set, recall may prepend a Transcendence predictive hit if one exists.
- Metadata includes whether fresh/no-cache mode was requested.
- Day-file recall results can now include `sourceSessionIds` when the best answer came from a consolidated artifact. Low-signal session detail may be compacted in that derived artifact, so use those IDs to drill back into canonical raw sessions when you need the full thread.

#### `coding_agent`

Route a coding task through Lucy, the Takumi compatibility bridge, and CLI fallback.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | yes | The coding task to execute |
| `mode` | enum | no | `full`, `plan-only`, or `cli`. Default `full` |
| `noCache` | boolean | no | Bypass predictive context and request fresh context reads |

Mode semantics:

| Mode | Behavior |
|------|----------|
| `full` | Lucy context injection -> Takumi bridge -> CLI fallback |
| `plan-only` | Returns a plan only. No commands are executed |
| `cli` | Skips Lucy/Takumi bridge and routes directly to a detected coding CLI |

Operational notes:

- Fresh/no-cache mode skips Transcendence predictive context during Lucy context assembly.
- The Takumi bridge propagates fresh intent into prompt text and environment variables.
- Bridge priority is Takumi structured mode first, Takumi plain CLI second, generic coding CLI fallback third.

---

## 4. REST API Endpoints

### Authority and Auth Boundaries

| Interface | Runtime authority | Auth model | Note |
|-----------|-------------------|------------|------|
| Daemon socket / named pipe (`@chitragupta/daemon`) | Primary single-writer runtime surface for persistent state | `auth.handshake` bridge token + scoped method authorization | Used by daemon-backed MCP/CLI flows. |
| Daemon loopback HTTP (`127.0.0.1:3690`) | Local operations/status surface | Loopback trust boundary (no bridge-token handshake) | Keep local-only. |
| Serve-mode HTTP (`chitragupta serve`) | User-facing API + Hub surface | Pairing/JWT + serve auth routes | Separate auth plane from daemon socket auth. |

Served by `chitragupta serve`. Default port 3141. When the Hub package is built, the server also serves the web dashboard at the root URL.
Endpoint groups below are representative and source-backed; use OpenAPI for exact per-build contract.

### Health and Observability

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Basic health check |
| `GET` | `/api/health/deep` | Deep health with system metrics |
| `GET` | `/api/metrics` | Prometheus-style metrics |
| `GET` | `/api/openapi.json` | OpenAPI spec |

### Sessions and Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List sessions |
| `GET` | `/api/sessions/:id` | Session details |
| `POST` | `/api/sessions` | Create session |
| `POST` | `/api/sessions/collaborate` | Open or reuse an explicit shared same-day lineage session |
| `POST` | `/api/chat` | Send message to agent |

`POST /api/sessions` accepts optional lineage/session fields:

- `sessionId`
  - resume the exact existing session instead of creating a new one
- `title`
- `clientKey`
- `sessionLineageKey`
- `lineageKey`
  - accepted alias for `sessionLineageKey`
- `sessionReusePolicy`
  - `isolated` or `same_day`
- `consumer`
- `surface`
- `channel`
- `actorId`

Response shape:

- `sessionId`
- `created`
- `requestId`

`POST /api/sessions/collaborate` requires one of:

- `sessionLineageKey`
- `lineageKey`
- `x-chitragupta-lineage`

It accepts the same optional session fields as `POST /api/sessions`, but applies intentional `same_day` reuse semantics.

`POST /api/chat` accepts the same lineage/session fields plus:

- `message`
  - required

Header aliases:

- `x-session-id`
- `x-chitragupta-client`
- `x-chitragupta-lineage`

`POST /api/chat` response includes:

- `response`
- `sessionId`
- `createdSession`
- `requestId`

Operational rules:

- sessions default to `isolated`
- intentional shared continuity must be explicit
- use `/api/sessions/collaborate` when multiple tabs, agents, or surfaces should share one thread intentionally
- raw sessions stay canonical even when recall later surfaces derived consolidation artifacts with `sourceSessionIds`
- compacted day artifacts are a retrieval surface, not a replay surface

### Agent Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agent/status` | Agent init status |
| `POST` | `/api/agent/reset` | Reset agent state |
| `GET` | `/api/agents` | List all agents |
| `GET` | `/api/agents/tree` | Full agent tree |
| `GET` | `/api/agents/stats` | Aggregate stats |
| `GET` | `/api/agents/:id` | Agent details |
| `GET` | `/api/agents/:id/tree` | Subtree |
| `POST` | `/api/agents/:id/spawn` | Spawn sub-agent |
| `POST` | `/api/agents/:id/abort` | Abort agent |
| `POST` | `/api/agents/:id/prompt` | Prompt agent |

### Async Jobs (Karya)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/jobs` | Submit async job |
| `GET` | `/api/jobs` | List jobs |
| `GET` | `/api/jobs/stats` | Queue stats |
| `GET` | `/api/jobs/:id` | Job details |
| `POST` | `/api/jobs/:id/cancel` | Cancel job |

### Memory (Smriti Dvaara)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/memory/scopes` | List memory scopes |
| `POST` | `/api/memory/search` | Search memory |
| `GET` | `/api/memory/:scope` | Get memory |
| `PUT` | `/api/memory/:scope` | Update memory |
| `POST` | `/api/memory/:scope` | Append to memory |
| `DELETE` | `/api/memory/:scope` | Delete memory |

These `serve` memory routes are daemon-backed by default. Reads may degrade to limited read-only fallback if the daemon is unavailable; writes remain single-writer and require the daemon path.

Valid scopes here are `global`, `project:<path>`, and `agent:<id>`.
Session-scoped content stays in the session ledger and is accessed through session APIs, not `/api/memory/:scope`.

### Providers and Tools

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/providers` | List LLM providers |
| `GET` | `/api/tools` | List tools |

### Auth (Dvarpalaka, Serve Mode)

These endpoints are for the `serve` HTTP surface. They do not replace daemon socket authentication (`auth.handshake`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/token` | OAuth token exchange |
| `POST` | `/api/auth/refresh` | Refresh JWT |
| `GET` | `/api/auth/me` | Current user |

### Self-Evolution (Phase 1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/vasanas` | List tendencies |
| `GET` | `/api/vasanas/:id` | Tendency details |
| `GET` | `/api/nidra/status` | Sleep daemon status |
| `POST` | `/api/nidra/wake` | Force wake |
| `GET` | `/api/vidhi` | List procedures |
| `GET` | `/api/vidhi/:name` | Procedure details |

### Intelligence (Phase 2)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/turiya/status` | Routing summary |
| `GET` | `/api/turiya/routing` | Detailed routing |
| `GET` | `/api/health/guna` | Triguna health |
| `GET` | `/api/rta/rules` | Invariant rules |
| `GET` | `/api/rta/audit` | Audit log |
| `GET` | `/api/decisions` | List decisions |
| `GET` | `/api/decisions/:id/reasoning` | Nyaya reasoning |

### Semantic Integrity

Daemon bridge methods for semantic mirror operations:

- `semantic.sync_status`
  - inspect local and remote semantic sync state for curated consolidation artifacts
- `semantic.sync_curated`
  - repair local semantic sync and mirror curated artifacts to the remote semantic store

These operate on:

- curated day artifacts
- curated monthly artifacts
- curated yearly artifacts

They do not treat raw turn exhaust as the canonical mirror source.

### Collective Intelligence (Phase 3)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/samiti/channels` | List channels |
| `GET` | `/api/samiti/channels/:name` | Channel messages |
| `POST` | `/api/samiti/channels/:name/broadcast` | Broadcast |
| `GET` | `/api/sabha/deliberations` | List deliberations |
| `POST` | `/api/sabha/deliberate` | Convene Sabha |
| `GET` | `/api/sabha/deliberations/:id` | Deliberation details |
| `GET` | `/api/lokapala/guardians` | Guardian agents |
| `GET` | `/api/lokapala/violations` | Findings |
| `GET` | `/api/lokapala/stats` | Guardian stats |
| `GET` | `/api/akasha/traces` | Query traces |
| `POST` | `/api/akasha/traces` | Leave trace |
| `GET` | `/api/akasha/stats` | Knowledge stats |

### Autonomy (Phase 4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/kartavya/pipeline` | Pipeline status |
| `GET` | `/api/kartavya/pending` | Pending proposals |
| `POST` | `/api/kartavya/execute/:id` | Execute duty |
| `GET` | `/api/kala/scales` | Temporal scales |
| `GET` | `/api/kala/context` | Temporal context |

### Skills (Vidya)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/skills` | List skills |
| `GET` | `/api/skills/ecosystem` | Ecosystem stats |
| `GET` | `/api/skills/compositions` | Yoga compositions |
| `GET` | `/api/skills/:name` | Skill report |
| `POST` | `/api/skills/:name/promote` | Promote lifecycle |
| `POST` | `/api/skills/:name/deprecate` | Deprecate |
| `POST` | `/api/skills/learn` | Autonomous learning |
| `POST` | `/api/skills/evaluate` | Evaluate lifecycles |

### Workflows (Prana)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/workflows` | List workflows |
| `GET` | `/api/workflows/executions` | Recent executions |
| `GET` | `/api/workflows/executions/:id` | Execution details |
| `GET` | `/api/workflows/:name` | Workflow DAG |
| `POST` | `/api/workflows/:name/run` | Execute workflow |

### Hub — Device Pairing (Dvara-Bandhu)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/pair/challenge` | Get current pairing challenge (passphrase, icons, QR data) |
| `POST` | `/api/pair/verify` | Submit pairing attempt (`{method, response}`) |
| `POST` | `/api/pair/refresh` | Refresh JWT (`{token}`) |
| `GET` | `/api/pair/devices` | List paired devices (requires Bearer token) |
| `DELETE` | `/api/pair/devices/:id` | Revoke a paired device (requires Bearer token) |

### Hub — Budget and Cost

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/budget/status` | Session + daily cost, limits, warnings, canProceed |
| `GET` | `/api/budget/history` | Daily cost history (last 30 days) |
| `GET` | `/api/budget/breakdown` | Cost breakdown by provider and by model |

### Hub — Model Catalog

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/models` | All available models across providers |
| `GET` | `/api/models/:id` | Model detail (pricing, capabilities) |
| `GET` | `/api/models/router` | TuriyaRouter state and strategy |

### Hub — Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | Current ChitraguptaSettings |
| `PUT` | `/api/settings` | Partial settings merge |

### WebSocket

| Protocol | Endpoint | Description |
|----------|----------|-------------|
| `WS` | `/ws` | Real-time agent interaction |

---

## 5. MCP Resources and Prompts

### Resources

| URI | Type | Description |
|-----|------|-------------|
| `chitragupta://memory/project` | `text/markdown` | Current project memory content |

### Prompts

| Name | Description | Arguments |
|------|-------------|-----------|
| `code_review` | Structured code review template | `file` (string, required) -- file to review; `focus` (string) -- `security`, `performance`, `style`, or `all` |
