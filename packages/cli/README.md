<p align="center">
  <img src="assets/logo.svg" alt="Chitragupta CLI" width="120" />
</p>

<h1 align="center">⛩ @chitragupta/cli</h1>

<p align="center"><strong>CLI and MCP server for the Chitragupta AI agent platform</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@yugenlab/chitragupta"><img src="https://img.shields.io/npm/v/@yugenlab/chitragupta" alt="npm" /></a>
  <img src="https://img.shields.io/badge/tests-12%2C022-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/MCP_tools-runtime-blue" alt="MCP Tools" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-blue" alt="Node" />
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-green" alt="License" /></a>
</p>

---

Persistent memory and observability layer for AI coding agents. The CLI is the unified entry point: interactive agent, single-shot task runner, MCP server for Claude Code / Cursor / any MCP client, or full HTTP API server.

The CLI is a surface of the engine, not a second authority:

- Chitragupta daemon owns durable writes and canonical sessions.
- CLI/TUI/API/serve consume that daemon-owned runtime by default.
- Vaayu and Takumi are downstream consumers of the same engine model.

For the runtime wiring behind the public coding path:

- User-facing coding flow: [../../docs/coding-agent.md](../../docs/coding-agent.md)
- Internal integrity and self-healing loops: [../../docs/runtime-integrity.md](../../docs/runtime-integrity.md)
- Engine/consumer model: [../../docs/runtime-constitution.md](../../docs/runtime-constitution.md)

---

## Installation

```bash
# Global install (recommended)
npm install -g @chitragupta/cli

# Or run directly without installing
npx @chitragupta/cli

# Verify
chitragupta --version
```

---

## Quick Start

```bash
# Interactive mode — full terminal UI with agent loop
chitragupta

# Single-shot print mode — pipe-friendly
chitragupta -p "Explain this codebase"

# Multi-turn agent task runner
chitragupta run "fix the login bug"

# MCP server for Claude Code
chitragupta mcp-server
```

---

## Runtime Authority and Auth Surfaces

- **Daemon-first runtime**: CLI and MCP flows target the daemon as the single-writer authority for persistent state.
- **Daemon-backed MemoryBridge**: main runtime surfaces share daemon-backed session/memory persistence instead of mixing local and daemon writers.
- **Socket/pipe auth**: daemon RPC requires `auth.handshake` with a local bridge token and method scopes.
- **Degraded fallback**: if daemon is unavailable, fallback is read-only for a narrow method subset; writes fail closed.
- **Serve vs daemon auth**: `chitragupta serve` auth (pairing/JWT/API routes) is a separate HTTP auth plane from daemon socket auth.
- **Lucy/Scarlett scope**: runtime overlays are platform-wide internal concepts; CLI coding paths expose only part of that behavior.
- **Canonical sessions**: raw sessions remain the source of truth; recall may surface derived day/month/year artifacts with `sourceSessionIds` for drill-down.

---

## CLI Commands

### Interactive Mode (default)

Launch the full terminal UI with editor, message list, status bar, and agent loop.

```bash
chitragupta
chitragupta --model claude-sonnet-4-5-20250929
chitragupta --provider openai --model gpt-4o
```

### Print Mode

Run a single prompt and print the response. Useful for scripts and pipelines.

```bash
chitragupta -p "Summarize package.json"
chitragupta -p "What does this function do?" --model gpt-4o
```

### `chitragupta run` -- Multi-Turn Agent Loop

A standalone agentic task runner. Loads project context and memory, creates a session, and runs a multi-turn loop with steering support.

```bash
# Run a task (up to 20 turns by default)
chitragupta run "fix the login bug"

# Limit turns
chitragupta run --max-turns 5 "small fix"

# Dry run — show context without calling the LLM
chitragupta run --dry-run "refactor the auth module"

# Resume a previous session
chitragupta run --resume <session-id>

# Override model/provider/project
chitragupta run --model claude-opus-4-20250918 --project /path/to/project "add tests"
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--max-turns <n>` | Max agent loop iterations (default: 20) |
| `--dry-run` | Show plan without calling the LLM |
| `--resume <id>` | Resume from a previous session checkpoint |
| `--model <model>` | Override model (e.g. `claude-sonnet-4-5-20250929`) |
| `--provider <id>` | Override provider (e.g. `openai`, `anthropic`) |
| `--project <path>` | Override project path |

### `chitragupta focus` -- Terminal Focus

Jump to the terminal running a Chitragupta process. Uses a 5-tier fallback chain:

1. **tmux** -- select-window + select-pane
2. **screen** -- reattach session
3. **iTerm2** -- AppleScript activation (macOS)
4. **TTY** -- open device (macOS) or xdotool (Linux)
5. **Notification** -- desktop notification fallback

```bash
# List running sessions
chitragupta focus

# Focus a specific process
chitragupta focus <pid>

# Focus the most recently started session
chitragupta focus --latest
```

### `chitragupta extension` -- Extension Management

Install, list, and remove extensions from npm, git, or local paths.

```bash
# Install from npm
chitragupta extension install npm:@scope/my-extension
chitragupta extension install npm:@scope/my-extension@1.2.0

# Install from git
chitragupta extension install git:github.com/user/chitragupta-ext

# Install from local path
chitragupta extension install ./my-local-extension

# List installed extensions
chitragupta extension list

# Remove an extension
chitragupta extension remove my-extension
```

Extensions are stored at `~/.chitragupta/extensions/` (global) and `.chitragupta/extensions/` (project-local). Extensions can contribute tools, hooks, UI widgets, keybinds, and panels.

### `chitragupta code` -- Autonomous Coding Agent

Delegate a coding task that plans, codes, validates, reviews, and optionally commits.

```bash
chitragupta code "add unit tests for the auth module"
chitragupta code --plan "refactor the database layer"
chitragupta code --no-commit --no-branch "quick fix"
```

### Other Subcommands

| Command | Purpose |
|---------|---------|
| `chitragupta session list\|show\|search\|export\|import` | Session management |
| `chitragupta memory show\|edit\|search` | Memory operations |
| `chitragupta config [set <key> <value>]` | Configuration management |
| `chitragupta provider list\|add\|test` | Provider management |
| `chitragupta agent list\|create\|use` | Agent profile management |
| `chitragupta mcp list\|add\|remove\|start\|stop` | MCP server management |
| `chitragupta skill` | Cross-format skill conversion |
| `chitragupta plugin list\|load\|install\|remove` | Plugin management |
| `chitragupta orchestrate` | Multi-agent orchestration |
| `chitragupta workflow list\|run\|status` | DAG workflow execution |
| `chitragupta sync` | Cross-machine state sync |
| `chitragupta serve` | HTTP API server mode |
| `chitragupta daemon` | Background daemon management |
| `chitragupta init` | Project initialization |

---

## MCP Server Mode

Chitragupta exposes its full toolset as an MCP (Model Context Protocol) server. This lets Claude Code, Cursor, Windsurf, and any MCP-compatible IDE use Chitragupta's memory, knowledge graph, P2P mesh, skill system, and more.

### Setup for Claude Code

Add to your Claude Code MCP configuration (`.claude/mcp.json` or VS Code settings):

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "chitragupta",
      "args": ["mcp-server"],
      "env": {}
    }
  }
}
```

### Setup for Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "chitragupta": {
      "command": "npx",
      "args": ["@chitragupta/cli", "mcp-server"]
    }
  }
}
```

### Transport Options

```bash
# Stdio transport (default — for Claude Code, Cursor)
chitragupta mcp-server

# SSE transport (for HTTP-based MCP clients)
chitragupta mcp-server --sse --port 3001

# Streamable HTTP transport (for newer MCP HTTP clients)
chitragupta mcp-server --streamable-http --port 3001

# With project path override
chitragupta mcp-server --project /path/to/project

# With agent prompt tool enabled (requires provider config)
chitragupta mcp-server --agent

# With custom server name
chitragupta mcp-server --name my-chitragupta
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CHITRAGUPTA_MCP_TRANSPORT` | `"stdio"`, `"sse"`, or `"streamable-http"` | `stdio` |
| `CHITRAGUPTA_MCP_PORT` | HTTP transport port (`sse` or `streamable-http`) | `3001` |
| `CHITRAGUPTA_MCP_PROJECT` | Project path override | `process.cwd()` |
| `CHITRAGUPTA_MCP_AGENT` | Agent profile override | -- |

---

## MCP Tools

Chitragupta exposes an MCP tool surface organized into categories. Inventory can vary by release/profile.

### Memory and Sessions

| Tool | Description |
|------|-------------|
| `chitragupta_memory_search` | Search project memory (GraphRAG-backed) |
| `chitragupta_session_list` | List recent sessions |
| `chitragupta_session_show` | Show a specific session by ID |
| `chitragupta_recall` | Unified search across ALL memory layers (sessions, KG, day files, Akasha) |
| `chitragupta_context` | Load full memory context (global + project + recent sessions) |
| `chitragupta_record_conversation` | Record conversation turns into the current session |

### Handover and Day Files

| Tool | Description |
|------|-------------|
| `chitragupta_handover` | Generate work-state handover for context continuity |
| `chitragupta_handover_since` | Incremental handover (delta since last cursor) |
| `chitragupta_memory_changes_since` | Detect memory changes since a timestamp |
| `chitragupta_day_show` | Show consolidated day file for a date |
| `chitragupta_day_list` | List available day files |
| `chitragupta_day_search` | Search across all day files |

### Collective Intelligence

| Tool | Description |
|------|-------------|
| `samiti_channels` | List ambient communication channels and messages |
| `samiti_broadcast` | Broadcast a message to a topic channel |
| `sabha_deliberate` | Multi-agent structured deliberation on a proposal |
| `akasha_traces` | Query stigmergic knowledge traces |
| `akasha_deposit` | Deposit a solution, pattern, warning, or correction |

### Introspection and Health

| Tool | Description |
|------|-------------|
| `vasana_tendencies` | Get crystallized behavioral tendencies |
| `health_status` | Triguna system health (Sattva/Rajas/Tamas) |
| `atman_report` | Full self-report: consciousness, identity, health |

### Cross-Machine Sync

| Tool | Description |
|------|-------------|
| `chitragupta_sync_status` | Show sync status across machines |
| `chitragupta_sync_export` | Export portable JSON snapshot |
| `chitragupta_sync_import` | Import and apply a sync snapshot |

### Learned Procedures and Consolidation

| Tool | Description |
|------|-------------|
| `chitragupta_vidhis` | List/search learned tool-sequence procedures |
| `chitragupta_consolidate` | Run Swapna memory consolidation on demand |

### Coding Agent

| Tool | Description |
|------|-------------|
| `coding_agent` | Delegate a coding task (plans, codes, validates, reviews, commits) |
| `chitragupta_prompt` | Send a task to Chitragupta's AI agent (async with heartbeat) |
| `chitragupta_prompt_status` | Check status of a long-running prompt job |
| `chitragupta_completion` | Send a prompt to an LLM via the multi-provider completion router |

### Model Routing

| Tool | Description |
|------|-------------|
| `swara_marga_decide` | Stateless LLM routing decision (task type, complexity, provider selection) |

### P2P Actor Mesh

| Tool | Description |
|------|-------------|
| `mesh_status` | Get mesh system status |
| `mesh_spawn` | Spawn an actor with capabilities |
| `mesh_send` | Fire-and-forget message to an actor |
| `mesh_ask` | Request-reply message with response |
| `mesh_find_capability` | Find peers by capability (multi-factor scoring) |
| `mesh_peers` | List all peers with health info |
| `mesh_gossip` | Get gossip protocol state |
| `mesh_topology` | Full mesh topology view |

Notes:
- `mesh_status` and `mesh_peers` now distinguish local mesh actors from remote gossip peers.
- Capability routing works in local-only mode too; full P2P networking is added when `CHITRAGUPTA_MESH_*` mesh config is present.

### Vidhya Skills Pipeline

| Tool | Description |
|------|-------------|
| `skills_find` | Find skills by natural language (TVM, zero-latency) |
| `skills_list` | List all registered skills |
| `skills_health` | Score a skill's health (Pancha Kosha five-sheath model) |
| `skills_learn` | Trigger autonomous skill learning pipeline |
| `skills_scan` | Run security scan on skill content |
| `skills_ecosystem` | Ecosystem-wide statistics |
| `skills_recommend` | Smart skill recommendation with readiness assessment |

### Code Intelligence (Netra)

| Tool | Description |
|------|-------------|
| `netra_repo_map` | Repository map with file structure and relationships |
| `netra_semantic_graph` | Semantic graph query for code understanding |
| `netra_ast_query` | AST-level code query |

### Episodic Memory

| Tool | Description |
|------|-------------|
| `episodic_recall` | Recall episodic developer memories |
| `episodic_record` | Record an episodic memory entry |

### UI Extensions

| Tool | Description |
|------|-------------|
| `chitragupta_ui_extensions` | List registered UI extensions from skills |
| `chitragupta_widget_data` | Get latest data for a UI widget |

### Cerebral Expansion

| Tool | Description |
|------|-------------|
| `cerebral_expansion` | Autonomous skill discovery + learning when tools are not found |

### File and Shell (Yantra)

Standard file system and shell tools (read, write, edit, grep, find, ls, bash, diff, watch, project analysis) are also exposed as MCP tools.

### MCP Resources

| URI | Description |
|-----|-------------|
| `chitragupta://memory/project` | Project memory content (MEMORY.md) |
| `chitragupta://system/metrics` | System metrics (tool count, uptime) |
| `chitragupta://system/config` | System configuration |
| `chitragupta://system/plugins` | Plugin ecosystem status |
| `chitragupta://system/recent-calls` | Recent tool call history |

### MCP Prompts

Pre-built prompt templates: `save`, `last_session`, `recall`, `status`, `handover`, `code_review`, `debug`, `research`, `refactor`, `memory_search`, `session`.

---

## Architecture

```
chitragupta (CLI binary)
  |
  +-- Interactive Mode (full TUI with agent loop)
  +-- Print Mode (single-shot, pipe-friendly)
  +-- Run Mode (multi-turn agent task runner)
  +-- Code Mode (autonomous coding agent)
  +-- MCP Server Mode (stdio/SSE for IDE integration)
  +-- HTTP Server Mode (Dvaara — REST API + WebSocket)
  +-- Daemon Mode (background process for consolidation + sync)
  |
  +-- packages/core        — config, types, errors
  +-- packages/smriti      — memory pipeline (sessions, day files, KG)
  +-- packages/swara       — LLM completion router (multi-provider)
  +-- packages/anina       — agent profiles, steering
  +-- packages/tantra      — tool registry, MCP protocol
  +-- packages/yantra      — file/shell tools
  +-- packages/sutra       — event bridge, P2P mesh
  +-- packages/vidhya-skills — skill discovery, learning, security
  +-- packages/dharma      — auth, rate limiting, RBAC
  +-- packages/niyanta     — job scheduler, worker pool
  +-- packages/netra       — code intelligence (AST, repo map)
  +-- packages/ui          — terminal UI components, ANSI helpers
  +-- packages/daemon      — background daemon (consolidation, sync)
```

### Key Binaries

| Binary | Purpose |
|--------|---------|
| `chitragupta` | Main CLI entry point |
| `chitragupta-mcp` | Dedicated MCP server entry point |
| `chitragupta-code` | Direct coding agent entry point |
| `chitragupta-snapshot` | Memory snapshot utility |

---

## Configuration

Chitragupta stores configuration at `~/.chitragupta/`:

```
~/.chitragupta/
  config.json          — global settings (default model, provider, etc.)
  extensions/          — installed extensions (npm/, git/, local/)
  plugins/             — plugin modules (.js ESM)
  learning/            — skill gap tracking, session state
  memory/              — global memory files
```

Project-level configuration lives at `.chitragupta/` in the project root:

```
.chitragupta/
  context.md           — project context for the agent
  extensions/          — project-local extensions
  memory/              — project-scoped memory
```

### Setting Defaults

```bash
# Set default model
chitragupta config set defaultModel claude-sonnet-4-5-20250929

# Set default provider
chitragupta config set defaultProvider anthropic

# View current config
chitragupta config
```

### Provider Setup

```bash
# List available providers
chitragupta provider list

# Add a provider (prompts for API key)
chitragupta provider add anthropic

# Test a provider connection
chitragupta provider test anthropic
```

---

## Programmatic Usage

```typescript
import { main } from "@chitragupta/cli";

// Launch Chitragupta programmatically
await main();
```

```typescript
import { parseArgs } from "@chitragupta/cli";

const args = parseArgs(["--model", "gpt-4o", "-p", "Hello"]);
console.log(args.model);    // "gpt-4o"
console.log(args.mode);     // "print"
```

```typescript
// MCP server mode (programmatic)
import { runMcpServerMode } from "@chitragupta/cli/mcp";

await runMcpServerMode({
  transport: "stdio",
  projectPath: "/path/to/project",
});
```

---

## Links

- [npm](https://www.npmjs.com/package/@yugenlab/chitragupta)
- [GitHub](https://github.com/sriinnu/chitragupta)
- [Issues](https://github.com/sriinnu/chitragupta/issues)
- [Monorepo Root](../../README.md)

## License

AGPL-3.0-only
