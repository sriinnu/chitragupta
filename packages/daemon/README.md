# @chitragupta/daemon

![Logo](../../assets/logos/daemon.svg)

**सेवक (sevaka) — The Guardian Process**

**One daemon per user, Unix domain socket, single-writer SQLite, JSON-RPC 2.0 over NDJSON, health monitoring, auto-recovery, and resilience layer.**

The daemon is Chitragupta's centralized process — a long-lived background service that all MCP clients, CLI sessions, and tools connect to via a Unix domain socket. It owns all database writes (single-writer guarantee), eliminating SQLite contention across concurrent sessions.

## Installation

```bash
npm install @chitragupta/daemon
# or
pnpm add @chitragupta/daemon
```

**Requires Node.js >= 22.**

---

## Key Features

- **Unix domain socket** — `~/.chitragupta/daemon.sock`, one per user, fast IPC with no TCP overhead
- **Single-writer guarantee** — Daemon exclusively owns SQLite writes; clients only read through RPC
- **JSON-RPC 2.0 over NDJSON** — Standard protocol, newline-delimited for streaming
- **Health monitoring** — 3-state model (HEALTHY → DEGRADED → DEAD) with exponential decay scoring
- **Circuit breaker** — Automatic fallback to direct-read mode when daemon is unreachable
- **Auto-recovery** — Switches back to daemon mode when health restores to HEALTHY
- **Socket safety** — Liveness probe before bind; never clobbers a running daemon
- **Stale socket cleanup** — Detects and removes orphaned socket files from crashed processes
- **Numeric validation** — All RPC parameters validated with `parseNonNegativeInt` / `parseLimit`
- **Graceful shutdown** — Drains connections, flushes WAL, removes PID file and socket

## Architecture

```
@chitragupta/daemon
├── client.ts          DaemonClient — JSON-RPC client with auto-reconnect
├── server.ts          startServer(), bindServerSocket() with liveness probe
├── rpc-router.ts      RpcRouter — method registry, validation, dispatch
├── services.ts        registerServices() — all 15+ RPC methods
├── resilience.ts      HealthMonitor, HealthState, circuit breaker
├── protocol.ts        JSON-RPC 2.0 types (RpcRequest, RpcResponse, etc.)
├── paths.ts           resolvePaths(), ensureDirs(), cleanStaleSocket()
├── process.ts         spawnDaemon(), stopDaemon(), checkStatus()
├── entry.ts           Daemon entry point (CLI bootstrap)
└── index.ts           Public API exports
```

## RPC Methods

| Method | Type | Description |
|--------|------|-------------|
| `daemon.ping` | Read | Liveness check |
| `daemon.health` | Read | Health status + metrics |
| `session.list` | Read | List sessions by project |
| `session.show` | Read | Load session by ID |
| `session.create` | Write | Create new session |
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
| `day.show` | Read | Show day consolidation file |
| `day.list` | Read | List day files |
| `day.search` | Read | Search day files |
| `context.load` | Read | Load provider context |
| `fact.extract` | Write | Extract facts from text |
| `vidhi.list` | Read | List learned procedures |
| `vidhi.match` | Read | Match procedure by query |
| `consolidation.run` | Write | Run Swapna consolidation |

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

## Tests

```bash
# Run daemon tests
pnpm test -- packages/daemon/

# Integration tests (real socket)
pnpm test -- packages/daemon/test/server-integration.test.ts
```

---

Part of the [Chitragupta](https://github.com/sriinnu/chitragupta) monorepo.
