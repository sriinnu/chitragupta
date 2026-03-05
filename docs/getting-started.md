# Getting Started with Chitragupta

Chitragupta is a bold, opinionated AI coding assistant built as a TypeScript ESM monorepo.
It serves as a platform/API layer -- exposing a CLI, an HTTP server, an MCP server, and
a programmatic API that other applications can consume.

---

## Prerequisites

- **Node.js >= 22** ([download](https://nodejs.org/)) — required by all packages
- **pnpm 9+** (package manager — `npm install -g pnpm`)
- **TypeScript 5.9+** (installed as a dev dependency)
- At least one AI provider: a CLI tool (Claude Code, Codex, Gemini CLI), Ollama, or an API key
- **Optional:** [Ollama](https://ollama.ai) for local models and embeddings

---

## Installation

```bash
# Clone the repository
git clone https://github.com/sriinnu/chitragupta.git
cd chitragupta

# Install all workspace dependencies
pnpm install

# Build all 16 packages (in dependency order)
pnpm run build
```

The build compiles packages in this order:
`core -> swara -> anina -> smriti -> ui -> yantra -> dharma -> netra -> vayu -> sutra -> tantra -> vidhya-skills -> niyanta -> cli`

After building, the CLI binary is available at `packages/cli/dist/cli.js`. You can run it
directly or link it globally:

```bash
# Run directly via the workspace script
pnpm chitragupta

# Or link globally for the `chitragupta` command
cd packages/cli && pnpm link --global
```

---

## Quick Start (3 minutes)

**1. No API key needed if you have a CLI tool installed:**

Chitragupta auto-detects installed CLI tools (Claude Code, Codex, Gemini CLI, Aider) at
startup and uses them as zero-cost providers. If you already have `claude` or `codex`
installed, you're ready to go -- no API key needed.

Otherwise, set an API key:

```bash
export ANTHROPIC_API_KEY="your-key-here"
```

Or use any supported provider (see [Multi-Provider Support](#multi-provider-support) below).

**2. Launch Chitragupta:**

```bash
pnpm chitragupta
```

**3. First-run onboarding:**

If `~/.chitragupta` does not exist, Chitragupta automatically runs an interactive onboarding
wizard that walks you through:
- Choosing your AI provider (Anthropic, OpenAI, Google, Ollama, or OpenAI-compatible)
- Entering and verifying your API credentials
- Creating `~/.chitragupta/config/settings.json` and `~/.chitragupta/config/credentials.json`

After onboarding, Chitragupta drops you into interactive mode. You can also skip onboarding
and configure manually (see [Configuration](#configuration)).

---

## CLI Usage

### Modes

```bash
# Interactive mode (default) -- full TUI with streaming, slash commands, and tools
chitragupta

# Interactive mode with an initial prompt
chitragupta "Explain this codebase"

# Print mode -- single response, then exit (great for scripting)
chitragupta -p "What does main.ts do?"

# Continue the last session
chitragupta -c

# Resume a previous session (interactive picker)
chitragupta -r
```

### Subcommands

```bash
# Provider management
chitragupta provider list              # Show all registered providers
chitragupta provider add anthropic     # Configure a provider
chitragupta provider test anthropic    # Verify credentials

# Session management
chitragupta session list               # List all sessions
chitragupta session show <id>          # Display a session
chitragupta session search "refactor"  # Full-text search across sessions
chitragupta session export <id> --format json --output ./backup.json
chitragupta session import ./backup.json

# Memory management
chitragupta memory show                # Display project memory
chitragupta memory edit                # Edit project memory
chitragupta memory search "auth flow"  # Semantic search across memory

# Agent profiles
chitragupta agent list                 # Show all profiles (built-in + custom)
chitragupta agent create mybot         # Create a custom profile
chitragupta agent use kartru           # Switch the active profile

# Configuration
chitragupta config                     # Show current config
chitragupta config set defaultModel "claude-sonnet-4-5-20250929"

# MCP server management
chitragupta mcp list                   # List configured MCP servers
chitragupta mcp add                    # Add an MCP server
chitragupta mcp remove                 # Remove an MCP server
chitragupta mcp test                   # Test MCP server connectivity

# Plugin management
chitragupta plugin list                # List installed plugins
chitragupta plugin load                # Load all plugins from ~/.chitragupta/plugins/
chitragupta plugin install             # Show plugin installation instructions

# HTTP API server + Hub dashboard
chitragupta serve --port 3141 --host localhost

# MCP server (for Claude Code, Codex, Gemini CLI, etc.)
chitragupta mcp-server                         # stdio transport (default)
chitragupta mcp-server --sse --port 3001       # SSE transport
chitragupta mcp-server --agent                 # Enable agent prompt tool
chitragupta mcp-server --name my-chitragupta      # Custom server name
```

### Key Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--print <prompt>` | `-p` | Print mode: respond and exit |
| `--continue` | `-c` | Continue the last session |
| `--resume` | `-r` | Resume a session (picker) |
| `--model <id>` | `-m` | Override the default model |
| `--provider <id>` | | Override the default provider |
| `--profile <id>` | | Override the agent profile |
| `--no-memory` | | Disable memory loading |
| `--version` | `-v` | Show version |
| `--help` | `-h` | Show help |

### Interactive Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Ctrl+C` | Clear editor (twice to quit) |
| `Escape` | Abort current operation |
| `Ctrl+L` | Model selector overlay |
| `Shift+Tab` | Cycle thinking level |

### Slash Commands (Interactive Mode)

| Command | Description |
|---------|-------------|
| `/model <name>` | Switch model |
| `/thinking <level>` | Set thinking level (`none`, `low`, `medium`, `high`) |
| `/compact` | Compact conversation context |
| `/memory` | Show project memory |
| `/help` | Show help |
| `/clear` | Clear conversation |
| `/quit` | Exit Chitragupta |

---

## Programmatic API

Chitragupta exposes a clean programmatic API for use as a library -- no TUI, no terminal
dependencies.

```typescript
import { createChitragupta } from "@yugenlab/chitragupta/api";

// Create an instance with options
const chitragupta = await createChitragupta({
  provider: "anthropic",          // "anthropic" | "openai" | "google" | "ollama" | ...
  model: "claude-sonnet-4-5-20250929",
  profile: "chitragupta",           // or a custom AgentProfile object
  workingDir: process.cwd(),
  thinkingLevel: "medium",       // "none" | "low" | "medium" | "high"
  maxSessionCost: 5.00,          // abort if session exceeds $5
  noMemory: false,
});

// Simple prompt -> full response
const answer = await chitragupta.prompt("Explain the config system");
console.log(answer);

// Streaming response
for await (const chunk of chitragupta.stream("Refactor this function")) {
  if (chunk.type === "text") process.stdout.write(chunk.data as string);
  if (chunk.type === "thinking") { /* extended thinking content */ }
  if (chunk.type === "tool_start") { /* tool invocation started */ }
  if (chunk.type === "done") break;
}

// Memory search
const results = await chitragupta.searchMemory("authentication", 10);
for (const r of results) {
  console.log(`[${r.score.toFixed(2)}] ${r.source}: ${r.content}`);
}

// Session management
const session = chitragupta.getSession();
console.log(`Session: ${session.id}, turns: ${session.turnCount}`);
await chitragupta.saveSession();

// Token/cost statistics
const stats = chitragupta.getStats();
console.log(`Cost: $${stats.totalCost.toFixed(4)}`);

// Clean up (required)
await chitragupta.destroy();
```

### ChitraguptaOptions Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `provider` | `string` | `"anthropic"` | AI provider ID |
| `model` | `string` | Provider default | Model ID |
| `profile` | `string \| AgentProfile` | `"chitragupta"` | Agent profile name or object |
| `workingDir` | `string` | `process.cwd()` | Working directory for tools |
| `sessionId` | `string` | Auto-generated | Session ID to resume |
| `onEvent` | `function` | `undefined` | Event handler for streaming |
| `maxSessionCost` | `number` | `0` (unlimited) | Max session cost in USD |
| `thinkingLevel` | `ThinkingLevel` | `"medium"` | Extended thinking level |
| `noMemory` | `boolean` | `false` | Disable memory loading |

---

## MCP Server Mode

Chitragupta can run as an MCP (Model Context Protocol) server, exposing its tools, memory,
and agent capabilities to MCP clients like Claude Code, OpenAI Codex, or Gemini CLI.

### Running the MCP Server

```bash
# stdio transport (Claude Code's preferred mode)
chitragupta mcp-server

# SSE transport for HTTP-based connections
chitragupta mcp-server --sse --port 3001

# Enable the agent prompt tool (requires a configured provider)
chitragupta mcp-server --agent

# Point to a specific project
chitragupta mcp-server --project /path/to/project

# Custom server name
chitragupta mcp-server --name my-chitragupta
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CHITRAGUPTA_MCP_TRANSPORT` | `"stdio"` or `"sse"` | `"stdio"` |
| `CHITRAGUPTA_MCP_PORT` | Port for SSE transport | `3001` |
| `CHITRAGUPTA_MCP_PROJECT` | Project directory | `process.cwd()` |
| `CHITRAGUPTA_MCP_AGENT` | `"true"` to enable agent prompt tool | `"false"` |
| `CHITRAGUPTA_MCP_NAME` | Server name shown to MCP clients | `"chitragupta"` |

---

### Configuring Claude Code

There are three ways to add Chitragupta as an MCP server in Claude Code:

#### Option A: CLI command (recommended)

```bash
# Add globally (available in all projects)
claude mcp add --transport stdio chitragupta -- \
  node /path/to/chitragupta/packages/cli/dist/mcp-entry.js --agent

# Add for a specific project only
claude mcp add --transport stdio chitragupta --scope project -- \
  node /path/to/chitragupta/packages/cli/dist/mcp-entry.js \
  --project /path/to/your/project --agent
```

#### Option B: Edit `~/.claude.json` (user scope)

Add the `mcpServers` entry under your project's key in `~/.claude.json`:

```json
{
  "projects": {
    "/path/to/your/project": {
      "mcpServers": {
        "chitragupta": {
          "command": "node",
          "args": [
            "/path/to/chitragupta/packages/cli/dist/mcp-entry.js",
            "--project", "/path/to/your/project",
            "--agent"
          ]
        }
      }
    }
  }
}
```

#### Option C: Project-scoped `.mcp.json`

Create `.mcp.json` in your project root (can be checked into version control):

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "node",
      "args": [
        "/path/to/chitragupta/packages/cli/dist/mcp-entry.js",
        "--project", ".",
        "--agent"
      ],
      "env": {
        "CHITRAGUPTA_MCP_NAME": "my-project-chitragupta"
      }
    }
  }
}
```

#### Verifying the Connection

After adding the server, restart Claude Code and run:

```
/mcp
```

You should see `chitragupta` listed with its tools and resources. If the server fails
to start, check the logs and ensure the dist file exists:

```bash
ls /path/to/chitragupta/packages/cli/dist/mcp-entry.js
# If missing, rebuild:
cd /path/to/chitragupta && pnpm run build --filter @chitragupta/cli
```

---

### Using npx (After npm Install)

If Chitragupta is installed globally or as a dependency, you can reference
the MCP entry point via npx. This is the recommended approach for machines
where Chitragupta was installed via npm rather than cloned from source.

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "npx",
      "args": [
        "-y", "-p", "@chitragupta/cli",
        "chitragupta-mcp",
        "--project", "/path/to/your/project",
        "--agent"
      ]
    }
  }
}
```

> **Note:** Some MCP clients (VS Code, Cursor) don't load your shell profile,
> so `npx` may not be on the PATH. See the troubleshooting section below
> for absolute-path workarounds.

---

### Configuring Other MCP Clients

#### VS Code (Copilot / Augment / Roo)

Add Chitragupta to `.vscode/mcp.json` in your project root (or to your
user-level `settings.json` under `"mcp.servers"`):

```json
{
  "servers": {
    "chitragupta": {
      "command": "node",
      "args": [
        "/absolute/path/to/chitragupta/packages/cli/dist/mcp-entry.js",
        "--project", "${workspaceFolder}",
        "--agent"
      ]
    }
  }
}
```

> **Important — VS Code PATH caveat:** VS Code extensions do **not** load your
> shell profile (`~/.zshrc`, `~/.bashrc`), so commands like `npx`, `chitragupta`,
> or nvm-managed `node` are typically not found. Always use **absolute paths**
> to both the `node` binary and the MCP entry script.

Find your absolute Node.js path:

```bash
which node
# Example: /Users/you/.nvm/versions/node/v22.12.0/bin/node
```

Then use the full paths in the config:

```json
{
  "servers": {
    "chitragupta": {
      "command": "/Users/you/.nvm/versions/node/v22.12.0/bin/node",
      "args": [
        "/Users/you/code/chitragupta/packages/cli/dist/mcp-entry.js",
        "--project", "${workspaceFolder}",
        "--agent"
      ]
    }
  }
}
```

#### OpenAI Codex

Add to your Codex MCP configuration:

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "node",
      "args": ["/path/to/chitragupta/packages/cli/dist/mcp-entry.js", "--agent"]
    }
  }
}
```

#### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "node",
      "args": [
        "/path/to/chitragupta/packages/cli/dist/mcp-entry.js",
        "--project", "/path/to/your/project",
        "--agent"
      ]
    }
  }
}
```

The stdio transport works with any MCP-compatible client.

#### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "node",
      "args": [
        "/path/to/chitragupta/packages/cli/dist/mcp-entry.js",
        "--project", ".",
        "--agent"
      ]
    }
  }
}
```

#### Generic / Custom Clients

For SSE-based clients, start the server in SSE mode:

```bash
chitragupta mcp-server --sse --port 3001 --agent
```

Then point your client to `http://localhost:3001/sse`.

---

### Exposed MCP Capabilities

**Tools** (32 total — 12 file/shell + 20 Chitragupta-specific):
- `read`, `write`, `edit` -- file operations
- `bash` -- shell command execution
- `grep`, `find`, `ls` -- search and navigation
- `diff`, `watch` -- change tracking
- `memory`, `session` -- memory and session access
- `project_analysis` -- codebase analysis
- `chitragupta_memory_search` -- GraphRAG-backed memory search
- `chitragupta_recall` -- unified search across all memory layers
- `chitragupta_context` -- load persistent memory context
- `chitragupta_session_list` -- list recent sessions
- `chitragupta_session_show` -- display a session's contents
- `chitragupta_handover` -- preserve work state across context limits
- `chitragupta_record_conversation` -- capture conversation turns
- `chitragupta_day_show`, `chitragupta_day_list`, `chitragupta_day_search` -- consolidated daily diaries
- `akasha_traces`, `akasha_deposit` -- shared knowledge field
- `samiti_channels`, `samiti_broadcast` -- ambient communication channels
- `sabha_deliberate` -- multi-agent deliberation
- `vasana_tendencies` -- learned behavioral patterns
- `health_status` -- system health (Triguna)
- `atman_report` -- full self-report
- `coding_agent` -- autonomous coding agent
- `swara_marga_decide` -- LLM routing decisions

**Resources:**
- `chitragupta://memory/project` -- project memory (MEMORY.md)

**Prompts:**
- `code_review` -- structured code review template with file and focus parameters

### What Claude Code Gets from Chitragupta

When Chitragupta is connected as an MCP server, Claude Code gains access to:

1. **Memory-augmented search** -- Chitragupta's GraphRAG-backed semantic memory search
   across sessions, project context, and learned patterns
2. **Session history** -- browse and search through previous coding sessions
3. **Agent delegation** -- hand off complex sub-tasks to Chitragupta's agent (with
   `--agent` flag), which has its own tool chain and reasoning loop
4. **Project memory** -- read Chitragupta's accumulated project knowledge as a resource

This is particularly useful when working on projects where Chitragupta has already
accumulated context through previous sessions.

---

## Hub Dashboard (Web UI)

Chitragupta includes a web-based dashboard served from the same port as the HTTP API.

### Setup

```bash
# Build the Hub frontend (Preact SPA)
pnpm -F @chitragupta/hub build

# Start the server — Hub is auto-detected
chitragupta serve
```

On startup, the terminal prints a **pairing challenge**. Open `http://localhost:3141` in your browser.

### Device Pairing

On first visit, the browser must pair with the terminal. Choose one of four methods:

1. **Passphrase** — type the words shown in the terminal
2. **Number code** — enter the 7-digit number code
3. **QR code** — scan the terminal QR with the browser camera
4. **Visual match** — tap the 4 icons shown in the terminal (in order)

On success, the browser receives a JWT and redirects to the dashboard. The JWT lasts 24 hours and auto-refreshes.

### What You Get

- **Overview** — cost cards, session summary, health indicators
- **Sessions** — searchable session list, turn-by-turn detail
- **Models** — model catalog across providers, router insights
- **Memory** — GraphRAG explorer, consolidation rules, learned patterns
- **Skills** — skill registry, approval queue, learning timeline
- **Settings** — budget config, provider preferences
- **Devices** — manage paired browsers, revoke access

For full details, see [docs/HUB.md](docs/HUB.md).

---

## Agent Profiles

Chitragupta ships with 9 built-in agent profiles, each with a distinct personality,
expertise focus, and methodology. All names are Sanskrit-inspired.

| Profile | Sanskrit | Focus | Slash Command |
|---------|----------|-------|---------------|
| `chitragupta` | -- | Bold, opinionated generalist (default) | -- |
| `minimal` | -- | No-personality raw output | -- |
| `friendly` | -- | Patient, encouraging mentor | -- |
| `kartru` | The Maker | Code reading, writing, testing | `/code` |
| `parikshaka` | The Examiner | Code review (read-only) | `/review` |
| `anveshi` | The Investigator | Systematic debugging | `/debug` |
| `shodhaka` | The Researcher | Codebase research (read-only) | `/research` |
| `parikartru` | The Refiner | Systematic refactoring | `/refactor` |
| `lekhaka` | The Writer | Documentation writing | `/docs` |

Switch profiles via the CLI flag or interactively:

```bash
# Via flag
chitragupta --profile kartru

# Or use agent subcommands
chitragupta agent list
chitragupta agent use anveshi
```

Custom profiles can be created as JSON files in `~/.chitragupta/profiles/`:

```json
{
  "id": "mybot",
  "name": "My Custom Agent",
  "personality": "You are a concise TypeScript expert...",
  "expertise": ["typescript", "react"],
  "preferredModel": "claude-sonnet-4-5-20250929",
  "preferredThinking": "high",
  "voice": "minimal"
}
```

---

## Configuration

### Cascading Config System

Configuration cascades in order of increasing priority:

1. **Global** -- `~/.chitragupta/config/settings.json`
2. **Workspace** -- workspace-level overrides
3. **Project** -- `<project-root>/chitragupta.json`
4. **Session** -- runtime overrides (flags, slash commands)

Later layers override earlier ones. Use dot-notation for nested keys:

```bash
chitragupta config set compaction.threshold 75
chitragupta config set memory.searchDepth 100
```

### Default Settings

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5-20250929",
  "thinkingLevel": "medium",
  "agentProfile": "chitragupta",
  "compaction": { "enabled": true, "threshold": 80 },
  "memory": { "autoSave": true, "searchDepth": 50 },
  "theme": "default",
  "plugins": [],
  "ollamaEndpoint": "http://localhost:11434",
  "graphrag": {
    "enabled": false,
    "provider": "ollama",
    "model": "nomic-embed-text"
  },
  "budget": {
    "maxSessionCost": 0,
    "maxDailyCost": 0,
    "warningThreshold": 0.8
  }
}
```

### Project-Level Configuration

Create a `chitragupta.json` in your project root to set project-specific defaults:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5-20250929",
  "thinkingLevel": "high",
  "agentProfile": "kartru"
}
```

### Credentials

API keys are stored in `~/.chitragupta/config/credentials.json` (chmod 600) and injected
as environment variables at startup. Only allowlisted keys are accepted:

```
ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, GEMINI_API_KEY,
OLLAMA_HOST, XAI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY,
MISTRAL_API_KEY, DEEPSEEK_API_KEY, OPENROUTER_API_KEY, TOGETHER_API_KEY
```

You can also set these directly as environment variables -- env vars take precedence
over the credentials file.

---

## Memory and Sessions

### Sessions

Sessions are persisted as human-readable Markdown with YAML frontmatter in
`~/.chitragupta/sessions/`. Each session records every user and assistant turn,
tool invocations, model, agent profile, and timestamps.

```bash
chitragupta session list                     # Browse sessions
chitragupta session show <id>                # Read a session
chitragupta session search "database schema" # Full-text search
chitragupta session export <id> --format md  # Export as Markdown
```

### Memory

Chitragupta maintains 4 memory streams:
- **Identity** -- agent personality and learned preferences
- **Projects** -- per-project patterns, conventions, and decisions
- **Tasks** -- task-specific context and outcomes
- **Flow** -- real-time working context

Memory is scoped at three levels: `global`, `project`, and `agent`.
Project memory is stored at `~/.chitragupta/memory/<project-hash>/MEMORY.md`.

```bash
chitragupta memory show                # Display project memory
chitragupta memory search "auth flow"  # Semantic search
chitragupta memory edit                # Edit in your $EDITOR
```

### GraphRAG (Optional)

For enhanced semantic memory search, enable GraphRAG with Ollama embeddings:

```json
{
  "graphrag": {
    "enabled": true,
    "provider": "ollama",
    "model": "nomic-embed-text"
  }
}
```

This requires Ollama running with the `nomic-embed-text` model pulled.

---

## Local Models (Ollama)

Chitragupta works fully offline with Ollama. Install the models you need:

```bash
# Embeddings (for GraphRAG memory search)
ollama pull nomic-embed-text

# General-purpose models
ollama pull llama3.2
ollama pull qwen2.5-coder:7b

# Verify Ollama is running
curl http://localhost:11434/api/tags
```

Configure Chitragupta to use Ollama:

```bash
chitragupta config set defaultProvider ollama
chitragupta config set ollamaEndpoint "http://localhost:11434"
```

Or select Ollama during the onboarding wizard.

---

## Multi-Provider Support

### Cloud Providers

| Provider | Env Variable | Default Model |
|----------|-------------|---------------|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5-20250929` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o` |
| Google | `GOOGLE_API_KEY` | `gemini-2.0-flash` |
| xAI (Grok) | `XAI_API_KEY` | -- |
| Groq | `GROQ_API_KEY` | -- |
| DeepSeek | `DEEPSEEK_API_KEY` | -- |
| Mistral | `MISTRAL_API_KEY` | -- |
| OpenRouter | `OPENROUTER_API_KEY` | -- |
| Together AI | `TOGETHER_API_KEY` | -- |
| Cerebras | `CEREBRAS_API_KEY` | -- |

### Local Providers

| Provider | Env Variable | Notes |
|----------|-------------|-------|
| Ollama | `OLLAMA_HOST` | Default: `http://localhost:11434` |
| Any OpenAI-compatible | `OPENAI_API_KEY` | vLLM, LM Studio, LocalAI, etc. |

### Switching Providers

```bash
# Via flag
chitragupta --provider openai --model gpt-4o

# Via config
chitragupta config set defaultProvider google
chitragupta config set defaultModel gemini-2.0-flash

# Via env var
export ANTHROPIC_API_KEY="your-key-here"
chitragupta --provider anthropic
```

### Custom OpenAI-Compatible Providers

Add custom providers in your settings:

```json
{
  "customProviders": [
    {
      "id": "local-vllm",
      "name": "Local vLLM",
      "baseUrl": "http://localhost:8000/v1",
      "authEnvVar": "VLLM_API_KEY"
    }
  ]
}
```

---

## Project Structure (for Contributors)

Chitragupta is a monorepo with 16 packages under `packages/`:

| Package | npm Scope | Sanskrit Name | Purpose |
|---------|-----------|---------------|---------|
| `core` | `@chitragupta/core` | -- | Types, config, events, profiles |
| `swara` | `@chitragupta/swara` | Voice | AI provider abstraction (LLM API layer) |
| `anina` | `@chitragupta/anina` | Soul | Agent loop (tool use, streaming, agentic reasoning) |
| `smriti` | `@chitragupta/smriti` | Memory | Sessions, memory, GraphRAG search |
| `ui` | `@chitragupta/ui` | -- | TUI components, ANSI rendering, themes |
| `yantra` | `@chitragupta/yantra` | Tool | 12 built-in tools (read, write, edit, bash, grep, ...) |
| `dharma` | `@chitragupta/dharma` | Law | Policy engine (security rules, permissions) |
| `netra` | `@chitragupta/netra` | Vision | Vision/image processing capabilities |
| `vayu` | `@chitragupta/vayu` | Wind | Workflow engine |
| `sutra` | `@chitragupta/sutra` | Thread | IPC / inter-agent communication |
| `tantra` | `@chitragupta/tantra` | Weave | MCP server/client implementation |
| `vidhya-skills` | `@chitragupta/vidhya-skills` | Knowledge | Skill discovery via Trait Vector Matching |
| `niyanta` | `@chitragupta/niyanta` | Orchestrator | Multi-agent orchestration (bandit strategies) |
| `hub` | `@chitragupta/hub` | -- | Web dashboard (Preact SPA, device pairing, monitoring) |
| `cli` | `@chitragupta/cli` | -- | CLI binary, HTTP server, MCP server, programmatic API |
| `darpana` | `@chitragupta/darpana` | Mirror | LLM API proxy — mirrors Anthropic API to any provider |

### Building and Testing

```bash
# Build all packages
pnpm run build

# Run all tests
pnpm test

# Watch mode
pnpm run test:watch

# Lint + format (Biome)
pnpm run check

# Dev mode (watch all packages)
pnpm run dev
```

### Architecture

```
                         chitragupta (CLI)
                        /      |       \       \
                   TUI Mode  HTTP Mode  MCP Mode  Hub (Web UI)
                      |        |          |
                 [cli/main]  [serve]  [mcp-server]
                      \        |        /
                       v       v       v
                      +-----------------+
                      |   Agent (anina)  |
                      +-----------------+
                     /    |    |    |    \
              Providers  Tools  Memory  Policy  Orchestrator
              (swara)  (yantra) (smriti) (dharma) (niyanta)
                 |        |       |        |         |
              Anthropic  read   Sessions  Security  Bandit
              OpenAI     write  GraphRAG  Rules     Strategies
              Google     bash   4-Stream  Sandbox   Agent Trees
              Ollama     grep   Search    Perms     Heartbeats
```

---

## What's Next

- **Hub dashboard** -- build and open the web dashboard for visual monitoring. See [docs/HUB.md](docs/HUB.md).
- **Individual package READMEs** -- each of the 16 packages has its own README with
  full API documentation. See `packages/<name>/README.md`.
- **Plugin development** -- create custom tools, commands, and themes as ESM modules
  in `~/.chitragupta/plugins/`.
- **Custom agent profiles** -- design specialized agents in `~/.chitragupta/profiles/`.
- **MCP integration** -- connect Chitragupta to Claude Code, Codex, or any MCP client
  for enhanced tool access.

---

## Troubleshooting

### Node.js version errors

Chitragupta requires Node.js >= 22. Check your version:

```bash
node --version
# Must be v22.x or higher
```

If you're using nvm:

```bash
nvm install 22
nvm use 22
```

### `pnpm install` fails with native modules

`better-sqlite3` requires native compilation. On macOS, ensure Xcode CLI tools are installed:

```bash
xcode-select --install
```

On Linux, ensure `build-essential` and `python3` are available:

```bash
sudo apt install build-essential python3
```

If native compilation still fails, try clearing the pnpm store:

```bash
pnpm store prune
rm -rf node_modules
pnpm install
```

### Build fails for a specific package

Packages must build in dependency order. If a single package fails, rebuild from scratch:

```bash
pnpm run clean
pnpm run build
```

To build a single package (after its dependencies are built):

```bash
pnpm run build --filter @chitragupta/smriti
```

### MCP server not connecting in Claude Code

1. Ensure the CLI is built: `ls packages/cli/dist/mcp-entry.js`
2. If missing, rebuild: `pnpm run build --filter @chitragupta/cli`
3. Check the path in your MCP config is absolute, not relative
4. Restart Claude Code after changing MCP configuration
5. Run `/mcp` in Claude Code to verify the server is listed

### MCP server not connecting in VS Code / Cursor

VS Code extensions don't load your shell profile, so `node`, `npx`, and
any nvm-managed binaries aren't on the PATH.

**Fix:** Use absolute paths in your MCP config:

```bash
# Find your node binary
which node
# Example output: /Users/you/.nvm/versions/node/v22.12.0/bin/node

# Find the MCP entry point
ls /path/to/chitragupta/packages/cli/dist/mcp-entry.js
```

Then update your `.vscode/mcp.json` to use the full absolute paths for
both `command` and the entry script in `args`. See the
[VS Code setup section](#vs-code-copilot--augment--roo) above.

### Tests failing after a fresh clone

Run the full build before tests — tests depend on compiled output:

```bash
pnpm install
pnpm run build
pnpm test
```

### Ollama connection refused

Ensure Ollama is running:

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# If not, start it
ollama serve
```

### "Cannot find module" errors at runtime

This usually means packages need rebuilding:

```bash
pnpm run clean
pnpm run build
```

If the error is about a workspace dependency (e.g., `@chitragupta/core`), ensure `pnpm install` has linked the workspace packages correctly:

```bash
pnpm install
pnpm run build
```
