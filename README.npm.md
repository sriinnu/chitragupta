<p align="center">
  <img src="https://raw.githubusercontent.com/sriinnu/chitragupta/main/assets/logos/chitragupta.svg" alt="Chitragupta" width="120" />
</p>

<h1 align="center">@yugenlab/chitragupta</h1>

<p align="center"><strong>AI agent memory engine — sessions, recall, fact extraction, MCP server</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@yugenlab/chitragupta"><img src="https://img.shields.io/npm/v/@yugenlab/chitragupta" alt="npm" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-blue" alt="Node" />
  <a href="https://github.com/sriinnu/chitragupta/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
</p>

---

Chitragupta gives AI agents **persistent memory**. Your coding assistant forgets everything between sessions — Chitragupta fixes that.

It works as an **MCP server**, a **CLI**, or a **library** you import directly.

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

This creates `.mcp.json` and teaches the agent when to use Chitragupta's 28 tools — memory search, recall, fact extraction, handover, and more.

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
import { ... } from "@yugenlab/chitragupta/vayu"     // Workflow DAG engine
import { ... } from "@yugenlab/chitragupta/sutra"    // IPC, actor mesh
import { ... } from "@yugenlab/chitragupta/niyanta"  // Orchestrator
import { ... } from "@yugenlab/chitragupta/netra"    // Vision
import { ... } from "@yugenlab/chitragupta/ui"       // Terminal UI
import { ... } from "@yugenlab/chitragupta/darpana"  // LLM API proxy
import { ... } from "@yugenlab/chitragupta/vidhya-skills" // Skill discovery
```

## What It Does

- **Persistent memory** — sessions, turns, and facts survive across conversations
- **Unified recall** — single query searches FTS5, GraphRAG, day files, and memory
- **Real-time fact extraction** — detects personal facts from conversations at zero LLM cost
- **Day consolidation** — daily summaries across all projects and providers
- **GraphRAG** — knowledge graph with bi-temporal edges and personalized PageRank
- **Hybrid search** — BM25 + vector + graph fusion with learned weights
- **Sleep consolidation** — 5-phase dream cycle makes the agent smarter between sessions
- **Behavioral crystallization** — stable habits detected via Bayesian change-point detection
- **Multi-agent deliberation** — structured councils with fallacy detection
- **28 MCP tools** — memory, file ops, shell, search, and self-awareness

## Requirements

- Node.js >= 22
- At least one AI provider (Anthropic, OpenAI, Google API key, or Ollama for local)

## Links

- [GitHub](https://github.com/sriinnu/chitragupta)
- [Getting Started](https://github.com/sriinnu/chitragupta/blob/main/GETTING_STARTED.md)
- [Architecture](https://github.com/sriinnu/chitragupta/blob/main/docs/ARCHITECTURE.md)
- [Changelog](https://github.com/sriinnu/chitragupta/blob/main/CHANGELOG.md)

## License

MIT © 2026 Srinivas Pendela
