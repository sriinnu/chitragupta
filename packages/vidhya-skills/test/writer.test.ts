import { describe, it, expect } from "vitest";
import { writeFrontmatter, writeSkillMarkdown } from "@chitragupta/vidhya-skills";
import { parseSkillMarkdown } from "@chitragupta/vidhya-skills";
import type { SkillManifest } from "@chitragupta/vidhya-skills";

// ─── writeFrontmatter ────────────────────────────────────────────────────────

describe("writeFrontmatter", () => {
	it("should write simple key-value pairs", () => {
		const result = writeFrontmatter({ name: "test", version: "1.0.0" });
		expect(result).toContain("name: test");
		expect(result).toContain("version: 1.0.0");
	});

	it("should write numbers", () => {
		const result = writeFrontmatter({ count: 42, pi: 3.14 });
		expect(result).toContain("count: 42");
		expect(result).toContain("pi: 3.14");
	});

	it("should write booleans", () => {
		const result = writeFrontmatter({ enabled: true, disabled: false });
		expect(result).toContain("enabled: true");
		expect(result).toContain("disabled: false");
	});

	it("should write null values", () => {
		const result = writeFrontmatter({ value: null });
		expect(result).toContain("value: null");
	});

	it("should skip undefined values", () => {
		const result = writeFrontmatter({ name: "test", gone: undefined });
		expect(result).toContain("name: test");
		expect(result).not.toContain("gone");
	});

	it("should write inline arrays", () => {
		const result = writeFrontmatter({ tags: ["a", "b", "c"] });
		expect(result).toContain("tags: [a, b, c]");
	});

	it("should write empty arrays", () => {
		const result = writeFrontmatter({ items: [] });
		expect(result).toContain("items: []");
	});

	it("should write nested objects", () => {
		const result = writeFrontmatter({ source: { type: "tool", name: "read" } });
		expect(result).toContain("source:");
		expect(result).toContain("  type: tool");
		expect(result).toContain("  name: read");
	});

	it("should quote strings with special characters", () => {
		const result = writeFrontmatter({ desc: "has: colon" });
		expect(result).toContain('"has: colon"');
	});

	it("should quote empty strings", () => {
		const result = writeFrontmatter({ empty: "" });
		expect(result).toContain('empty: ""');
	});

	it("should quote strings that look like numbers", () => {
		const result = writeFrontmatter({ version: "1.0" });
		expect(result).toContain('"1.0"');
	});

	it("should quote strings that look like booleans", () => {
		const result = writeFrontmatter({ val: "true" });
		expect(result).toContain('"true"');
	});
});

// ─── writeSkillMarkdown ──────────────────────────────────────────────────────

describe("writeSkillMarkdown", () => {
	const MANIFEST: SkillManifest = {
		name: "file-reader",
		version: "1.0.0",
		description: "Reads files",
		author: "Chitragupta",
		tags: ["file", "read"],
		source: { type: "tool", toolName: "read_file" },
		capabilities: [
			{
				verb: "read",
				object: "file",
				description: "Read a file from disk.",
				parameters: {
					path: { type: "string", description: "File path", required: true },
				},
			},
		],
		examples: [
			{
				description: "Read config",
				input: { path: "config.json" },
				output: "JSON content",
			},
		],
		antiPatterns: ["Do not read binaries"],
		updatedAt: "2025-01-15T00:00:00Z",
	};

	it("should produce valid skill.md format", () => {
		const md = writeSkillMarkdown(MANIFEST);
		expect(md).toContain("---");
		expect(md).toContain("name: file-reader");
		expect(md).toContain("## Capabilities");
		expect(md).toContain("## Examples");
		expect(md).toContain("## Anti-Patterns");
	});

	it("should include frontmatter with all fields", () => {
		const md = writeSkillMarkdown(MANIFEST);
		expect(md).toContain("version: 1.0.0");
		expect(md).toContain("author: Chitragupta");
		expect(md).toContain("tags: [file, read]");
	});

	it("should include capability headings", () => {
		const md = writeSkillMarkdown(MANIFEST);
		expect(md).toContain("### read / file");
		expect(md).toContain("Read a file from disk.");
	});

	it("should include parameters", () => {
		const md = writeSkillMarkdown(MANIFEST);
		expect(md).toContain("`path`");
		expect(md).toContain("string, required");
	});

	it("should include examples", () => {
		const md = writeSkillMarkdown(MANIFEST);
		expect(md).toContain("### Read config");
		expect(md).toContain("**input**:");
		expect(md).toContain("**output**: JSON content");
	});

	it("should include anti-patterns", () => {
		const md = writeSkillMarkdown(MANIFEST);
		expect(md).toContain("- Do not read binaries");
	});

	it("should include source info", () => {
		const md = writeSkillMarkdown(MANIFEST);
		expect(md).toContain("type: tool");
		expect(md).toContain("toolName: read_file");
	});

	it("should omit author when not provided", () => {
		const noAuthor = { ...MANIFEST, author: undefined };
		const md = writeSkillMarkdown(noAuthor);
		expect(md).not.toContain("author:");
	});

	it("should omit examples section when empty", () => {
		const noExamples = { ...MANIFEST, examples: undefined };
		const md = writeSkillMarkdown(noExamples);
		expect(md).not.toContain("## Examples");
	});

	it("should omit anti-patterns section when empty", () => {
		const noAntiPatterns = { ...MANIFEST, antiPatterns: undefined };
		const md = writeSkillMarkdown(noAntiPatterns);
		expect(md).not.toContain("## Anti-Patterns");
	});

	it("should handle mcp-server source", () => {
		const mcpManifest: SkillManifest = {
			...MANIFEST,
			source: { type: "mcp-server", serverId: "srv-1", serverName: "Test" },
		};
		const md = writeSkillMarkdown(mcpManifest);
		expect(md).toContain("type: mcp-server");
		expect(md).toContain("serverId: srv-1");
	});

	it("should handle plugin source", () => {
		const pluginManifest: SkillManifest = {
			...MANIFEST,
			source: { type: "plugin", pluginName: "my-plug" },
		};
		const md = writeSkillMarkdown(pluginManifest);
		expect(md).toContain("type: plugin");
		expect(md).toContain("pluginName: my-plug");
	});

	it("should roundtrip with parser (parse(write(manifest)))", () => {
		const md = writeSkillMarkdown(MANIFEST);
		const parsed = parseSkillMarkdown(md);
		expect(parsed.name).toBe(MANIFEST.name);
		expect(parsed.version).toBe(MANIFEST.version);
		expect(parsed.capabilities).toHaveLength(1);
		expect(parsed.capabilities[0].verb).toBe("read");
		expect(parsed.tags).toEqual(["file", "read"]);
	});
});
