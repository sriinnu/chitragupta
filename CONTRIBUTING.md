# Contributing to Chitragupta

Thank you for your interest in contributing to Chitragupta. This document covers everything you need to get started.

---

## Prerequisites

- **Node.js >= 22** ([download](https://nodejs.org/))
- **pnpm** (`npm install -g pnpm`)
- **Git**
- Optionally: [Ollama](https://ollama.ai) for local model testing

---

## Development Setup

```bash
# Fork and clone
git clone https://github.com/<your-username>/chitragupta.git
cd chitragupta

# Install dependencies
pnpm install

# Build all 15 packages (in dependency order)
pnpm run build

# Run all tests
pnpm test

# Lint and format
pnpm run check
```

### Build Order

Packages must compile in dependency order:

```
core -> swara -> anina -> smriti -> ui -> yantra -> dharma -> netra -> vayu -> sutra -> tantra -> vidhya-skills -> niyanta -> cli
```

`pnpm run build` handles this automatically.

### Watch Mode

```bash
# Watch all packages for changes
pnpm run dev

# Watch tests
pnpm run test:watch
```

---

## Project Structure

Chitragupta is a TypeScript ESM monorepo with 15 packages under `packages/`:

| Package | What It Does | Internal Name |
|---------|-------------|---------------|
| `core` | Foundation — types, config, events, auth, observability | — |
| `swara` | AI Providers — LLM streaming, cost tracking, model routing | Swara (Voice) |
| `anina` | Agent Runtime — tool execution, consciousness, learning | Anina (Soul) |
| `smriti` | Memory — 4-stream memory, GraphRAG, hybrid search, compaction | Smriti (Remembrance) |
| `ui` | Terminal UI — theme, ANSI rendering, markdown, progress | — |
| `yantra` | Tools — 12+ built-in tools, sandbox, credential protection | Yantra (Instrument) |
| `dharma` | Policy — security rules, rate limiting, approval gates | Dharma (Law) |
| `netra` | Vision — image analysis, pixel diffing, multimodal | Netra (Eye) |
| `vayu` | Workflows — DAG execution, worker thread pool, pipelines | Vayu (Wind) |
| `sutra` | IPC — P2P actor mesh, gossip protocol, pub/sub | Sutra (Thread) |
| `tantra` | MCP — server lifecycle, circuit breaker, auto-restart | Tantra (Technique) |
| `vidhya-skills` | Skills — trait vector matching, evolution, autonomous learning | Vidhya (Knowledge) |
| `niyanta` | Orchestrator — multi-armed bandit, task routing, scaling | Niyanta (Director) |
| `cli` | Entry Point — interactive CLI, HTTP server, MCP server | — |
| `darpana` | LLM Proxy — mirrors Anthropic API to any provider | Darpana (Mirror) |

---

## Code Style

### Formatting

- **Tabs, width 2** for indentation
- **Biome** for linting and formatting — run `pnpm run check` before committing
- **TypeScript strict mode** across all packages
- **ESM only** — all packages use `"type": "module"`

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `learning-loop.ts`, `session-store.ts`)
- **Types/Interfaces**: `PascalCase` (e.g., `AgentProfile`, `SessionMetadata`)
- **Functions/Variables**: `camelCase` (e.g., `createSession`, `toolMastery`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `DEFAULT_CONFIG`, `MAX_RETRIES`)

### Sanskrit Naming Guide

Internal modules use Sanskrit names that carry the *essence* of what they do. If you're adding a new sub-component:

1. The name should describe the **nature** of what the module does, not just label it
2. Choose a word from classical Sanskrit texts (Yoga Sutras, Nyaya Sutras, Upanishads, Gita, etc.)
3. Document the meaning in the module's JSDoc and in the README
4. The public API should still use English — Sanskrit is for internal identity

Examples of good naming:
- `Chetana` (consciousness) — not `CognitionManager`
- `Samskaara` (impression/imprint) — not `PatternDetector`
- `Dvikala` (two-times) — not `BiTemporalEdge`

### TypeScript Guidelines

- Prefer `unknown` over `any`
- Use explicit return types on exported functions
- No hardcoded limits — all limits should be configurable with system hard ceilings
- Avoid over-engineering — only build what's needed now

---

## Commit Conventions

- Keep commit messages concise — focus on the **why**, not the what
- Use imperative mood: "fix auth timeout" not "fixed auth timeout"
- No `Co-Authored-By` lines
- Prefix with type when helpful: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`

Examples:
```
feat: add bi-temporal edge compaction
fix: session write queue race condition
refactor: extract bootstrap shared code
test: add persistence round-trip E2E tests
```

---

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`
2. **Write code** following the style guidelines above
3. **Add tests** — all new features and bug fixes should include tests
4. **Run the full suite** — `pnpm run build && pnpm test` must pass with 0 failures
5. **Run the linter** — `pnpm run check` must pass
6. **Submit a PR** with:
   - A clear title (under 70 characters)
   - A description explaining what changed and why
   - Reference any related issues

### PR Review Criteria

- Does it compile? (`pnpm run build`)
- Do all tests pass? (`pnpm test`)
- Does it follow the code style? (`pnpm run check`)
- Is there test coverage for the change?
- Is the code clear without excessive comments?
- Does it avoid hardcoded values?
- If adding a new module, does it follow the Sanskrit naming convention?

---

## Testing

### Running Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm run test:watch

# Specific package
pnpm test -- --filter=smriti

# Coverage
pnpm run test:coverage
```

### Test Expectations

- **All tests must pass** — no exceptions
- **New features require tests** — unit tests at minimum, E2E for complex flows
- **Bug fixes require a regression test** — prove the fix works
- Current stats: 300 test files, 10,232 tests, 0 failures

### Test Structure

Tests live alongside source code in `test/` directories within each package:

```
packages/smriti/
  src/
    session-store.ts
  test/
    session-store.test.ts
    persistence-e2e.test.ts
```

We use **Vitest** as the test runner with the root `vitest.config.ts`.

---

## What Contributions Are Welcome

### Highly Welcome

- **Bug fixes** with regression tests
- **Performance improvements** with benchmarks
- **New tool implementations** for `@chitragupta/yantra`
- **Provider integrations** for `@chitragupta/swara` (new LLM backends)
- **Documentation improvements** — typos, clarity, examples
- **Test coverage** — especially E2E tests

### Welcome with Discussion

- **New packages** — open an issue first to discuss architecture
- **Algorithm changes** — existing algorithms are mathematically grounded; changes need justification
- **Breaking API changes** — discuss in an issue first

### Not Accepted

- Changes that break existing tests
- Code that introduces hardcoded limits without configurability
- Dependencies on large frameworks (we keep dependencies minimal)
- AI-generated code without human review and testing

---

## Architecture Decisions

Before proposing architectural changes, read:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design and package relationships
- [docs/ALGORITHMS.md](docs/ALGORITHMS.md) — mathematical foundations
- [docs/VEDIC-MODELS.md](docs/VEDIC-MODELS.md) — cognitive model mappings

Key principles:
- **Platform first** — Chitragupta is an API layer, not just a CLI
- **Zero LLM cost for cognition** — heuristics over token burns
- **Two-tier config** — user configurable defaults clamped by system hard ceilings
- **No hardcoding** — everything configurable
- **Performance is paramount** — no memory leaks, no token leaks

---

## Getting Help

- **Issues**: [github.com/sriinnu/chitragupta/issues](https://github.com/sriinnu/chitragupta/issues)
- **Discussions**: Open an issue with the `question` label

---

Thank you for contributing to Chitragupta.
