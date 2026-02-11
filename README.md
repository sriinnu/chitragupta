<p align="center">
  <img src="assets/logos/chitragupta.svg" alt="Chitragupta Logo" width="120" />
</p>

<h1 align="center">Chitragupta</h1>

<p align="center"><strong>The Autonomous AI Agent Platform</strong></p>

<p align="center">
  <a href="https://github.com/sriinnu/chitragupta/actions/workflows/ci.yml"><img src="https://github.com/sriinnu/chitragupta/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/tests-9%2C121-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-blue" alt="Node" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
  <img src="https://img.shields.io/badge/packages-14-orange" alt="Packages" />
</p>

---

Chitragupta is an AI agent platform that treats cognition as a first-class engineering discipline. It is a TypeScript ESM monorepo of 14 packages — a complete cognitive system with memory, identity, attention, affect, intention, self-reflection, deliberation, and self-evolution. Most of which runs at zero LLM cost.

It exposes a **CLI**, an **HTTP server**, an **MCP server**, and a **programmatic API**. It is designed to be consumed by other applications.

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

# HTTP API server
pnpm chitragupta -- serve

# MCP server (for Claude Code integration)
pnpm chitragupta -- mcp
```

See [GETTING_STARTED.md](GETTING_STARTED.md) for the full setup guide — providers, config, MCP, profiles, memory.

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

### 25 MCP Tools

| Category | Tools | What They Do |
|----------|-------|-------------|
| **Memory** | `chitragupta_memory_search`, `chitragupta_session_list`, `chitragupta_session_show` | Search & browse past sessions |
| **Continuity** | `chitragupta_handover`, `chitragupta_prompt` | Context handover, agent delegation |
| **Collective** | `akasha_traces`, `akasha_deposit`, `samiti_channels`, `samiti_broadcast`, `sabha_deliberate` | Shared knowledge, multi-agent deliberation |
| **Self-Awareness** | `vasana_tendencies`, `health_status`, `atman_report` | Learned patterns, health, identity |
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

## The 14 Packages

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
| [`@chitragupta/cli`](./packages/cli) | Entry Point — interactive CLI, HTTP server, MCP server, onboarding | — | — |

Build order: `core -> swara -> anina -> smriti -> ui -> yantra -> dharma -> netra -> vayu -> sutra -> tantra -> vidhya-skills -> niyanta -> cli`

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

## Performance

| Metric | Value |
|--------|-------|
| Test files | 248 |
| Total tests | 9,121 |
| Failures | 0 |
| TypeScript errors | 0 |
| Packages | 14 |
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

MIT © 2026 Srinivas Pendela

---

<p align="center"><em>"The Vedic traditions spent millennia building a complete model of mind. We are completing a circle that was drawn three thousand years ago."</em></p>