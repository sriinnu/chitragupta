# Chitragupta Daemon — Implementation Specification

> Version: 0.1.0-draft
> Date: 2026-02-28
> Status: Proposed
> Package: `@chitragupta/cli` (daemon mode) + new `@chitragupta/daemon` internal package

---

## 1. Overview

### Problem Statement

Chitragupta currently runs as an in-process MCP server. Each Claude Code session (or Cursor, Copilot, Codex session) spawns its own instance. This creates:

1. **Write contention.** Multiple processes opening the same SQLite databases in WAL mode. While reads are safe, concurrent writes from separate processes cause SQLITE_BUSY errors and potential corruption.
2. **No cross-session intelligence.** Session A's discoveries are invisible to session B until a file-system-level consolidation runs (which requires a session to be open).
3. **Orphaned consolidation.** The Nidra sleep cycle only runs inside an active session. Close all sessions, consolidation stops. Miss the 2am window, no backfill until a session manually triggers it.
4. **Redundant resource usage.** Each MCP server loads its own copy of the knowledge graph, vector index, and FTS5 tables into memory.

### Goals

- **G1.** Single-writer daemon process owns all SQLite databases. Zero write contention.
- **G2.** All MCP clients connect to the daemon via Unix socket. Shared memory in real time.
- **G3.** Consolidation runs on schedule regardless of client connections.
- **G4.** Socket activation — zero resource usage when idle, instant start on first connect.
- **G5.** Cross-platform: macOS (launchd), Linux (systemd), Windows (named pipes), VPS (systemd + remote Qdrant).
- **G6.** Graceful degradation — if daemon is unreachable, MCP adapter falls back to in-process mode.

### Non-Goals

- **NG1.** Multi-user / multi-tenant. The daemon serves one OS user.
- **NG2.** Remote API access over the internet (VPS mode is an exception, authenticated).
- **NG3.** Replacing the MCP protocol. The daemon speaks JSON-RPC internally; the MCP adapter translates.
- **NG4.** Running LLM inference. The daemon manages memory, not model execution.

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Developer's Machine                          │
│                                                                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │Claude Code │  │  Cursor    │  │   Codex    │  │  CLI REPL  │    │
│  │ (MCP host) │  │ (MCP host) │  │ (MCP host) │  │            │    │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘    │
│        │               │               │               │           │
│  ┌─────┴──────┐  ┌─────┴──────┐  ┌─────┴──────┐  ┌─────┴──────┐   │
│  │ MCP Adapter│  │ MCP Adapter│  │ MCP Adapter│  │ Direct RPC │   │
│  │   (thin)   │  │   (thin)   │  │   (thin)   │  │   Client   │   │
│  └─────┬──────┘  └─────┴──────┘  └─────┬──────┘  └─────┬──────┘   │
│        │               │               │               │           │
│        └───────┬───────┴───────┬───────┴───────┬───────┘           │
│                │  Unix Domain Socket / Named Pipe                   │
│                │  (~/.chitragupta/daemon/chitragupta.sock)          │
│                │                                                    │
│  ┌─────────────┴──────────────────────────────────────────────┐    │
│  │                   chitraguptad (daemon)                     │    │
│  │                                                             │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │    │
│  │  │  RPC Router  │  │  Session Mgr │  │  Auth Guard  │     │    │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────────┘     │    │
│  │         │                 │                                │    │
│  │  ┌──────┴─────────────────┴──────────────────────────┐    │    │
│  │  │              Service Layer                         │    │    │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐  │    │    │
│  │  │  │ Memory  │ │ Search  │ │ Session │ │  Graph │  │    │    │
│  │  │  │ Service │ │ Service │ │ Service │ │Service │  │    │    │
│  │  │  └────┬────┘ └────┬────┘ └────┬────┘ └───┬────┘  │    │    │
│  │  │       │           │           │           │       │    │    │
│  │  │  ┌────┴───────────┴───────────┴───────────┴────┐  │    │    │
│  │  │  │           Database Layer (single-writer)     │  │    │    │
│  │  │  │  agent.db │ graph.db │ vectors.db            │  │    │    │
│  │  │  └─────────────────────────────────────────────┘  │    │    │
│  │  └────────────────────────────────────────────────────┘    │    │
│  │                                                             │    │
│  │  ┌──────────────────────────────────────────────────┐      │    │
│  │  │         Nidra Consolidation Engine               │      │    │
│  │  │  Phase 1-6 pipeline │ Cron (croner) │ Backfill   │      │    │
│  │  └──────────────────────────────────────────────────┘      │    │
│  │                                                             │    │
│  │  ┌──────────────────────────────────────────────────┐      │    │
│  │  │              Cloud Sync                          │      │    │
│  │  │  Qdrant push │ S3/R2 archive │ Cross-device      │      │    │
│  │  └──────────────────────────────────────────────────┘      │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Daemon Process

### 2.1 Startup Sequence

The daemon starts in 10 ordered steps. Each step must complete before the next begins.

```
Step  Action                            Timeout   On Failure
────  ──────────────────────────────    ──────    ──────────────────────────
 1    Parse CLI flags + env vars         —        Exit with usage error
 2    Acquire PID file lock (flock)      1s       Exit: "another instance running"
 3    Write PID to file                  —        Exit: "cannot write PID file"
 4    Check/create data directories      —        Exit: "cannot create directories"
 5    Open SQLite databases (WAL mode)   5s       Exit: "database corruption"
 6    Run schema migrations              10s      Exit: "migration failed"
 7    Build in-memory caches (hot tier)  5s       Warn, continue with empty cache
 8    Start Unix socket listener         2s       Exit: "cannot bind socket"
 9    Register signal handlers           —        —
10    Start Nidra scheduler (croner)     —        Warn, continue without cron
```

**Step 1: Parse configuration.**

```typescript
interface DaemonConfig {
  /** Socket path. Auto-detected by platform if unset. */
  socketPath?: string;
  /** Data directory. Default: ~/.chitragupta/ */
  dataDir?: string;
  /** Consolidation hour (0-23). Default: 2 */
  consolidationHour?: number;
  /** Max days to backfill missed consolidation runs. Default: 7 */
  backfillDays?: number;
  /** V8 max-old-space-size in MB. Default: 256 */
  maxMemoryMb?: number;
  /** Enable verbose logging. Default: false */
  verbose?: boolean;
  /** Qdrant cloud endpoint. Optional. */
  qdrantEndpoint?: string;
  /** Qdrant API key. Optional. */
  qdrantApiKey?: string;
  /** VPS mode: also listen on TCP. Default: false */
  tcpPort?: number;
  /** TCP API key (required if tcpPort is set). */
  tcpApiKey?: string;
}
```

Configuration sources (in priority order):
1. CLI flags (`--socket-path`, `--data-dir`, etc.)
2. Environment variables (`CHITRAGUPTA_SOCKET`, `CHITRAGUPTA_DATA_DIR`, etc.)
3. Config file (`~/.chitragupta/daemon.json`)
4. Platform defaults

**Step 2: PID file lock.**

```typescript
import { openSync, flockSync, writeFileSync } from 'node:fs';

const pidFd = openSync(pidPath, 'w');
try {
  flockSync(pidFd, 'ex', /* nonblocking */ true);
} catch {
  process.stderr.write('Error: another daemon instance is running\n');
  process.exit(1);
}
writeFileSync(pidPath, String(process.pid));
```

The PID file uses `flock()` (advisory lock), not just file existence. This correctly handles stale PID files from crashed processes. On platforms without `flock` (Windows), use a named mutex.

**Step 5: Database initialization.**

```typescript
// All databases use WAL mode with tuned pragmas
const PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA cache_size = -16000;      -- 16MB cache
  PRAGMA mmap_size = 268435456;    -- 256MB mmap
  PRAGMA foreign_keys = ON;
  PRAGMA auto_vacuum = INCREMENTAL;
`;
```

**Step 7: Hot tier cache build.**

Load into memory:
- Active project identities (most recently accessed 10 projects)
- Global vasanas (behavioral tendencies)
- Top-100 consolidation rules by hit count
- RAPTOR tree root nodes (project-level summaries)

Target: under 2K tokens when serialized, under 5MB in-process.

### 2.2 Signal Handling

```
Signal    Action
───────   ────────────────────────────────────────────────────
SIGTERM   Graceful shutdown: finish active requests (5s timeout),
          flush WAL, close databases, remove PID file, remove socket
SIGINT    Same as SIGTERM (for interactive foreground mode)
SIGHUP    Reload configuration from daemon.json. Re-read hot tier cache.
          Do NOT restart databases (would drop connections).
SIGUSR1   Trigger immediate consolidation (equivalent to RPC consolidate.run)
SIGUSR2   Dump diagnostic info to stderr (active connections, memory usage,
          pending consolidation, cache stats)
```

Graceful shutdown sequence:

```typescript
async function shutdown(signal: string): Promise<void> {
  log.info(`Received ${signal}, shutting down...`);

  // 1. Stop accepting new connections
  socketServer.close();

  // 2. Wait for active requests to complete (max 5s)
  const timeout = setTimeout(() => {
    log.warn('Shutdown timeout, forcing close');
    forceClose();
  }, 5000);

  await Promise.allSettled(activeRequests);
  clearTimeout(timeout);

  // 3. Stop Nidra scheduler
  nidra.stop();

  // 4. Checkpoint WAL and close databases
  for (const db of [agentDb, graphDb, vectorsDb]) {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  }

  // 5. Clean up PID file and socket
  unlinkSync(pidPath);
  unlinkSync(socketPath);

  log.info('Daemon stopped cleanly');
  process.exit(0);
}
```

### 2.3 PID File Management

| Scenario | Detection | Action |
|----------|-----------|--------|
| No PID file | `!existsSync(pidPath)` | Start normally |
| PID file, process alive | `kill(pid, 0)` succeeds | Exit: "already running" |
| PID file, process dead | `kill(pid, 0)` throws ESRCH | Remove stale PID, start normally |
| PID file, flock fails | Another process holds the lock | Exit: "already running" |
| PID file, permission denied | Wrong user or file corruption | Exit with error |

### 2.4 Memory Limits

The daemon runs with constrained V8 heap to prevent memory bloat:

```bash
node --max-old-space-size=256 --max-semi-space-size=16 chitraguptad.js
```

Internal budgets:
- Hot tier cache: 5MB
- SQLite cache: 16MB per database (48MB total, via `cache_size` pragma)
- HNSW index: resident in SQLite mmap, not V8 heap
- Active request buffers: 2MB per connection, max 20 connections = 40MB
- Total target: under 200MB RSS

### 2.5 Health Monitoring (Self-Watchdog)

The daemon monitors its own health every 60 seconds:

```typescript
interface HealthCheck {
  /** RSS memory in bytes */
  rssBytes: number;
  /** V8 heap used in bytes */
  heapUsed: number;
  /** SQLite WAL size in bytes per database */
  walSizes: Record<string, number>;
  /** Number of active client connections */
  activeConnections: number;
  /** Number of pending RPC requests */
  pendingRequests: number;
  /** Last successful consolidation timestamp */
  lastConsolidation: number | null;
  /** Uptime in seconds */
  uptimeSeconds: number;
  /** Event loop lag in milliseconds */
  eventLoopLag: number;
}
```

Auto-corrective actions:

| Condition | Threshold | Action |
|-----------|-----------|--------|
| WAL size too large | > 64MB | Force WAL checkpoint |
| Memory too high | RSS > 300MB | Force GC, evict cold cache entries |
| Event loop lag | > 500ms | Log warning, shed lowest-priority requests |
| Database unreachable | 3 consecutive failed queries | Attempt reopen, emit health event |
| No consolidation in 48h | `Date.now() - lastConsolidation > 48h` | Trigger immediate consolidation |

---

## 3. Socket Communication

### 3.1 Socket Path Resolution

```typescript
function getSocketPath(): string {
  // 1. Explicit override
  if (process.env.CHITRAGUPTA_SOCKET) {
    return process.env.CHITRAGUPTA_SOCKET;
  }

  // 2. Platform-specific defaults
  switch (process.platform) {
    case 'darwin':
      // ~/Library/Caches/chitragupta/daemon/chitragupta.sock
      return path.join(
        os.homedir(),
        'Library/Caches/chitragupta/daemon/chitragupta.sock'
      );

    case 'linux':
      // $XDG_RUNTIME_DIR/chitragupta/chitragupta.sock
      const xdg = process.env.XDG_RUNTIME_DIR ?? `/run/user/${os.userInfo().uid}`;
      return path.join(xdg, 'chitragupta/chitragupta.sock');

    case 'win32':
      // Named pipe: \\.\pipe\chitragupta
      return '\\\\.\\pipe\\chitragupta';

    default:
      // Fallback: ~/.chitragupta/daemon/chitragupta.sock
      return path.join(os.homedir(), '.chitragupta/daemon/chitragupta.sock');
  }
}
```

Socket directory is created with mode `0700` (owner-only access).

### 3.2 Protocol: JSON-RPC 2.0 over NDJSON

The protocol is identical to the MCP stdio transport: newline-delimited JSON, one JSON-RPC message per line. This allows reuse of existing MCP parsing infrastructure.

```
CLIENT ──► DAEMON (request):
{"jsonrpc":"2.0","method":"memory.search","params":{"query":"auth bug","limit":10},"id":1}\n

DAEMON ──► CLIENT (response):
{"jsonrpc":"2.0","result":{"entries":[...]},"id":1}\n

DAEMON ──► CLIENT (notification, no id):
{"jsonrpc":"2.0","method":"consolidation.progress","params":{"phase":"extraction","percent":45}}\n
```

Message framing:
- Max message size: 10MB (configurable)
- Messages terminated by `\n` (0x0A)
- Encoding: UTF-8
- No HTTP, no WebSocket — raw NDJSON over the socket

### 3.3 Authentication

**macOS:**
Socket directory `~/Library/Caches/chitragupta/daemon/` has permissions `0700`. Only the owning user can connect. No in-protocol authentication needed.

**Linux:**
`SO_PEERCRED` on the accepted socket provides the connecting process's UID, GID, and PID:

```typescript
import { getpeercred } from './platform.js';

function authenticateConnection(socket: net.Socket): boolean {
  const cred = getpeercred(socket);
  if (!cred) return false;
  return cred.uid === process.getuid();
}
```

**Windows:**
Named pipe security descriptor restricts to the current user's SID at creation time:

```typescript
// Using node-windows or native N-API binding
const pipe = createNamedPipe('\\\\.\\pipe\\chitragupta', {
  securityDescriptor: `D:(A;;GA;;;${currentUserSid})`
});
```

**VPS / TCP mode:**
When `tcpPort` is configured, an API key is required:

```typescript
// First message on TCP connections must be an auth handshake
{"jsonrpc":"2.0","method":"auth.handshake","params":{"apiKey":"sk-..."},"id":0}
```

The daemon validates the key using timing-safe comparison against the SHA-256 hash stored in `daemon.json`.

### 3.4 Connection Lifecycle

```
Client                                     Daemon
  │                                          │
  ├──── connect() ──────────────────────────►│
  │                                          ├── accept()
  │                                          ├── authenticateConnection()
  │                                          ├── create ClientSession
  │◄──── {"method":"daemon.welcome"} ───────┤   (notification)
  │      {"params":{"version":"0.1.0",      │
  │       "sessionId":"cs_abc123"}}          │
  │                                          │
  ├──── RPC requests... ───────────────────►│
  │◄──── RPC responses... ─────────────────┤
  │                                          │
  │◄──── Notifications (consolidation, etc)─┤
  │                                          │
  ├──── {"method":"session.end"} ──────────►│
  │                                          ├── flush client buffers
  │◄──── {"result":"ok"} ──────────────────┤
  │                                          ├── destroy ClientSession
  ├──── close() ────────────────────────────►│
  │                                          │
```

**Heartbeat:** The daemon sends a `daemon.ping` notification every 30 seconds. If the client does not respond with a `daemon.pong` within 10 seconds, the connection is considered dead and cleaned up.

**Reconnection:** If the client detects socket close, it waits 100ms and reconnects. The daemon assigns a new session ID but the client can pass `resumeSessionId` in the first RPC to re-associate with the previous session context.

### 3.5 RPC Methods

All methods use the `namespace.method` convention. Parameters and return types are specified in TypeScript notation.

#### Memory Methods

```typescript
/** Search memory across all layers (FTS + vector + graph + RAPTOR) */
"memory.search": {
  params: {
    query: string;
    project?: string;        // scope to project (default: current)
    limit?: number;          // max results (default: 10)
    layers?: Array<'fts' | 'vector' | 'graph' | 'raptor'>; // default: all
    minConfidence?: number;  // 0-1 threshold (default: 0.3)
  };
  result: {
    entries: Array<{
      id: string;
      content: string;
      score: number;
      source: 'fts' | 'vector' | 'graph' | 'raptor';
      metadata: Record<string, unknown>;
    }>;
    timing: { totalMs: number; perLayer: Record<string, number> };
  };
};

/** Recall — unified search with RRF merge (highest-level search API) */
"memory.recall": {
  params: {
    query: string;
    project?: string;
    limit?: number;
    memoryDial?: number;     // 0.0 (fresh start) to 1.0 (max memory) — SteeM
  };
  result: {
    entries: Array<{
      id: string;
      content: string;
      score: number;
      sources: string[];     // which retrieval layers contributed
      metadata: Record<string, unknown>;
    }>;
  };
};

/** Write a memory entry (fact, decision, pattern, etc.) */
"memory.write": {
  params: {
    content: string;
    category: 'fact' | 'decision' | 'pattern' | 'solution' | 'warning' | 'correction';
    project?: string;        // null = global
    confidence?: number;     // 0-1 (default: 0.7)
    metadata?: Record<string, unknown>;
  };
  result: {
    id: string;
    indexed: boolean;        // true if immediately indexed, false if queued
  };
};

/** Read the hot-tier context (always-loaded project summary) */
"memory.hot": {
  params: {
    project: string;
  };
  result: {
    context: string;         // Serialized hot-tier, under 2K tokens
    tokenCount: number;
    lastUpdated: number;     // Unix epoch ms
  };
};

/** Delete a memory entry */
"memory.delete": {
  params: {
    id: string;
  };
  result: {
    deleted: boolean;
  };
};
```

#### Session Methods

```typescript
/** List recent sessions */
"session.list": {
  params: {
    project?: string;
    limit?: number;          // default: 20
    offset?: number;         // default: 0
    agent?: string;          // filter by agent name
  };
  result: {
    sessions: Array<{
      id: string;
      title: string;
      project: string;
      createdAt: number;
      updatedAt: number;
      turnCount: number;
      model: string | null;
      agent: string;
    }>;
    total: number;
  };
};

/** Show a session by ID (with turns) */
"session.show": {
  params: {
    id: string;
    includeTurns?: boolean;  // default: true
    turnLimit?: number;      // default: all
  };
  result: {
    session: {
      id: string;
      title: string;
      project: string;
      createdAt: number;
      updatedAt: number;
      turnCount: number;
      turns?: Array<{
        turnNumber: number;
        role: 'user' | 'assistant';
        content: string;
        toolCalls: unknown[] | null;
        createdAt: number;
      }>;
    };
  };
};

/** Record a new turn in a session */
"session.addTurn": {
  params: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    agent?: string;
    model?: string;
    toolCalls?: unknown[];
  };
  result: {
    turnNumber: number;
    indexed: boolean;
  };
};

/** Create a new session */
"session.create": {
  params: {
    project: string;
    title?: string;
    agent?: string;
    model?: string;
  };
  result: {
    id: string;
    filePath: string;
  };
};

/** End a session (triggers Phase 1-2 consolidation) */
"session.end": {
  params: {
    sessionId: string;
  };
  result: {
    consolidated: boolean;
    entitiesExtracted: number;
  };
};
```

#### Knowledge Graph Methods

```typescript
/** Query the knowledge graph */
"graph.query": {
  params: {
    entityName?: string;     // find entity by name
    entityType?: string;     // filter by type
    relation?: string;       // filter by relation type
    depth?: number;          // traversal depth (default: 1)
    project?: string;
    limit?: number;
  };
  result: {
    entities: Array<{
      id: string;
      name: string;
      type: string;
      properties: Record<string, unknown>;
      confidence: number;
      lastVerified: number;
    }>;
    relations: Array<{
      source: string;
      target: string;
      type: string;
      weight: number;
      sourceSessions: string[];
    }>;
  };
};

/** Add or update an entity in the knowledge graph */
"graph.upsertEntity": {
  params: {
    name: string;
    type: string;
    properties?: Record<string, unknown>;
    project?: string;
    confidence?: number;
  };
  result: {
    id: string;
    created: boolean;        // false if merged with existing
  };
};

/** Add a relation between entities */
"graph.addRelation": {
  params: {
    sourceName: string;
    targetName: string;
    type: string;
    weight?: number;
    sourceSession?: string;
  };
  result: {
    id: string;
    created: boolean;
  };
};
```

#### Consolidation Methods

```typescript
/** Trigger immediate consolidation */
"consolidate.run": {
  params: {
    phases?: Array<1 | 2 | 3 | 4 | 5 | 6>;  // default: all
    project?: string;        // default: all projects
    force?: boolean;         // skip "already consolidated" check
  };
  result: {
    started: boolean;
    runId: string;
  };
};

/** Get consolidation status */
"consolidate.status": {
  params: {};
  result: {
    running: boolean;
    currentPhase: number | null;
    currentPhaseName: string | null;
    progress: number;        // 0-100
    lastRun: {
      completedAt: number;
      duration: number;
      phases: Array<{
        phase: number;
        name: string;
        status: 'success' | 'failed' | 'skipped';
        duration: number;
        error?: string;
      }>;
    } | null;
    nextScheduled: number | null; // Unix epoch ms
  };
};

/** Get consolidation history */
"consolidate.history": {
  params: {
    limit?: number;          // default: 10
  };
  result: {
    runs: Array<{
      id: string;
      startedAt: number;
      completedAt: number;
      trigger: 'scheduled' | 'idle' | 'manual' | 'backfill' | 'session-end';
      phases: Array<{
        phase: number;
        status: 'success' | 'failed' | 'skipped';
        duration: number;
      }>;
    }>;
  };
};
```

#### Akasha Methods (Knowledge Traces)

```typescript
/** Deposit a knowledge trace */
"akasha.deposit": {
  params: {
    type: 'solution' | 'pattern' | 'warning' | 'correction';
    content: string;
    tags?: string[];
    project?: string;
    confidence?: number;
  };
  result: {
    id: string;
    indexed: boolean;
  };
};

/** Query knowledge traces */
"akasha.traces": {
  params: {
    query?: string;
    type?: string;
    project?: string;
    limit?: number;
    minConfidence?: number;
  };
  result: {
    traces: Array<{
      id: string;
      type: string;
      content: string;
      confidence: number;
      createdAt: number;
      hitCount: number;
      tags: string[];
    }>;
  };
};
```

#### Vasana Methods (Behavioral Tendencies)

```typescript
/** Get learned behavioral tendencies */
"vasana.list": {
  params: {
    project?: string;        // null = global + project
    minStrength?: number;    // 0-1 threshold
    valence?: 'positive' | 'negative' | 'neutral';
  };
  result: {
    vasanas: Array<{
      id: number;
      name: string;
      description: string;
      valence: string;
      strength: number;
      stability: number;
      activationCount: number;
      lastActivated: number | null;
    }>;
  };
};
```

#### Daemon Control Methods

```typescript
/** Health check */
"daemon.health": {
  params: {};
  result: HealthCheck; // See Section 2.5
};

/** Daemon version and capabilities */
"daemon.info": {
  params: {};
  result: {
    version: string;
    platform: string;
    uptime: number;
    dataDir: string;
    socketPath: string;
    capabilities: string[];  // ['consolidation', 'qdrant-sync', 'graph', 'vectors']
    connectedClients: number;
  };
};

/** List connected client sessions */
"daemon.clients": {
  params: {};
  result: {
    clients: Array<{
      sessionId: string;
      connectedAt: number;
      lastActivity: number;
      requestCount: number;
      pid: number | null;    // peer PID if available
    }>;
  };
};

/** Reload configuration */
"daemon.reload": {
  params: {};
  result: {
    reloaded: boolean;
    changes: string[];       // list of changed config keys
  };
};

/** Graceful shutdown */
"daemon.shutdown": {
  params: {
    force?: boolean;         // skip waiting for active requests
  };
  result: {
    shutdownInitiated: boolean;
  };
};
```

#### Handover Methods (Context Continuity)

```typescript
/** Save handover state (approaching context limits) */
"handover.save": {
  params: {
    sessionId: string;
    state: {
      filesModified: string[];
      decisionsIndex: string[];
      errorsEncountered: string[];
      pendingWork: string[];
      summary: string;
    };
  };
  result: {
    handoverId: string;
    savedAt: number;
  };
};

/** Load handover state (session resume) */
"handover.load": {
  params: {
    handoverId?: string;     // specific handover, or...
    sessionId?: string;      // latest handover for session
  };
  result: {
    handover: {
      id: string;
      sessionId: string;
      state: Record<string, unknown>;
      savedAt: number;
    } | null;
  };
};
```

---

## 4. Storage Architecture

### 4.1 SQLite Schema (Full DDL)

#### agent.db

```sql
-- ─── Pragmas (set on every open) ──────────────────────────────────────
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -16000;
PRAGMA mmap_size = 268435456;
PRAGMA foreign_keys = ON;
PRAGMA auto_vacuum = INCREMENTAL;

-- ─── Sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    project     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT 'New Session',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    turn_count  INTEGER NOT NULL DEFAULT 0,
    model       TEXT,
    agent       TEXT DEFAULT 'chitragupta',
    cost        REAL DEFAULT 0,
    tokens      INTEGER DEFAULT 0,
    tags        TEXT,
    file_path   TEXT NOT NULL,
    parent_id   TEXT,
    branch      TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);

-- ─── Turns ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    turn_number INTEGER NOT NULL,
    role        TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content     TEXT NOT NULL,
    agent       TEXT,
    model       TEXT,
    tool_calls  TEXT,
    created_at  INTEGER NOT NULL,
    UNIQUE(session_id, turn_number)
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_created ON turns(created_at DESC);

-- ─── FTS5 Full-Text Search ───────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
    content,
    content_rowid='id',
    tokenize='porter unicode61'
);

-- ─── Consolidation Rules ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consolidation_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category    TEXT NOT NULL,
    rule_text   TEXT NOT NULL,
    confidence  REAL NOT NULL DEFAULT 0.5,
    source_sessions TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    hit_count   INTEGER DEFAULT 1,
    project     TEXT
);

CREATE INDEX IF NOT EXISTS idx_rules_category ON consolidation_rules(category);
CREATE INDEX IF NOT EXISTS idx_rules_project ON consolidation_rules(project);

-- ─── Vasanas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vasanas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    valence     TEXT NOT NULL CHECK(valence IN ('positive', 'negative', 'neutral')),
    strength    REAL NOT NULL DEFAULT 0.5,
    stability   REAL NOT NULL DEFAULT 0.0,
    source_samskaras TEXT,
    project     TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    last_activated INTEGER,
    activation_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_vasanas_project ON vasanas(project);
CREATE INDEX IF NOT EXISTS idx_vasanas_strength ON vasanas(strength DESC);

-- ─── Kartavyas (executable tasks) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS kartavyas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'approved', 'rejected', 'completed', 'failed')),
    priority    INTEGER DEFAULT 0,
    source_session TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    completed_at INTEGER,
    project     TEXT
);

-- ─── Akasha Traces (knowledge deposits) ──────────────────────────────
CREATE TABLE IF NOT EXISTS akasha_traces (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL CHECK(type IN ('solution', 'pattern', 'warning', 'correction')),
    content     TEXT NOT NULL,
    confidence  REAL NOT NULL DEFAULT 0.7,
    tags        TEXT,
    project     TEXT,
    source_session TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    hit_count   INTEGER DEFAULT 0,
    decay_factor REAL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS idx_akasha_type ON akasha_traces(type);
CREATE INDEX IF NOT EXISTS idx_akasha_project ON akasha_traces(project);

-- ─── Consolidation Runs (audit trail) ────────────────────────────────
CREATE TABLE IF NOT EXISTS consolidation_runs (
    id          TEXT PRIMARY KEY,
    trigger     TEXT NOT NULL CHECK(trigger IN ('scheduled', 'idle', 'manual', 'backfill', 'session-end')),
    started_at  INTEGER NOT NULL,
    completed_at INTEGER,
    status      TEXT NOT NULL DEFAULT 'running'
                CHECK(status IN ('running', 'completed', 'failed', 'partial')),
    phases_json TEXT,
    project     TEXT,
    error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_consolidation_started ON consolidation_runs(started_at DESC);

-- ─── Handovers (context continuity) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS handovers (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    state_json  TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    project     TEXT
);

CREATE INDEX IF NOT EXISTS idx_handovers_session ON handovers(session_id);

-- ─── Schema Version Tracking ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);

INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('version', '5');
```

#### graph.db

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -8000;
PRAGMA mmap_size = 134217728;
PRAGMA foreign_keys = ON;

-- ─── Entities (nodes) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    properties  TEXT,                    -- JSON object
    confidence  REAL NOT NULL DEFAULT 0.7,
    project     TEXT,
    source_sessions TEXT,               -- JSON array of session IDs
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    last_verified INTEGER,
    access_count INTEGER DEFAULT 0,
    decay_factor REAL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_type_project
    ON entities(name, type, project);

-- ─── Relations (edges) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relations (
    id          TEXT PRIMARY KEY,
    source_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    weight      REAL NOT NULL DEFAULT 1.0,
    properties  TEXT,                    -- JSON object
    source_sessions TEXT,               -- JSON array
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    decay_factor REAL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_src_tgt_type
    ON relations(source_id, target_id, type);

-- ─── PageRank scores ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pagerank (
    entity_id   TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    score       REAL NOT NULL DEFAULT 0.0,
    computed_at INTEGER NOT NULL
);

-- ─── RAPTOR tree nodes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raptor_nodes (
    id          TEXT PRIMARY KEY,
    level       INTEGER NOT NULL,       -- 0 = leaf, higher = more abstract
    summary     TEXT NOT NULL,
    child_ids   TEXT NOT NULL,          -- JSON array of child node IDs
    project     TEXT,
    embedding_id TEXT,                  -- FK to vectors.db
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raptor_level ON raptor_nodes(level);
CREATE INDEX IF NOT EXISTS idx_raptor_project ON raptor_nodes(project);

-- ─── Schema Version ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);

INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('version', '2');
```

#### vectors.db

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -8000;
PRAGMA mmap_size = 268435456;

-- ─── Embeddings metadata ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS embeddings (
    id          TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,           -- 'turn', 'entity', 'raptor', 'akasha'
    source_id   TEXT NOT NULL,           -- FK to source table
    model       TEXT NOT NULL,           -- embedding model name
    dimensions  INTEGER NOT NULL,        -- 768, 1024, etc.
    created_at  INTEGER NOT NULL,
    project     TEXT
);

CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_project ON embeddings(project);

-- ─── Vector index (sqlite-vec) ───────────────────────────────────────
-- Created programmatically via sqlite-vec API:
--   CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
--     id TEXT PRIMARY KEY,
--     embedding FLOAT[768]
--   );

-- ─── Schema Version ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);

INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('version', '1');
```

### 4.2 Three-Tier Memory Storage

| Tier | Storage | Contents | Latency | Eviction |
|------|---------|----------|---------|----------|
| **Hot** | In-process LRU | Project facts, active decisions, vasanas, RAPTOR roots | <1ms | Rebuilt on consolidation |
| **Warm** | SQLite (WAL) | FTS5, vectors, knowledge graph, full session index | <50ms | Decay-based pruning |
| **Cold** | Filesystem + Cloud | Raw .md session files, monthly reports, yearly archives | 100-500ms | Time-based archival |

### 4.3 HNSW Vector Index Configuration

```typescript
const HNSW_CONFIG = {
  /** Embedding model */
  model: 'nomic-embed-text-v1.5',
  /** Embedding dimensions */
  dimensions: 768,
  /** HNSW M parameter (connections per node). Higher = better recall, more memory. */
  m: 16,
  /** HNSW efConstruction. Higher = better index quality, slower build. */
  efConstruction: 200,
  /** HNSW efSearch. Higher = better recall, slower search. */
  efSearch: 100,
  /** Distance metric */
  metric: 'cosine' as const,
  /** Max elements before incremental rebuild */
  maxElements: 100_000,
};
```

When using `sqlite-vec`, the HNSW configuration is handled internally. When syncing to Qdrant cloud, these parameters are applied to the remote collection.

### 4.4 File Layout

```
~/.chitragupta/
├── daemon/
│   ├── chitragupta.sock          # Unix domain socket (macOS/Linux)
│   └── daemon.log                # Daemon log file (rotated)
├── daemon.pid                    # PID file with flock
├── daemon.json                   # Daemon configuration
├── agent.db                      # Sessions, turns, FTS5, vasanas, kartavyas
├── agent.db-wal                  # WAL file
├── agent.db-shm                  # Shared memory file
├── graph.db                      # Knowledge graph, RAPTOR tree, PageRank
├── graph.db-wal
├── graph.db-shm
├── vectors.db                    # Embeddings, HNSW index
├── vectors.db-wal
├── vectors.db-shm
├── config.json                   # User configuration (existing)
├── projects/
│   └── <project-hash>/
│       ├── sessions/
│       │   └── YYYY/MM/
│       │       └── session-YYYY-MM-DD.md
│       ├── consolidated/
│       │   ├── monthly/YYYY-MM.md
│       │   └── yearly/YYYY.md
│       ├── memory/
│       │   ├── identity.md
│       │   ├── projects.md
│       │   ├── tasks.md
│       │   └── flow.md
│       └── hot-cache.json        # Serialized hot tier for this project
├── vasanas/                      # Behavioral tendencies (also in agent.db)
├── vidhis/                       # Learned procedures
├── consolidation/
│   └── YYYY-MM-DD.md             # Day consolidation files
└── logs/
    ├── daemon-YYYY-MM-DD.log     # Rotated daemon logs
    └── consolidation-YYYY-MM-DD.log
```

---

## 5. Consolidation Pipeline

### 5.1 Trigger Conditions

| Trigger | Condition | Phases Run |
|---------|-----------|------------|
| **Session end** | Client sends `session.end` | 1, 2 (fast, incremental) |
| **Idle** | No RPC activity for 30 minutes | 3 (KG update) |
| **Scheduled** | Cron at configured hour (default: 2am) | All (1-6) |
| **On-demand** | `consolidate.run` RPC or `SIGUSR1` | As specified (default: all) |
| **Backfill** | On daemon startup, check last run timestamp | All, for each missed day |
| **Missed-run detection** | Health watchdog detects >48h since last run | All |

### 5.2 Phase 1: Session Summarization

**Input:** Raw session turns from `agent.db` (sessions not yet summarized).

**Process:**
1. Retrieve all turns for the session.
2. If turn count < 5, skip (too short to summarize meaningfully).
3. Chunk turns into 4K-token windows (overlapping by 500 tokens).
4. For each chunk, extract structured summary via LLM (cheapest available model):

```typescript
interface SessionSummary {
  /** One-line description of what was accomplished */
  headline: string;
  /** Decisions made during this session */
  decisions: Array<{
    description: string;
    confidence: number;
    context: string;
  }>;
  /** Patterns discovered or applied */
  patterns: Array<{
    description: string;
    frequency: number;
  }>;
  /** Errors encountered and resolutions */
  errors: Array<{
    error: string;
    resolution: string | null;
  }>;
  /** Files created or modified */
  filesModified: string[];
  /** Key entities mentioned (functions, packages, APIs) */
  entities: string[];
}
```

5. Merge chunk summaries into one session summary.
6. Store in `consolidation_rules` table with `category = 'session_summary'`.

**Failure handling:** If LLM is unavailable, fall back to extractive summarization (take first and last 3 turns + any turns containing code blocks or error messages). Mark as `low_confidence`.

### 5.3 Phase 2: Entity Extraction (KGGen-inspired)

**Input:** Session summaries from Phase 1 + raw turns for high-confidence extraction.

**Process (3 passes, per KGGen 2502.09956):**

**Pass 1 — Entity identification:**
Extract entities with types: `file`, `function`, `api`, `package`, `decision`, `error`, `person`, `concept`, `convention`.

```typescript
interface ExtractedEntity {
  name: string;
  type: string;
  aliases: string[];       // coreference candidates
  properties: Record<string, string>;
  mentions: number;        // how many times mentioned in session
}
```

**Pass 2 — Relation extraction:**
Extract relations between entities: `depends-on`, `decided-by`, `replaced-by`, `caused-by`, `implements`, `tests`, `documents`, `conflicts-with`.

```typescript
interface ExtractedRelation {
  source: string;          // entity name
  target: string;          // entity name
  type: string;
  evidence: string;        // quote from session
  confidence: number;
}
```

**Pass 3 — Coreference resolution:**
Match extracted entities against existing knowledge graph entities. Merge duplicates (e.g., "the auth module" and "packages/dharma/src/auth.ts" are the same entity).

**Failure handling:** If LLM unavailable, run regex-based extraction only (file paths, function names from code blocks, npm package names). Lower recall but zero dependency on external services.

### 5.4 Phase 3: Knowledge Graph Update

**Input:** Entities and relations from Phase 2 + existing graph.db.

**Process:**

1. **Upsert entities.** Match by `(name, type, project)`. If exists, merge properties, update confidence (weighted average), append source session.
2. **Upsert relations.** Match by `(source_id, target_id, type)`. If exists, increase weight, append source session.
3. **Apply decay.** All entities and relations not accessed in the current cycle have `decay_factor` multiplied by 0.95. This implements the Memoria (2512.12686) recency-aware decay.
4. **Prune.** Remove entities with `decay_factor < 0.1` and `access_count < 3`. Remove relations with `decay_factor < 0.05`.
5. **Contradiction resolution.** When a new fact contradicts an existing one (e.g., "uses PostgreSQL" vs. "migrated to MySQL"), the newer fact wins if confidence is within 0.2 of the older one. Otherwise, both are kept with a `conflicts-with` relation.
6. **PageRank recompute.** Run PageRank over the updated graph (20 iterations, damping factor 0.85). Store scores in `pagerank` table.

**Failure handling:** All operations run in a single SQLite transaction. On failure, the entire phase rolls back. The graph is never left in a partial state.

### 5.5 Phase 4: RAPTOR Tree Rebuild

**Input:** Updated knowledge graph from Phase 3.

**Process (per RAPTOR 2401.18059):**

1. **Leaf nodes.** Each entity with confidence > 0.5 becomes a leaf node. Content = entity name + type + properties + top-3 relations.
2. **Clustering.** Leaf nodes are clustered using UMAP dimensionality reduction + GMM clustering. Target cluster size: 5-15 nodes.
3. **Summarization.** Each cluster is summarized into a single paragraph by LLM. This becomes a Level 1 RAPTOR node.
4. **Recursive.** Level 1 nodes are clustered and summarized into Level 2 nodes. Repeat until a single root node is reached or level count exceeds 4.
5. **Embedding.** Each RAPTOR node (at every level) is embedded and stored in vectors.db.
6. **Store.** RAPTOR nodes saved to `raptor_nodes` table in graph.db.

**Failure handling:** If clustering or LLM fails, reuse the previous RAPTOR tree. Log the failure. The tree is stale but functional until the next successful rebuild.

### 5.6 Phase 5: Vector Embedding Generation

**Input:** New/modified entities, RAPTOR nodes, akasha traces.

**Process:**

1. Identify items needing embedding: new entities, modified entities (updated_at > last embedding), new RAPTOR nodes, new akasha traces.
2. Batch items into groups of 32 for embedding API efficiency.
3. Generate embeddings via local model (nomic-embed-text-v1.5) or API fallback.
4. Upsert into `vec_embeddings` virtual table (sqlite-vec HNSW).
5. Update `embeddings` metadata table with source references.

**Incremental update (per Ada-IVF 2411.00970):** The HNSW index supports incremental inserts without full rebuild. Only re-index items whose source content changed. Expected throughput: 2-5x faster than full rebuild.

**Failure handling:** If embedding model is unavailable, queue items for next cycle. The FTS5 and graph retrieval layers remain functional without vectors.

### 5.7 Phase 6: Cloud Sync (Qdrant)

**Input:** Updated vectors from Phase 5 + session archives.

**Process:**

1. **Qdrant sync.** Push all new/modified vectors to Qdrant cloud collection. Use upsert (by ID) for idempotency.
   - Collection name: `chitragupta-{user-hash}`
   - Vectors: 768-dimensional, cosine distance
   - Payload: entity metadata, project, timestamps
2. **Archive sync.** If S3/R2 is configured, push new monthly consolidation reports and session files older than 90 days.
3. **Conflict resolution.** If Qdrant has a newer version of a vector (from another device), pull it and merge into local graph.

**Qdrant collection schema:**

```typescript
const QDRANT_COLLECTION = {
  name: 'chitragupta-memory',
  vectors: {
    size: 768,
    distance: 'Cosine',
  },
  optimizers_config: {
    indexing_threshold: 20000,
  },
  replication_factor: 1,       // single-user, no replication needed
};

interface QdrantPayload {
  sourceType: string;          // 'entity', 'raptor', 'akasha', 'turn'
  sourceId: string;
  project: string;
  content: string;             // first 500 chars for display
  confidence: number;
  createdAt: number;
  updatedAt: number;
  deviceId: string;            // for cross-device conflict detection
}
```

**Failure handling:** Cloud sync failures do not block the pipeline. Failed uploads are queued and retried on next cycle (exponential backoff, max 3 retries per item, then logged and skipped). The daemon operates fully offline; cloud sync is an enhancement, not a requirement.

---

## 6. MCP Adapter (Thin Client)

### 6.1 Responsibility Split

| Stays in MCP Adapter | Moves to Daemon |
|---------------------|-----------------|
| MCP protocol handling (stdio transport) | All SQLite read/write operations |
| Tool/prompt/resource registration | Knowledge graph management |
| Request/response marshalling | Vector indexing and search |
| Schema validation | FTS5 search |
| Claude Code / Cursor integration | Consolidation pipeline |
| Fallback (in-process) mode | Nidra scheduling |
| | Cross-session state |
| | Akasha trace management |
| | Vasana/behavioral state |
| | Hot tier cache computation |

### 6.2 Connection Management

```typescript
class DaemonClient {
  private socket: net.Socket | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: Function; reject: Function; timer: NodeJS.Timeout }>();
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 3;
  private readonly socketPath: string;

  constructor() {
    this.socketPath = getSocketPath();
  }

  /** Connect to daemon, auto-starting if needed */
  async connect(): Promise<void> {
    try {
      await this.tryConnect();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        await this.startDaemon();
        await this.retryConnect();
      } else {
        throw err;
      }
    }
  }

  /** Auto-start the daemon process */
  private async startDaemon(): Promise<void> {
    const { execFile } = await import('node:child_process');
    const bin = process.argv[0]; // node binary
    const entry = path.resolve(__dirname, '../../cli/dist/setup-daemon.js');

    const child = execFile(bin, [
      '--max-old-space-size=256',
      '--max-semi-space-size=16',
      entry,
    ], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CHITRAGUPTA_DAEMON: '1' },
    });

    child.unref();

    // Wait for socket to appear (max 3 seconds)
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      if (existsSync(this.socketPath)) return;
    }
    throw new Error('Daemon failed to start within 3 seconds');
  }

  /** Retry connection with exponential backoff */
  private async retryConnect(): Promise<void> {
    const delays = [50, 100, 200]; // ms
    for (const delay of delays) {
      await sleep(delay);
      try {
        await this.tryConnect();
        return;
      } catch {
        continue;
      }
    }
    throw new Error('Failed to connect to daemon after 3 retries');
  }

  /** Send an RPC request and return the result */
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.socket) throw new Error('Not connected');

    const id = ++this.requestId;
    const request = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id,
    }) + '\n';

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, 30_000);

      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(request);
    });
  }
}
```

### 6.3 Request Forwarding Pattern

Every MCP tool handler follows the same pattern:

```typescript
// Before (in-process):
async function handleMemorySearch(params: SearchParams): Promise<SearchResult> {
  return smriti.search(params.query, params.limit);
}

// After (daemon-backed):
async function handleMemorySearch(params: SearchParams): Promise<SearchResult> {
  return daemonClient.call<SearchResult>('memory.search', params);
}
```

The adapter is a mechanical translation: MCP tool name maps to RPC method, params pass through, result passes back.

### 6.4 Fallback Behavior

If the daemon is unreachable (crashed, not installed, socket permissions wrong):

1. Log a warning: "Daemon unreachable, falling back to in-process mode."
2. Initialize in-process SQLite connections (existing code path).
3. Operate normally but without cross-session sharing or background consolidation.
4. Periodically (every 5 minutes) attempt to reconnect to daemon.
5. On successful reconnect, flush any locally-buffered writes to the daemon.

This ensures Chitragupta always works, even without the daemon installed. The daemon is an enhancement, not a hard dependency.

---

## 7. Platform Support

### 7.1 macOS (launchd)

#### Plist: `~/Library/LaunchAgents/com.yugenlab.chitragupta.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.yugenlab.chitragupta</string>

    <key>ProgramArguments</key>
    <array>
        <!-- Resolved at install time -->
        <string>/usr/local/bin/node</string>
        <string>--max-old-space-size=256</string>
        <string>--max-semi-space-size=16</string>
        <string>CHITRAGUPTA_DAEMON_ENTRY</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>CHITRAGUPTA_DAEMON</key>
        <string>1</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>

    <!-- Socket activation: launchd holds the socket, starts daemon on connect -->
    <key>Sockets</key>
    <dict>
        <key>Listeners</key>
        <dict>
            <key>SockPathName</key>
            <string>SOCKET_PATH</string>
            <key>SockPathMode</key>
            <integer>384</integer> <!-- 0600 -->
        </dict>
    </dict>

    <!-- Keep alive: restart on crash, but not on clean exit -->
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>

    <!-- Resource limits -->
    <key>HardResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>4096</integer>
    </dict>
    <key>SoftResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>4096</integer>
    </dict>

    <!-- Logging -->
    <key>StandardOutPath</key>
    <string>CHITRAGUPTA_HOME/logs/daemon-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>CHITRAGUPTA_HOME/logs/daemon-stderr.log</string>

    <!-- Working directory -->
    <key>WorkingDirectory</key>
    <string>CHITRAGUPTA_HOME</string>

    <!-- Throttle: wait 10s before restarting after crash -->
    <key>ThrottleInterval</key>
    <integer>10</integer>

    <!-- Nice level: low priority -->
    <key>Nice</key>
    <integer>10</integer>
</dict>
</plist>
```

#### Installation Script

```bash
#!/bin/bash
# install-macos.sh — Install Chitragupta daemon on macOS via launchd

set -euo pipefail

CHITRAGUPTA_HOME="${HOME}/.chitragupta"
SOCKET_DIR="${HOME}/Library/Caches/chitragupta/daemon"
SOCKET_PATH="${SOCKET_DIR}/chitragupta.sock"
PLIST_SRC="$(dirname "$0")/com.yugenlab.chitragupta.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/com.yugenlab.chitragupta.plist"
NODE_BIN="$(which node)"
DAEMON_ENTRY="$(npm root -g)/@yugenlab/chitragupta/dist/setup-daemon.js"

# Create directories
mkdir -p "${CHITRAGUPTA_HOME}/logs"
mkdir -p "${CHITRAGUPTA_HOME}/daemon"
mkdir -p "${SOCKET_DIR}"
chmod 700 "${SOCKET_DIR}"

# Resolve plist template
sed \
  -e "s|/usr/local/bin/node|${NODE_BIN}|" \
  -e "s|CHITRAGUPTA_DAEMON_ENTRY|${DAEMON_ENTRY}|" \
  -e "s|SOCKET_PATH|${SOCKET_PATH}|" \
  -e "s|CHITRAGUPTA_HOME|${CHITRAGUPTA_HOME}|g" \
  "${PLIST_SRC}" > "${PLIST_DST}"

# Unload if already loaded, then load
launchctl unload "${PLIST_DST}" 2>/dev/null || true
launchctl load "${PLIST_DST}"

echo "Chitragupta daemon installed."
echo "  Plist: ${PLIST_DST}"
echo "  Socket: ${SOCKET_PATH}"
echo "  Logs: ${CHITRAGUPTA_HOME}/logs/"
echo ""
echo "The daemon will start automatically on first MCP connection."
echo "To start manually: launchctl start com.yugenlab.chitragupta"
echo "To stop: launchctl stop com.yugenlab.chitragupta"
echo "To uninstall: launchctl unload ${PLIST_DST} && rm ${PLIST_DST}"
```

### 7.2 Linux (systemd)

#### Service Unit: `~/.config/systemd/user/chitragupta.service`

```ini
[Unit]
Description=Chitragupta Memory Daemon
Documentation=https://github.com/sriinnu/chitragupta
After=network.target
Requires=chitragupta.socket

[Service]
Type=notify
ExecStart=/usr/bin/node \
    --max-old-space-size=256 \
    --max-semi-space-size=16 \
    %h/.local/lib/node_modules/@yugenlab/chitragupta/dist/setup-daemon.js
Environment=CHITRAGUPTA_DAEMON=1
Environment=NODE_ENV=production
WorkingDirectory=%h/.chitragupta

# Resource limits
MemoryMax=512M
CPUQuota=50%
LimitNOFILE=4096

# Restart policy
Restart=on-failure
RestartSec=10
WatchdogSec=120

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%h/.chitragupta
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=chitraguptad

[Install]
WantedBy=default.target
```

#### Socket Unit: `~/.config/systemd/user/chitragupta.socket`

```ini
[Unit]
Description=Chitragupta Memory Daemon Socket

[Socket]
ListenStream=%t/chitragupta/chitragupta.sock
SocketMode=0600
DirectoryMode=0700

# Buffer and connection limits
Backlog=5
MaxConnections=20

[Install]
WantedBy=sockets.target
```

#### Installation Script

```bash
#!/bin/bash
# install-linux.sh — Install Chitragupta daemon on Linux via systemd user units

set -euo pipefail

CHITRAGUPTA_HOME="${HOME}/.chitragupta"
SYSTEMD_DIR="${HOME}/.config/systemd/user"
SCRIPT_DIR="$(dirname "$0")"

# Create directories
mkdir -p "${CHITRAGUPTA_HOME}/logs"
mkdir -p "${SYSTEMD_DIR}"

# Copy unit files
cp "${SCRIPT_DIR}/chitragupta.service" "${SYSTEMD_DIR}/"
cp "${SCRIPT_DIR}/chitragupta.socket" "${SYSTEMD_DIR}/"

# Resolve node path in service file
NODE_BIN="$(which node)"
DAEMON_ENTRY="$(npm root -g)/@yugenlab/chitragupta/dist/setup-daemon.js"
sed -i "s|/usr/bin/node|${NODE_BIN}|" "${SYSTEMD_DIR}/chitragupta.service"
sed -i "s|%h/.local/lib/node_modules/@yugenlab/chitragupta/dist/setup-daemon.js|${DAEMON_ENTRY}|" \
  "${SYSTEMD_DIR}/chitragupta.service"

# Reload and enable
systemctl --user daemon-reload
systemctl --user enable chitragupta.socket
systemctl --user start chitragupta.socket

echo "Chitragupta daemon installed (systemd user service)."
echo "  Service: ${SYSTEMD_DIR}/chitragupta.service"
echo "  Socket: ${SYSTEMD_DIR}/chitragupta.socket"
echo ""
echo "The daemon will start automatically on first MCP connection."
echo "To start manually: systemctl --user start chitragupta"
echo "To stop: systemctl --user stop chitragupta"
echo "To view logs: journalctl --user -u chitragupta -f"
echo "To uninstall: systemctl --user disable chitragupta.socket chitragupta && rm ${SYSTEMD_DIR}/chitragupta.*"
```

### 7.3 Windows

#### Service Registration (via node-windows)

```typescript
// install-windows.ts
import { Service } from 'node-windows';
import path from 'node:path';

const svc = new Service({
  name: 'Chitragupta Memory Daemon',
  description: 'Centralized memory daemon for AI coding agents',
  script: path.resolve(__dirname, 'setup-daemon.js'),
  nodeOptions: [
    '--max-old-space-size=256',
    '--max-semi-space-size=16',
  ],
  env: [
    { name: 'CHITRAGUPTA_DAEMON', value: '1' },
    { name: 'NODE_ENV', value: 'production' },
  ],
});

svc.on('install', () => {
  console.log('Service installed. Starting...');
  svc.start();
});

svc.on('start', () => {
  console.log('Chitragupta daemon started as Windows Service.');
  console.log('Named pipe: \\\\.\\pipe\\chitragupta');
});

svc.install();
```

#### Named Pipe Communication

```typescript
// Windows uses named pipes instead of Unix sockets
import net from 'node:net';

const PIPE_PATH = '\\\\.\\pipe\\chitragupta';

// Server (daemon)
const server = net.createServer((socket) => {
  handleConnection(socket); // same handler as Unix socket
});
server.listen(PIPE_PATH);

// Client (MCP adapter)
const client = net.connect(PIPE_PATH);
```

#### Task Scheduler for Consolidation

If not running as a Windows Service, consolidation can be triggered via Task Scheduler:

```powershell
# Register-ChitraguptaConsolidation.ps1
$action = New-ScheduledTaskAction `
  -Execute "node.exe" `
  -Argument "--max-old-space-size=256 $env:APPDATA\npm\node_modules\@yugenlab\chitragupta\dist\consolidate.js"
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
Register-ScheduledTask `
  -TaskName "ChitraguptaConsolidation" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Nightly memory consolidation for Chitragupta"
```

### 7.4 VPS / Cloud

For remote development (SSH to a server, VS Code Remote, etc.):

```ini
# Same systemd service as Linux, plus TCP listener
[Service]
# ... (same as 7.2)
Environment=CHITRAGUPTA_TCP_PORT=7777
Environment=CHITRAGUPTA_TCP_API_KEY_HASH=sha256:abc123...
```

Remote access from laptop:

```typescript
// SSH tunnel approach (preferred — no auth complexity):
// ssh -L 7777:localhost:7777 user@vps

// Direct TCP approach (requires API key):
const client = net.connect({ host: 'vps.example.com', port: 7777 });
// First message must be auth handshake:
client.write(JSON.stringify({
  jsonrpc: '2.0',
  method: 'auth.handshake',
  params: { apiKey: process.env.CHITRAGUPTA_API_KEY },
  id: 0,
}) + '\n');
```

Qdrant cloud configuration:

```json
// ~/.chitragupta/daemon.json (VPS)
{
  "qdrantEndpoint": "https://your-cluster.qdrant.io:6333",
  "qdrantApiKey": "your-qdrant-api-key",
  "tcpPort": 7777,
  "tcpApiKey": "your-daemon-api-key"
}
```

### 7.5 Docker

#### Dockerfile

```dockerfile
FROM node:22-slim

WORKDIR /app

# Install Chitragupta globally
RUN npm install -g @yugenlab/chitragupta

# Create chitragupta home directory
RUN mkdir -p /data/.chitragupta/daemon /data/.chitragupta/logs

ENV CHITRAGUPTA_DAEMON=1
ENV CHITRAGUPTA_DATA_DIR=/data/.chitragupta
ENV NODE_ENV=production

# V8 memory limits
ENV NODE_OPTIONS="--max-old-space-size=256 --max-semi-space-size=16"

# Expose TCP port for remote access (optional)
EXPOSE 7777

# Health check
HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD node -e "const net=require('net');const c=net.connect('/data/.chitragupta/daemon/chitragupta.sock');c.on('connect',()=>{c.write('{\"jsonrpc\":\"2.0\",\"method\":\"daemon.health\",\"id\":1}\\n')});c.on('data',()=>process.exit(0));c.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),4000)"

VOLUME ["/data/.chitragupta"]

ENTRYPOINT ["node", "/usr/local/lib/node_modules/@yugenlab/chitragupta/dist/setup-daemon.js"]
```

#### Docker Compose

```yaml
version: "3.8"
services:
  chitraguptad:
    build: .
    container_name: chitraguptad
    restart: unless-stopped
    volumes:
      - chitragupta-data:/data/.chitragupta
    ports:
      - "7777:7777"  # Only if remote access needed
    environment:
      - CHITRAGUPTA_TCP_PORT=7777
      - CHITRAGUPTA_TCP_API_KEY=your-api-key
      - QDRANT_ENDPOINT=https://your-cluster.qdrant.io:6333
      - QDRANT_API_KEY=your-qdrant-key

volumes:
  chitragupta-data:
```

---

## 8. CLI Commands

### `chitragupta daemon start`

Start the daemon process. In foreground by default, detach with `--background`.

```
Usage: chitragupta daemon start [options]

Options:
  --background, -b    Run in background (detached)
  --socket-path PATH  Override socket path
  --data-dir PATH     Override data directory
  --hour N            Consolidation hour (0-23, default: 2)
  --verbose, -v       Enable verbose logging
  --tcp-port N        Also listen on TCP (for VPS/remote)

Examples:
  chitragupta daemon start                    # foreground
  chitragupta daemon start -b                 # background
  chitragupta daemon start --tcp-port 7777    # with remote access
```

### `chitragupta daemon stop`

Graceful shutdown. Sends SIGTERM, waits up to 10 seconds, then SIGKILL.

```
Usage: chitragupta daemon stop [options]

Options:
  --force, -f    Send SIGKILL immediately (skip graceful shutdown)
  --timeout N    Seconds to wait before SIGKILL (default: 10)
```

### `chitragupta daemon status`

Show daemon health, uptime, connected clients, and consolidation status.

```
Usage: chitragupta daemon status [options]

Options:
  --json    Output as JSON instead of human-readable

Example output:
  Chitragupta Daemon v0.1.0
  Status:       running (PID 12345)
  Uptime:       2d 14h 32m
  Socket:       ~/.chitragupta/daemon/chitragupta.sock
  Memory:       142MB RSS / 256MB limit
  Clients:      2 connected
  Databases:    agent.db (4.2MB) | graph.db (1.8MB) | vectors.db (12.3MB)
  Last consolidation: 2h ago (scheduled, all 6 phases OK)
  Next consolidation: 2026-03-01 02:00:00
  Entities:     1,247 | Relations: 3,891 | Vectors: 8,432
```

### `chitragupta daemon install`

Install OS service (launchd on macOS, systemd on Linux, Windows Service on Windows).

```
Usage: chitragupta daemon install [options]

Options:
  --no-socket-activation    Use polling instead of socket activation
  --tcp-port N              Also listen on TCP (for VPS)

Behavior:
  macOS:   Writes plist to ~/Library/LaunchAgents/, loads via launchctl
  Linux:   Writes .service + .socket to ~/.config/systemd/user/, enables via systemctl
  Windows: Registers Windows Service via node-windows
```

### `chitragupta daemon uninstall`

Remove OS service and clean up.

```
Usage: chitragupta daemon uninstall [options]

Options:
  --keep-data    Don't remove data directory (default: keep data)
  --purge        Remove data directory as well

Behavior:
  macOS:   Unloads and removes plist
  Linux:   Stops, disables, and removes systemd units
  Windows: Unregisters Windows Service
```

### `chitragupta daemon consolidate`

Trigger immediate consolidation (equivalent to `SIGUSR1` or `consolidate.run` RPC).

```
Usage: chitragupta daemon consolidate [options]

Options:
  --phases 1,2,3    Run only specific phases (default: all)
  --project NAME    Consolidate specific project only
  --force           Re-consolidate already-processed sessions
  --watch           Stream progress to stdout
```

### `chitragupta daemon logs`

Tail daemon logs. Reads from log file or journald depending on platform.

```
Usage: chitragupta daemon logs [options]

Options:
  --lines N, -n N    Number of lines to show (default: 50)
  --follow, -f       Follow log output (tail -f)
  --level LEVEL      Filter by level: debug, info, warn, error
  --since DATETIME   Show logs since timestamp

Behavior:
  macOS:   Reads from ~/.chitragupta/logs/daemon-*.log
  Linux:   Reads from journald (journalctl --user -u chitragupta)
  Windows: Reads from Event Log + ~/.chitragupta/logs/
```

---

## 9. Migration Plan

### 9.1 What Changes in Existing Code

| File | Change | Effort |
|------|--------|--------|
| `packages/cli/src/modes/daemon.ts` | Expand from consolidation-only to full daemon with socket server | Major rewrite |
| `packages/cli/src/modes/daemon-cmd.ts` | Add `install`, `uninstall`, `consolidate`, `logs` subcommands | Extend |
| `packages/cli/src/modes/mcp-server.ts` | Replace direct smriti/tantra calls with DaemonClient RPC | Moderate |
| `packages/cli/src/modes/mcp-tools-memory.ts` | Replace in-process memory calls with daemon RPC forwarding | Moderate |
| `packages/cli/src/modes/mcp-session.ts` | Add DaemonClient connection on MCP session start | Small |
| `packages/cli/src/main.ts` | Add daemon subcommand routing (`start`, `stop`, `status`, `install`, etc.) | Small |
| `packages/tantra/src/server.ts` | MCP tool handlers call DaemonClient instead of direct smriti | Moderate |
| `packages/smriti/src/consolidation.ts` | Extract into daemon-callable consolidation service | Moderate |
| `packages/smriti/src/db/database.ts` | Add read-only mode for fallback (when daemon owns the write path) | Small |
| `packages/core/src/paths.ts` (or equivalent) | Add `getSocketPath()`, `getDaemonLogPath()` platform-aware functions | New |

### 9.2 What is New

| New File | Package | Purpose | Est. LOC |
|----------|---------|---------|----------|
| `src/daemon/server.ts` | cli | Socket server, connection mgr, RPC dispatch | ~350 |
| `src/daemon/rpc-router.ts` | cli | Method→handler routing, validation | ~200 |
| `src/daemon/client.ts` | core or cli | DaemonClient class (connect, auto-start, call) | ~250 |
| `src/daemon/health.ts` | cli | Self-watchdog, health check, auto-corrective | ~150 |
| `src/daemon/platform.ts` | core | Socket path resolution, OS detection, peercred | ~120 |
| `src/daemon/consolidation-service.ts` | cli | Wraps smriti consolidation for daemon context | ~200 |
| `src/daemon/nidra-scheduler.ts` | cli | Cron via croner, backfill, idle detection | ~180 |
| `service/com.yugenlab.chitragupta.plist` | cli | macOS launchd plist template | ~50 |
| `service/chitragupta.service` | cli | Linux systemd service unit | ~30 |
| `service/chitragupta.socket` | cli | Linux systemd socket unit | ~15 |
| `service/install-macos.sh` | cli | macOS installation script | ~40 |
| `service/install-linux.sh` | cli | Linux installation script | ~40 |
| `service/Dockerfile` | cli | Docker container for daemon | ~25 |

Total new code: approximately 1,650 LOC across 13 files. All under the 450 LOC per file limit.

### 9.3 User Responsibilities vs. Automated

| Task | Who | Notes |
|------|-----|-------|
| Run `chitragupta daemon install` | User | One-time setup per machine |
| Qdrant cloud account setup | User | Optional, for cloud sync only |
| Set `QDRANT_API_KEY` env var | User | Only if using Qdrant cloud |
| Set `CHITRAGUPTA_TCP_API_KEY` | User | Only if using VPS/remote mode |
| Database migration | Automated | Runs on first daemon start |
| Schema upgrades | Automated | Version-tracked, idempotent |
| Backfill missed consolidation | Automated | On daemon startup |
| Hot tier cache rebuild | Automated | On consolidation cycle |
| Log rotation | Automated | 7-day retention, 10MB max per file |
| Stale PID cleanup | Automated | On daemon start |
| Socket file cleanup | Automated | On daemon start and shutdown |

### 9.4 Phased Implementation

#### Phase 1: Socket Server + Basic RPC (Week 1)

**Goal:** Daemon starts, listens on Unix socket, handles basic RPC calls.

**Deliverables:**
- `daemon/server.ts` — Unix socket server with connection management
- `daemon/rpc-router.ts` — Method dispatch, error handling
- `daemon/client.ts` — Client with auto-start and retry
- `daemon/platform.ts` — Cross-platform socket path resolution
- RPC methods: `daemon.health`, `daemon.info`, `daemon.shutdown`
- RPC methods: `memory.search`, `memory.write`, `memory.hot`
- CLI: `chitragupta daemon start`, `stop`, `status`

**Tests:**
- Unit tests for socket communication, message framing
- Integration test: start daemon, connect client, send RPC, verify response
- Stale PID detection test
- Platform detection test (mock `process.platform`)

**Success criteria:** `chitragupta daemon start` runs, `chitragupta daemon status` shows health, a test client can call `memory.search` and get results.

#### Phase 2: Move State to Daemon, Thin Adapter (Week 2)

**Goal:** MCP adapter delegates all state operations to daemon.

**Deliverables:**
- Refactor `mcp-tools-memory.ts` to use DaemonClient
- Refactor `mcp-server.ts` tool handlers to use DaemonClient
- All session/graph/akasha/vasana RPC methods
- Fallback mode (in-process when daemon unavailable)
- Connection lifecycle (welcome, heartbeat, reconnect)

**Tests:**
- Full MCP tool test suite runs against daemon-backed adapter
- Fallback mode test: kill daemon mid-session, verify graceful degradation
- Reconnection test: restart daemon, verify client auto-reconnects
- Concurrent client test: 3 clients share state correctly

**Success criteria:** All 28 existing MCP tools work identically whether the daemon is running or not. Zero behavioral regressions.

#### Phase 3: Consolidation Pipeline + Qdrant Sync (Week 3)

**Goal:** Full 6-phase consolidation pipeline running in daemon.

**Deliverables:**
- `daemon/consolidation-service.ts` — Pipeline orchestration
- `daemon/nidra-scheduler.ts` — Cron, idle, backfill scheduling
- Phase 1-6 implementations (leveraging existing smriti consolidation code)
- Qdrant cloud sync (optional, requires user configuration)
- `consolidate.run`, `consolidate.status`, `consolidate.history` RPCs
- CLI: `chitragupta daemon consolidate`

**Tests:**
- Each consolidation phase has unit tests with mock data
- Full pipeline integration test: ingest 10 sessions, run consolidation, verify KG + vectors + RAPTOR
- Qdrant sync test (with mock Qdrant or test cluster)
- Backfill test: simulate missed runs, verify catch-up
- Failure isolation test: kill LLM mid-phase, verify partial completion

**Success criteria:** Nidra runs on schedule, backfills missed runs on startup, all 6 phases produce correct output, failures in one phase don't block others.

#### Phase 4: OS Service Integration + Cross-Platform (Week 4)

**Goal:** One-command installation on all platforms.

**Deliverables:**
- macOS launchd plist + installation script
- Linux systemd units + installation script
- Windows Service registration + named pipe support
- Docker container configuration
- CLI: `chitragupta daemon install`, `uninstall`, `logs`
- VPS/TCP mode with API key authentication

**Tests:**
- macOS: install, verify socket activation, verify restart on crash
- Linux: install, verify socket activation, verify journald integration
- Windows: install, verify named pipe communication
- Docker: build, run, verify health check
- Cross-platform: socket path resolution returns correct paths per platform

**Success criteria:** `chitragupta daemon install` works on macOS and Linux. User can close all terminals, open a new one, and the daemon starts automatically on first MCP connection.

---

## 10. User Responsibilities

### Required (for daemon to function)

1. **Install the daemon service.** Run `chitragupta daemon install` once per machine. This registers the OS service (launchd/systemd/Windows Service) for socket activation.

2. **Verify Node.js version.** The daemon requires Node.js 20+ (for stable `sqlite-vec` support and `node:net` Unix socket APIs). Run `node --version` to confirm.

3. **Test the installation.** After install, run `chitragupta daemon status` to verify the daemon starts and responds.

### Optional (for cloud sync)

4. **Qdrant cloud account.** Create a free-tier cluster at [cloud.qdrant.io](https://cloud.qdrant.io). Note the cluster URL and API key.

5. **Set environment variables.** Add to shell profile (`~/.zshrc`, `~/.bashrc`):
   ```bash
   export QDRANT_ENDPOINT="https://your-cluster.qdrant.io:6333"
   export QDRANT_API_KEY="your-api-key-here"
   ```

6. **Or configure via daemon.json.** Create/edit `~/.chitragupta/daemon.json`:
   ```json
   {
     "qdrantEndpoint": "https://your-cluster.qdrant.io:6333",
     "qdrantApiKey": "your-api-key-here",
     "consolidationHour": 2,
     "backfillDays": 7
   }
   ```

### Optional (for VPS / remote access)

7. **Set TCP API key.** Generate a strong key and configure:
   ```bash
   export CHITRAGUPTA_TCP_API_KEY="$(openssl rand -hex 32)"
   ```
   Add to `daemon.json`:
   ```json
   {
     "tcpPort": 7777,
     "tcpApiKey": "your-generated-key"
   }
   ```

8. **Firewall.** If exposing TCP port, ensure firewall allows traffic on the configured port. Prefer SSH tunneling over direct exposure.

### Manual Migration Steps

9. **Existing data.** No manual migration needed. The daemon reads the same `~/.chitragupta/` directory structure. Existing sessions, databases, and memory files are preserved. Schema migrations run automatically on first daemon start.

10. **MCP configuration.** No changes needed to Claude Code's MCP configuration. The MCP adapter auto-detects the daemon and connects. If the daemon is not running, the adapter falls back to in-process mode transparently.

### Monitoring

11. **Check health periodically.** Run `chitragupta daemon status` to verify the daemon is healthy. Key metrics to watch:
    - Memory usage (should stay under 300MB RSS)
    - Last consolidation time (should be within 24 hours)
    - Database sizes (if growing rapidly, may need to tune decay/pruning)

12. **Review logs on issues.** Run `chitragupta daemon logs -f` to tail logs. Common issues:
    - `SQLITE_BUSY` — indicates a rogue process is also writing to the databases
    - `EADDRINUSE` — another daemon instance is running, or stale socket file exists
    - `Consolidation phase X failed` — check if LLM provider is configured and reachable

---

## Appendix A: npm Dependencies

New dependencies required by the daemon:

| Package | Version | Purpose |
|---------|---------|---------|
| `croner` | ^9.0 | Cron scheduling (Nidra consolidation timer) |
| `socket-activation` | ^0.1 | Detect launchd/systemd socket activation |
| `better-sqlite3` | ^11.0 | Already a dependency (SQLite driver) |
| `sqlite-vec` | ^0.2 | Already a dependency (vector extension) |
| `@qdrant/js-client-rest` | ^1.12 | Qdrant cloud sync (optional peer dependency) |

No new heavy dependencies. `croner` is 15KB minified. `socket-activation` is <5KB.

## Appendix B: Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHITRAGUPTA_DAEMON` | unset | Set to `1` when running as daemon (skips interactive features) |
| `CHITRAGUPTA_SOCKET` | platform-specific | Override Unix socket / named pipe path |
| `CHITRAGUPTA_DATA_DIR` | `~/.chitragupta` | Override data directory |
| `CHITRAGUPTA_TCP_PORT` | unset | Enable TCP listener on this port |
| `CHITRAGUPTA_TCP_API_KEY` | unset | API key for TCP connections (required if TCP enabled) |
| `QDRANT_ENDPOINT` | unset | Qdrant cloud cluster URL |
| `QDRANT_API_KEY` | unset | Qdrant cloud API key |
| `CHITRAGUPTA_LOG_LEVEL` | `info` | Daemon log level: debug, info, warn, error |
| `CHITRAGUPTA_CONSOLIDATION_HOUR` | `2` | Hour (0-23) for nightly consolidation |
