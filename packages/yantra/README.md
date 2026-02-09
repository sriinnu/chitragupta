# @chitragupta/yantra

![Logo](../../assets/logos/yantra.svg)

**यन्त्र (yantra) -- Tool / Instrument**

**Built-in tool implementations for Chitragupta: 12 tools for file manipulation, shell execution, search, diff, watch, memory, sessions, and project analysis -- plus the Kshetra sandbox and .env fortress for security.**

Yantra provides the standard tool set that every Chitragupta agent has access to. Each tool is a `ToolHandler` plugin conforming to a standard interface -- they can be individually imported, replaced, or extended. The registry helpers `getAllTools()` and `getToolByName()` make it simple to wire tools into an agent. Security is layered in at every level: the Kshetra sandbox provides isolated git-worktree execution environments, and the .env fortress blocks credential leakage across all tool boundaries.

---

## Key Features

- **File tools** -- `read`, `write`, `edit` for file manipulation with diff support
- **Shell tools** -- `bash` for command execution with `buildSafeEnv()` credential stripping, `grep` for pattern search, `find` for file discovery, `ls` for directory listing
- **Diff tools** -- `diff` with unified diff computation via `computeUnifiedDiff()`
- **Watch tool** -- `watch` for file system monitoring
- **Memory tools** -- `memory` for reading/writing memory streams, `session` for session management
- **Project analysis** -- `projectAnalysis` for codebase structure understanding
- **Kshetra sandbox** -- Isolated git-worktree environments for safe destructive operations (builds, tests, file writes) with command allowlisting
- **.env fortress** -- Multi-layered credential protection: `buildSafeEnv()` strips credential env vars, `BLOCKED_COMMAND_PATTERNS` blocks credential file access, `isBlockedSearchPath()` prevents searching sensitive paths, `SENSITIVE_DIRS/FILES` skip sensitive entries in find/ls
- **Registry helpers** -- `getAllTools()` returns all 12 built-in tools, `getToolByName()` for lookup by name
- **Standard interface** -- Every tool implements `ToolHandler` with `definition` and `execute()`

## Architecture

| Module | Purpose |
|--------|---------|
| `types.ts` | `ToolDefinition`, `ToolContext`, `ToolResult`, `ToolHandler` interfaces |
| `read.ts` | File reading with line ranges, blocked path protection |
| `write.ts` | File writing with directory creation, blocked path protection |
| `edit.ts` | Surgical file editing with search-and-replace, blocked path protection |
| `bash.ts` | Shell execution with `buildSafeEnv()`, `BLOCKED_COMMAND_PATTERNS`, timeout |
| `grep.ts` | Pattern search with `isBlockedSearchPath()` sensitive path blocking |
| `find.ts` | File discovery with `SENSITIVE_DIRS`, `SENSITIVE_FILES`, `SENSITIVE_PATH_FRAGMENTS` filtering |
| `ls.ts` | Directory listing with `isBlockedListPath()` for .ssh, .gnupg, .env protection |
| `diff.ts` | Diff computation and `computeUnifiedDiff()` |
| `watch.ts` | File system watcher |
| `memory-tool.ts` | Memory stream read/write tool |
| `session-tool.ts` | Session management tool |
| `project-analysis.ts` | Codebase structure analysis |
| `sandbox.ts` | Kshetra sandbox -- git worktree isolation with command allowlisting |

## API

### Get All Tools

```typescript
import { getAllTools, getToolByName } from "@chitragupta/yantra";

// Get all 12 built-in tools
const tools = getAllTools();
console.log(tools.map((t) => t.definition.name));
// ["read", "write", "edit", "bash", "grep", "find", "ls",
//  "memory", "session", "diff", "watch", "projectAnalysis"]

// Look up a specific tool
const readTool = getToolByName("read");
if (readTool) {
  const result = await readTool.execute(
    { path: "src/index.ts" },
    context
  );
  console.log(result.output);
}
```

### Using Individual Tools

```typescript
import {
  readTool,
  writeTool,
  editTool,
  bashTool,
  grepTool,
} from "@chitragupta/yantra";

// Read a file
const content = await readTool.execute(
  { path: "src/index.ts" },
  context
);

// Write a file
await writeTool.execute(
  { path: "out.txt", content: "Hello" },
  context
);

// Edit a file (search and replace)
await editTool.execute(
  {
    path: "src/config.ts",
    old_string: "const DEBUG = false",
    new_string: "const DEBUG = true",
  },
  context
);

// Run a shell command
const result = await bashTool.execute(
  { command: "npm test" },
  context
);

// Search for a pattern
const matches = await grepTool.execute(
  { pattern: "TODO", path: "src/" },
  context
);
```

### Kshetra Sandbox

The Kshetra sandbox creates isolated git-worktree environments where agents can safely execute destructive operations without affecting the main working directory. Each sandbox is a full git worktree on an ephemeral branch.

```typescript
import { KshetraSandbox } from "@chitragupta/yantra";
import type { SandboxConfig, SandboxInfo } from "@chitragupta/yantra";

const sandbox = new KshetraSandbox({
  baseDir: ".chitragupta/sandboxes",
  maxSandboxes: 5,
  defaultTimeout: 60_000,
});

// Create an isolated environment
const info: SandboxInfo = await sandbox.create();
console.log(info.path);   // Isolated worktree path
console.log(info.branch); // Ephemeral branch name

// Execute commands safely inside the sandbox
const result = await sandbox.exec(info.id, "npm test");

// Merge changes back (optional)
await sandbox.merge(info.id);

// Clean up
await sandbox.destroy(info.id);
```

### .env Fortress

The .env fortress is not a single module but a coordinated set of protections layered across every tool:

```typescript
// Bash tool: credential environment variables are stripped
import { buildSafeEnv } from "@chitragupta/yantra";
const safeEnv = buildSafeEnv(process.env);
// All API_KEY, TOKEN, SECRET, PASSWORD vars are removed

// Grep tool: sensitive paths are blocked from search
import { isBlockedSearchPath } from "@chitragupta/yantra";
isBlockedSearchPath(".env");           // true
isBlockedSearchPath("credentials.json"); // true
isBlockedSearchPath(".ssh/");          // true

// Find/LS: sensitive directories are filtered out automatically
// Read/Write/Edit: BLOCKED_*_PATHS prevent access to credential files
```

### Unified Diff

```typescript
import { computeUnifiedDiff } from "@chitragupta/yantra";

const diff = computeUnifiedDiff(
  originalContent,
  modifiedContent,
  "src/parser.ts"
);
console.log(diff);
```

### Tool Handler Interface

```typescript
import type {
  ToolDefinition,
  ToolHandler,
  ToolContext,
  ToolResult,
} from "@chitragupta/yantra";

// Create a custom tool
const myTool: ToolHandler = {
  definition: {
    name: "my-tool",
    description: "Does something useful",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string" },
      },
      required: ["input"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    return { output: `Processed: ${input.input}` };
  },
};
```

---

[Back to Chitragupta root](../../README.md)
