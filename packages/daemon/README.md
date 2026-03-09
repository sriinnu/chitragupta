# @chitragupta/daemon

![Logo](../../assets/logos/daemon.svg)

**सेवक (sevaka) — The Guardian Process**

**One daemon per user, Unix domain socket, single-writer SQLite, JSON-RPC 2.0 over NDJSON, health monitoring, auto-recovery, and resilience layer.**

The daemon is Chitragupta's centralized process — a long-lived background service that MCP clients, CLI sessions, and tools connect to over local IPC (Unix socket or Windows named pipe). It owns all database writes (single-writer guarantee), eliminating SQLite contention across concurrent sessions.

This package is one of the core runtime surfaces for Chitragupta's internal self-healing story. Scarlett's internal daemon health loop lives here; the broader Lucy/Scarlett runtime remains platform-wide, not daemon-only.

Within the product family, the daemon is the operational authority for normal persistent runtime behavior. Vaayu, Takumi, CLI, MCP, and serve surfaces should treat it as the primary state owner rather than inventing parallel durable write paths.

Related operator docs:

- Runtime integrity wiring: [../../docs/runtime-integrity.md](../../docs/runtime-integrity.md)
- System placement: [../../docs/architecture.md#current-runtime-wiring](../../docs/architecture.md#current-runtime-wiring)

## Installation

```bash
npm install @chitragupta/daemon
# or
pnpm add @chitragupta/daemon
```

**Requires Node.js >= 22.**

---

## Key Features

- **Platform-aware local IPC path** — Unix socket on macOS/Linux and named pipe on Windows (`resolvePaths()` in `src/paths.ts`)
- **Single-writer guarantee** — Daemon exclusively owns persistent writes; clients read and write through authenticated RPC instead of bypassing the daemon
- **Bridge auth + scopes** — Socket/pipe clients authenticate via `auth.handshake` and are authorized per method scope
- **JSON-RPC 2.0 over NDJSON** — Standard protocol, newline-delimited for streaming
- **Health monitoring** — 3-state model (HEALTHY → DEGRADED → DEAD) with exponential decay scoring
- **Circuit breaker** — Automatic fallback to direct-read mode when daemon is unreachable (writes fail closed in fallback)
- **Auto-recovery** — Switches back to daemon mode when health restores to HEALTHY
- **Socket safety** — Liveness probe before bind; never clobbers a running daemon
- **Stale socket cleanup** — Detects and removes orphaned socket files from crashed processes
- **Numeric validation** — All RPC parameters validated with `parseNonNegativeInt` / `parseLimit`
- **Graceful shutdown** — Drains connections, flushes WAL, removes PID file and socket
- **Exact deep-sleep scope** — Nidra deep sleep groups pending sessions by project and runs Swapna on the exact pending session IDs instead of broadening to unrelated recent sessions
- **Semantic integrity probe** — Scarlett checks whether curated consolidation artifacts are missing or stale in the vector mirror and can repair them with semantic reindex
- **Dynamic compression honesty** — `pakt-core` is preferred, stdio `pakt` is the fallback, and the engine drops compression out of default routing when no healthy runtime is available

## Architecture

```
@chitragupta/daemon
├── client.ts          DaemonClient — JSON-RPC client with auto-reconnect
├── server.ts          startServer(), bindServerSocket() with liveness probe
├── rpc-router.ts      RpcRouter — method registry, validation, dispatch
├── services.ts        registerServices() — RPC method registration
├── resilience.ts      HealthMonitor, HealthState, circuit breaker
├── protocol.ts        JSON-RPC 2.0 types (RpcRequest, RpcResponse, etc.)
├── paths.ts           resolvePaths(), ensureDirs(), cleanStaleSocket()
├── process.ts         spawnDaemon(), stopDaemon(), checkStatus()
├── entry.ts           Daemon entry point (CLI bootstrap)
└── index.ts           Public API exports
```

## RPC Methods

Representative method families (actual inventory grows with daemon services and version):

| Method | Type | Description |
|--------|------|-------------|
| `daemon.ping` | Read | Liveness check |
| `daemon.health` | Read | Health status + metrics |
| `session.list` | Read | List sessions by project |
| `session.show` | Read | Load session by ID |
| `session.open` | Write | Open-or-create canonical session with lineage controls |
| `session.create` | Write | Create new session |
| `session.turn` | Write | Consumer-friendly turn append alias |
| `session.dates` | Read | List session dates |
| `session.projects` | Read | List session projects |
| `session.modified_since` | Read | Sessions modified after timestamp |
| `turn.add` | Write | Add turn to session |
| `turn.list` | Read | List turns with timestamps |
| `turn.since` | Read | Turns after turn number |
| `turn.max_number` | Read | Max turn number in session |
| `memory.file_search` | Read | Search memory files |
| `memory.scopes` | Read | List memory scopes |
| `memory.search` | Read | Search memory by query |
| `memory.recall` | Read | Recall from memory |
| `memory.append` | Write | Append to memory |
| `memory.unified_recall` | Read | Unified cross-layer recall |
| `compression.status` | Read | Inspect engine-owned PAKT compression runtime status |
| `compression.compress` | Tool | Compress text through the engine-owned PAKT runtime |
| `compression.auto` | Tool | Auto-compress or decompress text through the engine-owned PAKT runtime |
| `discovery.info` | Read | Inspect kosha-discovery integration status |
| `discovery.providers` | Read | Discover providers through the engine control plane |
| `discovery.models` | Read | Discover/filter models through the engine control plane |
| `discovery.cheapest` | Read | Rank cheapest discovered models for a role or capability |
| `discovery.routes` | Read | Show serving routes for a model |
| `discovery.refresh` | Write | Force-refresh cached discovery inventory |
| `day.show` | Read | Show day consolidation file |
| `day.list` | Read | List day files |
| `day.search` | Read | Search day files |
| `semantic.sync_status` | Read | Inspect curated semantic sync state |
| `semantic.sync_curated` | Write | Repair local semantic sync and mirror curated artifacts remotely |
| `context.load` | Read | Load provider context |
| `fact.extract` | Write | Extract facts from text |
| `vidhi.list` | Read | List learned procedures |
| `vidhi.match` | Read | Match procedure by query |
| `consolidation.run` | Write | Run Swapna consolidation |
| `sabha.repl.merge` | Tool | Oplog-aware merge/fast-forward for replicated Sabha state |

Socket/pipe clients must authenticate first:

```json
{"jsonrpc":"2.0","id":0,"method":"auth.handshake","params":{"token":"<daemon-bridge-token>"}}
```

Important session fields for consumers:

- `sessionId`
- `clientKey`
- `sessionLineageKey`
- `sessionReusePolicy` (`isolated` or `same_day`)
- `consumer`
- `surface`
- `channel`
- `actorId`

By default, consumer sessions are isolated. Intentional shared continuity must be explicit.

Compression notes:

- `compression.status` reports `preferredRuntime`, `defaultRuntime`, per-runtime status, and required tool presence.
- `pakt-core` is preferred by policy, but the default runtime only flips on when a healthy runtime is actually available.

Discovery notes:

- `kosha-discovery` is integrated as discovery input to the daemon control plane.
- It contributes provider/model inventory, route availability, pricing, and provider health.
- Route authority remains with Chitragupta; discovery does not replace engine policy.
- Generic engine lanes such as `chat.flex` and `tool.use.flex` can be widened into temporary routeable discovered-model capabilities during `route.resolve`.
- Consumers still receive one engine-selected lane plus `discoveryHints`; they should not treat discovery as a second routing authority.

## Usage

```bash
# Start the daemon
pnpm daemon

# Check status
pnpm daemon:status

# Ping
pnpm daemon:ping

# Stop gracefully
pnpm daemon:stop

# Force kill
pnpm daemon:kill
```

## Production Operations Boundaries

- Daemon is the persistent-state authority (single writer) for normal operation.
- Socket/pipe RPC is bridge-token authenticated and scope-gated.
- Local HTTP (`127.0.0.1:3690`) is an operations/status surface; it does not use the bridge handshake.
- CLI degraded fallback is intentionally read-only for a subset of methods and should be treated as temporary.
- Keep daemon interfaces local-only unless you add your own hardened network boundary.

## Programmatic Client

```typescript
import { createClient } from "@chitragupta/daemon/client";

const client = createClient({ autoStart: true });
await client.connect();

// RPC call
const sessions = await client.call("session.list", { project: "/my/project" });

// Health check
const health = await client.call("daemon.health");
console.log(health.status); // "healthy" | "degraded" | "dead"

client.dispose();
```

## Resilience Layer

```typescript
import { HealthMonitor, HealthState } from "@chitragupta/daemon/resilience";

const monitor = new HealthMonitor({
  degradedThreshold: 0.5,
  deadThreshold: 0.2,
  decayFactor: 0.9,
});

monitor.on("transition", (from, to) => {
  if (to === HealthState.DEAD) {
    // Switch to direct-read fallback
  }
});

monitor.recordSuccess(); // Score increases
monitor.recordFailure(); // Score decays
```

## Runtime Position

The daemon is not the whole Lucy/Scarlett runtime, but it is the main long-lived process that currently hosts:

- internal Scarlett health probes
- daemon-side persistence hygiene
- single-writer database ownership
- the socket/RPC boundary that other runtime surfaces depend on

For the broader nervous-system wiring, see [../../docs/runtime-integrity.md](../../docs/runtime-integrity.md).

## Tests

```bash
# Run daemon tests
pnpm test -- packages/daemon/

# Integration tests (real socket)
pnpm test -- packages/daemon/test/server-integration.test.ts
```

---

Part of the [Chitragupta](https://github.com/sriinnu/chitragupta) monorepo.
