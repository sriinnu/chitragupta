import { describe, it, expect } from "vitest";
import {
	parseSkillMarkdown,
	parseFrontmatter,
	parseCapabilitiesSection,
	parseExamplesSection,
} from "../src/parser.js";
import { writeSkillMarkdown, writeFrontmatter } from "../src/writer.js";
import type { SkillManifest } from "../src/types.js";

// ─── Sample skill.md Content ────────────────────────────────────────────────

const SAMPLE_SKILL_MD = `---
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
- \`lineRange\` (string): Optional line range like "10-50".

### list / directory
List all files in a directory.

## Examples

### Read a TypeScript source file
- **input**: \`{"path": "/src/index.ts"}\`
- **output**: The full contents of the file as a UTF-8 string.

### Read with line range
- **input**: \`{"path": "/src/parser.ts", "lineRange": "1-20"}\`
- **output**: The first 20 lines of the file.

## Anti-Patterns
- Do not use for binary files like images or executables
- Not suitable for reading remote URLs or HTTP resources
`;

// ─── Round-Trip ─────────────────────────────────────────────────────────────

describe("parser + writer — round-trip", () => {
	it("parse -> write -> parse produces equivalent data", () => {
		const manifest1 = parseSkillMarkdown(SAMPLE_SKILL_MD);
		const written = writeSkillMarkdown(manifest1);
		const manifest2 = parseSkillMarkdown(written);

		expect(manifest2.name).toBe(manifest1.name);
		expect(manifest2.version).toBe(manifest1.version);
		expect(manifest2.description).toBe(manifest1.description);
		expect(manifest2.author).toBe(manifest1.author);
		expect(manifest2.tags).toEqual(manifest1.tags);
		expect(manifest2.source).toEqual(manifest1.source);

		// Capabilities should match
		expect(manifest2.capabilities.length).toBe(manifest1.capabilities.length);
		for (let i = 0; i < manifest1.capabilities.length; i++) {
			expect(manifest2.capabilities[i].verb).toBe(manifest1.capabilities[i].verb);
			expect(manifest2.capabilities[i].object).toBe(manifest1.capabilities[i].object);
		}

		// Examples should match
		expect(manifest2.examples?.length).toBe(manifest1.examples?.length);

		// Anti-patterns should match
		expect(manifest2.antiPatterns).toEqual(manifest1.antiPatterns);
	});
});

// ─── Frontmatter Parsing ────────────────────────────────────────────────────

describe("parseFrontmatter", () => {
	it("correctly extracts all YAML fields", () => {
		const yaml = `name: file-reader
version: 1.2.0
description: Read files from disk.
tags: [filesystem, io, read]
source:
  type: tool
  toolName: read_file`;

		const result = parseFrontmatter(yaml);
		expect(result.name).toBe("file-reader");
		expect(result.version).toBe("1.2.0");
		expect(result.description).toBe("Read files from disk.");
		expect(result.tags).toEqual(["filesystem", "io", "read"]);
		expect((result.source as Record<string, unknown>).type).toBe("tool");
		expect((result.source as Record<string, unknown>).toolName).toBe("read_file");
	});

	it("handles quoted strings", () => {
		const yaml = `name: "my-skill"
description: 'A skill with colons: and special chars'`;

		const result = parseFrontmatter(yaml);
		expect(result.name).toBe("my-skill");
		expect(result.description).toBe("A skill with colons: and special chars");
	});

	it("handles boolean and null values", () => {
		const yaml = `enabled: true
disabled: false
nothing: null`;

		const result = parseFrontmatter(yaml);
		expect(result.enabled).toBe(true);
		expect(result.disabled).toBe(false);
		expect(result.nothing).toBe(null);
	});

	it("handles numeric values", () => {
		const yaml = `count: 42
ratio: 3.14`;

		const result = parseFrontmatter(yaml);
		expect(result.count).toBe(42);
		expect(result.ratio).toBe(3.14);
	});

	it("handles empty arrays", () => {
		const yaml = `tags: []`;
		const result = parseFrontmatter(yaml);
		expect(result.tags).toEqual([]);
	});

	it("skips comments and empty lines", () => {
		const yaml = `# This is a comment
name: test

# Another comment
version: 1.0.0`;

		const result = parseFrontmatter(yaml);
		expect(result.name).toBe("test");
		expect(result.version).toBe("1.0.0");
	});
});

// ─── Capabilities Section ───────────────────────────────────────────────────

describe("parseCapabilitiesSection", () => {
	it("parses verb/object/description/parameters from markdown", () => {
		const markdown = `
## Capabilities

### read / files
Read the contents of a file at the given path.

**Parameters:**
- \`path\` (string, required): Absolute path to the file.
- \`encoding\` (string, default utf-8): Character encoding.
`;

		const capabilities = parseCapabilitiesSection(markdown);
		expect(capabilities.length).toBe(1);
		expect(capabilities[0].verb).toBe("read");
		expect(capabilities[0].object).toBe("files");
		expect(capabilities[0].description).toContain("Read the contents");

		const params = capabilities[0].parameters!;
		expect(params.path.type).toBe("string");
		expect(params.path.required).toBe(true);
		expect(params.encoding.type).toBe("string");
		expect(params.encoding.default).toBe("utf-8");
	});

	it("returns empty array when no capabilities section exists", () => {
		const markdown = `## Examples\n### Some example\nJust text.`;
		const capabilities = parseCapabilitiesSection(markdown);
		expect(capabilities.length).toBe(0);
	});

	it("parses multiple capabilities", () => {
		const markdown = `
## Capabilities

### read / files
Read file contents.

### write / files
Write to a file.

### delete / files
Delete a file.
`;

		const capabilities = parseCapabilitiesSection(markdown);
		expect(capabilities.length).toBe(3);
		expect(capabilities[0].verb).toBe("read");
		expect(capabilities[1].verb).toBe("write");
		expect(capabilities[2].verb).toBe("delete");
	});
});

// ─── Examples Section ───────────────────────────────────────────────────────

describe("parseExamplesSection", () => {
	it("parses description/input/output from markdown", () => {
		const markdown = `
## Examples

### Read a configuration file
- **input**: \`{"path": "/etc/config.json"}\`
- **output**: The JSON contents of the configuration.
`;

		const examples = parseExamplesSection(markdown);
		expect(examples.length).toBe(1);
		expect(examples[0].description).toBe("Read a configuration file");
		expect(examples[0].input).toEqual({ path: "/etc/config.json" });
		expect(examples[0].output).toBe("The JSON contents of the configuration.");
	});

	it("returns empty array when no examples section exists", () => {
		const markdown = `## Capabilities\n### verb / object\nSome capability.`;
		const examples = parseExamplesSection(markdown);
		expect(examples.length).toBe(0);
	});

	it("handles multiple examples", () => {
		const markdown = `
## Examples

### First example
- **input**: \`{"key": "value1"}\`
- **output**: Result 1

### Second example
- **input**: \`{"key": "value2"}\`
- **output**: Result 2
`;

		const examples = parseExamplesSection(markdown);
		expect(examples.length).toBe(2);
		expect(examples[0].description).toBe("First example");
		expect(examples[1].description).toBe("Second example");
	});
});

// ─── Anti-Patterns ──────────────────────────────────────────────────────────

describe("parseSkillMarkdown — anti-patterns", () => {
	it("parses anti-patterns from markdown list", () => {
		const manifest = parseSkillMarkdown(SAMPLE_SKILL_MD);
		expect(manifest.antiPatterns).toBeDefined();
		expect(manifest.antiPatterns!.length).toBe(2);
		expect(manifest.antiPatterns![0]).toContain("binary files");
		expect(manifest.antiPatterns![1]).toContain("remote URLs");
	});
});

// ─── Malformed Input ────────────────────────────────────────────────────────

describe("parseSkillMarkdown — malformed input", () => {
	it("throws on missing frontmatter delimiters", () => {
		const noFrontmatter = `name: test\n## Capabilities`;
		expect(() => parseSkillMarkdown(noFrontmatter)).toThrow();
	});

	it("handles missing optional sections gracefully", () => {
		const minimalMd = `---
name: bare-skill
version: 0.1.0
description: A skill with no capabilities or examples.
tags: []
source:
  type: manual
  filePath: /skills/bare.md
updatedAt: 2025-01-01T00:00:00Z
---
`;

		const manifest = parseSkillMarkdown(minimalMd);
		expect(manifest.name).toBe("bare-skill");
		expect(manifest.capabilities.length).toBe(0);
		expect(manifest.examples).toBeUndefined();
		expect(manifest.antiPatterns).toBeUndefined();
	});

	it("handles all source types", () => {
		const mcpMd = `---
name: mcp-skill
version: 1.0.0
description: From MCP server.
tags: []
source:
  type: mcp-server
  serverId: srv-1
  serverName: filesystem
updatedAt: 2025-01-01T00:00:00Z
---
`;

		const manifest = parseSkillMarkdown(mcpMd);
		expect(manifest.source.type).toBe("mcp-server");
		if (manifest.source.type === "mcp-server") {
			expect(manifest.source.serverId).toBe("srv-1");
			expect(manifest.source.serverName).toBe("filesystem");
		}
	});
});

// ─── writeFrontmatter ───────────────────────────────────────────────────────

describe("writeFrontmatter", () => {
	it("serializes scalars correctly", () => {
		const yaml = writeFrontmatter({ name: "test", version: "1.0.0", count: 42, enabled: true });
		expect(yaml).toContain("name: test");
		expect(yaml).toContain("count: 42");
		expect(yaml).toContain("enabled: true");
	});

	it("serializes inline arrays", () => {
		const yaml = writeFrontmatter({ tags: ["a", "b", "c"] });
		expect(yaml).toContain("tags: [a, b, c]");
	});

	it("serializes nested objects with indentation", () => {
		const yaml = writeFrontmatter({ source: { type: "tool", toolName: "read_file" } });
		expect(yaml).toContain("source:");
		expect(yaml).toContain("  type: tool");
		expect(yaml).toContain("  toolName: read_file");
	});

	it("skips undefined values", () => {
		const yaml = writeFrontmatter({ name: "test", author: undefined });
		expect(yaml).not.toContain("author");
	});

	it("handles null values", () => {
		const yaml = writeFrontmatter({ value: null });
		expect(yaml).toContain("value: null");
	});

	it("quotes strings with special characters", () => {
		const yaml = writeFrontmatter({ desc: "has: colon and [brackets]" });
		expect(yaml).toContain('"');
	});
});

// ─── writeSkillMarkdown ─────────────────────────────────────────────────────

describe("writeSkillMarkdown", () => {
	it("produces a complete skill.md with all sections", () => {
		const manifest: SkillManifest = {
			name: "test-skill",
			version: "1.0.0",
			description: "A test skill for verification.",
			author: "tester",
			capabilities: [
				{
					verb: "test",
					object: "things",
					description: "Run tests on things.",
					parameters: {
						target: { type: "string", description: "What to test", required: true },
					},
				},
			],
			examples: [
				{
					description: "Test a module",
					input: { target: "parser" },
					output: "All tests passed.",
				},
			],
			tags: ["testing", "verification"],
			source: { type: "tool", toolName: "test_runner" },
			antiPatterns: ["Not for production deployment"],
			updatedAt: "2025-06-01T12:00:00Z",
		};

		const md = writeSkillMarkdown(manifest);
		expect(md).toContain("---");
		expect(md).toContain("name: test-skill");
		expect(md).toContain("## Capabilities");
		expect(md).toContain("### test / things");
		expect(md).toContain("**Parameters:**");
		expect(md).toContain("## Examples");
		expect(md).toContain("### Test a module");
		expect(md).toContain("## Anti-Patterns");
		expect(md).toContain("Not for production deployment");
	});
});
