# Handover — 2026-02-16

**Branch**: `feat/memory`
**Last commit**: `2a78340` — `chore: sync version to 0.1.3, update CLAUDE.md with git push rules`

---

## What Got Done Today

### 1. NPM Publishing — COMPLETE

Published `@yugenlab/chitragupta@0.1.3` to npm as a **single package** bundling all 14 internal packages.

**Key files created/modified:**

| File | What |
|------|------|
| `scripts/bundle.mjs` | esbuild bundler — 18 entry points, code splitting, ESM, node22 |
| `scripts/build-types.mjs` | Copies .d.ts from tsc → `dist/_types/`, patches `@chitragupta/*` imports to relative paths |
| `src/barrel.ts` | Main entry: re-exports `@chitragupta/core` + `@chitragupta/smriti` |
| `package.publish.json` | `@yugenlab/chitragupta` metadata, exports map, bin entries |
| `scripts/publish.sh` | Single-package publish flow: tsc → esbuild → types → strip sourcemaps → npm publish ./dist |
| `README.npm.md` | Consumer-facing README (copied to `dist/README.md` during publish) |
| `.gitattributes` | Force LF line endings (WSL/Windows fix) |
| All 15 `packages/*/package.json` | Added `"private": true` |

**How to republish:**
```bash
bash scripts/publish.sh --bump patch --real --skip-tests
```

**Build pipeline:**
```bash
pnpm -r run build          # tsc all packages
node scripts/bundle.mjs    # esbuild → dist/ (18 entries + 56 shared chunks)
node scripts/build-types.mjs  # .d.ts assembly (373 files patched)
```

**Package stats:** 5.0 MB unpacked, 1.2 MB compressed, 527 files

**Gotchas encountered:**
- `better-sqlite3` must be in root devDeps (pnpm isolates it to smriti otherwise)
- Sourcemaps (.js.map) were 8 MB — stripped in publish.sh before npm publish
- `npm login --auth-type=legacy` needed in WSL (no browser)
- `.npmignore` fights with `npm pack` from subdirectories — `"files"` field in package.json wins
- CRLF line endings broke bash scripts — `.gitattributes` fixes this

### 2. Organization — COMPLETE

- **npm org**: `@yugenlab` (npmjs.com/org/yugenlab)
- **Brand**: Yūgen (幽玄)
- **Scope**: `@yugenlab/chitragupta`, `@yugenlab/vaayu`, future projects

---

## What's Left — Daemon/Recording Pipeline

Chitragupta is **deaf**. It only captures data when MCP tools are explicitly called by the agent. Conversations flow through but nothing is automatically recorded.

### The Problem
- The MCP server runs, agents call tools, but the actual conversation turns (user messages, assistant responses) are never persisted unless the agent explicitly calls `chitragupta_context` or similar
- The recording pipeline, fact extraction, and day consolidation are all **built** but not wired to receive data automatically
- The daemon exists at `packages/anina/src/chitragupta-daemon.ts` but isn't started/connected

### What Exists Already
- **Daemon**: `packages/anina/src/chitragupta-daemon.ts`
- **Recording pipeline**: Built in smriti — sessions, turns, fact extraction
- **Day consolidation**: Built — `~/.chitragupta/days/YYYY/MM/DD.md`
- **Event chains**: Built in smriti
- **Provider bridge**: Built in swara — can intercept LLM calls
- **WebSocket support**: Built in tantra
- **Fact extraction**: Pattern + vector detection, zero LLM cost

### What Needs Wiring
1. Daemon auto-start when MCP server starts
2. Hook into conversation flow to capture turns automatically
3. Provider bridge → recording pipeline connection
4. Day consolidation triggered at end of session or on schedule

### Key files to investigate
```
packages/anina/src/chitragupta-daemon.ts
packages/tantra/src/mcp-server.ts
packages/smriti/src/recording/
packages/smriti/src/consolidation/
packages/swara/src/provider-bridge.ts
```

---

## Quick Resume

```bash
git pull origin feat/memory
pnpm install
pnpm -r run build
pnpm test  # verify everything passes
```

Then start investigating the daemon wiring.
