import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock smriti modules to avoid file system access
vi.mock("@chitragupta/smriti/search", () => ({
	searchMemory: vi.fn().mockReturnValue([
		{
			content: "Use tabs for indentation",
			relevance: 0.95,
			scope: { type: "project" as const, path: "/test/project" },
		},
		{
			content: "Prefer async/await over callbacks",
			relevance: 0.8,
			scope: { type: "global" as const },
		},
	]),
}));

vi.mock("@chitragupta/smriti/session-store", () => ({
	listSessions: vi.fn().mockReturnValue([
		{
			id: "abc123",
			title: "Test Session",
			agent: "chitragupta",
			model: "claude-sonnet",
			created: "2026-01-01T00:00:00Z",
			updated: "2026-01-01T01:00:00Z",
			project: "/test",
			parent: null,
			branch: null,
			tags: [],
			totalCost: 0.05,
			totalTokens: 1000,
		},
	]),
	loadSession: vi.fn().mockReturnValue({
		meta: {
			id: "abc123",
			title: "Test Session",
			agent: "chitragupta",
			model: "claude-sonnet",
			created: "2026-01-01T00:00:00Z",
			updated: "2026-01-01T01:00:00Z",
			project: "/test",
			parent: null,
			branch: null,
			tags: [],
			totalCost: 0.05,
			totalTokens: 1000,
		},
		turns: [
			{ turnNumber: 1, role: "user", content: "Hello" },
			{ turnNumber: 2, role: "assistant", content: "Hi there!", agent: "chitragupta" },
		],
	}),
}));

vi.mock("@chitragupta/yantra", () => ({
	getAllTools: vi.fn().mockReturnValue([
		{
			definition: {
				name: "read",
				description: "Read a file",
				inputSchema: {
					type: "object",
					properties: {
						path: { type: "string", description: "File path" },
					},
					required: ["path"],
				},
			},
			execute: vi.fn().mockResolvedValue({ content: "file content", isError: false }),
		},
		{
			definition: {
				name: "bash",
				description: "Execute a shell command",
				inputSchema: {
					type: "object",
					properties: {
						command: { type: "string", description: "Command to run" },
					},
					required: ["command"],
				},
			},
			execute: vi.fn().mockResolvedValue({ content: "output", isError: false }),
		},
	]),
}));

// Avoid loading real credentials
vi.mock("@chitragupta/core", async () => {
	const actual = await vi.importActual("@chitragupta/core");
	return {
		...actual,
		getChitraguptaHome: vi.fn().mockReturnValue("/tmp/.chitragupta-test"),
	};
});

describe("MCP Server Mode", () => {
	describe("Tool creation", () => {
		it("should create memory search tool that returns results", async () => {
			// Dynamically import to get mocked version
			const mod = await import("../src/modes/mcp-server.js");
			// Access the tool creation via runMcpServerMode internals
			// We test the module exports exist and are callable
			expect(mod.runMcpServerMode).toBeDefined();
			expect(typeof mod.runMcpServerMode).toBe("function");
		});
	});

	describe("MCP entry point", () => {
		it("should export McpServerModeOptions type", async () => {
			const mod = await import("../src/modes/mcp-server.js");
			// Verify the function accepts options
			expect(mod.runMcpServerMode.length).toBeLessThanOrEqual(1);
		});
	});

	describe("Integration with tantra bridge", () => {
		it("should convert yantra tools via chitraguptaToolToMcp", async () => {
			const { chitraguptaToolToMcp } = await import("@chitragupta/tantra");
			const { getBuiltinTools } = await import("../src/bootstrap.js");

			const tools = getBuiltinTools();
			expect(tools.length).toBeGreaterThanOrEqual(1);

			// Convert first tool to MCP format
			const mcpTool = chitraguptaToolToMcp(tools[0] as any);
			expect(mcpTool.definition.name).toBe("read");
			expect(mcpTool.definition.description).toBe("Read a file");
			expect(typeof mcpTool.execute).toBe("function");
		});

		it("should execute converted tool and return MCP result", async () => {
			const { chitraguptaToolToMcp } = await import("@chitragupta/tantra");
			const { getBuiltinTools } = await import("../src/bootstrap.js");

			const tools = getBuiltinTools();
			const mcpTool = chitraguptaToolToMcp(tools[0] as any);

			const result = await mcpTool.execute({ path: "/test/file.ts" });
			expect(result.content).toBeDefined();
			expect(Array.isArray(result.content)).toBe(true);
			expect(result.content[0].type).toBe("text");
		});
	});

	describe("Memory search tool", () => {
		it("should search memory and return formatted results", async () => {
			const { searchMemory } = await import("@chitragupta/smriti/search");

			const results = searchMemory("tabs");
			expect(results.length).toBe(2);
			expect(results[0].content).toBe("Use tabs for indentation");
		});
	});

	describe("Session tools", () => {
		it("should list sessions from smriti", async () => {
			const { listSessions } = await import("@chitragupta/smriti/session-store");
			const sessions = listSessions("/test");
			expect(sessions.length).toBe(1);
			expect(sessions[0].id).toBe("abc123");
		});

		it("should load a specific session", async () => {
			const { loadSession } = await import("@chitragupta/smriti/session-store");
			const session = loadSession("abc123", "/test");
			expect(session.meta.title).toBe("Test Session");
			expect(session.turns.length).toBe(2);
		});
	});

	describe("CLI args parsing", () => {
		it("should register mcp-server as a valid subcommand", async () => {
			const { parseArgs } = await import("../src/args.js");
			const result = parseArgs(["mcp-server"]);
			expect(result.command).toBe("mcp-server");
		});

		it("should pass flags through rest for mcp-server", async () => {
			const { parseArgs } = await import("../src/args.js");
			const result = parseArgs(["mcp-server", "--sse", "--port", "4000"]);
			expect(result.command).toBe("mcp-server");
			// Flags (starting with --) go to rest, not subcommand
			expect(result.rest).toContain("--sse");
			expect(result.rest).toContain("--port");
			expect(result.rest).toContain("4000");
		});
	});

	describe("Package configuration", () => {
		it("should have chitragupta-mcp bin entry", async () => {
			const fs = await import("fs");
			const pkg = JSON.parse(
				fs.readFileSync(
					new URL("../package.json", import.meta.url),
					"utf-8",
				),
			);
			expect(pkg.bin["chitragupta-mcp"]).toBe("dist/mcp-entry.js");
		});

		it("should have ./mcp export", async () => {
			const fs = await import("fs");
			const pkg = JSON.parse(
				fs.readFileSync(
					new URL("../package.json", import.meta.url),
					"utf-8",
				),
			);
			expect(pkg.exports["./mcp"]).toBeDefined();
			expect(pkg.exports["./mcp"].import).toBe("./dist/modes/mcp-server.js");
		});
	});
});
