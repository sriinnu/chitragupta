import { describe, it, expect, vi, beforeEach } from "vitest";
import { sessionTool } from "@chitragupta/yantra";
import type { ToolContext } from "@chitragupta/yantra";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockStat, mockReaddir, mockReadFile, mockWriteFile } = vi.hoisted(() => ({
	mockStat: vi.fn(),
	mockReaddir: vi.fn(),
	mockReadFile: vi.fn(),
	mockWriteFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
	promises: {
		stat: mockStat,
		readdir: mockReaddir,
		readFile: mockReadFile,
		writeFile: mockWriteFile,
	},
}));

vi.mock("node:os", () => ({
	homedir: () => "/mock-home",
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CTX: ToolContext = { sessionId: "test-session", workingDirectory: "/tmp" };

const SESSION_1 = `---
id: abc-123
title: Test Session
created: 2025-01-15T10:00:00Z
model: claude-opus
updated: 2025-01-15T11:00:00Z
---

## Conversation

**User**: Hello
**Assistant**: Hi there!
`;

const SESSION_2 = `---
id: def-456
title: Another Session
created: 2025-01-16T10:00:00Z
model: gpt-4
---

## Conversation

**User**: Search for tests
**Assistant**: Found tests.
`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("sessionTool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ─── Definition ───────────────────────────────────────────────────

	describe("definition", () => {
		it("should have correct name", () => {
			expect(sessionTool.definition.name).toBe("session");
		});

		it("should require action", () => {
			expect(sessionTool.definition.inputSchema.required).toContain("action");
		});

		it("should have description", () => {
			expect(typeof sessionTool.definition.description).toBe("string");
		});

		it("should define valid actions enum", () => {
			const props = sessionTool.definition.inputSchema.properties as Record<string, any>;
			expect(props.action.enum).toEqual(["list", "show", "search", "branch"]);
		});
	});

	// ─── Validation ───────────────────────────────────────────────────

	describe("validation", () => {
		it("should error when action missing", async () => {
			const r = await sessionTool.execute({}, CTX);
			expect(r.isError).toBe(true);
			expect(r.content).toContain("'action' argument is required");
		});

		it("should error for invalid action", async () => {
			const r = await sessionTool.execute({ action: "delete" }, CTX);
			expect(r.isError).toBe(true);
			expect(r.content).toContain("Invalid action");
		});

		it("should error show without sessionId", async () => {
			const r = await sessionTool.execute({ action: "show" }, CTX);
			expect(r.isError).toBe(true);
			expect(r.content).toContain("'sessionId' is required");
		});

		it("should error search without query", async () => {
			const r = await sessionTool.execute({ action: "search" }, CTX);
			expect(r.isError).toBe(true);
			expect(r.content).toContain("'query' is required");
		});

		it("should error branch without sessionId", async () => {
			const r = await sessionTool.execute({ action: "branch", branchName: "t" }, CTX);
			expect(r.isError).toBe(true);
			expect(r.content).toContain("'sessionId' is required");
		});

		it("should error branch without branchName", async () => {
			const r = await sessionTool.execute({ action: "branch", sessionId: "a" }, CTX);
			expect(r.isError).toBe(true);
			expect(r.content).toContain("'branchName' is required");
		});
	});

	// ─── List ─────────────────────────────────────────────────────────

	describe("list", () => {
		it("should report no sessions when dir missing", async () => {
			mockStat.mockRejectedValue(new Error("ENOENT"));
			const r = await sessionTool.execute({ action: "list" }, CTX);
			expect(r.content).toContain("No sessions found");
		});

		it("should report no sessions when empty", async () => {
			mockStat.mockResolvedValue({});
			mockReaddir.mockResolvedValue([]);
			const r = await sessionTool.execute({ action: "list" }, CTX);
			expect(r.content).toContain("No sessions found");
		});

		it("should list sessions with metadata", async () => {
			mockStat.mockResolvedValue({});
			mockReaddir.mockResolvedValue(["abc-123.md", "def-456.md"]);
			mockReadFile.mockImplementation(async (p: string) => {
				if (p.includes("abc-123")) return SESSION_1;
				if (p.includes("def-456")) return SESSION_2;
				throw new Error("not found");
			});
			const r = await sessionTool.execute({ action: "list" }, CTX);
			expect(r.content).toContain("Sessions (2 total)");
			expect(r.content).toContain("Test Session");
		});

		it("should only list .md files", async () => {
			mockStat.mockResolvedValue({});
			mockReaddir.mockResolvedValue(["s.md", "n.txt"]);
			mockReadFile.mockResolvedValue(SESSION_1);
			const r = await sessionTool.execute({ action: "list" }, CTX);
			expect(r.content).toContain("Sessions (1 total)");
		});

		it("should handle unreadable files", async () => {
			mockStat.mockResolvedValue({});
			mockReaddir.mockResolvedValue(["bad.md"]);
			mockReadFile.mockRejectedValue(new Error("denied"));
			const r = await sessionTool.execute({ action: "list" }, CTX);
			expect(r.content).toContain("could not read");
		});

		it("should include metadata object", async () => {
			mockStat.mockRejectedValue(new Error("ENOENT"));
			const r = await sessionTool.execute({ action: "list" }, CTX);
			expect(r.metadata).toEqual({ action: "list" });
		});
	});

	// ─── Show ─────────────────────────────────────────────────────────

	describe("show", () => {
		it("should return content by exact ID", async () => {
			mockReadFile.mockResolvedValue(SESSION_1);
			const r = await sessionTool.execute({ action: "show", sessionId: "abc-123" }, CTX);
			expect(r.content).toContain("Test Session");
		});

		it("should return not found for missing session", async () => {
			mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
			mockReaddir.mockResolvedValue([]);
			const r = await sessionTool.execute({ action: "show", sessionId: "x" }, CTX);
			expect(r.content).toContain("Session not found");
		});

		it("should find by partial match", async () => {
			const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			mockReadFile.mockImplementation(async (p: string) => {
				if (p.includes("abc-123-full.md")) return SESSION_1;
				throw enoent;
			});
			mockReaddir.mockResolvedValue(["abc-123-full.md"]);
			const r = await sessionTool.execute({ action: "show", sessionId: "abc-123" }, CTX);
			expect(r.content).toContain("Test Session");
		});

		it("should list multiple partial matches", async () => {
			mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
			mockReaddir.mockResolvedValue(["abc-a.md", "abc-b.md"]);
			const r = await sessionTool.execute({ action: "show", sessionId: "abc" }, CTX);
			expect(r.content).toContain("Multiple sessions match");
		});
	});

	// ─── Search ───────────────────────────────────────────────────────

	describe("search", () => {
		it("should find matching sessions", async () => {
			mockStat.mockResolvedValue({});
			mockReaddir.mockResolvedValue(["abc-123.md", "def-456.md"]);
			mockReadFile.mockImplementation(async (p: string) => {
				if (p.includes("abc-123")) return SESSION_1;
				if (p.includes("def-456")) return SESSION_2;
				throw new Error("not found");
			});
			const r = await sessionTool.execute({ action: "search", query: "tests" }, CTX);
			expect(r.content).toContain("Found matches in 1 session");
		});

		it("should be case-insensitive", async () => {
			mockStat.mockResolvedValue({});
			mockReaddir.mockResolvedValue(["abc-123.md"]);
			mockReadFile.mockResolvedValue(SESSION_1);
			const r = await sessionTool.execute({ action: "search", query: "HELLO" }, CTX);
			expect(r.content).toContain("Found matches in 1 session");
		});

		it("should return no matches for unrelated query", async () => {
			mockStat.mockResolvedValue({});
			mockReaddir.mockResolvedValue(["abc-123.md"]);
			mockReadFile.mockResolvedValue(SESSION_1);
			const r = await sessionTool.execute({ action: "search", query: "quantum" }, CTX);
			expect(r.content).toContain("No sessions match query");
		});

		it("should include line numbers in results", async () => {
			mockStat.mockResolvedValue({});
			mockReaddir.mockResolvedValue(["abc-123.md"]);
			mockReadFile.mockResolvedValue(SESSION_1);
			const r = await sessionTool.execute({ action: "search", query: "Hello" }, CTX);
			expect(r.content).toMatch(/L\d+:/);
		});
	});

	// ─── Branch ───────────────────────────────────────────────────────

	describe("branch", () => {
		it("should create branched session", async () => {
			mockReadFile.mockResolvedValue(SESSION_1);
			mockWriteFile.mockResolvedValue(undefined);
			const r = await sessionTool.execute({ action: "branch", sessionId: "abc-123", branchName: "exp" }, CTX);
			expect(r.content).toContain("Session branched successfully");
			expect(mockWriteFile).toHaveBeenCalled();
		});

		it("should set parent field in branched content", async () => {
			mockReadFile.mockResolvedValue(SESSION_1);
			mockWriteFile.mockResolvedValue(undefined);
			await sessionTool.execute({ action: "branch", sessionId: "abc-123", branchName: "test" }, CTX);
			const written = mockWriteFile.mock.calls[0][1] as string;
			expect(written).toContain("parent: abc-123");
			expect(written).toContain("branch: test");
		});

		it("should error for missing source", async () => {
			mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
			const r = await sessionTool.execute({ action: "branch", sessionId: "x", branchName: "t" }, CTX);
			expect(r.content).toContain("Source session not found");
		});

		it("should update id in branched frontmatter", async () => {
			mockReadFile.mockResolvedValue(SESSION_1);
			mockWriteFile.mockResolvedValue(undefined);
			await sessionTool.execute({ action: "branch", sessionId: "abc-123", branchName: "fork" }, CTX);
			const written = mockWriteFile.mock.calls[0][1] as string;
			expect(written).toContain("id: fork-");
			expect(written).not.toMatch(/^id: abc-123$/m);
		});
	});
});
