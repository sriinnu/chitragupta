# Changelog

All notable changes to `@chitragupta/cli` will be documented in this file.

## 0.1.5 (2026-03-05)

### Features

- **transcendence**: Predictive context pre-fetcher integration (Lucy 100% phase)
- **lucy-bridge**: Lucy Bridge + Natasha Observer for 40-60% neural capacity expansion
- **cerebral**: Autonomous skill expansion at 40% neural capacity
- **cph4-catalyst**: Fix tool_calls persistence as catalyst for downstream learning
- **takumi-bridge**: Chitragupta to Takumi bridge with structured results for coding delegation
- **extension-management**: Extension package management (npm/git/local install, list, remove)
- **extension-loader**: Wire ExtensionLoader into MCP server with real ExtensionAPI + onResourcesDiscover hook
- **bash-hooks**: onBashSpawn hook with cancel/rewrite capability + SSH delegation reference extension
- **multi-turn-loop**: Multi-turn agent loop with dual-queue steering (interrupt + follow-up)
- **terminal-focus**: Terminal focus/jump with tmux/screen/iTerm2/tty/notification fallback
- **mesh-actors**: Replace mesh actor stubs with functional handlers + topology router
- **daemon-telemetry**: Enrich daemon status telemetry and session memory workflow
- **extension-api**: Extension API v2 with vasana/vidhi threshold tuning, process discovery scanner

### Bug Fixes

- **natasha-transcendence**: Rewire dead Natasha + Transcendence queries to real tables
- **mcp-agent-prompt**: Rewrite mcp-agent-prompt with CLI, Local, API fallback chain
- **nlu-router**: Stop NLU router from killing user questions (swara fix)
- **foundation-wires**: Wire foundation wires (2+4) into MCP server mode + expose netra repo_map tool
- **turn-list-rpc**: Fix turn.list RPC bug, parameter aliasing, enriched daemon.status
- **critical-bugs**: Fix missing imports, priorBlend clamp, truncateToBudget typo, svapna migration
- **coding-agent-refs**: Remove CodingAgent references from integration tests after routing refactor

### Refactoring

- **coding-router**: Replace coding agent with CLI routing (delegate to Takumi/Claude on PATH)
- **svapna-to-swapna**: Rename svapna to swapna across codebase (correct Sanskrit spelling)
- **theme-branding**: Theme/branding refresh with torii gate prompt and aurora/nebula themes

### Changed

- Bump version to 0.1.5 (from 0.1.4)
- Local fallback stage enforced with hard release gates
- Standardized configs across all packages

## 0.1.4 (2026-02-27)

### Features

- OS integration surface via MCP resources, trace propagation, ring buffer
- 6 platform capabilities added with all >450 LOC files refactored
- EventBridge, incremental handover, typed exports, and 3 agent subsystems

### Bug Fixes

- Mesh auth timeout hardened, capability learner wired, typed schemas, akasha events

## 0.1.0 (2026-02-08)

### Initial Release

- CLI with interactive REPL mode and MCP server mode (stdio + SSE)
- Agent task runner (`chitragupta run`) with dry-run, resume, graceful shutdown
- 12 built-in tools exposed via MCP protocol
- Multi-provider AI streaming (Anthropic, OpenAI, Google, Ollama)
- Agent tree with sub-agent spawning
- Session persistence as Markdown
- Agent Garage with 6 preconfigured agent profiles
