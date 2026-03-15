<p align="center">
  <img src="https://raw.githubusercontent.com/sriinnu/chitragupta/main/assets/logos/chitragupta.svg" alt="Chitragupta" width="120" />
</p>

<h1 align="center">@yugenlab/chitragupta</h1>

<p align="center"><strong>AI agent memory and observability platform — sessions, GraphRAG, hybrid search, temporal trending, predictive pre-fetching, and MCP tooling</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@yugenlab/chitragupta"><img src="https://img.shields.io/npm/v/@yugenlab/chitragupta" alt="npm" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-blue" alt="Node" />
  <a href="https://github.com/sriinnu/chitragupta/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-green" alt="License" /></a>
</p>

---

Chitragupta is the core engine for durable agent memory, sessions, routing policy, and runtime integrity.

It works as an **MCP server**, a **CLI**, or a **library** you import directly.

Consumer model:

- **Chitragupta** is the authority for durable memory and sessions.
- **Vaayu** is the primary assistant consumer.
- **Takumi** is a specialized coding consumer and executable capability.
- **Lucy** and **Scarlett** are platform-wide runtime faculties inside the engine.

## Install

```bash
npm install @yugenlab/chitragupta
```

## Use as MCP Server

Give any AI agent (Claude Code, Codex, etc.) persistent memory across sessions.

```bash
# One-command setup in your project
npx chitragupta init
```

This creates `.mcp.json` and teaches the agent when to use Chitragupta's tool surface — memory search, recall, fact extraction, handover, temporal trending, predictive pre-fetching, P2P mesh, skill discovery, and more.

### Manual MCP setup

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "npx",
      "args": ["chitragupta-mcp"],
      "env": {
        "CHITRAGUPTA_MCP_PROJECT": "/path/to/your/project"
      }
    }
  }
}
```

## Use as CLI

```bash
# Interactive mode
npx chitragupta

# Search memory
npx chitragupta recall "what did we decide about auth?"

# Run coding agent
npx chitragupta code "fix the login bug"
```

## Use as Library

```typescript
import { createSession, addTurn, recall, DatabaseManager } from "@yugenlab/chitragupta"

// Initialize
const db = new DatabaseManager();

// Create a session
const session = await createSession(db, {
  project: "/path/to/project",
  provider: "anthropic",
});

// Search across all memory
const answer = await recall(db, "how did we implement caching?");
```

### Sub-path Imports

Each subsystem is available as a separate import:

```typescript
import { ... } from "@yugenlab/chitragupta/core"    // Types, errors, config
import { ... } from "@yugenlab/chitragupta/smriti"   // Memory, sessions, GraphRAG
import { ... } from "@yugenlab/chitragupta/swara"    // LLM providers, routing
import { ... } from "@yugenlab/chitragupta/anina"    // Agent runtime, consciousness
import { ... } from "@yugenlab/chitragupta/tantra"   // MCP server/client
import { ... } from "@yugenlab/chitragupta/dharma"   // Policy, security rules
import { ... } from "@yugenlab/chitragupta/yantra"   // Tool system
import { ... } from "@yugenlab/chitragupta/prana"     // Workflow DAG engine
import { ... } from "@yugenlab/chitragupta/sutra"    // IPC, actor mesh
import { ... } from "@yugenlab/chitragupta/niyanta"  // Orchestrator
import { ... } from "@yugenlab/chitragupta/netra"    // Vision
import { ... } from "@yugenlab/chitragupta/ui"       // Terminal UI
import { ... } from "@yugenlab/chitragupta/darpana"  // LLM API proxy
import { ... } from "@yugenlab/chitragupta/vidhya-skills" // Skill discovery
```

## What It Does

- **Persistent memory** — sessions, turns, and facts survive across conversations
- **Unified recall** — single query searches FTS5, GraphRAG, day files, Akasha traces, and memory
- **Real-time fact extraction** — detects personal facts from conversations at zero LLM cost
- **Day consolidation** — daily summaries across all projects and providers
- **Provenance-aware consolidation** — day/month/year summaries keep raw sessions canonical and carry `sourceSessionIds` for drill-down recall
- **GraphRAG** — knowledge graph with bi-temporal edges and personalized PageRank
- **Hybrid search** — BM25 + vector + graph + Pramana + temporal fusion with Thompson Sampling learned weights
- **Natasha Observer** — temporal trending engine with trend detection, error regression alerts, and velocity tracking across 4 time windows
- **Transcendence Engine** — predictive context pre-fetcher that fuses 5 signal sources to anticipate what memory you'll need next
- **Sleep consolidation** — 5-phase dream cycle (Swapna) reorganizes experience into lasting knowledge
- **Behavioral crystallization** — stable habits detected via Bayesian change-point detection (Vasana Engine)
- **Multi-agent deliberation** — structured councils (Sabha) with Nyaya-style reasoning and fallacy detection
- **Extension system** — install extensions from npm, git, or local paths with hot-reload
- **MCP tools** — memory, sessions, search, Akasha, mesh, skills, file ops, shell, health, and self-awareness

## Runtime and Operations Boundaries

- **Daemon-first authority** — persistent writes are daemon-owned (single writer).
- **Socket auth** — daemon RPC over socket/pipe requires a bridge token handshake and scoped methods.
- **Fallback behavior** — if daemon connectivity drops, direct fallback is read-only for a narrow method subset; writes fail closed.
- **Lucy/Scarlett scope** — runtime overlays are platform-wide internal concepts; coding-agent/Takumi behavior is only one exposed path.
- **Deep-sleep scope** — Nidra groups exact pending sessions by project before running Swapna; deep sleep does not silently broaden to unrelated recent sessions.
- **Readiness check (repo source builds)** — run `pnpm run build:check`, `pnpm run build`, `pnpm run verify:engine`, and `pnpm test`.

See [docs/runtime-constitution.md](https://github.com/sriinnu/chitragupta/blob/main/docs/runtime-constitution.md) for the user-facing engine model.
See [docs/current-status.md](https://github.com/sriinnu/chitragupta/blob/main/docs/current-status.md) for the normalized runtime truth.
See [docs/consumer-contract.md](https://github.com/sriinnu/chitragupta/blob/main/docs/consumer-contract.md) for consumer and bridge boundaries.

## Requirements

- Node.js >= 22
- At least one AI provider (Anthropic, OpenAI, Google API key, or Ollama for local)

## Links

- [GitHub](https://github.com/sriinnu/chitragupta)
- [Getting Started](https://github.com/sriinnu/chitragupta/blob/main/docs/getting-started.md)
- [Architecture](https://github.com/sriinnu/chitragupta/blob/main/docs/architecture.md)
- [Current Status](https://github.com/sriinnu/chitragupta/blob/main/docs/current-status.md)
- [Consumer Contract](https://github.com/sriinnu/chitragupta/blob/main/docs/consumer-contract.md)
- [Changelog](https://github.com/sriinnu/chitragupta/blob/main/CHANGELOG.md)

## License

AGPL-3.0-only © 2026 Srinivas Pendela
