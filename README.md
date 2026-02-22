<p align="center">
  <img src="assets/logos/chitragupta.svg" alt="Chitragupta Logo" width="120" />
</p>

<h1 align="center">Chitragupta</h1>

<p align="center"><strong>The Timekeeper (चित्रगुप्त) — The Autonomous AI Agent Platform</strong></p>

<p align="center">
  <a href="https://github.com/sriinnu/chitragupta/actions/workflows/ci.yml"><img src="https://github.com/sriinnu/chitragupta/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/tests-10%2C682-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-blue" alt="Node" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
  <img src="https://img.shields.io/badge/packages-16-orange" alt="Packages" />
</p>

---

Chitragupta is an AI agent platform that treats cognition as a first-class engineering discipline. It is a TypeScript ESM monorepo of 16 packages — a complete cognitive system with memory, identity, attention, affect, intention, self-reflection, deliberation, and self-evolution. Most of which runs at zero LLM cost.

It exposes a **CLI**, an **HTTP server**, an **MCP server**, a **web dashboard (Hub)**, and a **programmatic API**. It is designed to be consumed by other applications.

Named after the divine scribe in Vedic tradition — the keeper of the hidden record — internally, every module carries a Sanskrit name that defines its purpose. Externally, everything speaks English.

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

Each is backed by Vedic source texts AND published research papers. Each maps to a concrete module. See [docs/ALGORITHMS.md](docs/ALGORITHMS.md) and [docs/VEDIC-MODELS.md](docs/VEDIC-MODELS.md) for the full details.

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
| Workflow Engine | Vayu | Wind |
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

See [GETTING_STARTED.md](GETTING_STARTED.md) for the full setup guide — providers, config, MCP, profiles, memory.

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

See [docs/HUB.md](docs/HUB.md) for the full Hub guide.

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

### 32 MCP Tools

| Category | Tools | What They Do |
|----------|-------|-------------|
| **Memory** | `chitragupta_memory_search`, `chitragupta_recall`, `chitragupta_context`, `chitragupta_session_list`, `chitragupta_session_show` | Search memory, recall decisions, browse sessions |
| **Continuity** | `chitragupta_handover`, `chitragupta_record_conversation` | Context handover, conversation capture |
| **Day Files** | `chitragupta_day_show`, `chitragupta_day_list`, `chitragupta_day_search` | Consolidated daily diaries across all projects |
| **Collective** | `akasha_traces`, `akasha_deposit`, `samiti_channels`, `samiti_broadcast`, `sabha_deliberate` | Shared knowledge, multi-agent deliberation |
| **Self-Awareness** | `vasana_tendencies`, `health_status`, `atman_report` | Learned patterns, health, identity |
| **Agent** | `coding_agent`, `swara_marga_decide` | Autonomous coding, model routing |
| **File & Shell** | `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, `diff`, `watch`, `memory`, `session`, `project_analysis` | Full development toolkit |

### Manual Setup (if you prefer)

<details>
<summary>Claude Code — .mcp.json</summary>

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "npx",
      "args": ["-y", "chitragupta-mcp", "--stdio"],
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
      "args": ["-y", "chitragupta-mcp", "--stdio"],
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

## The 16 Packages

| Package | What It Does | Internal Name | Meaning |
|---------|-------------|---------------|---------|
| [`@chitragupta/core`](./packages/core) | Foundation — types, plugin system, config, validation, auth, observability | — | — |
| [`@chitragupta/swara`](./packages/swara) | AI Providers — LLM streaming, cost tracking, model routing, embeddings | Swara | Voice |
| [`@chitragupta/anina`](./packages/anina) | Agent Runtime — tool execution, consciousness, learning loop, identity | Anina | Soul |
| [`@chitragupta/smriti`](./packages/smriti) | Memory — 4-stream memory, GraphRAG, bi-temporal edges, hybrid search, compaction | Smriti | Remembrance |
| [`@chitragupta/ui`](./packages/ui) | Terminal UI — theme, ANSI rendering, markdown, progress, diff viewer | — | — |
| [`@chitragupta/yantra`](./packages/yantra) | Tools — 12+ built-in tools, sandbox, .env fortress, credential protection | Yantra | Instrument |
| [`@chitragupta/dharma`](./packages/dharma) | Policy — security rules, rate limiting, approval gates, karma tracking | Dharma | Law |
| [`@chitragupta/netra`](./packages/netra) | Vision — image analysis, pixel diffing, screenshot capture, multimodal | Netra | Eye |
| [`@chitragupta/vayu`](./packages/vayu) | Workflows — DAG execution, worker thread pool, parallel pipelines | Vayu | Wind |
| [`@chitragupta/sutra`](./packages/sutra) | IPC — P2P actor mesh, 4-lane mailboxes, SWIM gossip, pub/sub, 6 coordination patterns | Sutra | Thread |
| [`@chitragupta/tantra`](./packages/tantra) | MCP — server lifecycle, circuit breaker, capability aggregation, auto-restart | Tantra | Technique |
| [`@chitragupta/vidhya-skills`](./packages/vidhya-skills) | Skills — trait vector matching, evolution, security scanning, autonomous learning | Vidhya | Knowledge |
| [`@chitragupta/niyanta`](./packages/niyanta) | Orchestrator — multi-armed bandit, task routing, agent evaluation, auto-scaling | Niyanta | Director |
| [`@chitragupta/hub`](./packages/hub) | Web Dashboard — Preact SPA, device pairing, real-time monitoring | — | — |
| [`@chitragupta/cli`](./packages/cli) | Entry Point — interactive CLI, HTTP server, MCP server, onboarding | — | — |
| [`@chitragupta/darpana`](./packages/darpana) | LLM Proxy — mirrors Anthropic API to any provider, <5ms overhead, zero-config | Darpana | Mirror |

> **npm:** Published as [`@yugenlab/chitragupta`](https://www.npmjs.com/package/@yugenlab/chitragupta) — `npm install -g @yugenlab/chitragupta`

Build order: `core -> swara -> anina -> smriti -> ui -> yantra -> dharma -> netra -> vayu -> sutra -> tantra -> vidhya-skills -> niyanta -> hub -> cli` · `darpana` (standalone, depends on core only)

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

Chitragupta agents communicate via **Sutra** (सूत्र — Thread), a full P2P actor mesh with gossip-based peer discovery, typed messaging, and ambient broadcast channels.

### Architecture

```
Agent A ──tell()──→  MeshRouter  ──deliver──→ Agent B
         ──ask()──→  MeshRouter  ──reply()──→ Agent A (with timeout)
                        │
                  GossipProtocol ──SWIM──→ Peer Discovery & Failure Detection
                        │
                     Samiti ──broadcast──→ #security, #performance, #correctness
```

### Core Components

| Component | Sanskrit | What It Does |
|-----------|----------|-------------|
| **ActorSystem** | Brahma | Top-level coordinator: spawn, stop, route, broadcast |
| **MeshRouter** | -- | Message delivery with TTL, hop tracking, priority lanes |
| **GossipProtocol** | -- | SWIM-style failure detection (alive → suspect → dead) |
| **Samiti** | समिति (Assembly) | Ambient broadcast channels with ring-buffer history |
| **Lokapala** | लोकपाल (Guardian) | 3 autonomous monitors: security, performance, correctness |

### Agent-to-Agent Messaging

Every agent auto-registers as an actor when `actorSystem` is provided:

```typescript
import { Agent } from "@chitragupta/anina";

const agent = new Agent({
  // ... standard config
  actorSystem: meshSystem,     // Enable P2P mesh
  enableMesh: true,            // Auto-register as actor (default: true)
  samiti: samitiInstance,       // Broadcast channel access
  lokapala: guardianInstance,   // Guardian monitoring
});
```

**Message Types:**
- `tell(targetId, message)` — Fire-and-forget delivery
- `ask(targetId, message, timeout)` — Request-reply with timeout
- `broadcast(topic, payload)` — Fan-out to all subscribers

**Protocol Messages:**
`prompt` | `steer` | `abort` | `status` | `delegate` | `ping`

### Samiti Broadcast Channels

Pre-configured ambient channels for cross-cutting concerns:

| Channel | Purpose |
|---------|---------|
| `#security` | Credential leaks, injection attempts, dangerous commands |
| `#performance` | Token burn spikes, latency outliers, context overflow |
| `#correctness` | Error streaks, user corrections, incomplete tasks |
| `#style` | Code style, convention violations |
| `#alerts` | Agent lifecycle events, health warnings |

Agents broadcast findings automatically. Consumers subscribe to channels for real-time notifications.

### Gossip & Failure Detection

SWIM-based protocol with configurable timings:

```json
{
  "mesh": {
    "enabled": true,
    "gossip": {
      "fanout": 3,
      "sweepIntervalMs": 5000,
      "suspectTimeoutMs": 15000,
      "deadTimeoutMs": 30000
    }
  }
}
```

Peer lifecycle: `alive` → `suspect` (no heartbeat) → `dead` (evicted). Lamport generation clock ensures causal ordering across the mesh.

---

## Performance

| Metric | Value |
|--------|-------|
| Test files | 300+ |
| Total tests | 10,682 |
| Failures | 0 |
| TypeScript errors | 0 |
| Packages | 16 |
| p99 latency (load test) | 1.2ms at 500 RPS |
| Security audit | 36 issues found and resolved |

---

## Documentation

| Document | What It Covers |
|----------|---------------|
| [GETTING_STARTED.md](GETTING_STARTED.md) | Installation, configuration, CLI, API, MCP, providers, memory |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, package graph, internal components, memory model, actor mesh |
| [docs/ALGORITHMS.md](docs/ALGORITHMS.md) | Novel algorithms — Sinkhorn-Knopp, PageRank, Thompson Sampling, BOCPD, and more |
| [docs/VEDIC-MODELS.md](docs/VEDIC-MODELS.md) | 17 Vedic cognitive models mapped to computational modules |
| [docs/HUB.md](docs/HUB.md) | Hub web dashboard — device pairing, pages, API endpoints, architecture |
| [docs/API.md](docs/API.md) | REST API, MCP tools/resources, CLI commands, Vayu DAG integration |
| [docs/RESEARCH.md](docs/RESEARCH.md) | 30+ research papers backing every major module |
| [CHANGELOG.md](CHANGELOG.md) | Release history (v0.1.0 — v0.5.0) |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, testing expectations, and PR process.

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community guidelines.

## Security

Full 36-issue security audit completed — 7 critical, 10 high, 12 medium, 7 low — all resolved.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and security features.

## License

MIT © 2025-2026 Srinivas Pendela

---

<p align="center"><em>"The Vedic traditions spent millennia building a complete model of mind. We are completing a circle that was drawn three thousand years ago."</em></p>
