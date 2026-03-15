<p align="center">
  <img src="assets/logos/chitragupta.svg" alt="Chitragupta Logo" width="120" />
</p>

<h1 align="center">Chitragupta</h1>

<p align="center"><strong>⛩ The Timekeeper — The Autonomous AI Agent Platform</strong></p>

<p align="center">
  <a href="https://github.com/sriinnu/chitragupta/actions/workflows/ci.yml"><img src="https://github.com/sriinnu/chitragupta/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/tests-11%2C502-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-blue" alt="Node" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-green" alt="License" /></a>
  <img src="https://img.shields.io/badge/packages-17-orange" alt="Packages" />
  <a href="https://deepwiki.com/sriinnu/chitragupta"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" /></a>
</p>

---

Chitragupta is an AI agent platform that treats cognition as a first-class engineering discipline. It is a TypeScript ESM monorepo of 17 packages — a complete cognitive system with memory, identity, attention, affect, intention, self-reflection, deliberation, and self-evolution. Most of which runs at zero LLM cost.

It exposes a **CLI**, an **HTTP server**, an **MCP server**, a **web dashboard (Hub)**, and a **programmatic API**. It is designed to be consumed by other applications.

Operationally, Chitragupta is the engine of the stack:

- **Chitragupta** owns durable memory, canonical sessions, routing policy, and bridge auth.
- **Vaayu** is the primary assistant consumer.
- **Takumi** is a specialized coding consumer and executable capability.
- **Lucy** and **Scarlett** are engine faculties, not separate products.

Named after the divine scribe in Vedic tradition — the keeper of the hidden record — internally, every module carries a Sanskrit name that defines its purpose. Externally, everything speaks English.

### Visual Identity

```
⛩  Prompt — Torii gate (idle state)
⛩ 𑁍  Spinner — alternates Torii ↔ Brahmi Lotus (processing)
───  Tool header — thin rule with amber highlight
▹  Tool bullet — outline triangle with cyan accent
```

Two built-in themes: **Aurora** (amber/cyan) and **Nebula** (violet/cyan, ink-blue background). Both use the same ⛩ 𑁍 iconography. A **Minimal** theme uses ASCII-only for broad terminal compatibility.

---

## Why Chitragupta?

No AI agent system in existence combines these capabilities:

- **Zero-LLM cognitive layer** — consciousness (affect, attention, self-model, intention) runs on heuristics, not token burns
- **Epistemological typing** — every knowledge edge classified by *how it was acquired* (6 Pramana types with confidence ranges)
- **Sleep consolidation** — the agent gets smarter between sessions via 5-phase dream cycles
- **Crystallized tendencies** — stable habits form from experience via Bayesian change-point detection
- **Predictive auto-execution** — patterns promote into auto-routines, but only with user consent
- **Self-recognition** — continuous identity reconstructed from discrete sessions
- **Formal deliberation** — multi-agent councils with structured syllogistic argument and fallacy detection
- **Bi-temporal knowledge graph** — time-travel queries across memory with temporal decay
- **Self-evolving skills** — discovers, builds, scans, and deploys its own tools autonomously
- **Domain guardian agents** — always-on specialized monitors for security, performance, correctness
- **Information-theoretic compaction** — compacts by knowledge type, not just recency
- **Hallucination grounding** — classifies claims as real, provisional, or contradicted

Each maps to a concrete module and is grounded by a mix of direct algorithms, heuristic adaptations, and published research references. The research docs are meant to make that grounding inspectable, not to claim that every subsystem is a line-by-line implementation of a paper. See [docs/algorithms.md](docs/algorithms.md), [docs/research.md](docs/research.md), and [docs/vedic-models.md](docs/vedic-models.md) for the details.

## Runtime Constitution

The shortest correct mental model is:

| Role | Meaning |
| --- | --- |
| Chitragupta | core engine and runtime authority |
| Sabha | council / peer consultation |
| Lucy | intuition / anticipation |
| Scarlett | integrity / healing |
| Vaayu | primary assistant consumer |
| Takumi | coding consumer + executable capability |

See [docs/runtime-constitution.md](docs/runtime-constitution.md) for the authoritative user-facing model.
See [docs/current-status.md](docs/current-status.md) for the normalized runtime truth.
See [docs/consumer-contract.md](docs/consumer-contract.md) for consumer and bridge boundaries.

### Lineage and Research Posture

Chitragupta sits in the same broad agent-tooling ecosystem as projects such as takumi, pi-mono, and some CLI, session, and operator-workflow ergonomics belong to that shared lineage.

That lineage is narrower than the full architecture. The Sanskrit-named cognitive subsystems and runtime overlays such as Smriti, Akasha, Lucy, Scarlett, Nidra, and Buddhi are Chitragupta-specific compositions in this repo family.

When this README points to research, it means one of three things:

- a direct algorithmic primitive is implemented in code
- a paper informed a heuristic or subsystem design
- a paper is an external validation or taxonomy reference for the architectural shape

---

## Quick Glossary

Chitragupta uses Sanskrit names internally — each captures the *essence* of what a module does. Here's the quick map:
For external docs/onboarding, prefer the English names first.

| English Name | Internal Name | What It Means |
|-------------|---------------|---------------|
| AI Providers | Swara | Voice |
| Agent Runtime | Anina | Soul |
| Memory System | Smriti | Remembrance |
| Tool System | Yantra | Instrument |
| Policy Engine | Dharma | Law |
| Vision | Netra | Eye |
| Workflow Engine | Prana | Life Force |
| IPC / Actor Mesh | Sutra | Thread |
| MCP Manager | Tantra | Technique |
| Skill Discovery | Vidhya | Knowledge |
| Orchestrator | Niyanta | Director |
| Consciousness | Chetana | Awareness |
| Consolidation | Samskaara | Impression |
| Model Router | Marga | Path |

---

## Quick Start

### Prerequisites

- **Node.js >= 22**
- **pnpm** (`npm install -g pnpm`)
- At least one AI provider: an API key (Anthropic, OpenAI, Google), Ollama for local, or a CLI tool (Claude Code, Codex, Gemini CLI)

### Install

```bash
git clone https://github.com/sriinnu/chitragupta.git
cd chitragupta
pnpm install
pnpm run build
```

### Run

```bash
# Set your API key (or use Ollama for fully local)
# See: https://console.anthropic.com/settings/keys

# Interactive mode
pnpm chitragupta

# Direct prompt
pnpm chitragupta -- "explain the auth flow in this project"

# HTTP API server + Hub dashboard
pnpm chitragupta -- serve

# MCP server (for Claude Code integration)
pnpm chitragupta -- mcp
```

See [docs/getting-started.md](docs/getting-started.md) for the full setup guide — providers, config, MCP, profiles, memory.

## Build and Release Hygiene

For root-level operator tasks, use the dependency-audited workspace pipeline:

```bash
pnpm run build:check
pnpm run build
pnpm run verify:engine
pnpm run publish:dry
```

Subtree operators:

```bash
pnpm run subtree:split
pnpm run subtree:push
```

Release and subtree details: [docs/release-hygiene.md](docs/release-hygiene.md)

---

## Providers

Chitragupta auto-detects AI providers and uses them in priority order. **CLI providers are tried first** (zero cost — they use their own auth/billing), then local (Ollama), then cloud APIs (paid).

### Supported Providers

| Provider | Type | Command | Cost |
|----------|------|---------|------|
| Claude Code | CLI | `claude --print` | Free |
| Gemini CLI | CLI | `gemini --prompt` | Free |
| GitHub Copilot | CLI | `copilot -p` | Free |
| Codex | CLI | `codex exec --full-auto` | Free |
| Aider | CLI | `aider --message` | Free |
| Z.AI (GLM) | CLI | `zai -p` | Free |
| MiniMax (M2.5) | CLI | `minimax -p` | Free |
| Ollama | Local | API | Free |
| Anthropic | Cloud API | API | Paid |
| OpenAI | Cloud API | API | Paid |
| Google | Cloud API | API | Paid |

### Default Priority

```
claude > gemini > copilot > codex > aider > zai > minimax > ollama > anthropic > openai > google
```

This is **not strict** — you can reorder it however you want.

### Customizing Priority

Edit `~/.chitragupta/config/settings.json`:

```json
{
  "providerPriority": ["minimax-cli", "zai-cli", "gemini-cli", "ollama", "anthropic"]
}
```

This puts MiniMax first, Z.AI second, skips Claude/Copilot/Codex/Aider entirely, and falls back to Ollama then Anthropic API.

### Forcing a Specific Provider

Use the `--provider` flag to bypass priority and force a specific provider:

```bash
chitragupta --provider anthropic "explain this code"
chitragupta --provider ollama "summarize this file"
```

### Adding Custom OpenAI-Compatible Providers

Any OpenAI-compatible endpoint (vLLM, LM Studio, LocalAI, llama.cpp) can be added via settings:

```json
{
  "customProviders": [
    {
      "id": "my-local",
      "name": "My Local Server",
      "baseUrl": "http://localhost:8080/v1",
      "authEnvVar": "MY_API_KEY"
    }
  ]
}
```

### How Detection Works

On startup, Chitragupta probes the system PATH for each CLI tool concurrently (< 2s total). Available CLIs are registered as providers. Use `chitragupta provider list` to see what's detected:

```
  Detected providers:
    ✓ claude CLI (1.0.23) — zero cost ← primary
    ✓ gemini CLI (0.1.0) — zero cost
    ✓ Ollama (local) — zero cost
    ✓ ANTHROPIC API — paid
```

---

## Hub Dashboard

Chitragupta includes a web-based dashboard served from the same port as the HTTP API. It provides a visual interface for monitoring sessions, costs, models, memory, skills, and managing paired devices.

```bash
# Build the Hub frontend
pnpm -F @chitragupta/hub build

# Start the server (Hub auto-detected)
chitragupta serve
# → Hub: http://localhost:3141
```

On first visit, the browser must complete a **device pairing** — a novel 4-method protocol (passphrase, QR code, visual icon match, or number code) that proves the browser can see the terminal output. No passwords, no API keys.

### Dashboard Pages

| Page | What It Shows |
|------|--------------|
| **Overview** | Cost cards, session summary, health indicators, recent activity |
| **Sessions** | Session list with search, turn-by-turn detail view |
| **Models** | Model catalog across providers, router insights, model switching |
| **Memory** | GraphRAG explorer, consolidation rules, learned patterns |
| **Skills** | Skill registry, approval queue, learning timeline |
| **Settings** | Budget config, provider preferences, skill discovery mode |
| **Devices** | Paired browsers, revoke access, re-pair |

See [docs/hub.md](docs/hub.md) for the full Hub guide.

---

## MCP Integration

Chitragupta's killer feature: **persistent memory for AI agents**. Your AI coding assistant (Claude Code, Codex, etc.) forgets everything between sessions. Chitragupta fixes that.

### One-Command Setup

```bash
cd your-project
chitragupta init
```

That's it. This does two things:

1. **Creates `.mcp.json`** — configures Chitragupta as an MCP server for your AI client
2. **Updates `CLAUDE.md`** (or `.codex/instructions.md`) — teaches the agent *when* to call Chitragupta's tools

### What the Agent Gets

Once initialized, your AI agent automatically:

- **Searches past sessions** at the start of every conversation for relevant context
- **Remembers decisions** — "we chose factory pattern" persists across sessions
- **Preserves work state** — when context compacts, the handover tool saves what you were doing
- **Learns your patterns** — coding style, preferred approaches, recurring workflows

### 38 MCP Tools

| Category | Tools | What They Do |
|----------|-------|-------------|
| **Memory** | `chitragupta_memory_search`, `chitragupta_recall`, `chitragupta_context`, `chitragupta_session_list`, `chitragupta_session_show` | Search memory, recall decisions, browse sessions |
| **Continuity** | `chitragupta_handover`, `chitragupta_record_conversation` | Context handover, conversation capture |
| **Day Files** | `chitragupta_day_show`, `chitragupta_day_list`, `chitragupta_day_search` | Consolidated daily diaries across all projects |
| **Collective** | `akasha_traces`, `akasha_deposit`, `samiti_channels`, `samiti_broadcast`, `sabha_deliberate` | Shared knowledge, multi-agent deliberation |
| **Self-Awareness** | `vasana_tendencies`, `health_status`, `atman_report` | Learned patterns, health, identity |
| **Mesh (P2P)** | `mesh_status`, `mesh_spawn`, `mesh_send`, `mesh_ask`, `mesh_find_capability`, `mesh_peers`, `mesh_gossip`, `mesh_topology` | Distributed actor mesh |
| **Skills** | `skills_find`, `skills_list`, `skills_health`, `skills_learn`, `skills_scan`, `skills_ecosystem`, `skills_recommend` | Self-evolving skill discovery |
| **Agent** | `coding_agent`, `swara_marga_decide` | Autonomous coding, model routing |
| **Sync** | `chitragupta_sync_status`, `chitragupta_sync_export`, `chitragupta_sync_import`, `chitragupta_vidhis`, `chitragupta_consolidate` | Cross-device sync, consolidation |
| **File & Shell** | `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, `diff`, `watch`, `memory`, `session`, `project_analysis` | Full development toolkit |

### Autonomous Coding

`coding_agent` is the user-facing entrypoint for Chitragupta's coding workflow.

Lucy and Scarlett are broader Chitragupta runtime concepts across the platform, not Takumi-only or MCP-only features. The `coding_agent` path is one user-facing surface that currently exposes part of that runtime.

- `full` — Lucy context injection + Takumi bridge when available + CLI fallback
- `plan-only` — returns a plan and context preview without executing
- `cli` — skips Lucy/Takumi and routes directly to the best available coding CLI
- `noCache` — bypasses predictive context hints and forces a fresh-memory execution path

See [docs/coding-agent.md](docs/coding-agent.md) for the exact mode semantics, Takumi bridge behavior, CLI fallback order, and what is wired today versus optional/fallback behavior.

### Manual Setup (if you prefer)

<details>
<summary>Claude Code — .mcp.json</summary>

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "npx",
      "args": ["-y", "-p", "@yugenlab/chitragupta", "chitragupta-mcp"],
      "env": {
        "CHITRAGUPTA_MCP_PROJECT": "/path/to/your/project"
      }
    }
  }
}
```

Then add to your project's `CLAUDE.md`:

```markdown
# Chitragupta MCP

## Session Start
- At the START of every session, call `chitragupta_memory_search` with the current task.
- Call `chitragupta_session_list` to see recent sessions.

## During Work
- Search past sessions before making architectural decisions.
- Call `akasha_deposit` after completing significant work.

## Context Limits
- Call `chitragupta_handover` when approaching context limits.
```

</details>

<details>
<summary>Codex CLI — .codex/config.json</summary>

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "npx",
      "args": ["-y", "-p", "@yugenlab/chitragupta", "chitragupta-mcp"],
      "env": {
        "CHITRAGUPTA_MCP_PROJECT": "/path/to/your/project"
      }
    }
  }
}
```

Add the same instructions to `.codex/instructions.md`.

</details>

<details>
<summary>SSE Transport (multi-client)</summary>

If you want multiple clients sharing one memory server:

```bash
# Start the SSE server
chitragupta mcp-server --sse --port 3001

# Point clients to http://localhost:3001
```

</details>

### Adding Chitragupta to a New Project

For any project where you want AI agents to have persistent memory:

```bash
# Option 1: Automatic setup (creates .mcp.json + CLAUDE.md)
cd /path/to/your/project
npx -y -p @yugenlab/chitragupta chitragupta init

# Option 2: Manual setup
# 1. Create .mcp.json in your project root:
cat > .mcp.json << 'EOF'
{
  "mcpServers": {
    "chitragupta": {
      "command": "npx",
      "args": ["-y", "-p", "@yugenlab/chitragupta", "chitragupta-mcp", "--agent"],
      "env": { "CHITRAGUPTA_MCP_AGENT": "true" }
    }
  }
}
EOF

# 2. Add instructions to CLAUDE.md (for Claude Code) or .codex/instructions.md (for Codex):
cat >> CLAUDE.md << 'EOF'

# Chitragupta MCP
## Session Start
- At the START of every session, call `chitragupta_memory_search` with the current task.
- Call `chitragupta_session_list` to see recent sessions.

## During Work
- Search past sessions before making architectural decisions.
- Call `akasha_deposit` after completing significant work.

## Context Limits
- Call `chitragupta_handover` when approaching context limits.
EOF
```

The `.mcp.json` file tells Claude Code (or Codex) to auto-start Chitragupta's MCP server. The `CLAUDE.md` instructions teach the AI agent *when* to call which tools — this is what makes it agentic.

### Troubleshooting

If the MCP server doesn't work, run the built-in diagnostic:

```bash
npx -y -p @yugenlab/chitragupta chitragupta-mcp --check
```

This verifies Node.js version (>=22), native module loading (better-sqlite3), data directory access, and core package imports.

### How It Works

```
chitragupta init          ← one-time setup (creates .mcp.json + CLAUDE.md)
         ↓
claude / codex            ← agent auto-discovers Chitragupta via MCP
         ↓
agent calls tools         ← memory_search at start, handover at end, akasha during work
         ↓
context persists          ← next session picks up where you left off
```

---

## Daemon

Chitragupta runs a **centralized daemon** — a single background process per user that owns all persistent state. Every MCP client session, CLI invocation, and Hub dashboard connects to this one daemon. No double-writes, no lock contention, no stale reads.

### Why a Daemon?

Without it, every MCP session opens its own SQLite connection. Two Claude Code sessions writing to the same database = WAL contention, stale reads, and silent data loss. The daemon is the single writer — all clients talk to it over IPC, and it serializes all mutations.

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                 Chitragupta Daemon                    │
│                  (one per user)                       │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │ Unix Socket  │  │ HTTP Server │  │    Nidra     │ │
│  │ JSON-RPC 2.0 │  │ :3690       │  │ Consolidation│ │
│  │ (NDJSON)     │  │ (loopback)  │  │ (cron 2am)  │ │
│  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘ │
│         │                 │                │         │
│  ┌──────┴─────────────────┴────────────────┴───────┐ │
│  │            RPC Router (method registry)          │ │
│  └──────┬──────────────┬───────────────┬───────────┘ │
│         │              │               │             │
│  ┌──────┴──────┐ ┌─────┴─────┐ ┌──────┴──────┐      │
│  │  agent.db   │ │ graph.db  │ │ vectors.db  │      │
│  │  (FTS5)     │ │ (KG)      │ │ (embeddings)│      │
│  └─────────────┘ └───────────┘ └─────────────┘      │
└──────────────────────────────────────────────────────┘
        ▲               ▲               ▲
        │               │               │
   ┌────┴────┐    ┌─────┴─────┐   ┌────┴─────┐
   │MCP Client│   │ CLI / Hub │   │ Menubar  │
   │(socket)  │   │ (socket)  │   │ (HTTP)   │
   └──────────┘   └───────────┘   └──────────┘
```

**Two local interfaces, same daemon:**

| Interface | Port/Path | Protocol | Auth boundary | Clients |
|-----------|-----------|----------|---------------|---------|
| Unix Socket | `~/Library/Caches/chitragupta/daemon/chitragupta.sock` (platform-specific) | JSON-RPC 2.0 over NDJSON | Bridge token handshake (`auth.handshake`) + method scopes | MCP sessions, CLI, Hub server |
| HTTP Server | `127.0.0.1:3690` | REST (JSON) | Loopback trust boundary (no bridge-token handshake) | macOS menubar, browser, curl |
| Named Pipe | `\\.\pipe\chitragupta` (Windows) | JSON-RPC 2.0 | Bridge token handshake (`auth.handshake`) + method scopes | Same as Unix socket |

### Lifecycle

```bash
# Start — forks a detached Node.js process
chitragupta daemon start
#   → acquires lock (prevents concurrent spawns)
#   → forks entry.js with detached:true, stdio:ignore
#   → waits for IPC "ready" signal (max 10s)
#   → writes PID file to ~/.chitragupta/daemon.pid
#   → exits (daemon survives parent exit)

# Status — check if running
chitragupta daemon status

# Stop — graceful SIGTERM, falls back to SIGKILL after 5s
chitragupta daemon stop

# Restart — stop + 500ms delay + start
chitragupta daemon restart

# Ping — verify socket response time
chitragupta daemon ping
```

The daemon auto-spawns when any MCP client connects — you rarely need to start it manually.

### HTTP API (port 3690)

Loopback-only operations surface for local tooling. This interface currently does not use the daemon bridge-token handshake; keep it local to the host.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ping` | Liveness check. Returns `{ pong: true, ts: <epoch_ms> }` |
| `GET` | `/status` | Aggregated health — daemon vitals, DB counts, Nidra state |
| `POST` | `/consolidate` | Trigger Nidra memory consolidation |
| `POST` | `/shutdown` | Graceful daemon shutdown |

**Example: check status**

```bash
curl -s http://127.0.0.1:3690/status | jq
```

```json
{
  "daemon": {
    "alive": true,
    "pid": 14801,
    "uptime": 86420,
    "memory": 47185920,
    "connections": 2,
    "methods": 42
  },
  "nidra": { "state": "awake", "running": false },
  "db": {
    "turns": 1247,
    "sessions": 68,
    "rules": 312,
    "vidhis": 22,
    "samskaras": 15,
    "vasanas": 8,
    "akashaTraces": 44
  },
  "timestamp": 1709312400000
}
```

### Three SQLite Databases

The daemon manages three separate databases (single-writer, WAL mode):

| Database | What It Stores | Search Method |
|----------|---------------|---------------|
| `agent.db` | Turns, sessions, rules, vidhis, samskaras, vasanas | FTS5 (BM25) |
| `graph.db` | Knowledge graph — entities, edges, Pramana types | Graph traversal + PageRank |
| `vectors.db` | Embeddings (Float32Array BLOBs) | Brute-force cosine similarity |

Retrieval uses **Reciprocal Rank Fusion** across 4 signals: BM25 + vector cosine + GraphRAG + Pramana epistemic weights.

### Platform Paths

| Platform | Daemon Directory | Socket/Pipe |
|----------|-----------------|-------------|
| **macOS** | `~/Library/Caches/chitragupta/daemon/` | `<daemon_dir>/chitragupta.sock` |
| **Linux** | `$XDG_RUNTIME_DIR/chitragupta/` or `~/.chitragupta/daemon/` | `<daemon_dir>/chitragupta.sock` |
| **Windows** | `%LOCALAPPDATA%\chitragupta\daemon\` | `\\.\pipe\chitragupta` |

Other paths: PID file at `~/.chitragupta/daemon.pid`, logs at `~/.chitragupta/logs/`.

Override with environment variables: `CHITRAGUPTA_SOCKET`, `CHITRAGUPTA_PID`, `CHITRAGUPTA_HOME`, `CHITRAGUPTA_DAEMON_DIR`.

### Process Safety

- **Single-writer guarantee** — all SQLite writes go through the daemon; clients only read via RPC
- **Lock-based spawn** — file-based lock prevents concurrent daemon starts (O_EXCL atomic creation)
- **Stale lock detection** — locks older than 30s with dead holder PIDs are automatically broken
- **Crash policy** — uncaught exceptions trigger clean exit (not silent continuation); clients detect death and auto-restart
- **Memory pressure** — 256MB heap limit, periodic GC hints at 80% usage
- **Signal handling** — SIGTERM/SIGINT for graceful shutdown, SIGHUP on Unix, `taskkill` on Windows
- **Nidra consolidation** — cron at 2am, backfills missed days on startup, manual trigger via RPC

### Production Readiness Boundaries

- **Engine authority** — daemon is the single-writer authority for persistent state; treat direct writers as a failure mode.
- **Degraded mode** — when the daemon is unreachable, CLI bridge fallback is read-only for a limited method set; write paths fail closed.
- **Auth split is intentional** — daemon socket/pipe RPC is token+scope gated; daemon loopback HTTP is local-trust ops only.
- **Lucy/Scarlett scope** — these are platform-wide internal runtime overlays; `coding_agent` and Takumi bridge behavior are one user-facing slice, not the full runtime.
- **Sabha semantics** — Sabha is available as a structured deliberation surface, but full daemon-driven autonomous loops remain partially wired (see runtime-integrity docs).
- **Release gate** — before shipping, run `pnpm run build:check`, `pnpm run build`, `pnpm run verify:engine`, and `pnpm test`.

### macOS Menubar App

A native SwiftUI menubar app that monitors the daemon in real-time:

- **Status bar icon** — animated sacred flame (green/amber/gray by health)
- **Live dashboard** — PID, uptime, memory, connections, Nidra state, memory pipeline counts
- **Start/Stop controls** — start daemon from the menubar when offline, stop via HTTP
- **Consolidation trigger** — manually wake Nidra for memory consolidation
- **Hub link** — open the web dashboard in the browser

Build: `cd apps/macos-menubar && xcodegen && xcodebuild`

---

## The 17 Packages

### Published (11 packages — `@chitragupta/*` on npm)

| Package | What It Does | Sanskrit Name | Meaning |
|---------|-------------|---------------|---------|
| [`@chitragupta/cli`](./packages/cli) | Entry Point — interactive CLI, HTTP server, MCP server, onboarding | — | — |
| [`@chitragupta/daemon`](./packages/daemon) | Daemon — Unix socket, single-writer SQLite, JSON-RPC, health monitor, circuit breaker | Sevaka | Guardian |
| [`@chitragupta/core`](./packages/core) | Foundation — types, plugin system, config, validation, auth, observability | — | — |
| [`@chitragupta/sutra`](./packages/sutra) | IPC — P2P actor mesh, 4-lane mailboxes, SWIM gossip, pub/sub, 6 coordination patterns | Sutra | Thread |
| [`@chitragupta/smriti`](./packages/smriti) | Memory — 4-stream memory, GraphRAG, bi-temporal edges, hybrid search, compaction | Smriti | Remembrance |
| [`@chitragupta/swara`](./packages/swara) | AI Providers — LLM streaming, cost tracking, model routing, embeddings | Swara | Voice |
| [`@chitragupta/dharma`](./packages/dharma) | Policy — security rules, rate limiting, approval gates, karma tracking | Dharma | Law |
| [`@chitragupta/darpana`](./packages/darpana) | LLM Proxy — mirrors Anthropic API to any provider, <5ms overhead, zero-config | Darpana | Mirror |
| [`@chitragupta/niyanta`](./packages/niyanta) | Orchestrator — multi-armed bandit, task routing, agent evaluation, auto-scaling | Niyanta | Director |
| [`@chitragupta/ui`](./packages/ui) | Terminal UI — themes (Aurora/Nebula/Minimal), ANSI rendering, markdown, progress, diff viewer | — | — |
| [`@chitragupta/vidhya-skills`](./packages/vidhya-skills) | Skills — trait vector matching, evolution, security scanning, autonomous learning | Vidhya | Knowledge |

### Private (6 packages — internal, not published)

| Package | What It Does | Sanskrit Name | Meaning |
|---------|-------------|---------------|---------|
| [`@chitragupta/anina`](./packages/anina) | Agent Runtime — tool execution, consciousness, learning loop, identity | Anina | Soul |
| [`@chitragupta/hub`](./packages/hub) | Web Dashboard — Preact SPA, device pairing, real-time monitoring | — | — |
| [`@chitragupta/netra`](./packages/netra) | Vision — image analysis, pixel diffing, screenshot capture, multimodal | Netra | Eye |
| [`@chitragupta/tantra`](./packages/tantra) | MCP — server lifecycle, circuit breaker, capability aggregation, auto-restart | Tantra | Technique |
| [`@chitragupta/prana`](./packages/prana) | Workflows — DAG execution, worker thread pool, parallel pipelines | Prana | Life Force |
| [`@chitragupta/yantra`](./packages/yantra) | Tools — 12+ built-in tools, sandbox, .env fortress, credential protection | Yantra | Instrument |

> **npm:** Published as [`@yugenlab/chitragupta`](https://www.npmjs.com/package/@yugenlab/chitragupta) — `npm install -g @yugenlab/chitragupta`

Build order: `core -> swara -> anina -> smriti -> ui -> yantra -> dharma -> netra -> prana -> sutra -> tantra -> vidhya-skills -> niyanta -> daemon -> hub -> cli` · `darpana` (standalone, depends on core only)

---

## Agent Garage

Six preconfigured specialist agents, each with scoped tool access:

| Agent | Role | Slash Command |
|-------|------|---------------|
| **Kartru** (Maker) | Coding — convention detection, self-validation | `/code` |
| **Parikshaka** (Reviewer) | Code review — read-only, structured reports | `/review` |
| **Anveshi** (Debugger) | Debugging — full tools, 5-step investigation | `/debug` |
| **Shodhaka** (Researcher) | Research — read-only, architecture analysis | `/research` |
| **Parikartru** (Refactorer) | Refactoring — plan-before-execute, validation | `/refactor` |
| **Lekhaka** (Documenter) | Documentation — README, JSDoc, changelog | `/docs` |

Plus 3 base profiles: `chitragupta` (bold, opinionated default), `friendly`, `minimal`. Custom profiles via the plugin system.

---

## Agent Scaling

Chitragupta enforces a **two-tier limit model** to prevent runaway agent spawning while keeping defaults generous for real workloads.

### Limits Overview

| Parameter | Default | System Ceiling | What It Controls |
|-----------|---------|---------------|-----------------|
| **Max Agent Depth** | 8 | 10 | How deep the agent tree can nest (root → child → grandchild...) |
| **Max Sub-Agents** | 12 | 16 | Maximum children a single parent agent can spawn |
| **Max Concurrent Jobs** | 10 | 16 | Parallel jobs in the HTTP job queue |
| **Global Max Agents** | 16 | -- | Total active agents across the entire tree |
| **Budget Decay** | 0.7x | -- | Token budget multiplier per depth level |

System ceilings are hard-coded and **cannot be exceeded** regardless of configuration. User-configured values are clamped to these ceilings automatically.

### Configuring via Settings

Add an `agents` section to `~/.chitragupta/config/settings.json`:

```json
{
  "agents": {
    "maxDepth": 10,
    "maxSubAgents": 16,
    "maxConcurrentJobs": 14
  }
}
```

All fields are optional — missing fields use defaults. Values exceeding system ceilings are silently clamped.

### Programmatic Configuration (KaalaConfig)

For fine-grained control, configure `KaalaBrahma` directly:

```typescript
import { KaalaBrahma } from "@chitragupta/anina";

const kaala = new KaalaBrahma({
  maxAgentDepth: 10,           // Tree depth (clamped to 10)
  maxSubAgents: 16,            // Children per parent (clamped to 16)
  globalMaxAgents: 16,         // Total active agents
  budgetDecayFactor: 0.7,      // Token budget: child = parent * 0.7
  rootTokenBudget: 200_000,    // Root agent token budget
  heartbeatInterval: 5_000,    // Health check cadence (ms)
  staleThreshold: 30_000,      // Stale detection (ms)
  deadThreshold: 120_000,      // Dead promotion (ms)
  orphanPolicy: "cascade",     // "cascade" | "reparent" | "promote"
  minTokenBudgetForSpawn: 1_000,
});
```

### Spawn Validation

Before any agent spawn, `KaalaBrahma.canSpawn()` checks:
1. **Depth** — child depth <= `maxAgentDepth`
2. **Sibling count** — parent's children < `maxSubAgents`
3. **Global count** — total active < `globalMaxAgents`
4. **Token budget** — child budget (`parent * decayFactor`) >= `minTokenBudgetForSpawn`

If any check fails, the spawn is rejected with a reason string.

---

## P2P Agent Communication (Sutra Mesh)

Chitragupta agents communicate via **Sutra** (सूत्र — Thread), a full P2P actor mesh over real WebSocket connections with Bitcoin-inspired network design, HMAC authentication, TLS encryption, gossip-based failure detection, and ambient broadcast channels.

> Full documentation: [docs/p2p-mesh.md](docs/p2p-mesh.md)

### Architecture

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│ Node A                      │ WS  │ Node B                      │
│  Agent 1 ──→ MeshRouter ────┼─────┼──→ MeshRouter ──→ Agent 3  │
│  Agent 2     GossipProtocol ┼─────┼──  GossipProtocol          │
│              PeerGuard      │     │    PeerAddrDb               │
└─────────────────────────────┘     └─────────────────────────────┘
```

### Core Components

| Component | What It Does |
|-----------|-------------|
| **ActorSystem** | Top-level coordinator: spawn, stop, route, broadcast, P2P bootstrap |
| **PeerConnectionManager** | WebSocket lifecycle, TLS, reconnect, peer exchange, addr relay |
| **MeshRouter** | Message delivery with TTL, hop tracking, 4 priority lanes |
| **GossipProtocol** | SWIM-style failure detection (alive → suspect → dead) |
| **PeerGuard** | Anti-eclipse: subnet diversity, rate limiting, peer scoring |
| **PeerAddrDb** | Bitcoin-style persistent peer database (new/tried tables) |
| **Samiti** | Ambient broadcast channels with ring-buffer history |

### Quick Start

```typescript
const system = new ActorSystem({ gossipIntervalMs: 500 });
system.start();

const port = await system.bootstrapP2P({
  listenPort: 3142,
  staticPeers: ["ws://seed.example.com:3142/mesh"],
  meshSecret: process.env.MESH_SECRET,
  tls: true, tlsCert: cert, tlsKey: key,
});

// Actors on this node are reachable from any peer
system.spawn("my-agent", { behavior: agentBehavior });
const reply = await system.ask("caller", "remote-agent", { task: "analyze" });
```

### Security

- **HMAC-SHA256 authentication** — nonce-based mutual auth on every connection
- **Replay protection** — nonce windowing rejects stale or replayed auth frames
- **Per-frame signing** — all messages signed with shared secret
- **TLS (wss://)** — encrypted transport with custom CA support
- **Anti-eclipse (PeerGuard)** — subnet diversity (/24), rate limiting, min outbound
- **Version handshake** — protocol compatibility negotiation (`mesh/1.0`)

### Bitcoin-Inspired Peer Discovery

- **Addr relay** — newly discovered peers transitively propagated to all connections
- **Two-table addr database** — "new" (heard about) and "tried" (connected) survive restarts
- **Subnet diversity** — max connections per /24 block; bootstrap set capped at 2 per subnet
- **Peer scoring** — reliability * recency ranking for reconnection priority

### Samiti Broadcast Channels

| Channel | Purpose |
|---------|---------|
| `#security` | Credential leaks, injection attempts, dangerous commands |
| `#performance` | Token burn spikes, latency outliers, context overflow |
| `#correctness` | Error streaks, user corrections, incomplete tasks |
| `#style` | Code style, convention violations |
| `#alerts` | Agent lifecycle events, health warnings |

### Gossip & Failure Detection

SWIM-based protocol: `alive` → `suspect` (no heartbeat) → `dead` (evicted). Lamport generation clock ensures causal ordering. Configurable fanout, sweep intervals, and timeouts.

---

## Lucy Neural Expansion System

Chitragupta's autonomous intelligence layer is named after the film _Lucy_ (2014) — the idea of a system gaining new cognitive abilities as more neural capacity comes online. Each module maps to a stage of cerebral expansion.

Lucy and Scarlett are internal platform concepts first. They apply across Chitragupta's own runtime, memory, health, prediction, and self-healing flows. The Takumi bridge and external MCP-facing agent flows are only one public slice of that broader internal system.

The Lucy/Scarlett framing is Chitragupta-specific. Related papers and future Takumi binding notes are research and planning inputs, not proof that this runtime layer was imported wholesale from another codebase or external spec.

### Architecture

```
              ┌─────────────────────────────────────────────┐
              │          Lucy Neural Expansion               │
              │                                             │
  20%         │  ┌──────────────────────┐                   │
  Self-Heal   │  │  Scarlett Watchdog   │ Daemon crash      │
              │  │  (packages/daemon)   │ detection +       │
              │  └──────────┬───────────┘ auto-restart      │
              │             │                               │
  40%         │  ┌──────────┴───────────┐                   │
  Autonomy    │  │  Lucy Bridge         │ Context injection  │
              │  │  (packages/cli)      │ + watch-and-fix   │
              │  └──────────┬───────────┘ loop              │
              │             │                               │
  60%         │  ┌──────────┴───────────┐                   │
  Expansion   │  │  Cerebral Expansion  │ Autonomous skill  │
              │  │  (packages/cli)      │ discovery +       │
              │  └──────────┬───────────┘ installation      │
              │             │                               │
  80%         │  ┌──────────┴───────────┐                   │
  Observation │  │  Natasha Observer    │ Temporal trending  │
              │  │  (packages/smriti)   │ + regression       │
              │  └──────────┬───────────┘ detection         │
              │             │                               │
  100%        │  ┌──────────┴───────────┐                   │
  Precognition│  │  Transcendence       │ Predictive context │
              │  │  (packages/smriti)   │ pre-fetching       │
              │  └──────────────────────┘                   │
              └─────────────────────────────────────────────┘
                             │
                      CPH4 Catalyst
                  (tool_calls persistence)
```

### Components

| Module | Stage | What It Does |
|--------|-------|-------------|
| **Scarlett Watchdog** | 20% — Self-Healing | Monitors daemon liveness via PID + socket ping. Auto-restarts on crash with exponential backoff and restart-storm prevention. Named after Scarlett Johansson. |
| **Lucy Bridge** | 40% — Autonomy | Wraps the coding agent with autonomous behaviors: queries episodic memory before every task, injects context hints, monitors test output, and auto-dispatches fix tasks on failure. |
| **Cerebral Expansion** | 60% — Expansion | Autonomous skill discovery pipeline. When a tool is not found: extract intent from the name, check Akasha cache, TVM-match against local skills, run Suraksha security scan, install if confidence > 0.8. |
| **Natasha Observer** | 80% — Observation | Temporal trending engine. Tracks entity mention frequency across 4 time windows (hour/day/week/month), detects error regressions by comparing periods, and measures coding velocity deltas. |
| **Transcendence Engine** | 100% — Precognition | Predictive context pre-fetcher. Fuses 5 signal sources (trends, temporal patterns, session continuation, behavioral tendencies, co-occurrence) to predict what memory context will be needed before it is requested. |
| **CPH4 Catalyst** | — | Named after the synthetic molecule that triggers neural expansion. Ensures tool_calls data survives snake_case/camelCase client boundaries so downstream learning pipelines receive complete data. |

For the operator-facing behavior of the runtime integrity wiring, including Buddhi/Akasha/Nidra/Triguna/Lokapala links and autonomous MCP recovery, see [docs/runtime-integrity.md](docs/runtime-integrity.md).

### Research Basis

- Neural Paging (ArXiv 2603.02228) — predictive memory pre-loading
- MEM1 (ArXiv 2506.15841) — anticipatory context staging
- Codified Context (ArXiv 2602.20478) — memory-augmented tool orchestration
- MemWeaver (ArXiv 2601.18204) — three-tier memory with prefetch
- Zep/Graphiti (ArXiv 2501.13956) — bitemporal knowledge graphs

These are representative research anchors for the Lucy-related runtime ideas. The current codebase mixes direct algorithms, heuristics, and platform-specific wiring on top of those references.

---

## Performance Snapshot

These numbers are reference snapshots, not formal SLO guarantees. Re-run the release gate above for current readiness on your branch.

| Metric | Value |
|--------|-------|
| Test files | 371+ |
| Total tests | 11,502 |
| Failures | 0 |
| TypeScript errors | 0 |
| Packages | 17 |
| p99 latency (load test) | 1.2ms at 500 RPS |
| Security audit | 36 issues found and resolved |

---

## Documentation

| Document | What It Covers |
|----------|---------------|
| [docs/getting-started.md](docs/getting-started.md) | Installation, configuration, CLI, API, MCP, providers, memory |
| [docs/architecture.md](docs/architecture.md) | System architecture, package graph, internal components, memory model, actor mesh |
| [docs/component-responsibilities.md](docs/component-responsibilities.md) | Why each core faculty and consumer exists, what it owns, and what it must not own |
| [docs/end-to-end-communication-flow.md](docs/end-to-end-communication-flow.md) | Human-readable flow of how clients, daemon, sessions, memory, Lucy/Scarlett, Nidra, Sabha, and semantic mirror communicate |
| [docs/algorithms.md](docs/algorithms.md) | Novel algorithms — Sinkhorn-Knopp, PageRank, Thompson Sampling, BOCPD, and more |
| [docs/vedic-models.md](docs/vedic-models.md) | 17 Vedic cognitive models mapped to computational modules |
| [docs/hub.md](docs/hub.md) | Hub web dashboard — device pairing, pages, API endpoints, architecture |
| [docs/api.md](docs/api.md) | REST API, MCP tools/resources, CLI commands, Prana workflow integration |
| [docs/current-status.md](docs/current-status.md) | Current runtime truth: what is live, partial, and still open |
| [docs/consumer-contract.md](docs/consumer-contract.md) | Integration contract for Vaayu, Takumi, and future consumers |
| [docs/coding-agent.md](docs/coding-agent.md) | User-facing guide for coding_agent modes, noCache/fresh behavior, Takumi bridge routing, and CLI fallback |
| [docs/runtime-integrity.md](docs/runtime-integrity.md) | Practical runtime contract for nervous-system wiring, integrity loops, and autonomous MCP recovery |
| [docs/sabha-protocol.md](docs/sabha-protocol.md) | Sabha as the council layer: current deliberation engine and target protocol shape |
| [docs/p2p-mesh.md](docs/p2p-mesh.md) | P2P actor mesh — Bitcoin-inspired network, TLS, anti-eclipse, peer discovery |
| [docs/research.md](docs/research.md) | 30+ research papers backing every major module |
| [CHANGELOG.md](CHANGELOG.md) | Release history (v0.1.0 — v0.5.0) |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, testing expectations, and PR process.

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community guidelines.

## Security

Full 36-issue security audit completed — 7 critical, 10 high, 12 medium, 7 low — all resolved.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and security features.

## License

AGPL-3.0-only © 2025-2026 Srinivas Pendela

---

<p align="center"><em>"The Vedic traditions spent millennia building a complete model of mind. We are completing a circle that was drawn three thousand years ago."</em></p>
