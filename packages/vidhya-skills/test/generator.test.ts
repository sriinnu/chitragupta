import { describe, it, expect } from "vitest";
import {
	generateSkillFromTool,
	generateSkillsFromTools,
	extractVerbObject,
} from "../src/generator.js";
import type { ToolDefinition } from "../src/generator.js";

// ── extractVerbObject ────────────────────────────────────────────────────────

describe("extractVerbObject", () => {
	it("extracts verb/object from snake_case tool name", () => {
		const result = extractVerbObject("read_file");
		expect(result.verb).toBe("read");
		expect(result.object).toBe("file");
	});

	it("extracts verb/object from kebab-case tool name", () => {
		const result = extractVerbObject("search-code");
		expect(result.verb).toBe("search");
		expect(result.object).toBe("code");
	});

	it("extracts verb/object from camelCase tool name", () => {
		const result = extractVerbObject("analyzeCode");
		expect(result.verb).toBe("analyze");
		expect(result.object).toBe("code");
	});

	it("extracts verb/object from PascalCase tool name", () => {
		const result = extractVerbObject("ReadFile");
		expect(result.verb).toBe("read");
		expect(result.object).toBe("file");
	});

	it("handles multi-part names (verb + multi-word object)", () => {
		const result = extractVerbObject("read_file_contents");
		expect(result.verb).toBe("read");
		expect(result.object).toBe("file contents");
	});

	it("maps known single-word verbs to default objects", () => {
		const result = extractVerbObject("grep");
		expect(result.verb).toBe("grep");
		expect(result.object).toBe("content");
	});

	it("maps 'ls' to directory", () => {
		const result = extractVerbObject("ls");
		expect(result.verb).toBe("ls");
		expect(result.object).toBe("directory");
	});

	it("maps 'find' to files", () => {
		const result = extractVerbObject("find");
		expect(result.verb).toBe("find");
		expect(result.object).toBe("files");
	});

	it("returns 'use' verb for unknown single-word names", () => {
		const result = extractVerbObject("frobulate");
		expect(result.verb).toBe("use");
		expect(result.object).toBe("frobulate");
	});

	it("handles empty string by using 'use' verb", () => {
		const result = extractVerbObject("");
		expect(result.verb).toBe("use");
	});

	it("handles mixed separators (underscore and camelCase)", () => {
		const result = extractVerbObject("get_userProfile");
		expect(result.verb).toBe("get");
		// Should split on underscore first, then camelCase
		expect(result.object).toContain("user");
		expect(result.object).toContain("profile");
	});

	it("splits XMLParser correctly (consecutive uppercase)", () => {
		const result = extractVerbObject("XMLParser");
		// XMLParser -> XML, Parser
		expect(result.verb).toBe("xml");
		expect(result.object).toBe("parser");
	});
});

// ── generateSkillFromTool ────────────────────────────────────────────────────

describe("generateSkillFromTool", () => {
	const readFileTool: ToolDefinition = {
		name: "read_file",
		description: "Read the contents of a file at a given path",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "File path" },
				encoding: { type: "string", description: "Encoding", default: "utf-8" },
			},
			required: ["path"],
		},
	};

	it("generates a skill manifest with correct name", () => {
		const skill = generateSkillFromTool(readFileTool);
		expect(skill.name).toBe("read_file");
	});

	it("sets version to 1.0.0", () => {
		const skill = generateSkillFromTool(readFileTool);
		expect(skill.version).toBe("1.0.0");
	});

	it("extracts verb and object into capabilities", () => {
		const skill = generateSkillFromTool(readFileTool);
		expect(skill.capabilities.length).toBe(1);
		expect(skill.capabilities[0].verb).toBe("read");
		expect(skill.capabilities[0].object).toBe("file");
	});

	it("extracts parameters from inputSchema", () => {
		const skill = generateSkillFromTool(readFileTool);
		const params = skill.capabilities[0].parameters;
		expect(params).toBeDefined();
		expect(params!["path"]).toBeDefined();
		expect(params!["path"].type).toBe("string");
		expect(params!["path"].required).toBe(true);
		expect(params!["encoding"]).toBeDefined();
		expect(params!["encoding"].default).toBe("utf-8");
	});

	it("generates tags from name, description, and domain keywords", () => {
		const skill = generateSkillFromTool(readFileTool);
		expect(skill.tags).toContain("read");
		expect(skill.tags).toContain("file");
	});

	it("sets source type to tool with correct toolName", () => {
		const skill = generateSkillFromTool(readFileTool);
		expect(skill.source.type).toBe("tool");
		if (skill.source.type === "tool") {
			expect(skill.source.toolName).toBe("read_file");
		}
	});

	it("pre-computes a 128-dimensional trait vector", () => {
		const skill = generateSkillFromTool(readFileTool);
		expect(skill.traitVector).toBeDefined();
		expect(skill.traitVector!.length).toBe(128);
	});

	it("sets an updatedAt ISO timestamp", () => {
		const skill = generateSkillFromTool(readFileTool);
		expect(skill.updatedAt).toBeDefined();
		// Should be a valid ISO 8601 date
		expect(isNaN(Date.parse(skill.updatedAt))).toBe(false);
	});

	it("maps integer schema type to number parameter type", () => {
		const tool: ToolDefinition = {
			name: "set_count",
			description: "Set a count value",
			inputSchema: {
				type: "object",
				properties: {
					count: { type: "integer", description: "Count" },
				},
			},
		};
		const skill = generateSkillFromTool(tool);
		expect(skill.capabilities[0].parameters!["count"].type).toBe("number");
	});

	it("handles tools with no properties in inputSchema", () => {
		const tool: ToolDefinition = {
			name: "run",
			description: "Run a command",
			inputSchema: { type: "object" },
		};
		const skill = generateSkillFromTool(tool);
		expect(skill.capabilities[0].parameters).toBeUndefined();
	});

	it("detects domain keywords from description", () => {
		const tool: ToolDefinition = {
			name: "query_database",
			description: "Execute a database query over HTTP API",
			inputSchema: { type: "object", properties: { sql: { type: "string" } } },
		};
		const skill = generateSkillFromTool(tool);
		expect(skill.tags).toContain("database");
		expect(skill.tags).toContain("http");
		expect(skill.tags).toContain("api");
	});
});

// ── generateSkillsFromTools ──────────────────────────────────────────────────

describe("generateSkillsFromTools", () => {
	it("generates one manifest per tool definition", () => {
		const tools: ToolDefinition[] = [
			{ name: "read_file", description: "Read file", inputSchema: { type: "object" } },
			{ name: "write_file", description: "Write file", inputSchema: { type: "object" } },
			{ name: "list_dir", description: "List directory", inputSchema: { type: "object" } },
		];
		const skills = generateSkillsFromTools(tools);
		expect(skills.length).toBe(3);
		expect(skills.map((s) => s.name)).toEqual(["read_file", "write_file", "list_dir"]);
	});

	it("returns an empty array for empty input", () => {
		const skills = generateSkillsFromTools([]);
		expect(skills).toHaveLength(0);
	});
});
