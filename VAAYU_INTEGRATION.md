# Chitragupta Integration Guide for Vaayu

> **चित्रगुप्त** — The divine scribe who records all deeds.
> This document is the handshake protocol between **Vaayu** (personal AI assistant) and **Chitragupta** (the AI agent platform).

---

## What is Chitragupta?

Chitragupta is a **14-package TypeScript monorepo** — an AI agent orchestration platform that provides:

- **Memory** (Smriti): GraphRAG with bi-temporal edges, vector search, session persistence
- **Intelligence** (Anina): Agent lifecycle, consciousness layer, emotional/cognitive awareness
- **Routing** (Swara): Multi-provider cost-optimized LLM routing (Claude, GPT, Gemini, local)
- **Tools** (Yantra): 12 sandboxed system tools (file, bash, grep, git, http, etc.)
- **Policy** (Dharma): 20 security rules, sandbox enforcement, credential protection
- **Skills** (Vidhya): Autonomous skill learning, evolution, trait-vector matching
- **MCP** (Tantra): Pluggable MCP server management with health monitoring
- **IPC** (Sutra): Inter-agent communication hub
- **Orchestration** (Niyanta): Bandit-driven strategy selection, agent tree lifecycle

All packages live under `@chitragupta/*` npm scope.

---

## How Vaayu Connects

### Bridge Pattern (In-Process)

The primary integration is via `LodestarBridge` in Vaayu's gateway:

```
vaayu/apps/gateway/src/lodestar/bridge.ts
```

**Key principle**: Chitragupta is **optional**. Vaayu runs at full capacity without it. The bridge:
- Uses dynamic `import()` with fallback chain
- Never throws — returns `null` or `[]` on failure
- All methods are fire-and-forget

### Bridge Methods

| Method | Purpose | Returns |
|--------|---------|---------|
| `recommend(query)` | Get skill recommendations for user message | `string[]` |
| `onSkillExecuted(name, success, latencyMs)` | Report tool execution outcome | `void` |
| `onSkillRejected(rejected, chosen)` | Report when LLM chose differently | `void` |
| `onSessionEnd(sessionId)` | Flush session skill data | `void` |
| `dispose()` | Persist state and release resources | `void` |

### Data Flow

```
User Message → Vaayu Agent Loop
                 ↓
         bridge.recommend(msg)  ← Chitragupta TVM matching (< 0.1ms)
                 ↓
         LLM selects tools (with Chitragupta's recommendations as context)
                 ↓
         Tool executes
                 ↓
         bridge.onSkillExecuted(name, success, latency)  → Chitragupta learns
                 ↓
         Session ends → bridge.onSessionEnd(id)  → state persisted
```

---

## API Surfaces

### 1. REST HTTP (port 3141)

**Core:**
- `GET /api/health` — health check
- `GET /api/sessions` — list sessions
- `POST /api/chat` — send message

**Memory:**
- `GET /api/memory/:scope` — read memory (global/project/agent)
- `PUT /api/memory/:scope` — write memory
- `GET /api/memory/search?q=...` — GraphRAG search

**Agent Tree:**
- `GET /api/agents` — list all agents
- `POST /api/agents/:id/spawn` — spawn child agent
- `POST /api/agents/:id/abort` — abort agent (cascading)
- `POST /api/agents/:id/prompt` — send prompt to specific agent

**Job Queue (async):**
- `POST /api/jobs` — submit job (returns 202 + job ID)
- `GET /api/jobs/:id` — poll for result
- `DELETE /api/jobs/:id` — cancel

**Skills:**
- `GET /api/skills` — list all skills
- `GET /api/skills/ecosystem` — ecosystem stats
- `POST /api/skills/learn` — trigger autonomous learning

**Intelligence Layer:**
- `GET /api/intelligence/turiya` — multi-layer reasoning
- `GET /api/intelligence/triguna` — three-quality health
- `GET /api/intelligence/buddhi` — decision framework

**Collaboration:**
- `GET /api/collaboration/samiti` — ambient channels
- `GET /api/collaboration/sabha` — deliberation/consensus
- `GET /api/collaboration/akasha` — shared knowledge field

**Autonomy:**
- `GET /api/autonomy/kartavya` — auto-execution triggers
- `GET /api/autonomy/kala-chakra` — temporal awareness

### 2. WebSocket (ws://localhost:3141/ws)

- JWT or token auth via query param
- Subscribe to events: `agent:*`, `stream:*`, `tool:*`, `job:*`, `memory:*`
- Real-time streaming of agent output
- Heartbeat with configurable interval

### 3. MCP (stdio or SSE)

Run: `node chitragupta/packages/cli/dist/mcp-entry.js --agent`

**Tools:** 12 yantra tools + `memory_search` + `session_list` + `session_show` + `agent_prompt`
**Resources:** `lodestar://memory/project`, `lodestar://memory/global`
**Prompts:** `code_review`, `architectural_analysis`

---

## Memory Architecture

```
Scopes:
  global  → ~/.chitragupta/memory/global.md        (cross-project patterns)
  project → ~/.chitragupta/memory/projects/{hash}/  (per-project knowledge)
  agent   → ~/.chitragupta/memory/agents/{id}.md    (per-agent state)
  session → stored in session markdown files        (conversation turns)

GraphRAG:
  Entities extracted via NER → graph nodes
  Relations via bi-temporal edges (validTime + recordTime)
  Vector search via Ollama nomic-embed-text (fallback: char-frequency hash)
  Hybrid scoring: Thompson Sampling weights + temporal decay + MMR diversity
```

---

## Auth (Kavach)

- **JWT**: RS256 tokens, configurable expiry
- **RBAC**: 4 roles (user/admin/service/guest), 16 permissions
- **OAuth**: Google, Apple, GitHub token exchange
- **Multi-tenant**: Org-scoped data isolation
- All in `@chitragupta/core/auth/` — zero external dependencies

---

## Configuration

Chitragupta uses cascading config: `global → workspace → project → session`

**Vaayu gateway config** (`vaayu.config.json`):
```json
{
  "chitragupta": {
    "enabled": false,
    "mcpTransport": "stdio",
    "mcpCommand": "npx",
    "mcpArgs": ["chitragupta", "mcp-server"]
  }
}
```

**MCP config** (`.mcp.json`):
```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "node",
      "args": ["chitragupta/packages/cli/dist/mcp-entry.js", "--agent"],
      "env": {
        "CHITRAGUPTA_MCP_AGENT": "true",
        "CHITRAGUPTA_MCP_PROJECT": "/path/to/project"
      }
    }
  }
}
```

---

## Performance Guarantees

| Operation | Latency | Notes |
|-----------|---------|-------|
| Skill recommendation | < 0.1ms | TVM matching, zero LLM calls |
| Memory search | 5-50ms | GraphRAG + vector similarity |
| Job submission | 1-2ms | Async, non-blocking |
| WebSocket message | 2-5ms | Per-frame encoding |
| Health check | < 1ms | In-memory counters |
| Load test baseline | p99 < 1.2ms at 500 RPS | Token bucket rate limiting |

---

## Error Handling Contract

1. **Bridge never throws** — all methods catch and return safe defaults
2. **HTTP errors are structured** — JSON `{ error, message, statusCode }`
3. **WebSocket errors are events** — `{ type: "error", data: { ... } }`
4. **MCP errors use protocol** — standard MCP error codes
5. **Degradation is graceful** — Vaayu operates fully without Chitragupta

---

## Package Map

| Package | Sanskrit | Purpose |
|---------|----------|---------|
| core | मूल | Types, config, auth, observability |
| swara | स्वर | AI provider routing, cost optimization |
| anina | आनिन | Agent lifecycle, consciousness (Chetana) |
| smriti | स्मृति | Memory, GraphRAG, sessions, consolidation |
| ui | दर्शन | Terminal UI, themes, ANSI rendering |
| yantra | यन्त्र | 12 sandboxed tools |
| dharma | धर्म | Policy engine, security rules |
| netra | नेत्र | Vision, screenshot analysis |
| vayu | वायु | Workflow DAG engine |
| sutra | सूत्र | IPC, inter-agent messaging |
| tantra | तन्त्र | MCP server management |
| vidhya-skills | विद्या | Skill discovery, evolution, learning |
| niyanta | नियन्ता | Orchestrator, bandit strategies |
| cli | चित्रगुप्त | Entry point, HTTP server, MCP server |

---

*This document is the single source of truth for Vaayu-Chitragupta integration.
Updated: 2026-02-09*
