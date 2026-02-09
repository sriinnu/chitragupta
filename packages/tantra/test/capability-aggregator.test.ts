import { describe, it, expect } from "vitest";
import { CapabilityAggregator } from "../src/capability-aggregator.js";
import type {
	NamespacedTool,
	ToolCallRoute,
	ToolSearchResult,
} from "../src/capability-aggregator.js";
import type { McpTool, McpResource, McpPrompt } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTool(name: string, description: string): McpTool {
	return {
		name,
		description,
		inputSchema: { type: "object", properties: {} },
	};
}

function makeResource(uri: string, name: string): McpResource {
	return { uri, name };
}

// ─── Namespacing ────────────────────────────────────────────────────────────

describe("CapabilityAggregator — namespacing", () => {
	it("tools get serverName.toolName format", () => {
		const agg = new CapabilityAggregator();
		agg.addServer("fs-1", "filesystem", [
			makeTool("read_file", "Read a file from disk"),
			makeTool("write_file", "Write content to a file"),
		]);

		const tools = agg.getAllTools();
		expect(tools.length).toBe(2);
		expect(tools[0].namespacedName).toBe("filesystem.read_file");
		expect(tools[1].namespacedName).toBe("filesystem.write_file");
		expect(tools[0].originalName).toBe("read_file");
		expect(tools[0].serverId).toBe("fs-1");
		expect(tools[0].serverName).toBe("filesystem");
	});

	it("tool descriptions are prefixed with server name", () => {
		const agg = new CapabilityAggregator();
		agg.addServer("git-1", "git", [
			makeTool("status", "Show working tree status"),
		]);

		const tools = agg.getAllTools();
		expect(tools[0].tool.description).toContain("[git]");
		expect(tools[0].tool.description).toContain("Show working tree status");
	});

	it("sanitizes server names with special characters", () => {
		const agg = new CapabilityAggregator();
		agg.addServer("id-1", "my server!@#", [
			makeTool("hello", "A greeting tool"),
		]);

		const tools = agg.getAllTools();
		// Special characters should be replaced with underscores
		expect(tools[0].namespacedName).toBe("my_server___.hello");
		expect(tools[0].namespacedName).not.toContain("!");
		expect(tools[0].namespacedName).not.toContain("@");
	});
});

// ─── Route Tool Call ────────────────────────────────────────────────────────

describe("CapabilityAggregator — routing", () => {
	it("correctly routes namespaced tool calls", () => {
		const agg = new CapabilityAggregator();
		agg.addServer("fs-1", "filesystem", [
			makeTool("read_file", "Read a file"),
		]);

		const route = agg.routeToolCall("filesystem.read_file", { path: "/src/index.ts" });
		expect(route).not.toBeNull();
		expect(route!.serverId).toBe("fs-1");
		expect(route!.toolName).toBe("read_file");
		expect(route!.args).toEqual({ path: "/src/index.ts" });
	});

	it("falls back to un-namespaced lookup", () => {
		const agg = new CapabilityAggregator();
		agg.addServer("git-1", "git", [
			makeTool("status", "Show status"),
		]);

		const route = agg.routeToolCall("status", {});
		expect(route).not.toBeNull();
		expect(route!.serverId).toBe("git-1");
		expect(route!.toolName).toBe("status");
	});

	it("returns null for unknown tools", () => {
		const agg = new CapabilityAggregator();
		agg.addServer("fs-1", "filesystem", [
			makeTool("read_file", "Read a file"),
		]);

		const route = agg.routeToolCall("unknown.nonexistent", {});
		expect(route).toBeNull();
	});
});

// ─── Multi-Server ───────────────────────────────────────────────────────────

describe("CapabilityAggregator — multi-server", () => {
	it("tools from different servers coexist", () => {
		const agg = new CapabilityAggregator();
		agg.addServer("fs-1", "filesystem", [
			makeTool("read_file", "Read a file from disk"),
			makeTool("write_file", "Write to a file"),
		]);
		agg.addServer("git-1", "git", [
			makeTool("status", "Show git status"),
			makeTool("diff", "Show git diff"),
		]);
		agg.addServer("db-1", "database", [
			makeTool("query", "Execute SQL query"),
		]);

		const tools = agg.getAllTools();
		expect(tools.length).toBe(5);
		expect(agg.getToolCount()).toBe(5);
		expect(agg.getServerCount()).toBe(3);

		// All have correct namespacing
		const names = tools.map((t) => t.namespacedName);
		expect(names).toContain("filesystem.read_file");
		expect(names).toContain("git.status");
		expect(names).toContain("database.query");
	});

	it("resources from different servers get namespaced URIs", () => {
		const agg = new CapabilityAggregator();
		agg.addServer("fs-1", "filesystem", [], [
			makeResource("file:///src/index.ts", "index.ts"),
		]);
		agg.addServer("db-1", "database", [], [
			makeResource("postgres://localhost/mydb", "mydb"),
		]);

		const resources = agg.getAllResources();
		expect(resources.length).toBe(2);
		expect(resources[0].namespacedUri).toBe("filesystem://file:///src/index.ts");
		expect(resources[1].namespacedUri).toBe("database://postgres://localhost/mydb");
	});
});

// ─── Remove Server ──────────────────────────────────────────────────────────

describe("CapabilityAggregator — remove server", () => {
	it("tools are removed when server is removed", () => {
		const agg = new CapabilityAggregator();
		agg.addServer("fs-1", "filesystem", [
			makeTool("read_file", "Read a file"),
		]);
		agg.addServer("git-1", "git", [
			makeTool("status", "Show status"),
		]);

		expect(agg.getToolCount()).toBe(2);
		expect(agg.getServerCount()).toBe(2);

		agg.removeServer("fs-1");

		expect(agg.getToolCount()).toBe(1);
		expect(agg.getServerCount()).toBe(1);

		const tools = agg.getAllTools();
		expect(tools[0].namespacedName).toBe("git.status");

		// Routing to removed server should fail
		const route = agg.routeToolCall("filesystem.read_file", {});
		expect(route).toBeNull();
	});

	it("removing non-existent server does not throw", () => {
		const agg = new CapabilityAggregator();
		expect(() => agg.removeServer("nonexistent")).not.toThrow();
	});
});

// ─── Find Tools (Fuzzy Search) ──────────────────────────────────────────────

describe("CapabilityAggregator — findTools", () => {
	function setupAggregator(): CapabilityAggregator {
		const agg = new CapabilityAggregator();
		agg.addServer("fs-1", "filesystem", [
			makeTool("read_file", "Read content from a file on disk"),
			makeTool("write_file", "Write content to a file on disk"),
			makeTool("list_directory", "List files in a directory"),
		]);
		agg.addServer("git-1", "git", [
			makeTool("status", "Show the working tree status"),
			makeTool("diff", "Show changes between commits"),
			makeTool("log", "Show commit history"),
		]);
		agg.addServer("search-1", "search", [
			makeTool("grep", "Search file contents using regex"),
			makeTool("find", "Find files by name pattern"),
		]);
		return agg;
	}

	it("exact name match scores highest", () => {
		const agg = setupAggregator();
		const results = agg.findTools("read_file");
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].tool.originalName).toBe("read_file");
		expect(results[0].score).toBe(1.0);
	});

	it("name prefix match scores high", () => {
		const agg = setupAggregator();
		const results = agg.findTools("read");
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].score).toBeGreaterThanOrEqual(0.7);
	});

	it("description match returns relevant results", () => {
		const agg = setupAggregator();
		const results = agg.findTools("regex");
		expect(results.length).toBeGreaterThan(0);
		// "grep" tool has "regex" in its description
		expect(results.some((r) => r.tool.originalName === "grep")).toBe(true);
	});

	it("empty query returns empty results", () => {
		const agg = setupAggregator();
		const results = agg.findTools("");
		expect(results.length).toBe(0);
	});

	it("respects limit parameter", () => {
		const agg = setupAggregator();
		const results = agg.findTools("file", 2);
		expect(results.length).toBeLessThanOrEqual(2);
	});
});

// ─── Duplicate Tool Names ───────────────────────────────────────────────────

describe("CapabilityAggregator — duplicate tool names", () => {
	it("different servers with same tool name do not conflict", () => {
		const agg = new CapabilityAggregator();
		agg.addServer("server-a", "alpha", [
			makeTool("status", "Get alpha server status"),
		]);
		agg.addServer("server-b", "beta", [
			makeTool("status", "Get beta server status"),
		]);

		const tools = agg.getAllTools();
		expect(tools.length).toBe(2);

		const names = tools.map((t) => t.namespacedName);
		expect(names).toContain("alpha.status");
		expect(names).toContain("beta.status");

		// Routing correctly distinguishes
		const routeA = agg.routeToolCall("alpha.status", {});
		const routeB = agg.routeToolCall("beta.status", {});
		expect(routeA!.serverId).toBe("server-a");
		expect(routeB!.serverId).toBe("server-b");
	});

	it("updateServerTools replaces tools for existing server", () => {
		const agg = new CapabilityAggregator();
		agg.addServer("fs-1", "filesystem", [
			makeTool("read_file", "Read a file"),
		]);

		expect(agg.getToolCount()).toBe(1);

		agg.updateServerTools("fs-1", [
			makeTool("read_file", "Read a file (v2)"),
			makeTool("write_file", "Write a file"),
		]);

		expect(agg.getToolCount()).toBe(2);
		const tools = agg.getAllTools();
		expect(tools.some((t) => t.originalName === "write_file")).toBe(true);
	});
});
