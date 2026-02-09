import { describe, it, expect } from "vitest";
import {
	parseFrontmatter,
	parseCapabilitiesSection,
	parseExamplesSection,
	parseSkillMarkdown,
} from "@chitragupta/vidhya-skills";

// ─── parseFrontmatter ────────────────────────────────────────────────────────

describe("parseFrontmatter", () => {
	it("should parse simple key-value pairs", () => {
		const result = parseFrontmatter("name: my-skill\nversion: 1.0.0");
		expect(result.name).toBe("my-skill");
		expect(result.version).toBe("1.0.0");
	});

	it("should parse numbers", () => {
		const result = parseFrontmatter("count: 42\nprice: 3.14");
		expect(result.count).toBe(42);
		expect(result.price).toBe(3.14);
	});

	it("should parse booleans", () => {
		const result = parseFrontmatter("enabled: true\nactive: false");
		expect(result.enabled).toBe(true);
		expect(result.active).toBe(false);
	});

	it("should parse null", () => {
		const result = parseFrontmatter("value: null\nother: ~");
		expect(result.value).toBeNull();
		expect(result.other).toBeNull();
	});

	it("should parse inline arrays", () => {
		const result = parseFrontmatter("tags: [a, b, c]");
		expect(result.tags).toEqual(["a", "b", "c"]);
	});

	it("should parse empty inline array", () => {
		const result = parseFrontmatter("tags: []");
		expect(result.tags).toEqual([]);
	});

	it("should parse quoted strings", () => {
		const result = parseFrontmatter('name: "hello world"\nother: \'single\'');
		expect(result.name).toBe("hello world");
		expect(result.other).toBe("single");
	});

	it("should parse nested objects", () => {
		const result = parseFrontmatter("source:\n  type: tool\n  toolName: read_file");
		expect(result.source).toEqual({ type: "tool", toolName: "read_file" });
	});

	it("should skip empty lines and comments", () => {
		const result = parseFrontmatter("name: test\n\n# This is a comment\nversion: 1");
		expect(result.name).toBe("test");
		expect(result.version).toBe(1);
	});

	it("should handle mixed arrays with numbers", () => {
		const result = parseFrontmatter("dims: [1, 2, 3]");
		expect(result.dims).toEqual([1, 2, 3]);
	});
});

// ─── parseCapabilitiesSection ────────────────────────────────────────────────

describe("parseCapabilitiesSection", () => {
	it("should return empty array when no Capabilities section", () => {
		expect(parseCapabilitiesSection("## Other\nsome text")).toEqual([]);
	});

	it("should parse verb/object from heading", () => {
		const md = `## Capabilities\n### read / file\nReads a file from disk.\n`;
		const caps = parseCapabilitiesSection(md);
		expect(caps).toHaveLength(1);
		expect(caps[0].verb).toBe("read");
		expect(caps[0].object).toBe("file");
		expect(caps[0].description).toBe("Reads a file from disk.");
	});

	it("should parse parameters", () => {
		const md = `## Capabilities
### write / file
Write content to a file.

**Parameters:**
- \`path\` (string, required): File path
- \`content\` (string): File content
`;
		const caps = parseCapabilitiesSection(md);
		expect(caps).toHaveLength(1);
		expect(caps[0].parameters).toBeDefined();
		expect(caps[0].parameters!.path.type).toBe("string");
		expect(caps[0].parameters!.path.required).toBe(true);
		expect(caps[0].parameters!.content.required).toBeUndefined();
	});

	it("should parse multiple capabilities", () => {
		const md = `## Capabilities
### read / file
Read a file.
### write / file
Write a file.
### delete / file
Delete a file.
`;
		const caps = parseCapabilitiesSection(md);
		expect(caps).toHaveLength(3);
		expect(caps[0].verb).toBe("read");
		expect(caps[1].verb).toBe("write");
		expect(caps[2].verb).toBe("delete");
	});

	it("should skip headings without slash separator", () => {
		const md = `## Capabilities\n### invalid heading\nSome text.\n`;
		const caps = parseCapabilitiesSection(md);
		expect(caps).toHaveLength(0);
	});
});

// ─── parseExamplesSection ────────────────────────────────────────────────────

describe("parseExamplesSection", () => {
	it("should return empty array when no Examples section", () => {
		expect(parseExamplesSection("## Other\nsome text")).toEqual([]);
	});

	it("should parse example with input and output", () => {
		const md = `## Examples
### Read a config file
- **input**: \`{"path": "/etc/config.json"}\`
- **output**: Returns the file contents
`;
		const examples = parseExamplesSection(md);
		expect(examples).toHaveLength(1);
		expect(examples[0].description).toBe("Read a config file");
		expect(examples[0].input).toEqual({ path: "/etc/config.json" });
		expect(examples[0].output).toBe("Returns the file contents");
	});

	it("should handle invalid JSON input gracefully", () => {
		const md = `## Examples
### Bad input
- **input**: \`not valid json\`
`;
		const examples = parseExamplesSection(md);
		expect(examples).toHaveLength(1);
		expect(examples[0].input).toEqual({ raw: "not valid json" });
	});

	it("should parse multiple examples", () => {
		const md = `## Examples
### Example one
- **input**: \`{"a": 1}\`
### Example two
- **input**: \`{"b": 2}\`
`;
		const examples = parseExamplesSection(md);
		expect(examples).toHaveLength(2);
	});
});

// ─── parseSkillMarkdown ──────────────────────────────────────────────────────

describe("parseSkillMarkdown", () => {
	const FULL_SKILL = `---
name: file-reader
version: 1.2.0
description: Reads files from the filesystem
author: Chitragupta
tags: [file, read, io]
source:
  type: tool
  toolName: read_file
updatedAt: 2025-01-15T00:00:00Z
---

## Capabilities

### read / file
Read a file from disk.

**Parameters:**
- \`path\` (string, required): Path to the file

## Examples

### Read a JSON file
- **input**: \`{"path": "config.json"}\`
- **output**: The JSON content

## Anti-Patterns
- Do not read binary files
- Do not read very large files
`;

	it("should parse a complete skill.md file", () => {
		const manifest = parseSkillMarkdown(FULL_SKILL);
		expect(manifest.name).toBe("file-reader");
		expect(manifest.version).toBe("1.2.0");
		expect(manifest.description).toBe("Reads files from the filesystem");
		expect(manifest.author).toBe("Chitragupta");
		expect(manifest.tags).toEqual(["file", "read", "io"]);
	});

	it("should parse source correctly", () => {
		const manifest = parseSkillMarkdown(FULL_SKILL);
		expect(manifest.source).toEqual({ type: "tool", toolName: "read_file" });
	});

	it("should parse capabilities", () => {
		const manifest = parseSkillMarkdown(FULL_SKILL);
		expect(manifest.capabilities).toHaveLength(1);
		expect(manifest.capabilities[0].verb).toBe("read");
		expect(manifest.capabilities[0].object).toBe("file");
	});

	it("should parse examples", () => {
		const manifest = parseSkillMarkdown(FULL_SKILL);
		expect(manifest.examples).toHaveLength(1);
		expect(manifest.examples![0].description).toBe("Read a JSON file");
	});

	it("should parse anti-patterns", () => {
		const manifest = parseSkillMarkdown(FULL_SKILL);
		expect(manifest.antiPatterns).toHaveLength(2);
		expect(manifest.antiPatterns![0]).toBe("Do not read binary files");
	});

	it("should throw on missing frontmatter delimiters", () => {
		expect(() => parseSkillMarkdown("no frontmatter here")).toThrow("missing YAML frontmatter");
	});

	it("should handle mcp-server source type", () => {
		const md = `---
name: mcp-tool
version: 0.1.0
description: test
tags: []
source:
  type: mcp-server
  serverId: srv-1
  serverName: Test Server
updatedAt: 2025-01-01
---
`;
		const manifest = parseSkillMarkdown(md);
		expect(manifest.source).toEqual({
			type: "mcp-server",
			serverId: "srv-1",
			serverName: "Test Server",
		});
	});

	it("should handle plugin source type", () => {
		const md = `---
name: plugin-tool
version: 0.1.0
description: test
tags: []
source:
  type: plugin
  pluginName: my-plugin
updatedAt: 2025-01-01
---
`;
		const manifest = parseSkillMarkdown(md);
		expect(manifest.source).toEqual({ type: "plugin", pluginName: "my-plugin" });
	});

	it("should handle manual source type (default)", () => {
		const md = `---
name: manual-tool
version: 0.1.0
description: test
tags: []
source:
  type: manual
  filePath: /path/to/skill.md
updatedAt: 2025-01-01
---
`;
		const manifest = parseSkillMarkdown(md);
		expect(manifest.source).toEqual({ type: "manual", filePath: "/path/to/skill.md" });
	});

	it("should default to empty tags when not array", () => {
		const md = `---
name: test
version: 0.1.0
description: test
tags: not-an-array
source:
  type: tool
  toolName: x
updatedAt: 2025-01-01
---
`;
		const manifest = parseSkillMarkdown(md);
		expect(manifest.tags).toEqual([]);
	});
});
