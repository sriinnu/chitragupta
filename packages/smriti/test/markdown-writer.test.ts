import { describe, it, expect } from "vitest";
import { writeSessionMarkdown, writeTurnMarkdown } from "../src/markdown-writer.js";
import { parseSessionMarkdown } from "../src/markdown-parser.js";
import type { Session, SessionTurn, SessionMeta } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMeta(overrides?: Partial<SessionMeta>): SessionMeta {
	return {
		id: "test-001",
		title: "Test Session",
		created: "2026-01-01T00:00:00Z",
		updated: "2026-01-01T00:00:00Z",
		agent: "chitragupta",
		model: "claude-3",
		project: "/test/project",
		parent: null,
		branch: null,
		tags: [],
		totalCost: 0,
		totalTokens: 0,
		...overrides,
	};
}

function makeSession(overrides?: Partial<Session>): Session {
	return {
		meta: makeMeta(),
		turns: [],
		...overrides,
	};
}

function makeTurn(overrides?: Partial<SessionTurn>): SessionTurn {
	return {
		turnNumber: 1,
		role: "user",
		content: "Hello!",
		...overrides,
	};
}

describe("markdown-writer", () => {

	// ── Frontmatter ─────────────────────────────────────────────────────

	describe("frontmatter", () => {
		it("writes id field", () => {
			const md = writeSessionMarkdown(makeSession());
			expect(md).toContain("id: test-001");
		});

		it("writes title with quotes", () => {
			const md = writeSessionMarkdown(makeSession());
			expect(md).toContain('title: "Test Session"');
		});

		it("writes created and updated dates", () => {
			const md = writeSessionMarkdown(makeSession());
			expect(md).toContain("created: 2026-01-01T00:00:00Z");
			expect(md).toContain("updated: 2026-01-01T00:00:00Z");
		});

		it("writes null parent as 'null'", () => {
			const md = writeSessionMarkdown(makeSession());
			expect(md).toContain("parent: null");
		});

		it("writes parent session ID when set", () => {
			const session = makeSession({ meta: makeMeta({ parent: "parent-001" }) });
			const md = writeSessionMarkdown(session);
			expect(md).toContain("parent: parent-001");
		});

		it("writes empty tags as '[]'", () => {
			const md = writeSessionMarkdown(makeSession());
			expect(md).toContain("tags: []");
		});

		it("writes tags as multi-line list", () => {
			const session = makeSession({ meta: makeMeta({ tags: ["alpha", "beta"] }) });
			const md = writeSessionMarkdown(session);
			expect(md).toContain("tags:");
			expect(md).toContain("  - alpha");
			expect(md).toContain("  - beta");
		});

		it("writes totalCost", () => {
			const md = writeSessionMarkdown(makeSession());
			expect(md).toContain("totalCost: 0");
		});

		it("writes totalTokens", () => {
			const md = writeSessionMarkdown(makeSession());
			expect(md).toContain("totalTokens: 0");
		});

		it("starts and ends with --- delimiters", () => {
			const md = writeSessionMarkdown(makeSession());
			expect(md.startsWith("---\n")).toBe(true);
			expect(md).toContain("\n---\n");
		});
	});

	// ── Turn writing ────────────────────────────────────────────────────

	describe("writeTurnMarkdown", () => {
		it("writes user turn heading", () => {
			const md = writeTurnMarkdown(makeTurn());
			expect(md).toContain("## Turn 1 \u2014 user");
		});

		it("writes assistant turn heading", () => {
			const md = writeTurnMarkdown(makeTurn({ role: "assistant", content: "Hi!" }));
			expect(md).toContain("## Turn 1 \u2014 assistant");
		});

		it("includes turn content", () => {
			const md = writeTurnMarkdown(makeTurn({ content: "My message" }));
			expect(md).toContain("My message");
		});

		it("includes agent metadata in heading", () => {
			const md = writeTurnMarkdown(makeTurn({ role: "assistant", agent: "kartru" }));
			expect(md).toContain("(agent: kartru)");
		});

		it("includes model metadata in heading", () => {
			const md = writeTurnMarkdown(makeTurn({ role: "assistant", model: "claude-3-opus" }));
			expect(md).toContain("(model: claude-3-opus)");
		});

		it("includes both agent and model in heading", () => {
			const md = writeTurnMarkdown(makeTurn({ role: "assistant", agent: "kartru", model: "claude-3" }));
			expect(md).toContain("(agent: kartru, model: claude-3)");
		});
	});

	// ── Tool call writing ───────────────────────────────────────────────

	describe("tool call writing", () => {
		it("writes tool call heading", () => {
			const turn = makeTurn({
				role: "assistant",
				content: "Reading file.",
				toolCalls: [{ name: "read_file", input: '{"path":"/a.ts"}', result: "content" }],
			});
			const md = writeTurnMarkdown(turn);
			expect(md).toContain("### Tool: read_file");
		});

		it("writes tool call input in json code block", () => {
			const turn = makeTurn({
				role: "assistant",
				content: "Go.",
				toolCalls: [{ name: "bash", input: '{"command":"ls"}', result: "file.ts" }],
			});
			const md = writeTurnMarkdown(turn);
			expect(md).toContain("**Input:**");
			expect(md).toContain("```json");
			expect(md).toContain('{"command":"ls"}');
		});

		it("writes tool result in details block", () => {
			const turn = makeTurn({
				role: "assistant",
				content: "Done.",
				toolCalls: [{ name: "read_file", input: "{}", result: "const x = 1;" }],
			});
			const md = writeTurnMarkdown(turn);
			expect(md).toContain("<details>");
			expect(md).toContain("<summary>Result</summary>");
			expect(md).toContain("const x = 1;");
			expect(md).toContain("</details>");
		});

		it("writes error summary label for error tool calls", () => {
			const turn = makeTurn({
				role: "assistant",
				content: "Failed.",
				toolCalls: [{ name: "bash", input: "{}", result: "Permission denied", isError: true }],
			});
			const md = writeTurnMarkdown(turn);
			expect(md).toContain("<summary>Error</summary>");
		});
	});

	// ── Footer ──────────────────────────────────────────────────────────

	describe("footer", () => {
		it("writes session footer", () => {
			const md = writeSessionMarkdown(makeSession());
			expect(md).toContain("*Session test-001 | chitragupta | claude-3 |");
		});

		it("includes cost in footer", () => {
			const session = makeSession({ meta: makeMeta({ totalCost: 0.1234 }) });
			const md = writeSessionMarkdown(session);
			expect(md).toContain("Cost: $0.1234");
		});

		it("includes token count in footer", () => {
			const session = makeSession({ meta: makeMeta({ totalTokens: 5000 }) });
			const md = writeSessionMarkdown(session);
			expect(md).toContain("Tokens: 5000");
		});
	});

	// ── Round-trip ──────────────────────────────────────────────────────

	describe("round-trip (write then parse)", () => {
		it("round-trips a minimal session", () => {
			const session = makeSession();
			const md = writeSessionMarkdown(session);
			const parsed = parseSessionMarkdown(md);
			expect(parsed.meta.id).toBe(session.meta.id);
			expect(parsed.meta.title).toBe(session.meta.title);
			expect(parsed.turns).toEqual([]);
		});

		it("round-trips session with turns", () => {
			const session = makeSession({
				turns: [
					makeTurn({ turnNumber: 1, role: "user", content: "Hello" }),
					makeTurn({ turnNumber: 2, role: "assistant", content: "Hi there!" }),
				],
			});
			const md = writeSessionMarkdown(session);
			const parsed = parseSessionMarkdown(md);
			expect(parsed.turns).toHaveLength(2);
			expect(parsed.turns[0].role).toBe("user");
			expect(parsed.turns[0].content).toBe("Hello");
			expect(parsed.turns[1].role).toBe("assistant");
			expect(parsed.turns[1].content).toBe("Hi there!");
		});

		it("round-trips tags", () => {
			const session = makeSession({ meta: makeMeta({ tags: ["debug", "ts"] }) });
			const md = writeSessionMarkdown(session);
			const parsed = parseSessionMarkdown(md);
			expect(parsed.meta.tags).toEqual(["debug", "ts"]);
		});
	});
});
