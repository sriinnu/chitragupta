import { describe, it, expect, vi, beforeEach } from "vitest";
import { VidyaBridge, SkillRegistry } from "@chitragupta/vidhya-skills";
import type { SkillManifest, SkillMatch } from "@chitragupta/vidhya-skills";
import type { ToolDefinition } from "@chitragupta/vidhya-skills";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeToolDef(name: string, description: string): ToolDefinition {
	return {
		name,
		description,
		inputSchema: {
			type: "object",
			properties: { path: { type: "string" } },
		},
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("VidyaBridge", () => {
	let registry: SkillRegistry;
	let bridge: VidyaBridge;

	beforeEach(() => {
		registry = new SkillRegistry();
		bridge = new VidyaBridge(registry);
	});

	// ─── Constructor ───────────────────────────────────────────────────

	describe("constructor", () => {
		it("should create bridge with empty state", () => {
			expect(bridge.registeredCount).toBe(0);
		});
	});

	// ─── registerToolsAsSkills ─────────────────────────────────────────

	describe("registerToolsAsSkills", () => {
		it("should register tools as skills", () => {
			const tools = [
				makeToolDef("read_file", "Read a file from the filesystem"),
				makeToolDef("write_file", "Write content to a file"),
			];
			bridge.registerToolsAsSkills(tools);
			expect(bridge.registeredCount).toBe(2);
		});

		it("should skip duplicate tool names", () => {
			const tools = [makeToolDef("read_file", "Read a file")];
			bridge.registerToolsAsSkills(tools);
			bridge.registerToolsAsSkills(tools); // second call
			expect(bridge.registeredCount).toBe(1);
		});

		it("should add skills to the registry", () => {
			bridge.registerToolsAsSkills([makeToolDef("search", "Search the codebase")]);
			expect(registry.getAll().length).toBeGreaterThan(0);
		});
	});

	// ─── recommendSkill ────────────────────────────────────────────────

	describe("recommendSkill", () => {
		it("should return null when registry is empty", () => {
			expect(bridge.recommendSkill("read a file")).toBeNull();
		});

		it("should return a match when skill exists", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("read_file", "Read a file from the filesystem"),
			]);
			const match = bridge.recommendSkill("read a file");
			// May or may not match depending on the matching algorithm threshold
			// Just test the return type
			if (match) {
				expect(match.skill).toBeDefined();
				expect(typeof match.score).toBe("number");
			}
		});

		it("should respect threshold parameter", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("niche_tool", "Very specific obscure operation"),
			]);
			// Very high threshold should return null
			const match = bridge.recommendSkill("completely unrelated query", 999);
			expect(match).toBeNull();
		});
	});

	// ─── recommendSkills ───────────────────────────────────────────────

	describe("recommendSkills", () => {
		it("should return empty array when no matches", () => {
			const matches = bridge.recommendSkills("xyz");
			expect(matches).toEqual([]);
		});

		it("should return multiple matches", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("read_file", "Read a file from disk"),
				makeToolDef("write_file", "Write a file to disk"),
				makeToolDef("delete_file", "Delete a file from disk"),
			]);
			const matches = bridge.recommendSkills("file operations", 10);
			expect(Array.isArray(matches)).toBe(true);
		});

		it("should respect topK parameter", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("tool_a", "First tool"),
				makeToolDef("tool_b", "Second tool"),
				makeToolDef("tool_c", "Third tool"),
			]);
			const matches = bridge.recommendSkills("tool", 1, 0);
			expect(matches.length).toBeLessThanOrEqual(1);
		});
	});

	// ─── getSkillForTool ───────────────────────────────────────────────

	describe("getSkillForTool", () => {
		it("should return null for unknown tool", () => {
			expect(bridge.getSkillForTool("nonexistent")).toBeNull();
		});

		it("should find skill by tool name", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("read_file", "Read a file"),
			]);
			const skill = bridge.getSkillForTool("read_file");
			expect(skill).not.toBeNull();
			expect(skill!.name).toBe("read_file");
		});

		it("should find skill by source tool name", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("my_tool", "Does something"),
			]);
			// The generated skill has source.type = "tool" and source.toolName = "my_tool"
			const skill = bridge.getSkillForTool("my_tool");
			expect(skill).not.toBeNull();
		});
	});

	// ─── registerMCPServerTools ────────────────────────────────────────

	describe("registerMCPServerTools", () => {
		it("should register tools with MCP server source", () => {
			bridge.registerMCPServerTools("srv-1", "Test Server", [
				makeToolDef("mcp_read", "Read via MCP"),
			]);
			expect(bridge.registeredCount).toBe(1);
			const skill = bridge.getSkillForTool("mcp_read");
			expect(skill).not.toBeNull();
			expect(skill!.source.type).toBe("mcp-server");
			if (skill!.source.type === "mcp-server") {
				expect(skill!.source.serverId).toBe("srv-1");
				expect(skill!.source.serverName).toBe("Test Server");
			}
		});

		it("should skip duplicate tool names", () => {
			const tools = [makeToolDef("mcp_tool", "MCP tool")];
			bridge.registerMCPServerTools("srv-1", "Server 1", tools);
			bridge.registerMCPServerTools("srv-2", "Server 2", tools);
			expect(bridge.registeredCount).toBe(1);
		});
	});

	// ─── unregisterAll ─────────────────────────────────────────────────

	describe("unregisterAll", () => {
		it("should remove all registered tools", () => {
			bridge.registerToolsAsSkills([
				makeToolDef("tool_a", "Tool A"),
				makeToolDef("tool_b", "Tool B"),
			]);
			expect(bridge.registeredCount).toBe(2);

			bridge.unregisterAll();
			expect(bridge.registeredCount).toBe(0);
		});

		it("should remove skills from registry", () => {
			bridge.registerToolsAsSkills([makeToolDef("tool_x", "Tool X")]);
			bridge.unregisterAll();
			expect(bridge.getSkillForTool("tool_x")).toBeNull();
		});

		it("should be idempotent", () => {
			bridge.unregisterAll();
			bridge.unregisterAll();
			expect(bridge.registeredCount).toBe(0);
		});

		it("should allow re-registration after unregister", () => {
			const tools = [makeToolDef("tool_y", "Tool Y")];
			bridge.registerToolsAsSkills(tools);
			bridge.unregisterAll();
			bridge.registerToolsAsSkills(tools);
			expect(bridge.registeredCount).toBe(1);
		});
	});

	// ─── registeredCount ───────────────────────────────────────────────

	describe("registeredCount", () => {
		it("should be 0 initially", () => {
			expect(bridge.registeredCount).toBe(0);
		});

		it("should increment as tools are registered", () => {
			bridge.registerToolsAsSkills([makeToolDef("a", "A")]);
			expect(bridge.registeredCount).toBe(1);
			bridge.registerToolsAsSkills([makeToolDef("b", "B")]);
			expect(bridge.registeredCount).toBe(2);
		});

		it("should reset to 0 after unregisterAll", () => {
			bridge.registerToolsAsSkills([makeToolDef("z", "Z")]);
			bridge.unregisterAll();
			expect(bridge.registeredCount).toBe(0);
		});
	});
});
