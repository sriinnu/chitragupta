# API Reference

Chitragupta exposes four interface layers: a **CLI** with command groups and interactive slash commands, an **MCP server** with 25 tools for integration with Claude Code and other MCP clients, and a **REST API** with 60+ endpoints served via `chitragupta serve`. This document is the canonical reference for all public-facing interfaces.

For architectural context see [ARCHITECTURE.md](./ARCHITECTURE.md). For algorithmic details see [ALGORITHMS.md](./ALGORITHMS.md). For the Vedic model taxonomy see [VEDIC-MODELS.md](./VEDIC-MODELS.md).

---

## Table of Contents

1. [CLI Commands](#1-cli-commands)
2. [Interactive Slash Commands](#2-interactive-slash-commands)
3. [MCP Tools](#3-mcp-tools)
4. [REST API Endpoints](#4-rest-api-endpoints)
5. [MCP Resources and Prompts](#5-mcp-resources-and-prompts)

---

## 1. CLI Commands

### Top-level Options

```
chitragupta [options] [command]
```

| Flag | Description |
|------|-------------|
| `-p, --print <prompt>` | Print mode: respond and exit |
| `-c, --continue` | Continue the last session |
| `-r, --resume` | Resume a session (interactive picker) |
| `-m, --model <model>` | Override the default model |
| `--provider <id>` | Override the default provider |
| `--profile <id>` | Override the agent profile |
| `--no-memory` | Disable memory loading |
| `-v, --version` | Show version |

### Command Groups

#### `provider` -- LLM Provider Management

| Command | Description |
|---------|-------------|
| `provider list` | List all registered providers with their models and configuration status |
| `provider add <provider-id>` | Guide the user through configuring a provider |
| `provider test <provider-id>` | Test a provider connection |

#### `session` -- Session Management

| Command | Description |
|---------|-------------|
| `session list` | List sessions for the current project |
| `session show <session-id>` | Display a full session transcript |
| `session search <query>` | Search sessions by query string |
| `session export <session-id> [--format json\|md] [--output file]` | Export a session |
| `session import <file>` | Import a session from an exported file |

#### `memory` -- Memory Management

| Command | Description |
|---------|-------------|
| `memory show` | Display the current project memory |
| `memory edit` | Open the project memory in `$EDITOR` |
| `memory search <query>` | Search all memory files across projects |

#### `agent` -- Agent Profile Management

| Command | Description |
|---------|-------------|
| `agent list` | List all available agent profiles (built-in and custom) |
| `agent create <name>` | Create a new custom agent profile interactively |
| `agent use <profile-id>` | Switch the active agent profile |

#### `config` -- Configuration

| Command | Description |
|---------|-------------|
| `config` | Display the current configuration |
| `config set <key> <value>` | Set a configuration value (dot-notation keys) |

#### `mcp` -- MCP Server Management

| Command | Description |
|---------|-------------|
| `mcp list` | List all configured MCP servers (global and project) |
| `mcp add <id> <command> [args...] [--project] [--name <name>]` | Add MCP server |
| `mcp remove <id> [--project]` | Remove MCP server |
| `mcp test <id>` | Test MCP server connection |

#### `orchestrate` -- Multi-Agent Orchestration

| Command | Description |
|---------|-------------|
| `orchestrate <plan-file \| preset-name>` | Run an orchestration plan |
| `orchestrate presets` | List built-in presets (code-review, tdd, refactor, bug-hunt, documentation) |

#### `workflow` -- DAG Workflow Engine

| Command | Description |
|---------|-------------|
| `workflow run <file \| template-name>` | Execute a workflow DAG |
| `workflow list` | List saved workflows |
| `workflow validate <file>` | Validate a workflow definition |
| `workflow templates` | List built-in templates (code-review, refactor, bug-fix, deploy) |

#### `skill` -- Skill Format Converter (Setu)

| Command | Description |
|---------|-------------|
| `skill detect <file>` | Detect skill file format |
| `skill import <file> [--output <dir>]` | Import skill to vidhya format |
| `skill export <file> --format <claude\|gemini> [--output <file>]` | Export to other formats |
| `skill convert <file> --to <vidhya\|claude\|gemini> [--output <file>]` | Convert between formats |

#### `skills` -- Skill Security Pipeline

| Command | Description |
|---------|-------------|
| `skills pending` | List quarantined skills awaiting review |
| `skills approve <id>` | Promote skill to ecosystem |
| `skills reject <id> [reason]` | Reject and archive skill |
| `skills list` | List approved skills |
| `skills health` | Show health reports (evolution) |
| `skills scan <file>` | Run Suraksha security scanner |
| `skills ingest <path>` | Discover and quarantine skills from directory |
| `skills learn <query>` | Autonomously learn a new skill (Shiksha) |

#### `plugin` -- Plugin Management

| Command | Description |
|---------|-------------|
| `plugin list` | List installed plugins |
| `plugin load` | Load and display plugin info |
| `plugin install` | Show installation instructions |
| `plugin remove` | Show removal instructions |

### Server Modes

| Command | Description |
|---------|-------------|
| `serve [--port 3000] [--host localhost]` | HTTP API server |
| `mcp-server [--stdio\|--sse] [--port 3001] [--project <path>] [--agent] [--name <name>]` | MCP server |

---

## 2. Interactive Slash Commands

43 commands available during an interactive session.

### Basic

| Command | Description |
|---------|-------------|
| `/help` | Show command help |
| `/model <name>` | Switch model |
| `/thinking <level>` | Set thinking level (`none\|low\|medium\|high`) |
| `/compact` | Compact conversation context |
| `/memory [search <q>]` | Show/search project memory |
| `/clear` | Clear conversation |
| `/status` | Show session stats |
| `/agents` | Show agent tree |
| `/delegate <profile> <task>` | Spawn sub-agent |
| `/cost` | Show cost breakdown |
| `/diff` | Show recent file changes |
| `/mcp` | Show MCP server status |
| `/branch` | Branch current session |
| `/tree` | Show session tree |
| `/quit` / `/exit` / `/q` | Exit |

### Specialized Agents

| Command | Description |
|---------|-------------|
| `/code <task>` | Spawn Kartru (coding agent) |
| `/review [files...]` | Spawn Parikshaka (review agent) |
| `/debug <error>` | Spawn Anveshi (debug agent) |
| `/research <question>` | Spawn Shodhaka (research agent) |
| `/refactor <desc>` | Spawn Parikartru (refactor agent) |
| `/docs [task]` | Spawn Lekhaka (docs agent) |

### Self-Evolution (Phase 1)

| Command | Description |
|---------|-------------|
| `/vasana [id]` | List/inspect vasanas (behavioral tendencies) |
| `/nidra` | Nidra sleep daemon status |
| `/vidhi [name]` | List/inspect learned procedures |
| `/pratyabhijna` | Self-recognition narrative |

### Intelligence (Phase 2)

| Command | Description |
|---------|-------------|
| `/turiya [routing]` | Model routing stats |
| `/health` | Triguna health status |
| `/rta [audit]` | Invariant rules / audit log |
| `/buddhi [explain <id>]` | Decisions + Nyaya reasoning |

### Collective Intelligence (Phase 3)

| Command | Description |
|---------|-------------|
| `/samiti` | Ambient communication channels |
| `/sabha` | Sabha deliberation protocol |
| `/lokapala` | Lokapala guardian agents |
| `/akasha` | Akasha knowledge field traces |

### Autonomy (Phase 4)

| Command | Description |
|---------|-------------|
| `/kartavya` | Auto-execution pipeline |
| `/kala` | Kala Chakra temporal awareness |

### Meta

| Command | Description |
|---------|-------------|
| `/chetana` | Consciousness visualization |
| `/atman` | Complete agent soul report |
| `/vidya` | Vidya skill ecosystem dashboard |
| `/learn <query>` | Autonomous skill learning |
| `/skill <sub> <file>` | Setu skill porter |
| `/skills <sub>` | Skill security pipeline |
| `/workflow [sub]` | Vayu DAG workflows |
| `/stats` | Codebase power stats |

---

## 3. MCP Tools

25 tools exposed via the `chitragupta-mcp` binary. Supports both stdio and SSE transports.

### File and Shell Tools (12)

#### `bash`

Execute shell command, captures stdout/stderr.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | yes | Shell command to execute |
| `cwd` | string | no | Working directory |
| `timeout` | number | no | Timeout in milliseconds |

#### `read`

Read file contents with line numbers.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Absolute file path |
| `startLine` | number | no | First line to read |
| `endLine` | number | no | Last line to read |

#### `write`

Create or overwrite a file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Absolute file path |
| `content` | string | yes | File content |

#### `edit`

Surgical text replacements within a file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Absolute file path |
| `edits` | array | yes | Array of `{oldText, newText}` objects |

#### `grep`

Search file contents with regex.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | yes | Regex pattern |
| `path` | string | no | Directory to search |
| `include` | string | no | Glob include filter |
| `fileType` | string | no | File type filter |
| `maxResults` | number | no | Maximum results |
| `contextLines` | number | no | Context lines around match |
| `invert` | boolean | no | Invert match |

#### `find`

Find files by glob patterns.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `patterns` | string[] | yes | Glob patterns |
| `path` | string | no | Root directory |
| `maxResults` | number | no | Maximum results |

#### `ls`

List directory contents.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | no | Directory path |
| `recursive` | boolean | no | Recurse into subdirectories |
| `maxDepth` | number | no | Maximum recursion depth |

#### `diff`

Unified diff between files or content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_a` | string | yes | First file path |
| `file_b` | string | no | Second file path |
| `content_b` | string | no | Content to compare against |
| `contextLines` | number | no | Context lines |

#### `watch`

Watch files for changes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | no | Path to watch |
| `durationMs` | number | no | Watch duration in milliseconds |
| `recursive` | boolean | no | Watch recursively |

#### `memory`

Read, write, append, or search memory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | yes | `read`, `write`, `append`, or `search` |
| `scope` | enum | yes | `global`, `project`, or `agent` |
| `content` | string | no | Content for write/append |
| `query` | string | no | Search query |

#### `session`

Session management operations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | yes | `list`, `show`, `search`, or `branch` |
| `sessionId` | string | no | Session identifier |
| `query` | string | no | Search query |
| `branchName` | string | no | Branch name |

#### `project_analysis`

Analyze project structure and dependencies.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | no | Project root path |
| `skipGit` | boolean | no | Skip git analysis |
| `skipDependencies` | boolean | no | Skip dependency analysis |
| `maxFiles` | number | no | Maximum files to analyze |

### Chitragupta Memory Tools (5)

#### `chitragupta_memory_search`

Search project memory (GraphRAG-backed).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `limit` | number | no | Maximum results |

#### `chitragupta_session_list`

List recent sessions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | no | Maximum sessions to return |

#### `chitragupta_session_show`

Show session by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | yes | Session identifier |
| `turnLimit` | number | no | Maximum turns to return |

#### `chitragupta_prompt`

Delegate task to agent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | yes | Prompt message |
| `provider` | string | no | Provider override |
| `model` | string | no | Model override |

#### `chitragupta_handover`

Generate a work-state handover summary for session continuity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | no | Session to summarize |
| `turnWindow` | number | no | Number of recent turns to include |

### Collective Intelligence Tools (8)

#### `samiti_channels`

List or query ambient communication channels.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channel` | string | no | Specific channel name |
| `limit` | number | no | Maximum messages |

#### `samiti_broadcast`

Broadcast a message to a channel.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channel` | string | yes | Target channel |
| `content` | string | yes | Message content |
| `severity` | enum | no | `info`, `warning`, or `critical` |

#### `sabha_deliberate`

Initiate multi-agent deliberation on a proposal.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `proposal` | string | yes | Deliberation proposal |
| `agents` | string[] | no | Agent profiles to involve |

#### `akasha_traces`

Query stigmergic knowledge traces.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `type` | enum | no | `solution`, `warning`, `shortcut`, `pattern`, `correction`, or `preference` |
| `limit` | number | no | Maximum results |

#### `akasha_deposit`

Deposit a knowledge trace into the Akasha field.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | Trace content |
| `type` | enum | yes | `solution`, `warning`, `shortcut`, `pattern`, `correction`, or `preference` |
| `topics` | string[] | yes | Topic tags |

#### `vasana_tendencies`

List behavioral patterns (vasanas).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | no | Maximum results |

#### `health_status`

Return current Triguna health status. No parameters.

#### `atman_report`

Generate complete agent self-report. No parameters.

---

## 4. REST API Endpoints

Served by `chitragupta serve`. Default port 3000.

### Health and Observability

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Basic health check |
| `GET` | `/api/health/deep` | Deep health with system metrics |
| `GET` | `/api/metrics` | Prometheus-style metrics |
| `GET` | `/api/openapi.json` | OpenAPI spec |

### Sessions and Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List sessions |
| `GET` | `/api/sessions/:id` | Session details |
| `POST` | `/api/sessions` | Create session |
| `POST` | `/api/chat` | Send message to agent |

### Agent Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agent/status` | Agent init status |
| `POST` | `/api/agent/reset` | Reset agent state |
| `GET` | `/api/agents` | List all agents |
| `GET` | `/api/agents/tree` | Full agent tree |
| `GET` | `/api/agents/stats` | Aggregate stats |
| `GET` | `/api/agents/:id` | Agent details |
| `GET` | `/api/agents/:id/tree` | Subtree |
| `POST` | `/api/agents/:id/spawn` | Spawn sub-agent |
| `POST` | `/api/agents/:id/abort` | Abort agent |
| `POST` | `/api/agents/:id/prompt` | Prompt agent |

### Async Jobs (Karya)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/jobs` | Submit async job |
| `GET` | `/api/jobs` | List jobs |
| `GET` | `/api/jobs/stats` | Queue stats |
| `GET` | `/api/jobs/:id` | Job details |
| `POST` | `/api/jobs/:id/cancel` | Cancel job |

### Memory (Smriti Dvaara)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/memory/scopes` | List memory scopes |
| `POST` | `/api/memory/search` | Search memory |
| `GET` | `/api/memory/:scope` | Get memory |
| `PUT` | `/api/memory/:scope` | Update memory |
| `POST` | `/api/memory/:scope` | Append to memory |
| `DELETE` | `/api/memory/:scope` | Delete memory |

### Providers and Tools

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/providers` | List LLM providers |
| `GET` | `/api/tools` | List tools |

### Auth (Dvarpalaka)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/token` | OAuth token exchange |
| `POST` | `/api/auth/refresh` | Refresh JWT |
| `GET` | `/api/auth/me` | Current user |

### Self-Evolution (Phase 1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/vasanas` | List tendencies |
| `GET` | `/api/vasanas/:id` | Tendency details |
| `GET` | `/api/nidra/status` | Sleep daemon status |
| `POST` | `/api/nidra/wake` | Force wake |
| `GET` | `/api/vidhi` | List procedures |
| `GET` | `/api/vidhi/:name` | Procedure details |

### Intelligence (Phase 2)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/turiya/status` | Routing summary |
| `GET` | `/api/turiya/routing` | Detailed routing |
| `GET` | `/api/health/guna` | Triguna health |
| `GET` | `/api/rta/rules` | Invariant rules |
| `GET` | `/api/rta/audit` | Audit log |
| `GET` | `/api/decisions` | List decisions |
| `GET` | `/api/decisions/:id/reasoning` | Nyaya reasoning |

### Collective Intelligence (Phase 3)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/samiti/channels` | List channels |
| `GET` | `/api/samiti/channels/:name` | Channel messages |
| `POST` | `/api/samiti/channels/:name/broadcast` | Broadcast |
| `GET` | `/api/sabha/deliberations` | List deliberations |
| `POST` | `/api/sabha/deliberate` | Convene Sabha |
| `GET` | `/api/sabha/deliberations/:id` | Deliberation details |
| `GET` | `/api/lokapala/guardians` | Guardian agents |
| `GET` | `/api/lokapala/violations` | Findings |
| `GET` | `/api/lokapala/stats` | Guardian stats |
| `GET` | `/api/akasha/traces` | Query traces |
| `POST` | `/api/akasha/traces` | Leave trace |
| `GET` | `/api/akasha/stats` | Knowledge stats |

### Autonomy (Phase 4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/kartavya/pipeline` | Pipeline status |
| `GET` | `/api/kartavya/pending` | Pending proposals |
| `POST` | `/api/kartavya/execute/:id` | Execute duty |
| `GET` | `/api/kala/scales` | Temporal scales |
| `GET` | `/api/kala/context` | Temporal context |

### Skills (Vidya)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/skills` | List skills |
| `GET` | `/api/skills/ecosystem` | Ecosystem stats |
| `GET` | `/api/skills/compositions` | Yoga compositions |
| `GET` | `/api/skills/:name` | Skill report |
| `POST` | `/api/skills/:name/promote` | Promote lifecycle |
| `POST` | `/api/skills/:name/deprecate` | Deprecate |
| `POST` | `/api/skills/learn` | Autonomous learning |
| `POST` | `/api/skills/evaluate` | Evaluate lifecycles |

### Workflows (Vayu)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/workflows` | List workflows |
| `GET` | `/api/workflows/executions` | Recent executions |
| `GET` | `/api/workflows/executions/:id` | Execution details |
| `GET` | `/api/workflows/:name` | Workflow DAG |
| `POST` | `/api/workflows/:name/run` | Execute workflow |

### WebSocket

| Protocol | Endpoint | Description |
|----------|----------|-------------|
| `WS` | `/ws` | Real-time agent interaction |

---

## 5. MCP Resources and Prompts

### Resources

| URI | Type | Description |
|-----|------|-------------|
| `chitragupta://memory/project` | `text/markdown` | Current project memory content |

### Prompts

| Name | Description | Arguments |
|------|-------------|-----------|
| `code_review` | Structured code review template | `file` (string, required) -- file to review; `focus` (string) -- `security`, `performance`, `style`, or `all` |
