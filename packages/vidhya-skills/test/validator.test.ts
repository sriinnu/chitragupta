import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateSkill, validateSkillMarkdown } from "@chitragupta/vidhya-skills";
import type { SkillManifest } from "@chitragupta/vidhya-skills";

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeValidManifest(overrides?: Partial<SkillManifest>): SkillManifest {
	return {
		name: "test-skill",
		version: "1.0.0",
		description: "A test skill for testing purposes",
		capabilities: [{ verb: "test", object: "code", description: "Tests code" }],
		tags: ["testing"],
		source: { type: "tool", toolName: "test-tool" },
		examples: [{ description: "Test example", input: { query: "test" } }],
		inputSchema: { type: "object" },
		author: "test-author",
		updatedAt: new Date().toISOString(),
		...overrides,
	} as SkillManifest;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("validateSkill", () => {
	// ── Full valid manifest ──────────────────────────────────────────────

	describe("full valid manifest", () => {
		it("should return valid=true with no errors for a complete manifest", () => {
			const result = validateSkill(makeValidManifest());
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("should still have no errors when optional fields are present", () => {
			const manifest = makeValidManifest({
				antiPatterns: ["do not use for X"],
			});
			const result = validateSkill(manifest);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});
	});

	// ── name ─────────────────────────────────────────────────────────────

	describe("name field", () => {
		it("should error when name is missing", () => {
			const manifest = makeValidManifest();
			(manifest as any).name = undefined;
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "name")).toBe(true);
		});

		it("should error when name is empty string", () => {
			const manifest = makeValidManifest({ name: "" });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "name")).toBe(true);
		});

		it("should error when name is whitespace only", () => {
			const manifest = makeValidManifest({ name: "   " });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "name")).toBe(true);
		});

		it("should error when name is not a string", () => {
			const manifest = makeValidManifest();
			(manifest as any).name = 42;
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "name")).toBe(true);
		});

		it("should pass with a valid name", () => {
			const result = validateSkill(makeValidManifest({ name: "my-skill" }));
			expect(result.errors.filter((e) => e.field === "name")).toHaveLength(0);
		});
	});

	// ── version ──────────────────────────────────────────────────────────

	describe("version field", () => {
		it("should error when version is missing", () => {
			const manifest = makeValidManifest();
			(manifest as any).version = undefined;
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "version")).toBe(true);
		});

		it("should error when version is empty string", () => {
			const manifest = makeValidManifest({ version: "" });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "version")).toBe(true);
		});

		it("should error for invalid semver '1.0'", () => {
			const manifest = makeValidManifest({ version: "1.0" });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "version")).toBe(true);
		});

		it("should error for invalid semver 'abc'", () => {
			const manifest = makeValidManifest({ version: "abc" });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "version")).toBe(true);
		});

		it("should error for invalid semver 'v1.0.0'", () => {
			const manifest = makeValidManifest({ version: "v1.0.0" });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
		});

		it("should error for semver with pre-release '1.0.0-beta'", () => {
			const manifest = makeValidManifest({ version: "1.0.0-beta" });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
		});

		it("should pass for valid semver '1.0.0'", () => {
			const result = validateSkill(makeValidManifest({ version: "1.0.0" }));
			expect(result.errors.filter((e) => e.field === "version")).toHaveLength(0);
		});

		it("should pass for valid semver '10.20.300'", () => {
			const result = validateSkill(makeValidManifest({ version: "10.20.300" }));
			expect(result.errors.filter((e) => e.field === "version")).toHaveLength(0);
		});

		it("should error when version is not a string", () => {
			const manifest = makeValidManifest();
			(manifest as any).version = 100;
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "version")).toBe(true);
		});
	});

	// ── description ──────────────────────────────────────────────────────

	describe("description field", () => {
		it("should error when description is missing", () => {
			const manifest = makeValidManifest();
			(manifest as any).description = undefined;
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "description")).toBe(true);
		});

		it("should error when description is empty string", () => {
			const manifest = makeValidManifest({ description: "" });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "description")).toBe(true);
		});

		it("should error when description is whitespace only", () => {
			const manifest = makeValidManifest({ description: "    " });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "description")).toBe(true);
		});

		it("should warn when description is shorter than 10 characters", () => {
			const manifest = makeValidManifest({ description: "Short" });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(true); // only warning, not error
			expect(result.warnings.some((w) => w.field === "description")).toBe(true);
		});

		it("should not warn when description is 10+ characters", () => {
			const manifest = makeValidManifest({ description: "A long enough description" });
			const result = validateSkill(manifest);
			expect(result.warnings.filter((w) => w.field === "description")).toHaveLength(0);
		});
	});

	// ── capabilities ─────────────────────────────────────────────────────

	describe("capabilities field", () => {
		it("should error when capabilities is not an array", () => {
			const manifest = makeValidManifest();
			(manifest as any).capabilities = "not-an-array";
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "capabilities")).toBe(true);
		});

		it("should error when capabilities is an empty array", () => {
			const manifest = makeValidManifest({ capabilities: [] });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "capabilities")).toBe(true);
		});

		it("should error when a capability is missing verb", () => {
			const manifest = makeValidManifest({
				capabilities: [{ verb: "", object: "code", description: "d" } as any],
			});
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "capabilities.0.verb")).toBe(true);
		});

		it("should error when a capability is missing object", () => {
			const manifest = makeValidManifest({
				capabilities: [{ verb: "test", object: "", description: "d" } as any],
			});
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "capabilities.0.object")).toBe(true);
		});

		it("should error when verb is not a string", () => {
			const manifest = makeValidManifest({
				capabilities: [{ verb: 42, object: "code", description: "d" } as any],
			});
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "capabilities.0.verb")).toBe(true);
		});

		it("should error when object is not a string", () => {
			const manifest = makeValidManifest({
				capabilities: [{ verb: "test", object: null, description: "d" } as any],
			});
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "capabilities.0.object")).toBe(true);
		});

		it("should warn when a capability has no description", () => {
			const manifest = makeValidManifest({
				capabilities: [{ verb: "test", object: "code", description: "" }],
			});
			const result = validateSkill(manifest);
			expect(result.warnings.some((w) => w.field === "capabilities.0.description")).toBe(true);
		});

		it("should validate multiple capabilities independently", () => {
			const manifest = makeValidManifest({
				capabilities: [
					{ verb: "test", object: "code", description: "Tests code" },
					{ verb: "", object: "files", description: "d" },
				],
			});
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "capabilities.1.verb")).toBe(true);
		});
	});

	// ── tags ─────────────────────────────────────────────────────────────

	describe("tags field", () => {
		it("should error when tags is not an array", () => {
			const manifest = makeValidManifest();
			(manifest as any).tags = "not-an-array";
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "tags")).toBe(true);
		});

		it("should error when tags is an empty array", () => {
			const manifest = makeValidManifest({ tags: [] });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "tags")).toBe(true);
		});

		it("should warn on duplicate tags", () => {
			const manifest = makeValidManifest({ tags: ["testing", "Testing"] });
			const result = validateSkill(manifest);
			expect(result.warnings.some((w) => w.field === "tags" && w.message.includes("duplicate"))).toBe(true);
		});

		it("should not warn when tags are unique", () => {
			const manifest = makeValidManifest({ tags: ["testing", "code", "analysis"] });
			const result = validateSkill(manifest);
			expect(result.warnings.filter((w) => w.field === "tags")).toHaveLength(0);
		});
	});

	// ── source ───────────────────────────────────────────────────────────

	describe("source field", () => {
		it("should error when source is missing", () => {
			const manifest = makeValidManifest();
			(manifest as any).source = undefined;
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "source")).toBe(true);
		});

		it("should error when source is not an object", () => {
			const manifest = makeValidManifest();
			(manifest as any).source = "tool";
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "source")).toBe(true);
		});

		it("should error for invalid source type", () => {
			const manifest = makeValidManifest();
			(manifest as any).source = { type: "invalid" };
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "source.type")).toBe(true);
		});

		it.each(["tool", "mcp-server", "plugin", "manual"] as const)(
			"should accept source type '%s'",
			(sourceType) => {
				const manifest = makeValidManifest();
				(manifest as any).source = { type: sourceType };
				const result = validateSkill(manifest);
				expect(result.errors.filter((e) => e.field === "source.type")).toHaveLength(0);
			},
		);
	});

	// ── Optional warnings ────────────────────────────────────────────────

	describe("optional field warnings", () => {
		it("should warn when no examples are provided", () => {
			const manifest = makeValidManifest();
			delete (manifest as any).examples;
			const result = validateSkill(manifest);
			expect(result.warnings.some((w) => w.field === "examples")).toBe(true);
		});

		it("should warn when examples is empty array", () => {
			const manifest = makeValidManifest({ examples: [] });
			const result = validateSkill(manifest);
			expect(result.warnings.some((w) => w.field === "examples")).toBe(true);
		});

		it("should not warn when examples are present", () => {
			const manifest = makeValidManifest({
				examples: [{ description: "Ex", input: {} }],
			});
			const result = validateSkill(manifest);
			expect(result.warnings.filter((w) => w.field === "examples")).toHaveLength(0);
		});

		it("should warn when no inputSchema is defined", () => {
			const manifest = makeValidManifest();
			delete (manifest as any).inputSchema;
			const result = validateSkill(manifest);
			expect(result.warnings.some((w) => w.field === "inputSchema")).toBe(true);
		});

		it("should not warn when inputSchema is present", () => {
			const manifest = makeValidManifest({ inputSchema: { type: "object" } });
			const result = validateSkill(manifest);
			expect(result.warnings.filter((w) => w.field === "inputSchema")).toHaveLength(0);
		});

		it("should warn when no author is specified", () => {
			const manifest = makeValidManifest();
			delete (manifest as any).author;
			const result = validateSkill(manifest);
			expect(result.warnings.some((w) => w.field === "author")).toBe(true);
		});

		it("should not warn when author is present", () => {
			const manifest = makeValidManifest({ author: "someone" });
			const result = validateSkill(manifest);
			expect(result.warnings.filter((w) => w.field === "author")).toHaveLength(0);
		});

		it("should warn when antiPatterns is present but empty", () => {
			const manifest = makeValidManifest({ antiPatterns: [] });
			const result = validateSkill(manifest);
			expect(result.warnings.some((w) => w.field === "antiPatterns")).toBe(true);
		});

		it("should not warn when antiPatterns has entries", () => {
			const manifest = makeValidManifest({ antiPatterns: ["do not use for X"] });
			const result = validateSkill(manifest);
			expect(result.warnings.filter((w) => w.field === "antiPatterns")).toHaveLength(0);
		});

		it("should not warn about antiPatterns when field is absent", () => {
			const manifest = makeValidManifest();
			delete (manifest as any).antiPatterns;
			const result = validateSkill(manifest);
			expect(result.warnings.filter((w) => w.field === "antiPatterns")).toHaveLength(0);
		});
	});

	// ── Multiple errors ──────────────────────────────────────────────────

	describe("multiple errors", () => {
		it("should collect all errors for a completely invalid manifest", () => {
			const manifest = {} as any;
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			// At minimum: name, version, description, capabilities, tags, source
			expect(result.errors.length).toBeGreaterThanOrEqual(5);
		});
	});
});

// ─── validateSkillMarkdown ──────────────────────────────────────────────────

describe("validateSkillMarkdown", () => {
	it("should return parse error for invalid markdown content", () => {
		// Passing content that will fail parsing — no frontmatter at all
		const result = validateSkillMarkdown("no frontmatter here");
		// This either fails at parse or returns validation errors
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it("should return errors array and warnings array", () => {
		const result = validateSkillMarkdown("---\n---\n");
		expect(Array.isArray(result.errors)).toBe(true);
		expect(Array.isArray(result.warnings)).toBe(true);
	});
});
