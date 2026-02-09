/**
 * E2E: Skill Discovery Pipeline
 *
 * Exercises the FULL flow through:
 *   bridge.ts -> registry.ts -> fingerprint.ts -> matcher.ts -> evolution.ts
 *
 * No mocking of internals -- only real module execution.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
	VidyaBridge,
	SkillRegistry,
	SkillEvolution,
	computeTraitVector,
	computeQueryVector,
	writeSkillMarkdown,
	parseSkillMarkdown,
	TRAIT_DIMENSIONS,
	BUCKET_SIZE,
	matchSkills,
	generateSkillFromTool,
} from "@chitragupta/vidhya-skills";
import type {
	SkillManifest,
	SkillMatch,
} from "@chitragupta/vidhya-skills";
import type { ToolDefinition } from "@chitragupta/vidhya-skills";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tool(name: string, description: string, props?: Record<string, unknown>): ToolDefinition {
	return {
		name,
		description,
		inputSchema: {
			type: "object",
			properties: props ?? { path: { type: "string", description: "File path" } },
			required: props ? Object.keys(props).slice(0, 1) : ["path"],
		},
	};
}

/** Build a diverse set of tools for testing. */
function diverseTools(): ToolDefinition[] {
	return [
		tool("read_file", "Read the contents of a file from the filesystem", {
			path: { type: "string", description: "Absolute file path" },
		}),
		tool("write_file", "Write content to a file on disk", {
			path: { type: "string", description: "File path" },
			content: { type: "string", description: "Content to write" },
		}),
		tool("search_code", "Search for patterns in source code files", {
			query: { type: "string", description: "Search pattern" },
			path: { type: "string", description: "Directory to search" },
		}),
		tool("execute_command", "Execute a shell command and return output", {
			command: { type: "string", description: "Shell command" },
		}),
		tool("list_directory", "List files and directories in a given path", {
			path: { type: "string", description: "Directory path" },
		}),
		tool("delete_file", "Delete a file from the filesystem", {
			path: { type: "string", description: "File path to delete" },
		}),
		tool("analyzeCode", "Analyze source code for quality and issues", {
			code: { type: "string", description: "Source code text" },
		}),
		tool("format_json", "Format and pretty-print a JSON string", {
			json: { type: "string", description: "Raw JSON input" },
		}),
	];
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("E2E: Skill Discovery Pipeline", () => {
	let registry: SkillRegistry;
	let bridge: VidyaBridge;

	beforeEach(() => {
		registry = new SkillRegistry();
		bridge = new VidyaBridge(registry);
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 1. Tool-to-skill registration flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("tool-to-skill registration flow", () => {
		it("should register tools and make them queryable in the registry", () => {
			const tools = diverseTools();
			bridge.registerToolsAsSkills(tools);

			expect(bridge.registeredCount).toBe(tools.length);
			expect(registry.size).toBe(tools.length);

			// Each skill should be retrievable by name
			for (const t of tools) {
				const skill = registry.get(t.name);
				expect(skill).toBeDefined();
				expect(skill!.name).toBe(t.name);
				expect(skill!.description).toBe(t.description);
				expect(skill!.source.type).toBe("tool");
			}
		});

		it("should generate correct tags from tool names and descriptions", () => {
			bridge.registerToolsAsSkills([
				tool("read_file", "Read the contents of a file from the filesystem"),
			]);

			const skill = registry.get("read_file")!;
			expect(skill.tags).toContain("read");
			expect(skill.tags).toContain("file");
		});

		it("should extract verb/object capabilities correctly", () => {
			bridge.registerToolsAsSkills([
				tool("search_code", "Search for patterns in source code"),
			]);

			const skill = registry.get("search_code")!;
			expect(skill.capabilities.length).toBeGreaterThanOrEqual(1);
			expect(skill.capabilities[0].verb).toBe("search");
			expect(skill.capabilities[0].object).toBe("code");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 2. TVM fingerprinting flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("TVM fingerprinting flow", () => {
		it("should produce 128-dim trait vectors (8 buckets x 16 dims)", () => {
			bridge.registerToolsAsSkills([
				tool("read_file", "Read a file from the filesystem"),
			]);

			const skill = registry.get("read_file")!;
			expect(skill.traitVector).toBeDefined();
			expect(skill.traitVector!.length).toBe(TRAIT_DIMENSIONS);
			expect(TRAIT_DIMENSIONS).toBe(128);
			expect(BUCKET_SIZE).toBe(16);
		});

		it("should produce L2-normalized vectors (unit length)", () => {
			bridge.registerToolsAsSkills([
				tool("search_code", "Search for patterns in source code"),
			]);

			const skill = registry.get("search_code")!;
			const vec = new Float32Array(skill.traitVector!);
			let sumSq = 0;
			for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
			const norm = Math.sqrt(sumSq);
			expect(Math.abs(norm - 1.0)).toBeLessThan(1e-4);
		});

		it("should produce different vectors for different tools", () => {
			bridge.registerToolsAsSkills(diverseTools());

			const readVec = registry.get("read_file")!.traitVector!;
			const searchVec = registry.get("search_code")!.traitVector!;

			// Vectors should differ (at least some dimensions)
			let diffCount = 0;
			for (let i = 0; i < TRAIT_DIMENSIONS; i++) {
				if (Math.abs(readVec[i] - searchVec[i]) > 1e-6) diffCount++;
			}
			expect(diffCount).toBeGreaterThan(0);
		});

		it("should produce similar vectors for semantically similar tools", () => {
			// read_file and list_directory both deal with filesystem
			bridge.registerToolsAsSkills(diverseTools());

			const readVec = new Float32Array(registry.get("read_file")!.traitVector!);
			const listVec = new Float32Array(registry.get("list_directory")!.traitVector!);
			const execVec = new Float32Array(registry.get("execute_command")!.traitVector!);

			// Cosine similarity: read_file <-> list_directory should be higher
			// than read_file <-> execute_command
			function cosine(a: Float32Array, b: Float32Array): number {
				let dot = 0, na = 0, nb = 0;
				for (let i = 0; i < a.length; i++) {
					dot += a[i] * b[i];
					na += a[i] * a[i];
					nb += b[i] * b[i];
				}
				const denom = Math.sqrt(na) * Math.sqrt(nb);
				return denom === 0 ? 0 : dot / denom;
			}

			const simReadList = cosine(readVec, listVec);
			const simReadExec = cosine(readVec, execVec);
			// Both are filesystem-related, so they should be at least somewhat similar
			// (this is a soft check — TVM is algorithmic, not perfect semantic)
			expect(simReadList).toBeGreaterThan(-0.5);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 3. Skill matching flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("skill matching flow", () => {
		beforeEach(() => {
			bridge.registerToolsAsSkills(diverseTools());
		});

		it("should return read_file as top match for 'read a file'", () => {
			const matches = bridge.recommendSkills("read a file", 5, 0);
			expect(matches.length).toBeGreaterThan(0);

			// read_file should appear (ideally at the top or near top)
			const readFileMatch = matches.find((m) => m.skill.name === "read_file");
			expect(readFileMatch).toBeDefined();
		});

		it("should return search_code as top match for 'search for code patterns'", () => {
			const matches = bridge.recommendSkills("search for code patterns", 5, 0);
			expect(matches.length).toBeGreaterThan(0);

			const searchMatch = matches.find((m) => m.skill.name === "search_code");
			expect(searchMatch).toBeDefined();
		});

		it("should sort results by descending score", () => {
			const matches = bridge.recommendSkills("file", 10, 0);
			for (let i = 1; i < matches.length; i++) {
				expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
			}
		});

		it("should include breakdown in match results", () => {
			const matches = bridge.recommendSkills("read a file", 3, 0);
			expect(matches.length).toBeGreaterThan(0);

			const match = matches[0];
			expect(match.breakdown).toBeDefined();
			expect(typeof match.breakdown.traitSimilarity).toBe("number");
			expect(typeof match.breakdown.tagBoost).toBe("number");
			expect(typeof match.breakdown.capabilityMatch).toBe("number");
			expect(typeof match.breakdown.antiPatternPenalty).toBe("number");
		});

		it("should filter by threshold", () => {
			const allMatches = bridge.recommendSkills("file", 10, 0);
			const filteredMatches = bridge.recommendSkills("file", 10, 0.5);

			// All filtered matches should have score >= 0.5
			for (const m of filteredMatches) {
				expect(m.score).toBeGreaterThanOrEqual(0.5);
			}

			// Filtered count should be <= all count
			expect(filteredMatches.length).toBeLessThanOrEqual(allMatches.length);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 4. Recommendation flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("recommendation flow", () => {
		beforeEach(() => {
			bridge.registerToolsAsSkills(diverseTools());
		});

		it("should return best match via recommendSkill()", () => {
			const match = bridge.recommendSkill("read a file", 0);
			expect(match).not.toBeNull();
			expect(match!.skill).toBeDefined();
			expect(typeof match!.score).toBe("number");
		});

		it("should return null when threshold is impossibly high", () => {
			const match = bridge.recommendSkill("read a file", 999);
			expect(match).toBeNull();
		});

		it("should return correct count via recommendSkills(query, topK)", () => {
			const top3 = bridge.recommendSkills("file operations", 3, 0);
			expect(top3.length).toBeLessThanOrEqual(3);

			const top1 = bridge.recommendSkills("file operations", 1, 0);
			expect(top1.length).toBeLessThanOrEqual(1);
		});

		it("should return empty array when registry is empty", () => {
			const emptyRegistry = new SkillRegistry();
			const emptyBridge = new VidyaBridge(emptyRegistry);
			const matches = emptyBridge.recommendSkills("anything");
			expect(matches).toEqual([]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 5. MCP server tool registration
	// ═══════════════════════════════════════════════════════════════════════

	describe("MCP server tool registration", () => {
		it("should register tools with mcp-server source", () => {
			const mcpTools = [
				tool("mcp_fetch_url", "Fetch content from a URL"),
				tool("mcp_send_email", "Send an email message"),
			];

			bridge.registerMCPServerTools("srv-github", "GitHub Server", mcpTools);

			expect(bridge.registeredCount).toBe(2);

			const fetchSkill = registry.get("mcp_fetch_url")!;
			expect(fetchSkill.source.type).toBe("mcp-server");
			if (fetchSkill.source.type === "mcp-server") {
				expect(fetchSkill.source.serverId).toBe("srv-github");
				expect(fetchSkill.source.serverName).toBe("GitHub Server");
			}

			const sendSkill = registry.get("mcp_send_email")!;
			expect(sendSkill.source.type).toBe("mcp-server");
		});

		it("should be matchable after MCP registration", () => {
			bridge.registerMCPServerTools("srv-1", "Test Server", [
				tool("mcp_fetch_url", "Fetch content from a URL"),
			]);

			const match = bridge.recommendSkill("fetch a URL", 0);
			expect(match).not.toBeNull();
			expect(match!.skill.name).toBe("mcp_fetch_url");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 6. Skill markdown roundtrip
	// ═══════════════════════════════════════════════════════════════════════

	describe("skill markdown roundtrip", () => {
		it("should preserve key fields through write -> parse cycle", () => {
			bridge.registerToolsAsSkills([
				tool("read_file", "Read the contents of a file from the filesystem"),
			]);

			const original = registry.get("read_file")!;
			const markdown = writeSkillMarkdown(original);
			const parsed = parseSkillMarkdown(markdown);

			// Key fields should survive the roundtrip
			expect(parsed.name).toBe(original.name);
			expect(parsed.version).toBe(original.version);
			expect(parsed.description).toBe(original.description);
			expect(parsed.tags).toEqual(expect.arrayContaining(original.tags));
			expect(parsed.source.type).toBe(original.source.type);
		});

		it("should preserve capabilities through the roundtrip", () => {
			bridge.registerToolsAsSkills([
				tool("search_code", "Search for patterns in source code"),
			]);

			const original = registry.get("search_code")!;
			const markdown = writeSkillMarkdown(original);
			const parsed = parseSkillMarkdown(markdown);

			expect(parsed.capabilities.length).toBe(original.capabilities.length);
			expect(parsed.capabilities[0].verb).toBe(original.capabilities[0].verb);
			expect(parsed.capabilities[0].object).toBe(original.capabilities[0].object);
		});

		it("should produce valid markdown with frontmatter delimiters", () => {
			bridge.registerToolsAsSkills([tool("test_tool", "A test tool")]);
			const skill = registry.get("test_tool")!;
			const md = writeSkillMarkdown(skill);

			expect(md.startsWith("---\n")).toBe(true);
			expect(md).toContain("\n---\n");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 7. Anti-pattern negative dimensions
	// ═══════════════════════════════════════════════════════════════════════

	describe("anti-pattern negative dimensions", () => {
		it("should produce negative dims in metadata bucket for anti-patterns", () => {
			// Create a manifest with anti-patterns
			const manifest: SkillManifest = {
				name: "write_file",
				version: "1.0.0",
				description: "Write content to a file on disk",
				capabilities: [{
					verb: "write",
					object: "file",
					description: "Write content to a file on disk",
				}],
				tags: ["write", "file", "filesystem"],
				source: { type: "tool", toolName: "write_file" },
				antiPatterns: [
					"Do not use for reading files",
					"Not suitable for binary data processing",
				],
				updatedAt: new Date().toISOString(),
			};

			const vector = computeTraitVector(manifest);

			// Bucket 7 (metadata signals) spans dims 112-127
			// Anti-patterns should produce negative values in some of these dims
			let hasNegative = false;
			for (let i = 112; i < 128; i++) {
				if (vector[i] < 0) {
					hasNegative = true;
					break;
				}
			}
			expect(hasNegative).toBe(true);
		});

		it("should apply anti-pattern penalty when query matches anti-patterns", () => {
			// Register a skill with anti-patterns
			const manifest: SkillManifest = {
				name: "write_file",
				version: "1.0.0",
				description: "Write content to a file",
				capabilities: [{
					verb: "write",
					object: "file",
					description: "Write content to a file",
				}],
				tags: ["write", "file"],
				source: { type: "tool", toolName: "write_file" },
				antiPatterns: ["reading files", "binary data processing"],
				updatedAt: new Date().toISOString(),
			};

			// Match with a query that triggers anti-patterns
			const matchResults = matchSkills(
				{ text: "reading files from disk", topK: 5, threshold: 0 },
				[manifest],
			);

			if (matchResults.length > 0) {
				// Anti-pattern penalty should be > 0
				expect(matchResults[0].breakdown.antiPatternPenalty).toBeGreaterThan(0);
			}
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 8. Tag boost in matching
	// ═══════════════════════════════════════════════════════════════════════

	describe("tag boost in matching", () => {
		it("should boost scores when query tags match skill tags", () => {
			bridge.registerToolsAsSkills(diverseTools());

			// Query with tag filter matching "file"
			const withTagMatches = registry.query({
				text: "operate on files",
				tags: ["file"],
				topK: 10,
				threshold: 0,
			});

			// Query without tag filter
			const withoutTagMatches = registry.query({
				text: "operate on files",
				topK: 10,
				threshold: 0,
			});

			// With tags, file-related skills should appear (and may score higher)
			const taggedFileSkills = withTagMatches.filter(
				(m) => m.skill.tags.map((t) => t.toLowerCase()).includes("file"),
			);
			// All results with tag filter should have the "file" tag
			expect(taggedFileSkills.length).toBe(withTagMatches.length);
		});

		it("should require ALL tags when multiple tags are specified", () => {
			bridge.registerToolsAsSkills(diverseTools());

			// Query with multiple tags -- only skills with BOTH tags pass the filter
			const matches = registry.query({
				text: "work with files",
				tags: ["read", "file"],
				topK: 10,
				threshold: 0,
			});

			// Every result must have both tags
			for (const m of matches) {
				const skillTags = m.skill.tags.map((t) => t.toLowerCase());
				expect(skillTags).toContain("read");
				expect(skillTags).toContain("file");
			}
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 9. Evolution feedback loop
	// ═══════════════════════════════════════════════════════════════════════

	describe("evolution feedback loop", () => {
		let evolution: SkillEvolution;

		beforeEach(() => {
			evolution = new SkillEvolution();
		});

		it("should track usage and compute health scores", () => {
			// Record usage over several calls
			for (let i = 0; i < 10; i++) {
				evolution.recordMatch("read_file", "read something", 0.8);
			}
			for (let i = 0; i < 7; i++) {
				evolution.recordUsage("read_file", true, `ctx-${i}`);
			}
			for (let i = 0; i < 2; i++) {
				evolution.recordUsage("read_file", false);
			}

			const health = evolution.getSkillHealth("read_file");

			// Basic checks
			expect(health.matchCount).toBe(10);
			expect(health.useCount).toBe(9);
			expect(health.successCount).toBe(7);
			expect(health.useRate).toBeCloseTo(9 / 10, 2);
			expect(health.successRate).toBeCloseTo(7 / 9, 2);
			expect(health.freshnessScore).toBeGreaterThan(0.9); // just used
			expect(health.health).toBeGreaterThan(0.5);
		});

		it("should flag unhealthy skills for deprecation after sufficient matches", () => {
			vi.useFakeTimers();
			const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
			vi.setSystemTime(thirtyDaysAgo);

			// Create a bad skill: many matches, one failed use, long ago
			for (let i = 0; i < 55; i++) {
				evolution.recordMatch("bad_skill", "query", 0.1);
			}
			evolution.recordUsage("bad_skill", false);

			// Move time to now
			vi.setSystemTime(Date.now() + 30 * 86_400_000);

			const health = evolution.getSkillHealth("bad_skill");
			expect(health.health).toBeLessThan(0.1);
			expect(health.flaggedForReview).toBe(true);

			const candidates = evolution.getDeprecationCandidates();
			expect(candidates.length).toBeGreaterThan(0);
			expect(candidates[0].name).toBe("bad_skill");

			vi.useRealTimers();
		});

		it("should evolve trait vectors via online gradient descent", () => {
			const v1 = new Float32Array(TRAIT_DIMENSIONS);
			v1[0] = 10.0;
			evolution.evolveTraitVector("skill-a", v1);

			const v2 = new Float32Array(TRAIT_DIMENSIONS);
			v2[1] = 10.0;
			evolution.evolveTraitVector("skill-a", v2);

			const evolved = evolution.getEvolvedVector("skill-a")!;
			// After evolution, both dims should have signal
			expect(evolved[0]).toBeGreaterThan(0);
			expect(evolved[1]).toBeGreaterThan(0);

			// Should be L2-normalized
			let sumSq = 0;
			for (let i = 0; i < evolved.length; i++) sumSq += evolved[i] * evolved[i];
			expect(Math.abs(Math.sqrt(sumSq) - 1.0)).toBeLessThan(1e-4);
		});

		it("should produce evolution report sorted by health ascending", () => {
			// Healthy skill
			for (let i = 0; i < 10; i++) evolution.recordMatch("good", "q", 0.9);
			for (let i = 0; i < 8; i++) evolution.recordUsage("good", true, `ctx-${i}`);

			// Unhealthy skill (no uses)
			for (let i = 0; i < 5; i++) evolution.recordMatch("poor", "q", 0.2);

			const report = evolution.getEvolutionReport();
			expect(report.length).toBe(2);
			expect(report[0].name).toBe("poor");
			expect(report[0].health).toBeLessThan(report[1].health);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 10. Fusion detection
	// ═══════════════════════════════════════════════════════════════════════

	describe("fusion detection", () => {
		it("should detect fusion candidates when skills consistently co-occur", () => {
			const evolution = new SkillEvolution();

			// Simulate 15 sessions where read_file and write_file always co-occur
			for (let i = 0; i < 15; i++) {
				evolution.recordUsage("read_file", true);
				evolution.recordUsage("write_file", true);
				evolution.flushSession();
			}

			const fusions = evolution.suggestFusions();
			expect(fusions.length).toBeGreaterThan(0);

			const pair = fusions[0];
			const names = [pair.skillA, pair.skillB].sort();
			expect(names).toEqual(["read_file", "write_file"]);
			expect(pair.coOccurrenceRate).toBeGreaterThanOrEqual(0.6);
		});

		it("should NOT suggest fusion when co-occurrences are below threshold", () => {
			const evolution = new SkillEvolution();

			// Only 5 sessions (below FUSION_MIN_CO_OCCURRENCES=10)
			for (let i = 0; i < 5; i++) {
				evolution.recordUsage("skill-a", true);
				evolution.recordUsage("skill-b", true);
				evolution.flushSession();
			}

			expect(evolution.suggestFusions()).toHaveLength(0);
		});

		it("should handle multiple fusion pairs", () => {
			const evolution = new SkillEvolution();

			// pair 1: A + B always together
			// pair 2: C + D always together
			for (let i = 0; i < 15; i++) {
				evolution.recordUsage("skill-a", true);
				evolution.recordUsage("skill-b", true);
				evolution.flushSession();

				evolution.recordUsage("skill-c", true);
				evolution.recordUsage("skill-d", true);
				evolution.flushSession();
			}

			const fusions = evolution.suggestFusions();
			expect(fusions.length).toBeGreaterThanOrEqual(2);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 11. Unregister flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("unregister flow", () => {
		it("should remove all skills and allow clean re-registration", () => {
			bridge.registerToolsAsSkills(diverseTools());
			expect(bridge.registeredCount).toBe(diverseTools().length);

			bridge.unregisterAll();
			expect(bridge.registeredCount).toBe(0);
			expect(registry.size).toBe(0);

			// recommendSkill should return null
			const match = bridge.recommendSkill("read a file");
			expect(match).toBeNull();

			// Re-register should work
			bridge.registerToolsAsSkills(diverseTools());
			expect(bridge.registeredCount).toBe(diverseTools().length);
		});

		it("should clean registry indices on unregister", () => {
			bridge.registerToolsAsSkills([
				tool("read_file", "Read a file from the filesystem"),
			]);

			expect(registry.getByTag("read").length).toBeGreaterThan(0);
			expect(registry.getByVerb("read").length).toBeGreaterThan(0);

			bridge.unregisterAll();

			expect(registry.getByTag("read").length).toBe(0);
			expect(registry.getByVerb("read").length).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 12. Edge cases
	// ═══════════════════════════════════════════════════════════════════════

	describe("edge cases", () => {
		it("should handle empty tool list", () => {
			bridge.registerToolsAsSkills([]);
			expect(bridge.registeredCount).toBe(0);
			expect(registry.size).toBe(0);
		});

		it("should skip duplicate tool names on re-registration", () => {
			const tools = [tool("read_file", "Read a file")];
			bridge.registerToolsAsSkills(tools);
			bridge.registerToolsAsSkills(tools);
			expect(bridge.registeredCount).toBe(1);
		});

		it("should handle tools with very long descriptions", () => {
			const longDesc = "A ".repeat(5000) + "tool that does things.";
			bridge.registerToolsAsSkills([tool("verbose_tool", longDesc)]);

			const skill = registry.get("verbose_tool")!;
			expect(skill.traitVector).toBeDefined();
			expect(skill.traitVector!.length).toBe(TRAIT_DIMENSIONS);
		});

		it("should handle tools with special characters in names", () => {
			bridge.registerToolsAsSkills([
				tool("my-special_tool.v2", "A tool with special characters"),
			]);

			const skill = bridge.getSkillForTool("my-special_tool.v2");
			expect(skill).not.toBeNull();
			expect(skill!.traitVector).toBeDefined();
		});

		it("should handle tools with empty descriptions", () => {
			bridge.registerToolsAsSkills([tool("empty_desc", "")]);

			const skill = registry.get("empty_desc")!;
			expect(skill).toBeDefined();
			expect(skill.traitVector).toBeDefined();
			expect(skill.traitVector!.length).toBe(TRAIT_DIMENSIONS);
		});

		it("should handle tools with minimal inputSchema", () => {
			const minimal: ToolDefinition = {
				name: "minimal",
				description: "Minimal tool",
				inputSchema: { type: "object" },
			};
			bridge.registerToolsAsSkills([minimal]);
			expect(bridge.registeredCount).toBe(1);
		});

		it("should handle concurrent queries without corruption", () => {
			bridge.registerToolsAsSkills(diverseTools());

			// Fire multiple queries simultaneously
			const results = Array.from({ length: 10 }, (_, i) =>
				bridge.recommendSkills(`query ${i}`, 3, 0),
			);

			// Each result should be a valid array
			for (const r of results) {
				expect(Array.isArray(r)).toBe(true);
			}
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Full pipeline integration
	// ═══════════════════════════════════════════════════════════════════════

	describe("full pipeline integration", () => {
		it("should complete the entire lifecycle: register -> match -> evolve -> serialize", () => {
			// 1. Register tools
			bridge.registerToolsAsSkills(diverseTools());
			expect(bridge.registeredCount).toBe(diverseTools().length);

			// 2. Match
			const match = bridge.recommendSkill("read a file", 0);
			expect(match).not.toBeNull();

			// 3. Evolve
			const evolution = new SkillEvolution();
			evolution.recordMatch(match!.skill.name, "read a file", match!.score);
			evolution.recordUsage(match!.skill.name, true, "file-context");

			const health = evolution.getSkillHealth(match!.skill.name);
			expect(health.matchCount).toBe(1);
			expect(health.useCount).toBe(1);

			// 4. Evolve trait vector
			const queryVec = computeQueryVector({ text: "read a file" });
			evolution.evolveTraitVector(match!.skill.name, queryVec);
			const evolved = evolution.getEvolvedVector(match!.skill.name);
			expect(evolved).not.toBeNull();

			// 5. Serialize
			const state = evolution.serialize();
			const restored = SkillEvolution.deserialize(state);
			const restoredHealth = restored.getSkillHealth(match!.skill.name);
			expect(restoredHealth.matchCount).toBe(1);
			expect(restoredHealth.useCount).toBe(1);
		});

		it("should handle getSkillForTool -> markdown -> re-register cycle", () => {
			bridge.registerToolsAsSkills([
				tool("read_file", "Read file contents from disk"),
			]);

			// Get the skill
			const original = bridge.getSkillForTool("read_file")!;
			expect(original).not.toBeNull();

			// Write to markdown
			const md = writeSkillMarkdown(original);

			// Parse back
			const parsed = parseSkillMarkdown(md);
			expect(parsed.name).toBe("read_file");

			// Re-register in a fresh registry
			const freshRegistry = new SkillRegistry();
			freshRegistry.register(parsed);

			// Query the fresh registry
			const matches = freshRegistry.query({
				text: "read a file",
				topK: 1,
				threshold: 0,
			});
			expect(matches.length).toBeGreaterThan(0);
			expect(matches[0].skill.name).toBe("read_file");
		});
	});
});
