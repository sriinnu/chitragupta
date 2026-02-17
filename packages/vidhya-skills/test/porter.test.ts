import { describe, it, expect } from "vitest";
import {
	SkillPorter,
	detectFormat,
	importClaudeSkill,
	exportClaudeSkill,
	importGeminiExtension,
	exportGeminiExtension,
	convert,
} from "../src/porter.js";
import type { SkillManifest } from "../src/types.js";

// ─── Sample Data ────────────────────────────────────────────────────────────

const SAMPLE_CLAUDE_SKILL = `---
name: explain-code
description: Explains code with visual diagrams and analogies. Use when explaining how code works.
allowed-tools: Read, Grep, Glob
---

When explaining code, always include:

1. **Start with an analogy**: Compare the code to something from everyday life
2. **Draw a diagram**: Use ASCII art to show the flow
3. **Walk through the code**: Explain step-by-step what happens
4. **Highlight a gotcha**: What's a common mistake?

Keep explanations conversational.
`;

const SAMPLE_CLAUDE_SKILL_MINIMAL = `---
name: deploy
description: Deploy the application to production
disable-model-invocation: true
context: fork
---

Deploy the application:
1. Run the test suite
2. Build the application
3. Push to the deployment target
`;

const SAMPLE_CLAUDE_NO_FRONTMATTER = `# Code Reviewer

Review code for quality, patterns, and potential bugs.

1. Read the source files
2. Analyze code structure
3. Check for common issues
4. Report findings
`;

const SAMPLE_GEMINI_EXTENSION = JSON.stringify({
	name: "my-first-extension",
	version: "1.0.0",
	description: "A filesystem helper extension for Gemini CLI",
	contextFileName: "GEMINI.md",
	mcpServers: {
		nodeServer: {
			command: "node",
			args: ["${extensionPath}/dist/example.js"],
			cwd: "${extensionPath}",
		},
	},
}, null, "\t");

const SAMPLE_GEMINI_WITH_TOOLS = JSON.stringify({
	name: "code-analyzer",
	version: "2.0.0",
	description: "Analyze code quality and find issues",
	tools: [
		{
			name: "analyze_code",
			description: "Analyze source code for quality issues",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "File path to analyze" },
					language: { type: "string", description: "Programming language" },
				},
				required: ["path"],
			},
		},
		{
			name: "find_patterns",
			description: "Find design patterns in codebase",
			parameters: {
				type: "object",
				properties: {
					directory: { type: "string", description: "Root directory" },
				},
			},
		},
	],
	excludeTools: ["WebBrowser", "CodeExec"],
}, null, "\t");

const SAMPLE_GEMINI_MINIMAL = JSON.stringify({
	name: "simple-ext",
	version: "0.1.0",
	mcpServers: {},
});

const SAMPLE_VIDHYA_SKILL = `---
name: file-reader
version: 1.2.0
description: Read files from the local filesystem with encoding detection.
author: chitragupta-team
tags: [filesystem, io, read]
source:
  type: tool
  toolName: read_file
updatedAt: 2025-01-15T10:00:00Z
---

## Capabilities

### read / files
Read the contents of a file at the given absolute path.

**Parameters:**
- \`path\` (string, required): Absolute path to the file to read.
- \`encoding\` (string, default utf-8): Character encoding to use.

### list / directory
List all files in a directory.

## Examples

### Read a TypeScript source file
- **input**: \`{"path": "/src/index.ts"}\`
- **output**: The full contents of the file as a UTF-8 string.

## Anti-Patterns
- Do not use for binary files like images or executables
- Not suitable for reading remote URLs or HTTP resources
`;

// ─── Format Detection ───────────────────────────────────────────────────────

describe("detectFormat", () => {
	it("detects Claude SKILL.md format", () => {
		expect(detectFormat(SAMPLE_CLAUDE_SKILL)).toBe("claude");
	});

	it("detects Claude SKILL.md with disable-model-invocation", () => {
		expect(detectFormat(SAMPLE_CLAUDE_SKILL_MINIMAL)).toBe("claude");
	});

	it("detects Gemini extension JSON format", () => {
		expect(detectFormat(SAMPLE_GEMINI_EXTENSION)).toBe("gemini");
	});

	it("detects Gemini extension with tools", () => {
		expect(detectFormat(SAMPLE_GEMINI_WITH_TOOLS)).toBe("gemini");
	});

	it("detects vidhya skill.md format", () => {
		expect(detectFormat(SAMPLE_VIDHYA_SKILL)).toBe("vidhya");
	});

	it("returns unknown for plain text", () => {
		expect(detectFormat("Just some plain text without any structure.")).toBe("unknown");
	});

	it("returns unknown for invalid JSON", () => {
		expect(detectFormat("{ broken json")).toBe("unknown");
	});

	it("returns unknown for JSON without extension fields", () => {
		const plainJson = JSON.stringify({ name: "foo", data: [1, 2, 3] });
		expect(detectFormat(plainJson)).toBe("unknown");
	});

	it("detects claude for frontmatter with only name", () => {
		const content = `---\nname: my-skill\n---\nSome instructions.`;
		expect(detectFormat(content)).toBe("claude");
	});
});

// ─── Claude Import ──────────────────────────────────────────────────────────

describe("importClaudeSkill", () => {
	it("parses name and description from frontmatter", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		expect(manifest.name).toBe("explain-code");
		expect(manifest.description).toContain("Explains code with visual diagrams");
	});

	it("maps allowed-tools to capabilities with verb=use", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		const useCapabilities = manifest.capabilities.filter((c) => c.verb === "use");
		expect(useCapabilities.length).toBe(3);
		expect(useCapabilities.map((c) => c.object)).toEqual(
			expect.arrayContaining(["read", "grep", "glob"]),
		);
	});

	it("extracts numbered steps as a workflow capability", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		const workflowCap = manifest.capabilities.find((c) => c.verb === "execute");
		expect(workflowCap).toBeDefined();
		expect(workflowCap!.description).toContain("Start with an analogy");
	});

	it("generates tags from description", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		expect(manifest.tags.length).toBeGreaterThan(0);
		expect(manifest.tags).toContain("code");
	});

	it("sets source type to manual with claude:// prefix", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		expect(manifest.source.type).toBe("manual");
		if (manifest.source.type === "manual") {
			expect(manifest.source.filePath).toContain("claude://");
		}
	});

	it("computes a trait vector", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		expect(manifest.traitVector).toBeDefined();
		expect(manifest.traitVector!.length).toBe(128);
	});

	it("handles skill without frontmatter", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_NO_FRONTMATTER);
		expect(manifest.name).toBe("code-reviewer");
		expect(manifest.capabilities.length).toBeGreaterThan(0);
	});

	it("handles deploy skill with disable-model-invocation", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_SKILL_MINIMAL);
		expect(manifest.name).toBe("deploy");
		expect(manifest.description).toContain("Deploy the application");
	});

	it("sets version to 1.0.0 by default", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		expect(manifest.version).toBe("1.0.0");
	});

	it("sets updatedAt to a valid ISO string", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		expect(() => new Date(manifest.updatedAt)).not.toThrow();
	});
});

// ─── Claude Export ──────────────────────────────────────────────────────────

describe("exportClaudeSkill", () => {
	const sampleManifest: SkillManifest = {
		name: "test-skill",
		version: "1.0.0",
		description: "A test skill for verification.",
		capabilities: [
			{
				verb: "use",
				object: "read",
				description: "Use the Read tool.",
			},
			{
				verb: "analyze",
				object: "code",
				description: "Analyze source code for quality issues.",
				parameters: {
					path: { type: "string", description: "File path", required: true },
				},
			},
		],
		examples: [
			{
				description: "Analyze a module",
				input: { path: "/src/index.ts" },
				output: "Quality report for the module.",
			},
		],
		tags: ["testing", "code"],
		source: { type: "tool", toolName: "test_runner" },
		antiPatterns: ["Not for production deployment"],
		updatedAt: "2025-06-01T12:00:00Z",
	};

	it("produces valid SKILL.md with frontmatter", () => {
		const md = exportClaudeSkill(sampleManifest);
		expect(md).toContain("---");
		expect(md).toContain("name: test-skill");
		expect(md).toContain("description: A test skill for verification.");
	});

	it("maps use capabilities to allowed-tools", () => {
		const md = exportClaudeSkill(sampleManifest);
		expect(md).toContain("allowed-tools: Read");
	});

	it("renders non-use capabilities as numbered steps", () => {
		const md = exportClaudeSkill(sampleManifest);
		expect(md).toContain("1. **Analyze code**:");
	});

	it("renders parameters as sub-items", () => {
		const md = exportClaudeSkill(sampleManifest);
		expect(md).toContain("`path`");
		expect(md).toContain("(required)");
	});

	it("includes examples section", () => {
		const md = exportClaudeSkill(sampleManifest);
		expect(md).toContain("## Examples");
		expect(md).toContain("### Analyze a module");
		expect(md).toContain("```json");
	});

	it("renders antiPatterns as Limitations section", () => {
		const md = exportClaudeSkill(sampleManifest);
		expect(md).toContain("## Limitations");
		expect(md).toContain("Not for production deployment");
	});
});

// ─── Claude Round-Trip ──────────────────────────────────────────────────────

describe("Claude round-trip", () => {
	it("import -> export preserves name and description", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		const exported = exportClaudeSkill(manifest);
		const reimported = importClaudeSkill(exported);

		expect(reimported.name).toBe(manifest.name);
		expect(reimported.description).toBe(manifest.description);
	});

	it("import -> export preserves allowed-tools", () => {
		const manifest = importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		const exported = exportClaudeSkill(manifest);

		expect(exported).toContain("allowed-tools:");
		expect(exported).toContain("Read");
		expect(exported).toContain("Grep");
		expect(exported).toContain("Glob");
	});
});

// ─── Gemini Import ──────────────────────────────────────────────────────────

describe("importGeminiExtension", () => {
	it("parses name and version", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_EXTENSION);
		expect(manifest.name).toBe("my-first-extension");
		expect(manifest.version).toBe("1.0.0");
	});

	it("parses description", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_EXTENSION);
		expect(manifest.description).toContain("filesystem helper");
	});

	it("maps mcpServers to capabilities with verb=serve", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_EXTENSION);
		const serveCaps = manifest.capabilities.filter((c) => c.verb === "serve");
		expect(serveCaps.length).toBe(1);
		expect(serveCaps[0].object).toBe("nodeServer");
	});

	it("sets source type to mcp-server when mcpServers present", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_EXTENSION);
		expect(manifest.source.type).toBe("mcp-server");
		if (manifest.source.type === "mcp-server") {
			expect(manifest.source.serverId).toBe("my-first-extension");
		}
	});

	it("maps inline tools to capabilities", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_WITH_TOOLS);
		expect(manifest.capabilities.length).toBe(2);
		// First tool: "analyze_code" -> verb from description "Analyze source code"
		const analyzeCap = manifest.capabilities.find((c) => c.verb === "analyze");
		expect(analyzeCap).toBeDefined();
	});

	it("maps tool parameters to capability parameters", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_WITH_TOOLS);
		const cap = manifest.capabilities[0];
		expect(cap.parameters).toBeDefined();
		expect(cap.parameters!.path).toBeDefined();
		expect(cap.parameters!.path.type).toBe("string");
	});

	it("maps excludeTools to antiPatterns", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_WITH_TOOLS);
		expect(manifest.antiPatterns).toBeDefined();
		expect(manifest.antiPatterns!.length).toBe(2);
		expect(manifest.antiPatterns![0]).toContain("WebBrowser");
	});

	it("adds mcp tag when mcpServers present", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_EXTENSION);
		expect(manifest.tags).toContain("mcp");
	});

	it("adds tools tag when tools present", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_WITH_TOOLS);
		expect(manifest.tags).toContain("tools");
	});

	it("computes a trait vector", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_EXTENSION);
		expect(manifest.traitVector).toBeDefined();
		expect(manifest.traitVector!.length).toBe(128);
	});

	it("throws on invalid JSON", () => {
		expect(() => importGeminiExtension("not json")).toThrow();
	});

	it("throws on missing name", () => {
		expect(() => importGeminiExtension(JSON.stringify({ version: "1.0" }))).toThrow(
			"missing 'name' field",
		);
	});

	it("defaults version to 1.0.0 when missing", () => {
		const json = JSON.stringify({ name: "test", mcpServers: {} });
		const manifest = importGeminiExtension(json);
		expect(manifest.version).toBe("1.0.0");
	});

	it("generates description when missing", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_MINIMAL);
		expect(manifest.description).toContain("simple-ext");
	});
});

// ─── Gemini Export ──────────────────────────────────────────────────────────

describe("exportGeminiExtension", () => {
	const sampleManifest: SkillManifest = {
		name: "test-extension",
		version: "2.0.0",
		description: "Test extension for Gemini CLI.",
		capabilities: [
			{
				verb: "serve",
				object: "testServer",
				description: "MCP server: node dist/server.js",
				parameters: {
					command: { type: "string", description: "Command", required: true },
				},
			},
			{
				verb: "analyze",
				object: "code",
				description: "Analyze source code quality.",
			},
		],
		tags: ["test", "mcp"],
		source: { type: "mcp-server", serverId: "test", serverName: "testServer" },
		antiPatterns: ["Do not use the WebBrowser tool"],
		updatedAt: "2025-06-01T12:00:00Z",
	};

	it("produces valid JSON", () => {
		const json = exportGeminiExtension(sampleManifest);
		expect(() => JSON.parse(json)).not.toThrow();
	});

	it("includes name and version", () => {
		const parsed = JSON.parse(exportGeminiExtension(sampleManifest));
		expect(parsed.name).toBe("test-extension");
		expect(parsed.version).toBe("2.0.0");
	});

	it("maps serve capabilities to mcpServers", () => {
		const parsed = JSON.parse(exportGeminiExtension(sampleManifest));
		expect(parsed.mcpServers).toBeDefined();
		expect(parsed.mcpServers.testServer).toBeDefined();
		expect(parsed.mcpServers.testServer.command).toBe("node");
	});

	it("maps non-serve capabilities to tools", () => {
		const parsed = JSON.parse(exportGeminiExtension(sampleManifest));
		expect(parsed.tools).toBeDefined();
		expect(parsed.tools.length).toBe(1);
		expect(parsed.tools[0].name).toBe("analyze_code");
	});

	it("maps antiPatterns to excludeTools", () => {
		const parsed = JSON.parse(exportGeminiExtension(sampleManifest));
		expect(parsed.excludeTools).toBeDefined();
		expect(parsed.excludeTools).toContain("WebBrowser");
	});
});

// ─── Gemini Round-Trip ──────────────────────────────────────────────────────

describe("Gemini round-trip", () => {
	it("import -> export preserves name and version", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_EXTENSION);
		const exported = exportGeminiExtension(manifest);
		const parsed = JSON.parse(exported);

		expect(parsed.name).toBe("my-first-extension");
		expect(parsed.version).toBe("1.0.0");
	});

	it("import -> export preserves mcpServers", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_EXTENSION);
		const exported = exportGeminiExtension(manifest);
		const parsed = JSON.parse(exported);

		expect(parsed.mcpServers).toBeDefined();
		expect(parsed.mcpServers.nodeServer).toBeDefined();
	});

	it("import -> export preserves excludeTools", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_WITH_TOOLS);
		const exported = exportGeminiExtension(manifest);
		const parsed = JSON.parse(exported);

		expect(parsed.excludeTools).toContain("WebBrowser");
		expect(parsed.excludeTools).toContain("CodeExec");
	});
});

// ─── Cross-Format Conversion ────────────────────────────────────────────────

describe("convert", () => {
	it("converts Claude to vidhya", () => {
		const vidhya = convert(SAMPLE_CLAUDE_SKILL, "vidhya");
		expect(vidhya).toContain("---");
		expect(vidhya).toContain("name: explain-code");
		expect(vidhya).toContain("## Capabilities");
	});

	it("converts Claude to gemini", () => {
		const gemini = convert(SAMPLE_CLAUDE_SKILL, "gemini");
		const parsed = JSON.parse(gemini);
		expect(parsed.name).toBe("explain-code");
		expect(parsed.description).toContain("Explains code");
	});

	it("converts Gemini to vidhya", () => {
		const vidhya = convert(SAMPLE_GEMINI_EXTENSION, "vidhya");
		expect(vidhya).toContain("---");
		expect(vidhya).toContain("name: my-first-extension");
	});

	it("converts Gemini to claude", () => {
		const claude = convert(SAMPLE_GEMINI_EXTENSION, "claude");
		expect(claude).toContain("---");
		expect(claude).toContain("name: my-first-extension");
	});

	it("converts vidhya to claude", () => {
		const claude = convert(SAMPLE_VIDHYA_SKILL, "claude");
		expect(claude).toContain("---");
		expect(claude).toContain("name: file-reader");
	});

	it("converts vidhya to gemini", () => {
		const gemini = convert(SAMPLE_VIDHYA_SKILL, "gemini");
		const parsed = JSON.parse(gemini);
		expect(parsed.name).toBe("file-reader");
		expect(parsed.version).toBe("1.2.0");
	});

	it("returns content unchanged when source equals target", () => {
		const result = convert(SAMPLE_CLAUDE_SKILL, "claude");
		expect(result).toBe(SAMPLE_CLAUDE_SKILL);
	});

	it("throws on unknown format", () => {
		expect(() => convert("random text content", "vidhya")).toThrow("cannot detect");
	});
});

// ─── SkillPorter Class ──────────────────────────────────────────────────────

describe("SkillPorter class", () => {
	const porter = new SkillPorter();

	it("detectFormat delegates correctly", () => {
		expect(porter.detectFormat(SAMPLE_CLAUDE_SKILL)).toBe("claude");
		expect(porter.detectFormat(SAMPLE_GEMINI_EXTENSION)).toBe("gemini");
		expect(porter.detectFormat(SAMPLE_VIDHYA_SKILL)).toBe("vidhya");
	});

	it("importClaudeSkill returns a valid manifest", () => {
		const manifest = porter.importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		expect(manifest.name).toBe("explain-code");
		expect(manifest.capabilities.length).toBeGreaterThan(0);
	});

	it("exportClaudeSkill produces valid SKILL.md", () => {
		const manifest = porter.importClaudeSkill(SAMPLE_CLAUDE_SKILL);
		const md = porter.exportClaudeSkill(manifest);
		expect(md).toContain("---");
		expect(md).toContain("name:");
	});

	it("importGeminiExtension returns a valid manifest", () => {
		const manifest = porter.importGeminiExtension(SAMPLE_GEMINI_EXTENSION);
		expect(manifest.name).toBe("my-first-extension");
	});

	it("exportGeminiExtension produces valid JSON", () => {
		const manifest = porter.importGeminiExtension(SAMPLE_GEMINI_EXTENSION);
		const json = porter.exportGeminiExtension(manifest);
		expect(() => JSON.parse(json)).not.toThrow();
	});

	it("convert auto-detects and converts", () => {
		const result = porter.convert(SAMPLE_CLAUDE_SKILL, "gemini");
		const parsed = JSON.parse(result);
		expect(parsed.name).toBe("explain-code");
	});
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe("edge cases", () => {
	it("handles empty capabilities list", () => {
		const manifest: SkillManifest = {
			name: "empty-skill",
			version: "1.0.0",
			description: "A skill with no capabilities.",
			capabilities: [],
			tags: [],
			source: { type: "manual", filePath: "/test" },
			updatedAt: "2025-01-01T00:00:00Z",
		};

		const claude = exportClaudeSkill(manifest);
		expect(claude).toContain("name: empty-skill");
		// Should fallback to description as body
		expect(claude).toContain("A skill with no capabilities.");

		const gemini = exportGeminiExtension(manifest);
		const parsed = JSON.parse(gemini);
		expect(parsed.name).toBe("empty-skill");
	});

	it("handles skill with no tools", () => {
		const manifest: SkillManifest = {
			name: "no-tools",
			version: "1.0.0",
			description: "Background knowledge skill.",
			capabilities: [
				{
					verb: "explain",
					object: "architecture",
					description: "Explain the system architecture.",
				},
			],
			tags: [],
			source: { type: "manual", filePath: "/test" },
			updatedAt: "2025-01-01T00:00:00Z",
		};

		const claude = exportClaudeSkill(manifest);
		expect(claude).not.toContain("allowed-tools:");
	});

	it("handles Claude skill with examples section", () => {
		const claude = `---
name: test-with-examples
description: A skill with examples
---

Do something useful.

## Examples

### First example
\`\`\`json
{"key": "value1"}
\`\`\`
**Expected output**: Result 1

### Second example
\`\`\`json
{"key": "value2"}
\`\`\`
**Expected output**: Result 2
`;

		const manifest = importClaudeSkill(claude);
		expect(manifest.examples).toBeDefined();
		expect(manifest.examples!.length).toBe(2);
		expect(manifest.examples![0].description).toBe("First example");
		expect(manifest.examples![0].input).toEqual({ key: "value1" });
		expect(manifest.examples![0].output).toBe("Result 1");
	});

	it("handles Gemini extension with empty mcpServers", () => {
		const manifest = importGeminiExtension(SAMPLE_GEMINI_MINIMAL);
		expect(manifest.name).toBe("simple-ext");
		expect(manifest.capabilities.length).toBeGreaterThan(0);
	});

	it("handles description with special characters in Claude export", () => {
		const manifest: SkillManifest = {
			name: "special-chars",
			version: "1.0.0",
			description: 'Handles "quotes" and colons: properly',
			capabilities: [],
			tags: [],
			source: { type: "manual", filePath: "/test" },
			updatedAt: "2025-01-01T00:00:00Z",
		};

		const claude = exportClaudeSkill(manifest);
		expect(claude).toContain("description:");
	});

	it("handles very long description in tag generation", () => {
		const longDesc = "This skill can read write search and analyze code files in a filesystem with git support for multiple web api endpoints and database connections through a network shell terminal session with config json yaml markdown formatting and test build deploy lint review debug refactor documentation";

		const manifest = importClaudeSkill(`---
name: mega-skill
description: ${longDesc}
---

Just a test.
`);

		// Should have many tags from domain keywords
		expect(manifest.tags.length).toBeGreaterThan(5);
	});
});
