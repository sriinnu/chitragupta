import { describe, it, expect } from "vitest";
import { parseSessionMarkdown } from "../src/markdown-parser.js";
import { SessionError } from "@chitragupta/core";

describe("markdown-parser", () => {

	// ── Error cases ─────────────────────────────────────────────────────

	describe("error handling", () => {
		it("throws SessionError for empty string", () => {
			expect(() => parseSessionMarkdown("")).toThrow(SessionError);
		});

		it("throws SessionError for non-string input", () => {
			expect(() => parseSessionMarkdown(null as unknown as string)).toThrow(SessionError);
		});

		it("throws SessionError for undefined input", () => {
			expect(() => parseSessionMarkdown(undefined as unknown as string)).toThrow(SessionError);
		});

		it("throws SessionError when frontmatter is missing", () => {
			expect(() => parseSessionMarkdown("No frontmatter here")).toThrow(SessionError);
			expect(() => parseSessionMarkdown("No frontmatter here")).toThrow("frontmatter");
		});

		it("throws SessionError when frontmatter delimiters are incomplete", () => {
			expect(() => parseSessionMarkdown("---\nid: 1\n")).toThrow(SessionError);
		});
	});

	// ── Minimal valid session ───────────────────────────────────────────

	describe("minimal session", () => {
		const minimal = `---
id: test-001
title: Test Session
created: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:00:00Z
agent: chitragupta
model: claude-3
project: /test
parent: null
branch: null
tags: []
totalCost: 0
totalTokens: 0
---`;

		it("parses minimal session without turns", () => {
			const session = parseSessionMarkdown(minimal);
			expect(session.meta.id).toBe("test-001");
			expect(session.meta.title).toBe("Test Session");
			expect(session.turns).toEqual([]);
		});

		it("parses agent field", () => {
			const session = parseSessionMarkdown(minimal);
			expect(session.meta.agent).toBe("chitragupta");
		});

		it("parses model field", () => {
			const session = parseSessionMarkdown(minimal);
			expect(session.meta.model).toBe("claude-3");
		});

		it("parses null parent", () => {
			const session = parseSessionMarkdown(minimal);
			expect(session.meta.parent).toBeNull();
		});

		it("parses null branch", () => {
			const session = parseSessionMarkdown(minimal);
			expect(session.meta.branch).toBeNull();
		});

		it("parses empty tags", () => {
			const session = parseSessionMarkdown(minimal);
			expect(session.meta.tags).toEqual([]);
		});

		it("parses numeric totalCost", () => {
			const session = parseSessionMarkdown(minimal);
			expect(session.meta.totalCost).toBe(0);
		});

		it("parses numeric totalTokens", () => {
			const session = parseSessionMarkdown(minimal);
			expect(session.meta.totalTokens).toBe(0);
		});
	});

	// ── Full session with metadata ──────────────────────────────────────

	describe("full metadata", () => {
		const full = `---
id: sess-full
title: "Full Session"
created: 2026-02-01T12:00:00Z
updated: 2026-02-01T13:00:00Z
agent: kartru
model: claude-3-opus
project: /my/project
parent: sess-parent
branch: feature-branch
tags:
  - refactor
  - typescript
totalCost: 0.0523
totalTokens: 15000
---`;

		it("parses tags as array", () => {
			const session = parseSessionMarkdown(full);
			expect(session.meta.tags).toEqual(["refactor", "typescript"]);
		});

		it("parses parent session ID", () => {
			const session = parseSessionMarkdown(full);
			expect(session.meta.parent).toBe("sess-parent");
		});

		it("parses branch name", () => {
			const session = parseSessionMarkdown(full);
			expect(session.meta.branch).toBe("feature-branch");
		});

		it("parses totalCost as number", () => {
			const session = parseSessionMarkdown(full);
			expect(session.meta.totalCost).toBe(0.0523);
		});

		it("parses totalTokens as number", () => {
			const session = parseSessionMarkdown(full);
			expect(session.meta.totalTokens).toBe(15000);
		});
	});

	// ── Turns ───────────────────────────────────────────────────────────

	describe("turns", () => {
		const withTurns = `---
id: t-1
title: Turns
created: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:00:00Z
agent: chitragupta
model: claude-3
project: /test
parent: null
branch: null
tags: []
totalCost: 0
totalTokens: 0
---

## Turn 1 — user

Hello, can you help me?

## Turn 2 — assistant

Of course! What do you need?

## Turn 3 — user

Fix the bug in main.ts.`;

		it("parses multiple turns", () => {
			const session = parseSessionMarkdown(withTurns);
			expect(session.turns).toHaveLength(3);
		});

		it("parses turn numbers correctly", () => {
			const session = parseSessionMarkdown(withTurns);
			expect(session.turns[0].turnNumber).toBe(1);
			expect(session.turns[1].turnNumber).toBe(2);
			expect(session.turns[2].turnNumber).toBe(3);
		});

		it("parses turn roles correctly", () => {
			const session = parseSessionMarkdown(withTurns);
			expect(session.turns[0].role).toBe("user");
			expect(session.turns[1].role).toBe("assistant");
			expect(session.turns[2].role).toBe("user");
		});

		it("parses turn content", () => {
			const session = parseSessionMarkdown(withTurns);
			expect(session.turns[0].content).toBe("Hello, can you help me?");
			expect(session.turns[1].content).toBe("Of course! What do you need?");
		});
	});

	// ── Turns with agent/model metadata ─────────────────────────────────

	describe("turn metadata", () => {
		const withMeta = `---
id: m-1
title: Meta
created: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:00:00Z
agent: chitragupta
model: claude-3
project: /test
parent: null
branch: null
tags: []
totalCost: 0
totalTokens: 0
---

## Turn 1 — assistant (agent: kartru, model: claude-3-opus)

I reviewed the code.`;

		it("parses agent from turn heading", () => {
			const session = parseSessionMarkdown(withMeta);
			expect(session.turns[0].agent).toBe("kartru");
		});

		it("parses model from turn heading", () => {
			const session = parseSessionMarkdown(withMeta);
			expect(session.turns[0].model).toBe("claude-3-opus");
		});
	});

	// ── Tool calls ──────────────────────────────────────────────────────

	describe("tool calls", () => {
		const withTools = `---
id: tc-1
title: Tools
created: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:00:00Z
agent: chitragupta
model: claude-3
project: /test
parent: null
branch: null
tags: []
totalCost: 0
totalTokens: 0
---

## Turn 1 — assistant

Let me read the file.

### Tool: read_file

**Input:**
` + "```json" + `
{"path": "/src/main.ts"}
` + "```" + `

<details>
<summary>Result</summary>

` + "```" + `
const x = 42;
` + "```" + `

</details>`;

		it("parses tool call name", () => {
			const session = parseSessionMarkdown(withTools);
			expect(session.turns[0].toolCalls).toHaveLength(1);
			expect(session.turns[0].toolCalls![0].name).toBe("read_file");
		});

		it("parses tool call input", () => {
			const session = parseSessionMarkdown(withTools);
			expect(session.turns[0].toolCalls![0].input).toContain("/src/main.ts");
		});

		it("parses tool call result", () => {
			const session = parseSessionMarkdown(withTools);
			expect(session.turns[0].toolCalls![0].result).toContain("const x = 42;");
		});

		it("isError is falsy for normal result", () => {
			const session = parseSessionMarkdown(withTools);
			expect(session.turns[0].toolCalls![0].isError).toBeFalsy();
		});

		it("preserves turn content before tool calls", () => {
			const session = parseSessionMarkdown(withTools);
			expect(session.turns[0].content).toBe("Let me read the file.");
		});
	});

	// ── Error tool results ──────────────────────────────────────────────

	describe("error tool results", () => {
		const withError = `---
id: te-1
title: Error
created: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:00:00Z
agent: chitragupta
model: claude-3
project: /test
parent: null
branch: null
tags: []
totalCost: 0
totalTokens: 0
---

## Turn 1 — assistant

Trying bash.

### Tool: bash

**Input:**
` + "```json" + `
{"command": "rm -rf /"}
` + "```" + `

<details>
<summary>Error</summary>

` + "```" + `
Permission denied
` + "```" + `

</details>`;

		it("sets isError to true when summary says Error", () => {
			const session = parseSessionMarkdown(withError);
			expect(session.turns[0].toolCalls![0].isError).toBe(true);
		});

		it("parses error result content", () => {
			const session = parseSessionMarkdown(withError);
			expect(session.turns[0].toolCalls![0].result).toContain("Permission denied");
		});
	});

	// ── Footer stripping ────────────────────────────────────────────────

	describe("footer stripping", () => {
		const withFooter = `---
id: f-1
title: Footer
created: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:00:00Z
agent: chitragupta
model: claude-3
project: /test
parent: null
branch: null
tags: []
totalCost: 0
totalTokens: 0
---

## Turn 1 — user

Hello!

---

*Session f-1 | chitragupta | claude-3 | Cost: $0.0000 | Tokens: 0*`;

		it("strips footer so it does not bleed into last turn", () => {
			const session = parseSessionMarkdown(withFooter);
			expect(session.turns[0].content).toBe("Hello!");
			expect(session.turns[0].content).not.toContain("Session f-1");
		});
	});

	// ── Inline tags ─────────────────────────────────────────────────────

	describe("inline tags", () => {
		const inlineTags = `---
id: it-1
title: Inline
created: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:00:00Z
agent: chitragupta
model: claude-3
project: /test
parent: null
branch: null
tags: [alpha, beta, gamma]
totalCost: 0
totalTokens: 0
---`;

		it("parses inline array tags", () => {
			const session = parseSessionMarkdown(inlineTags);
			expect(session.meta.tags).toEqual(["alpha", "beta", "gamma"]);
		});
	});
});
