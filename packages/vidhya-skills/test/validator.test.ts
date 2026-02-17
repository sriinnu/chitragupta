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

		it("should accept two-part semver '1.0'", () => {
			const manifest = makeValidManifest({ version: "1.0" });
			const result = validateSkill(manifest);
			expect(result.errors.filter((e) => e.field === "version")).toHaveLength(0);
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

		it("should warn when description is shorter than 30 characters", () => {
			const manifest = makeValidManifest({ description: "Short description" });
			const result = validateSkill(manifest);
			expect(result.valid).toBe(true); // only warning, not error
			expect(result.warnings.some((w) => w.field === "description")).toBe(true);
		});

		it("should not warn when description is 30+ characters", () => {
			const manifest = makeValidManifest({ description: "A sufficiently detailed skill description" });
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

	// ── Vidya Spec: name format ─────────────────────────────────────────

	describe("name format (Vidya spec)", () => {
		it("should error for uppercase in name", () => {
			const result = validateSkill(makeValidManifest({ name: "MySkill" }));
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "name" && e.message.includes("lowercase"))).toBe(true);
		});

		it("should error for name over 64 characters", () => {
			const result = validateSkill(makeValidManifest({ name: "a".repeat(65) }));
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "name" && e.message.includes("64"))).toBe(true);
		});

		it("should error for consecutive hyphens", () => {
			const result = validateSkill(makeValidManifest({ name: "my--skill" }));
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "name" && e.message.includes("consecutive"))).toBe(true);
		});

		it("should error for leading hyphen", () => {
			const result = validateSkill(makeValidManifest({ name: "-my-skill" }));
			expect(result.valid).toBe(false);
		});

		it("should error for trailing hyphen", () => {
			const result = validateSkill(makeValidManifest({ name: "my-skill-" }));
			expect(result.valid).toBe(false);
		});

		it("should accept valid hyphenated name", () => {
			const result = validateSkill(makeValidManifest({ name: "my-cool-skill" }));
			expect(result.errors.filter((e) => e.field === "name")).toHaveLength(0);
		});

		it("should accept single-char name", () => {
			const result = validateSkill(makeValidManifest({ name: "a" }));
			expect(result.errors.filter((e) => e.field === "name")).toHaveLength(0);
		});
	});

	// ── Vidya Spec: description length ──────────────────────────────────

	describe("description max length (Vidya spec)", () => {
		it("should error for description over 1024 characters", () => {
			const result = validateSkill(makeValidManifest({ description: "x".repeat(1025) }));
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "description" && e.message.includes("1024"))).toBe(true);
		});

		it("should accept description at exactly 1024 characters", () => {
			const result = validateSkill(makeValidManifest({ description: "x".repeat(1024) }));
			expect(result.errors.filter((e) => e.field === "description")).toHaveLength(0);
		});
	});

	// ── Vidya Spec: kula tier ───────────────────────────────────────────

	describe("kula tier (Vidya spec)", () => {
		it("should error for invalid kula value", () => {
			const manifest = makeValidManifest();
			(manifest as any).kula = "invalid";
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "kula")).toBe(true);
		});

		it.each(["antara", "bahya", "shiksha"])("should accept kula '%s'", (kula) => {
			const manifest = makeValidManifest();
			(manifest as any).kula = kula;
			const result = validateSkill(manifest);
			expect(result.errors.filter((e) => e.field === "kula")).toHaveLength(0);
		});

		it("should not error when kula is omitted", () => {
			const result = validateSkill(makeValidManifest());
			expect(result.errors.filter((e) => e.field === "kula")).toHaveLength(0);
		});
	});

	// ── Vidya Spec: requirements shape ──────────────────────────────────

	describe("requirements shape (Vidya spec)", () => {
		it("should error when requirements.bins is not an array", () => {
			const manifest = makeValidManifest();
			(manifest as any).requirements = { bins: "nmap" };
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "requirements.bins")).toBe(true);
		});

		it("should error when requirements.network is not boolean", () => {
			const manifest = makeValidManifest();
			(manifest as any).requirements = { network: "yes" };
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "requirements.network")).toBe(true);
		});

		it("should accept valid requirements", () => {
			const manifest = makeValidManifest();
			(manifest as any).requirements = { bins: ["nmap"], env: ["KEY"], os: ["darwin"], network: true, privilege: false };
			const result = validateSkill(manifest);
			expect(result.errors.filter((e) => e.field.startsWith("requirements"))).toHaveLength(0);
		});
	});

	// ── Vidya Spec: tags minimum warning ────────────────────────────────

	describe("tags minimum (Vidya spec)", () => {
		it("should warn when fewer than 3 tags", () => {
			const result = validateSkill(makeValidManifest({ tags: ["one", "two"] }));
			expect(result.warnings.some((w) => w.field === "tags" && w.message.includes("3"))).toBe(true);
		});

		it("should not warn when 3+ tags", () => {
			const result = validateSkill(makeValidManifest({ tags: ["one", "two", "three"] }));
			expect(result.warnings.filter((w) => w.field === "tags" && w.message.includes("3"))).toHaveLength(0);
		});
	});

	// ── Vidya Spec: source type includes generated ──────────────────────

	describe("generated source type (Vidya spec)", () => {
		it("should accept source type 'generated'", () => {
			const manifest = makeValidManifest();
			(manifest as any).source = { type: "generated", generator: "shiksha" };
			const result = validateSkill(manifest);
			expect(result.errors.filter((e) => e.field === "source.type")).toHaveLength(0);
		});
	});

	// ── Granular Permissions Validation ─────────────────────────────────

	describe("granular permissions (Vidya spec)", () => {
		it("should error when networkPolicy.allowlist is not an array", () => {
			const manifest = makeValidManifest();
			(manifest as any).permissions = { networkPolicy: { allowlist: "example.com" } };
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "permissions.networkPolicy.allowlist")).toBe(true);
		});

		it("should error when secrets is not an array", () => {
			const manifest = makeValidManifest();
			(manifest as any).permissions = { secrets: "API_KEY" };
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "permissions.secrets")).toBe(true);
		});

		it("should error for invalid piiPolicy", () => {
			const manifest = makeValidManifest();
			(manifest as any).permissions = { piiPolicy: "yolo" };
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "permissions.piiPolicy")).toBe(true);
		});

		it("should error for invalid filesystem.scope", () => {
			const manifest = makeValidManifest();
			(manifest as any).permissions = { filesystem: { scope: "everywhere" } };
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "permissions.filesystem.scope")).toBe(true);
		});

		it("should accept valid granular permissions", () => {
			const manifest = makeValidManifest();
			(manifest as any).permissions = {
				networkPolicy: { allowlist: ["api.example.com"], timeoutMs: 5000 },
				secrets: ["API_KEY"],
				piiPolicy: "no_persist",
				filesystem: { scope: "skill_dir", maxWriteMb: 10 },
			};
			const result = validateSkill(manifest);
			expect(result.errors.filter((e) => e.field.startsWith("permissions"))).toHaveLength(0);
		});

		it("should not error when permissions is omitted", () => {
			const result = validateSkill(makeValidManifest());
			expect(result.errors.filter((e) => e.field.startsWith("permissions"))).toHaveLength(0);
		});
	});

	// ── Approach Ladder Validation ──────────────────────────────────────

	describe("approach ladder (Vidya spec)", () => {
		it("should error when approachLadder is not an array", () => {
			const manifest = makeValidManifest();
			(manifest as any).approachLadder = "not-array";
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "approachLadder")).toBe(true);
		});

		it("should error for missing name in approach entry", () => {
			const manifest = makeValidManifest();
			(manifest as any).approachLadder = [{ status: "preferred", why: "best" }];
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field.includes("approachLadder") && e.message.includes("name"))).toBe(true);
		});

		it("should error for invalid status in approach entry", () => {
			const manifest = makeValidManifest();
			(manifest as any).approachLadder = [{ name: "Test", status: "invalid", why: "reason" }];
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field.includes("approachLadder") && e.message.includes("status"))).toBe(true);
		});

		it("should error for missing why in approach entry", () => {
			const manifest = makeValidManifest();
			(manifest as any).approachLadder = [{ name: "Test", status: "preferred" }];
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field.includes("approachLadder") && e.message.includes("why"))).toBe(true);
		});

		it("should accept valid approach ladder", () => {
			const manifest = makeValidManifest();
			(manifest as any).approachLadder = [
				{ name: "API", status: "preferred", why: "Official endpoint" },
				{ name: "Scraping", status: "fallback", why: "No API key" },
				{ name: "Hacking", status: "blocked", why: "Illegal" },
			];
			const result = validateSkill(manifest);
			expect(result.errors.filter((e) => e.field.includes("approachLadder"))).toHaveLength(0);
		});

		it("should not error when approachLadder is omitted", () => {
			const result = validateSkill(makeValidManifest());
			expect(result.errors.filter((e) => e.field.includes("approachLadder"))).toHaveLength(0);
		});
	});

	// ── Eval Cases Validation ───────────────────────────────────────────

	describe("eval cases (Vidya spec)", () => {
		it("should error when evalCases is not an array", () => {
			const manifest = makeValidManifest();
			(manifest as any).evalCases = "not-array";
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field === "evalCases")).toBe(true);
		});

		it("should error for missing id in eval case", () => {
			const manifest = makeValidManifest();
			(manifest as any).evalCases = [{ input: {}, expected: "ok" }];
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field.includes("evalCases") && e.message.includes("id"))).toBe(true);
		});

		it("should error for missing input in eval case", () => {
			const manifest = makeValidManifest();
			(manifest as any).evalCases = [{ id: "test", expected: "ok" }];
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field.includes("evalCases") && e.message.includes("input"))).toBe(true);
		});

		it("should error for invalid type in eval case", () => {
			const manifest = makeValidManifest();
			(manifest as any).evalCases = [{ id: "test", input: {}, expected: "ok", type: "unknown" }];
			const result = validateSkill(manifest);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.field.includes("evalCases") && e.message.includes("type"))).toBe(true);
		});

		it("should accept valid eval cases", () => {
			const manifest = makeValidManifest();
			(manifest as any).evalCases = [
				{ id: "golden-1", input: { q: "hello" }, expected: "world", type: "golden" },
				{ id: "adv-1", input: { q: "'; DROP TABLE --" }, expected: "rejected", type: "adversarial" },
			];
			const result = validateSkill(manifest);
			expect(result.errors.filter((e) => e.field.includes("evalCases"))).toHaveLength(0);
		});

		it("should not error when evalCases is omitted", () => {
			const result = validateSkill(makeValidManifest());
			expect(result.errors.filter((e) => e.field.includes("evalCases"))).toHaveLength(0);
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
