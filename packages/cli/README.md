# @chitragupta/cli

![Logo](../../assets/logos/cli.svg)

**CLI entry point for Chitragupta -- the front door to the entire system.**

`@chitragupta/cli` is the unified entry point that wires together every other package into a coherent developer experience. It parses command-line arguments, detects the current project, loads context files, builds the system prompt with personality, and launches either interactive mode (the full terminal UI experience) or print mode (single-shot, pipe-friendly output). Beyond the interactive agent loop, it provides a full-featured HTTP server (Dvaara) with REST API, WebSocket support (Sandhana), OpenAPI 3.0 spec generation, an MCP server mode for Claude Code integration, a job queue (Karya) for async task execution, 12 subcommands, 13+ slash commands, and comprehensive route groups spanning skills, evolution, intelligence, collaboration, autonomy, and workflow management.

---

## Key Features

- **Argument parsing** -- `parseArgs()` handles flags, modes, model selection, and provider overrides
- **Project detection** -- `detectProject()` identifies the project type, language, framework, and root directory
- **Context files** -- `loadContextFiles()` and `buildContextString()` gather project-level context (`.chitragupta/context.md`, `package.json`, etc.)
- **System prompt** -- `buildSystemPrompt()` assembles the full system prompt from profile, project context, memory, and guardrails
- **Welcome message** -- `buildWelcomeMessage()` generates the personality-driven greeting
- **Interactive mode** -- `runInteractiveMode()` launches the full terminal UI with editor, message list, status bar, and agent loop
- **Print mode** -- `runPrintMode()` runs a single prompt and prints the response (pipe-friendly)
- **HTTP server (Dvaara)** -- Full REST API with JWT auth, RBAC, rate limiting, CORS (localhost-only), Prometheus metrics, and health checks
- **WebSocket server (Sandhana)** -- Real-time bidirectional communication for Vaayu and other clients
- **OpenAPI 3.0 specification** -- Programmatically generated spec covering all registered endpoints
- **MCP server mode** -- Expose Chitragupta tools to Claude Code and other MCP clients via stdio or SSE transport
- **Job queue (Karya)** -- Async task execution with priority, status tracking, and result retrieval
- **12 subcommands** -- session, memory, config, provider, agent, mcp, skills, skill-porter, orchestrate, vidya, workflow, stats
- **13+ slash commands** -- /code, /review, /debug, /research, /refactor, /docs, /skills, /learn, /chetana, /vidya, /stats, /samiti, /sabha, /lokapala, /akasha, /kartavya, /kala, /atman
- **6 REST route groups** -- skills, evolution, intelligence, collaboration, autonomy, workflow
- **Plugin system** -- Extensible via providers, tools, commands, themes, and agent profiles
- **Onboarding** -- First-run setup wizard for API keys and preferences
- **Budget tracking** -- Per-session cost monitoring and limits

## Architecture

| Module | Purpose |
|--------|---------|
| `cli.ts` | Binary entry point (`#!/usr/bin/env node`) |
| `main.ts` | `main()` -- initialization, config loading, bootstrap, mode dispatch |
| `args.ts` | `parseArgs()`, `printHelp()`, `ParsedArgs` type |
| `project-detector.ts` | `detectProject()`, `ProjectInfo` type |
| `context-files.ts` | `loadContextFiles()`, `buildContextString()`, `ContextFiles` type |
| `personality.ts` | `buildSystemPrompt()`, `buildWelcomeMessage()`, `SystemPromptOptions` type |
| `bootstrap.ts` | Shared initialization: config, providers, embedding, memory, tools, skills, dharma, chetana |
| `http-server.ts` | `ChitraguptaServer` (Dvaara) -- REST API, WebSocket, auth, metrics, health checks |
| `ws-handler.ts` | `WebSocketServer` (Sandhana) -- real-time bidirectional communication |
| `openapi.ts` | `generateOpenAPISpec()` -- programmatic OpenAPI 3.0 spec for all endpoints |
| `mcp-entry.ts` | MCP server entry point (`chitragupta-mcp` binary) |
| `mcp-loader.ts` | MCP server setup: tool exposure, resources, prompts, transport selection |
| `job-queue.ts` | `JobQueue` (Karya) -- async task execution with priority and status tracking |
| `agent-api.ts` | Agent tree serialization, stats computation, agent lookup |
| `memory-api.ts` | Memory CRUD utilities for REST endpoints |
| `api.ts` | HTTP API mode initialization |
| `budget-tracker.ts` | Per-session cost monitoring and budget enforcement |
| `plugin-loader.ts` | Dynamic plugin discovery and loading |
| `onboarding.ts` | First-run setup wizard |
| `index.ts` | Package exports |
| `modes/interactive.ts` | `runInteractiveMode()` -- full TUI experience |
| `modes/print.ts` | `runPrintMode()` -- single-shot output |

### Subcommands

| Command | File | Purpose |
|---------|------|---------|
| `session` | `commands/session.ts` | Session management: list, show, delete, export |
| `memory` | `commands/memory.ts` | Memory operations: search, get, update, delete |
| `config` | `commands/config.ts` | Configuration: get, set, list, reset |
| `provider` | `commands/provider.ts` | Provider management: list, test, select |
| `agent` | `commands/agent.ts` | Agent profiles: list, show, use |
| `mcp` | `commands/mcp.ts` | MCP server management: list, add, remove, start, stop |
| `skills` | `commands/skills.ts` | Skill management: list, search, learn, approve, reject |
| `skill-porter` | `commands/skill-porter.ts` | Cross-format skill conversion (Setu) |
| `orchestrate` | `commands/orchestrate.ts` | Multi-agent orchestration: execute, status, history |
| `vidya` | `commands/vidya.ts` | Vidya ecosystem: dashboard, lifecycle, stats |
| `workflow` | `commands/workflow.ts` | Vayu DAG workflows: list, run, status, templates |
| `stats` | `commands/stats.ts` | System statistics: packages, tests, lines, memory |

### REST Route Groups

| Group | File | Endpoints |
|-------|------|-----------|
| **Skills** | `routes/skills.ts` | Skill CRUD, search, Vidya orchestrator, lifecycle evaluation |
| **Evolution** | `routes/evolution.ts` | Vasanas, Nidra daemon status, Vidhi procedural memory |
| **Intelligence** | `routes/intelligence.ts` | Turiya model routing stats, Triguna health, Rta audit, Buddhi decisions |
| **Collaboration** | `routes/collaboration.ts` | Samiti channels, Sabha deliberation, Lokapala guardians, Akasha knowledge |
| **Autonomy** | `routes/autonomy.ts` | Kartavya auto-execution, Kala Chakra temporal awareness |
| **Workflow** | `routes/workflow.ts` | Vayu DAG engine: workflow CRUD, execution, templates |

## API

### Running Chitragupta

```bash
# Interactive mode (default)
chitragupta

# Print mode (single prompt)
chitragupta -p "Explain this codebase"

# With a specific model
chitragupta --model claude-sonnet-4-5-20250929

# With a specific provider
chitragupta --provider openai --model gpt-4o

# API server mode
chitragupta api --port 3000

# MCP server mode (for Claude Code)
chitragupta mcp-server

# Show help
chitragupta --help
```

### Programmatic Usage

```typescript
import { main } from "@chitragupta/cli";

// Launch Chitragupta programmatically
await main();
```

### Argument Parsing

```typescript
import { parseArgs, printHelp } from "@chitragupta/cli";
import type { ParsedArgs } from "@chitragupta/cli";

const args: ParsedArgs = parseArgs(process.argv.slice(2));

console.log(args.mode);     // "interactive" | "print"
console.log(args.model);    // "claude-sonnet-4-5-20250929"
console.log(args.provider); // "anthropic"
console.log(args.prompt);   // The user's prompt (print mode)

if (args.help) {
  printHelp();
}
```

### Project Detection

```typescript
import { detectProject } from "@chitragupta/cli";
import type { ProjectInfo } from "@chitragupta/cli";

const project: ProjectInfo = await detectProject("/path/to/project");

console.log(project.root);       // "/path/to/project"
console.log(project.type);       // "node" | "python" | "rust" | ...
console.log(project.framework);  // "next" | "express" | ...
console.log(project.language);   // "typescript" | "javascript" | ...
```

### Context Files

```typescript
import {
  loadContextFiles,
  buildContextString,
} from "@chitragupta/cli";
import type { ContextFiles } from "@chitragupta/cli";

const ctx: ContextFiles = await loadContextFiles("/path/to/project");
const contextStr = buildContextString(ctx);

// contextStr includes contents of .chitragupta/context.md,
// package.json summaries, and other project metadata
```

### System Prompt & Personality

```typescript
import {
  buildSystemPrompt,
  buildWelcomeMessage,
} from "@chitragupta/cli";
import type { SystemPromptOptions } from "@chitragupta/cli";

const options: SystemPromptOptions = {
  profile: chitraguptaProfile,
  project: projectInfo,
  context: contextString,
  memory: memoryContent,
};

const systemPrompt = buildSystemPrompt(options);
const welcome = buildWelcomeMessage(options);

console.log(welcome);
// "Chitragupta here. I see you're working on a TypeScript monorepo..."
```

### Modes

```typescript
import { runInteractiveMode } from "@chitragupta/cli";
import { runPrintMode } from "@chitragupta/cli";
import type {
  InteractiveModeOptions,
  PrintModeOptions,
} from "@chitragupta/cli";

// Interactive: full TUI
await runInteractiveMode({
  model: "claude-sonnet-4-5-20250929",
  provider: "anthropic",
  profile: chitraguptaProfile,
  project: projectInfo,
});

// Print: single-shot
await runPrintMode({
  prompt: "Explain the architecture",
  model: "claude-sonnet-4-5-20250929",
  provider: "anthropic",
});
```

## HTTP Server (Dvaara)

The Dvaara (द्वार -- Gateway) HTTP server provides a REST API for external applications like Vaayu AI assistant. Built on Node.js `http` module -- no Express or other framework.

**Features:**
- JWT authentication with token exchange and refresh
- RBAC with 4 roles and 16 permissions
- Rate limiting per endpoint
- CORS restricted to localhost
- Prometheus-format metrics at `/metrics`
- Health checks at `/health` (memory, event loop, disk)
- OpenAPI 3.0 spec at `/api/openapi.json`

```typescript
import { ChitraguptaServer } from "@chitragupta/cli";

const server = new ChitraguptaServer({
  port: 3000,
  auth: { secret: process.env.JWT_SECRET, issuer: "chitragupta" },
  rateLimit: { windowMs: 60_000, maxRequests: 100 },
});

await server.start();
```

### Core Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | Send a message to the agent |
| `GET` | `/api/sessions` | List sessions |
| `GET` | `/api/sessions/:id` | Get session details |
| `DELETE` | `/api/sessions/:id` | Delete a session |
| `GET` | `/api/memory` | Search memory |
| `POST` | `/api/memory` | Create/update memory |
| `GET` | `/api/agents` | List agents in the tree |
| `GET` | `/api/agents/:id` | Get agent details |
| `POST` | `/api/jobs` | Submit an async job |
| `GET` | `/api/jobs/:id` | Check job status |

### Collaboration Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/samiti/channels` | List Samiti ambient channels |
| `POST` | `/api/samiti/broadcast` | Broadcast to a Samiti channel |
| `GET` | `/api/samiti/listen/:channel` | Listen to a channel |
| `POST` | `/api/sabha/convene` | Convene a Sabha deliberation |
| `POST` | `/api/sabha/:id/propose` | Submit a proposal |
| `POST` | `/api/sabha/:id/vote` | Cast a vote |
| `GET` | `/api/lokapala/sweep` | Trigger a guardian sweep |
| `GET` | `/api/akasha/query` | Query the Akasha knowledge field |

### Autonomy Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/kartavya` | List kartavyas (active duties) |
| `POST` | `/api/kartavya/propose` | Propose a niyama |
| `POST` | `/api/kartavya/:id/approve` | Approve a niyama |
| `POST` | `/api/kartavya/:id/evaluate` | Evaluate triggers |
| `GET` | `/api/kala` | Get Kala Chakra temporal state |

### Intelligence Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/turiya/stats` | Turiya model router statistics |
| `GET` | `/api/triguna/health` | Triguna system health |
| `GET` | `/api/rta/audit` | Rta invariant audit log |
| `GET` | `/api/buddhi/decisions` | Buddhi decision history |

### Evolution Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/vasanas` | List crystallized tendencies |
| `GET` | `/api/nidra/status` | Nidra daemon status |
| `GET` | `/api/vidhi` | List Vidhi procedures |

### Workflow Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workflows` | List workflows |
| `POST` | `/api/workflows` | Create a workflow |
| `POST` | `/api/workflows/:id/execute` | Execute a workflow |
| `GET` | `/api/workflows/:id/status` | Get execution status |
| `GET` | `/api/workflow-templates` | List built-in templates |

## MCP Server Mode

Expose Chitragupta as an MCP server for Claude Code and other MCP clients.

```bash
# Stdio transport (for Claude Code)
chitragupta mcp-server

# SSE transport (for HTTP clients)
CHITRAGUPTA_MCP_TRANSPORT=sse CHITRAGUPTA_MCP_PORT=3001 chitragupta mcp-server
```

**Exposed MCP tools:** All 12 yantra tools + `memory_search` + `session_list` + `session_show` + `agent_prompt` (opt-in).

**MCP resource:** `chitragupta://memory/project` -- project memory content.

**MCP prompt:** `code_review` -- structured review template.

**Environment variables:**
- `CHITRAGUPTA_MCP_TRANSPORT` -- `"stdio"` (default) or `"sse"`
- `CHITRAGUPTA_MCP_PORT` -- SSE port (default 3001)
- `CHITRAGUPTA_MCP_PROJECT` -- project path override
- `CHITRAGUPTA_MCP_AGENT` -- agent profile override

## Slash Commands

Slash commands switch the agent's personality and toolset mid-session.

| Command | Agent Profile | Purpose |
|---------|--------------|---------|
| `/code` | Kartru (कर्तृ -- Maker) | Coding agent with convention detection and self-validation |
| `/review` | Parikshaka (परीक्षक -- Reviewer) | Read-only structured code review |
| `/debug` | Anveshi (अन्वेषी -- Debugger) | Full tools, 5-step investigation protocol |
| `/research` | Shodhaka (शोधक -- Researcher) | Read-only architecture and codebase research |
| `/refactor` | Parikartru (परिकर्तृ -- Refactorer) | Plan-before-execute refactoring with validation |
| `/docs` | Lekhaka (लेखक -- Documenter) | README, JSDoc, changelog, architecture docs |
| `/skills` | -- | Skill ecosystem dashboard |
| `/learn` | -- | Trigger Shiksha autonomous skill learning |
| `/chetana` | -- | Consciousness state visualization (affect, attention, goals, mastery) |
| `/vidya` | -- | Vidya-Tantra ecosystem dashboard with lifecycle evaluation |
| `/stats` | -- | System statistics: packages, tests, lines, memory usage |
| `/samiti` | -- | Samiti ambient channel viewer |
| `/sabha` | -- | Sabha deliberation interface |
| `/lokapala` | -- | Lokapala guardian sweep trigger |
| `/akasha` | -- | Akasha shared knowledge query |
| `/kartavya` | -- | Kartavya auto-execution management |
| `/kala` | -- | Kala Chakra temporal awareness |
| `/atman` | -- | Atman self-recognition and identity state |

## OpenAPI Specification

A comprehensive OpenAPI 3.0 spec is programmatically generated covering all registered API endpoints.

```typescript
import { generateOpenAPISpec } from "@chitragupta/cli";

const spec = generateOpenAPISpec();
// Covers: core, sessions, memory, agents, auth, jobs, skills,
// evolution, intelligence, collaboration, autonomy, workflow
```

The spec is served at `GET /api/openapi.json` when the HTTP server is running.

## WebSocket Server (Sandhana)

Real-time bidirectional communication channel for Vaayu and other connected clients.

```typescript
import { WebSocketServer } from "@chitragupta/cli";

const ws = new WebSocketServer({
  port: 3001,
  path: "/ws",
  heartbeatInterval: 30_000,
});

ws.onMessage((client, message) => {
  console.log(`${client.id}: ${message.type}`);
});
```

## Job Queue (Karya)

Async task execution with priority, status tracking, and result retrieval.

```typescript
import { JobQueue } from "@chitragupta/cli";

const queue = new JobQueue({ maxConcurrency: 3, maxQueueSize: 100 });

const jobId = queue.submit({
  type: "code-review",
  payload: { files: ["src/parser.ts"] },
  priority: 1,
});

const status = queue.getStatus(jobId);
console.log(status.state); // "pending" | "running" | "completed" | "failed"
```

---

[Back to Chitragupta root](../../README.md)
