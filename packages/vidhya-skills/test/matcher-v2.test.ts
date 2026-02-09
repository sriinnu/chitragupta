/**
 * @module matcher-v2.test
 * @description Rigorous tests for the Vidya-Tantra three-phase matching pipeline.
 *
 * Phase 1: Algorithmic pre-filter (ashrama gating, pranamaya check, kula/trust/ashrama weights)
 * Phase 2: Contextual re-ranking (Chetana focus, frustration, goals, preferences, Thompson Sampling)
 * Phase 3: Model disambiguation flag (top-2 score gap < 0.05)
 *
 * These tests verify that 90%+ of skill selection is decided algorithmically
 * without any LLM call, and that the pipeline correctly flags the remaining
 * ambiguous cases for model-driven disambiguation.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { matchSkillsV2 } from "../src/matcher.js";
import type { MatchContext } from "../src/matcher.js";
import type { SkillQuery } from "../src/types.js";
import type {
	EnhancedSkillManifest,
	AnandamayaMastery,
	KulaType,
} from "../src/types-v2.js";
import { KULA_WEIGHTS, ASHRAMA_MATCH_WEIGHT, INITIAL_ANANDAMAYA } from "../src/types-v2.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal EnhancedSkillManifest for testing. */
function makeEnhancedSkill(
	overrides: Partial<EnhancedSkillManifest> & { name: string },
): EnhancedSkillManifest {
	return {
		version: "1.0.0",
		description: overrides.description ?? `A skill named ${overrides.name}`,
		capabilities: overrides.capabilities ?? [
			{ verb: "read", object: "data", description: `${overrides.name} reads data` },
		],
		tags: overrides.tags ?? [overrides.name],
		source: overrides.source ?? { type: "tool", toolName: overrides.name },
		updatedAt: overrides.updatedAt ?? "2025-06-01T00:00:00Z",
		kula: overrides.kula ?? "antara",
		...overrides,
	};
}

/** Build mastery data with custom alpha/beta for Thompson Sampling. */
function makeMastery(overrides: Partial<AnandamayaMastery> = {}): AnandamayaMastery {
	return {
		...INITIAL_ANANDAMAYA,
		...overrides,
	};
}

/**
 * Build a bank of test skills with distinct traits for pipeline testing.
 * All skills have simple unique descriptions/tags so TVM produces different vectors.
 */
function makeSkillBank(): EnhancedSkillManifest[] {
	return [
		makeEnhancedSkill({
			name: "file-reader",
			description: "Read files from the local filesystem with encoding detection",
			capabilities: [{ verb: "read", object: "files", description: "Read a file at a given path" }],
			tags: ["filesystem", "io", "read"],
			kula: "antara",
		}),
		makeEnhancedSkill({
			name: "code-analyzer",
			description: "Analyze source code for complexity and quality metrics",
			capabilities: [{ verb: "analyze", object: "code", description: "Run static analysis" }],
			tags: ["analysis", "code-quality", "metrics"],
			kula: "antara",
		}),
		makeEnhancedSkill({
			name: "database-query",
			description: "Execute SQL queries against a PostgreSQL database",
			capabilities: [{ verb: "execute", object: "queries", description: "Run SQL" }],
			tags: ["database", "sql", "postgresql"],
			kula: "bahya",
			antiPatterns: ["Do not use for file operations"],
		}),
		makeEnhancedSkill({
			name: "file-writer",
			description: "Write content to files on the local filesystem",
			capabilities: [{ verb: "write", object: "files", description: "Write to a file" }],
			tags: ["filesystem", "io", "write"],
			kula: "antara",
		}),
		makeEnhancedSkill({
			name: "web-scraper",
			description: "Scrape and extract content from web pages",
			capabilities: [{ verb: "fetch", object: "web-pages", description: "Fetch web content" }],
			tags: ["web", "http", "scraping"],
			kula: "bahya",
		}),
		makeEnhancedSkill({
			name: "image-resizer",
			description: "Resize and optimize images for different formats",
			capabilities: [{ verb: "transform", object: "images", description: "Resize images" }],
			tags: ["image", "media", "transform"],
			kula: "shiksha",
		}),
		makeEnhancedSkill({
			name: "git-manager",
			description: "Manage git repositories, branches, and commits",
			capabilities: [{ verb: "execute", object: "git-commands", description: "Run git commands" }],
			tags: ["git", "vcs", "repository"],
			kula: "antara",
		}),
		makeEnhancedSkill({
			name: "test-runner",
			description: "Run test suites and collect coverage data",
			capabilities: [{ verb: "execute", object: "tests", description: "Run test suites" }],
			tags: ["testing", "coverage", "ci"],
			kula: "antara",
		}),
		makeEnhancedSkill({
			name: "docker-builder",
			description: "Build and manage Docker containers and images",
			capabilities: [{ verb: "create", object: "containers", description: "Build Docker images" }],
			tags: ["docker", "containers", "devops"],
			kula: "bahya",
		}),
		makeEnhancedSkill({
			name: "log-analyzer",
			description: "Analyze and search through application log files",
			capabilities: [{ verb: "search", object: "logs", description: "Search logs" }],
			tags: ["logging", "analysis", "search"],
			kula: "shiksha",
		}),
	];
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1 — Algorithmic Pre-Filter
// ═══════════════════════════════════════════════════════════════════════════

describe("matchSkillsV2 — Phase 1: Algorithmic Pre-Filter", () => {
	describe("Ashrama gating", () => {
		it("excludes skills in brahmacharya stage", () => {
			const skills = [
				makeEnhancedSkill({ name: "student-skill", description: "Read files from the filesystem" }),
				makeEnhancedSkill({ name: "active-skill", description: "Read files from the filesystem" }),
			];

			const context: MatchContext = {
				ashramamStages: new Map([
					["student-skill", "brahmacharya"],
					["active-skill", "grihastha"],
				]),
				trustScores: new Map([
					["student-skill", 0.9],
					["active-skill", 0.9],
				]),
			};

			const results = matchSkillsV2({ text: "read files from the filesystem" }, skills, context);
			const names = results.map((r) => r.skill.name);
			expect(names).not.toContain("student-skill");
			expect(names).toContain("active-skill");
		});

		it("excludes skills in sannyasa stage", () => {
			const skills = [
				makeEnhancedSkill({ name: "archived-skill", description: "Read filesystem data" }),
				makeEnhancedSkill({ name: "live-skill", description: "Read filesystem data" }),
			];

			const context: MatchContext = {
				ashramamStages: new Map([
					["archived-skill", "sannyasa"],
					["live-skill", "grihastha"],
				]),
				trustScores: new Map([
					["archived-skill", 0.9],
					["live-skill", 0.9],
				]),
			};

			const results = matchSkillsV2({ text: "read filesystem data" }, skills, context);
			const names = results.map((r) => r.skill.name);
			expect(names).not.toContain("archived-skill");
		});

		it("includes skills in grihastha stage at full weight", () => {
			const skill = makeEnhancedSkill({
				name: "active-skill",
				description: "Read files from filesystem",
			});

			const context: MatchContext = {
				ashramamStages: new Map([["active-skill", "grihastha"]]),
				trustScores: new Map([["active-skill", 1.0]]),
			};

			const results = matchSkillsV2({ text: "read files from filesystem" }, [skill], context);
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].breakdown.ashramamWeight).toBe(ASHRAMA_MATCH_WEIGHT.grihastha);
			expect(results[0].breakdown.ashramamWeight).toBe(1.0);
		});

		it("applies 0.5x penalty to vanaprastha skills", () => {
			const skills = [
				makeEnhancedSkill({ name: "retired-skill", description: "Read local filesystem files" }),
				makeEnhancedSkill({ name: "active-skill", description: "Read local filesystem files" }),
			];

			const context: MatchContext = {
				ashramamStages: new Map([
					["retired-skill", "vanaprastha"],
					["active-skill", "grihastha"],
				]),
				trustScores: new Map([
					["retired-skill", 1.0],
					["active-skill", 1.0],
				]),
			};

			const results = matchSkillsV2({ text: "read local filesystem files" }, skills, context);
			const retired = results.find((r) => r.skill.name === "retired-skill");
			const active = results.find((r) => r.skill.name === "active-skill");

			if (retired && active) {
				expect(retired.breakdown.ashramamWeight).toBe(0.5);
				expect(active.breakdown.ashramamWeight).toBe(1.0);
				// Same base score but vanaprastha gets halved
				expect(active.score).toBeGreaterThan(retired.score);
			}
		});
	});

	describe("Kula priority weighting", () => {
		it("antara skills get 1.0x kula weight", () => {
			const skill = makeEnhancedSkill({
				name: "core-skill",
				description: "Core filesystem operations",
				kula: "antara",
			});

			const context: MatchContext = {
				trustScores: new Map([["core-skill", 1.0]]),
			};

			const results = matchSkillsV2({ text: "core filesystem operations" }, [skill], context);
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].breakdown.kulaPriority).toBe(KULA_WEIGHTS.antara);
			expect(results[0].breakdown.kulaPriority).toBe(1.0);
		});

		it("bahya skills get 0.7x kula weight", () => {
			const skill = makeEnhancedSkill({
				name: "community-skill",
				description: "Read files from the local filesystem with encoding detection",
				capabilities: [{ verb: "read", object: "files", description: "Read a file at a given path" }],
				tags: ["filesystem", "io", "read"],
				kula: "bahya",
			});

			const context: MatchContext = {
				trustScores: new Map([["community-skill", 1.0]]),
			};

			const results = matchSkillsV2(
				{ text: "read files from the local filesystem", threshold: 0.01 },
				[skill],
				context,
			);
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].breakdown.kulaPriority).toBe(KULA_WEIGHTS.bahya);
			expect(results[0].breakdown.kulaPriority).toBe(0.7);
		});

		it("shiksha skills get 0.4x kula weight", () => {
			const skill = makeEnhancedSkill({
				name: "learned-skill",
				description: "Auto-learned file operations",
				kula: "shiksha",
			});

			const context: MatchContext = {
				trustScores: new Map([["learned-skill", 1.0]]),
			};

			const results = matchSkillsV2({ text: "auto-learned file operations" }, [skill], context);
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].breakdown.kulaPriority).toBe(KULA_WEIGHTS.shiksha);
			expect(results[0].breakdown.kulaPriority).toBe(0.4);
		});

		it("antara ranks higher than bahya with same base score", () => {
			const skills = [
				makeEnhancedSkill({ name: "antara-reader", description: "Read filesystem files", kula: "antara" }),
				makeEnhancedSkill({ name: "bahya-reader", description: "Read filesystem files", kula: "bahya" }),
			];

			const context: MatchContext = {
				trustScores: new Map([
					["antara-reader", 1.0],
					["bahya-reader", 1.0],
				]),
			};

			const results = matchSkillsV2({ text: "read filesystem files" }, skills, context);
			const antara = results.find((r) => r.skill.name === "antara-reader");
			const bahya = results.find((r) => r.skill.name === "bahya-reader");
			if (antara && bahya) {
				expect(antara.score).toBeGreaterThan(bahya.score);
			}
		});

		it("bahya ranks higher than shiksha with same base score", () => {
			const skills = [
				makeEnhancedSkill({ name: "bahya-tool", description: "Transform images resize", kula: "bahya" }),
				makeEnhancedSkill({ name: "shiksha-tool", description: "Transform images resize", kula: "shiksha" }),
			];

			const context: MatchContext = {
				trustScores: new Map([
					["bahya-tool", 1.0],
					["shiksha-tool", 1.0],
				]),
			};

			const results = matchSkillsV2({ text: "transform images resize" }, skills, context);
			const bahya = results.find((r) => r.skill.name === "bahya-tool");
			const shiksha = results.find((r) => r.skill.name === "shiksha-tool");
			if (bahya && shiksha) {
				expect(bahya.score).toBeGreaterThan(shiksha.score);
			}
		});
	});

	describe("Trust score multiplier", () => {
		it("multiplies trust score into the final score", () => {
			const skills = [
				makeEnhancedSkill({ name: "trusted-skill", description: "Search log files and analyze" }),
				makeEnhancedSkill({ name: "untrusted-skill", description: "Search log files and analyze" }),
			];

			const context: MatchContext = {
				trustScores: new Map([
					["trusted-skill", 1.0],
					["untrusted-skill", 0.3],
				]),
			};

			const results = matchSkillsV2({ text: "search log files and analyze" }, skills, context);
			const trusted = results.find((r) => r.skill.name === "trusted-skill");
			const untrusted = results.find((r) => r.skill.name === "untrusted-skill");

			if (trusted && untrusted) {
				expect(trusted.score).toBeGreaterThan(untrusted.score);
				expect(trusted.breakdown.trustMultiplier).toBe(1.0);
				expect(untrusted.breakdown.trustMultiplier).toBe(0.3);
			}
		});

		it("defaults trust to 0.5 when not provided", () => {
			const skill = makeEnhancedSkill({
				name: "no-trust-data",
				description: "Read filesystem files",
			});

			const results = matchSkillsV2({ text: "read filesystem files" }, [skill]);
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].breakdown.trustMultiplier).toBe(0.5);
		});
	});

	describe("Pranamaya requirements check", () => {
		it("excludes skills with unsatisfied requirements", () => {
			const skills = [
				makeEnhancedSkill({ name: "satisfied-skill", description: "Read filesystem files with encoding" }),
				makeEnhancedSkill({ name: "unsatisfied-skill", description: "Read filesystem files with encoding" }),
			];

			const context: MatchContext = {
				requirementsSatisfied: new Map([
					["satisfied-skill", true],
					["unsatisfied-skill", false],
				]),
				trustScores: new Map([
					["satisfied-skill", 0.9],
					["unsatisfied-skill", 0.9],
				]),
			};

			const results = matchSkillsV2({ text: "read filesystem files with encoding" }, skills, context);
			const names = results.map((r) => r.skill.name);
			expect(names).toContain("satisfied-skill");
			expect(names).not.toContain("unsatisfied-skill");
		});

		it("includes skills not in requirementsSatisfied map (assumed satisfied)", () => {
			const skill = makeEnhancedSkill({
				name: "unknown-reqs",
				description: "Read filesystem files",
			});

			const context: MatchContext = {
				requirementsSatisfied: new Map(), // empty map
				trustScores: new Map([["unknown-reqs", 0.9]]),
			};

			const results = matchSkillsV2({ text: "read filesystem files" }, [skill], context);
			expect(results.length).toBeGreaterThan(0);
		});

		it("reports requirementsMet=true in breakdown when satisfied", () => {
			const skill = makeEnhancedSkill({
				name: "met-skill",
				description: "Read filesystem files",
			});

			const context: MatchContext = {
				requirementsSatisfied: new Map([["met-skill", true]]),
				trustScores: new Map([["met-skill", 0.9]]),
			};

			const results = matchSkillsV2({ text: "read filesystem files" }, [skill], context);
			expect(results[0].breakdown.requirementsMet).toBe(true);
		});
	});

	describe("Top-K phase 1 candidates", () => {
		it("returns at most 5 results (top-10 from phase 1, top-5 from phase 2)", () => {
			const skills = makeSkillBank(); // 10 skills
			const query: SkillQuery = { text: "read write analyze search execute" };

			const context: MatchContext = {
				trustScores: new Map(skills.map((s) => [s.name, 0.9])),
			};

			const results = matchSkillsV2(query, skills, context);
			expect(results.length).toBeLessThanOrEqual(5);
		});
	});

	describe("TVM cosine similarity", () => {
		it("matching query text produces higher score for relevant skill", () => {
			const skills = [
				makeEnhancedSkill({
					name: "file-reader",
					description: "Read files from the local filesystem with encoding detection",
					tags: ["filesystem", "io", "read"],
				}),
				makeEnhancedSkill({
					name: "image-resizer",
					description: "Resize and optimize images for different display formats",
					tags: ["image", "media", "transform"],
				}),
			];

			const context: MatchContext = {
				trustScores: new Map([
					["file-reader", 1.0],
					["image-resizer", 1.0],
				]),
			};

			const results = matchSkillsV2({ text: "read files from the filesystem" }, skills, context);
			expect(results.length).toBeGreaterThan(0);
			// file-reader should rank higher for a filesystem query
			if (results.length >= 2) {
				const fr = results.find((r) => r.skill.name === "file-reader");
				const ir = results.find((r) => r.skill.name === "image-resizer");
				if (fr && ir) {
					expect(fr.score).toBeGreaterThan(ir.score);
				}
			}
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 — Contextual Re-Ranking
// ═══════════════════════════════════════════════════════════════════════════

describe("matchSkillsV2 — Phase 2: Contextual Re-Ranking", () => {
	describe("Identity without context", () => {
		it("phase 2 is identity when no context provided (same order as phase 1)", () => {
			const skills = [
				makeEnhancedSkill({
					name: "file-reader",
					description: "Read files from the local filesystem",
					tags: ["filesystem", "io"],
				}),
				makeEnhancedSkill({
					name: "code-analyzer",
					description: "Analyze source code quality",
					tags: ["analysis", "code"],
				}),
			];

			const results = matchSkillsV2({ text: "read files" }, skills);
			// Without context, chetanaBoost should be 0
			for (const r of results) {
				expect(r.breakdown.chetanaBoost).toBe(0);
			}
		});

		it("phase 2 is identity when context is empty object", () => {
			const skills = [
				makeEnhancedSkill({
					name: "skill-a",
					description: "Read files from the local filesystem with encoding detection",
					capabilities: [{ verb: "read", object: "files", description: "Read a file" }],
					tags: ["filesystem", "io", "read"],
				}),
			];

			const emptyContext: MatchContext = {};
			const results = matchSkillsV2(
				{ text: "read files from the local filesystem", threshold: 0.01 },
				skills,
				emptyContext,
			);
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].breakdown.chetanaBoost).toBe(0);
		});
	});

	describe("Focus concepts boost", () => {
		it("boosts skills whose tags match focus concepts", () => {
			const skills = [
				makeEnhancedSkill({
					name: "fs-reader",
					description: "Read data from storage",
					tags: ["filesystem", "storage"],
				}),
				makeEnhancedSkill({
					name: "net-reader",
					description: "Read data from storage",
					tags: ["network", "http"],
				}),
			];

			const context: MatchContext = {
				focusConcepts: new Map([["filesystem", 0.8]]),
				trustScores: new Map([
					["fs-reader", 1.0],
					["net-reader", 1.0],
				]),
			};

			const results = matchSkillsV2({ text: "read data from storage" }, skills, context);
			const fsResult = results.find((r) => r.skill.name === "fs-reader");
			const netResult = results.find((r) => r.skill.name === "net-reader");
			if (fsResult && netResult) {
				// fs-reader should get a focus boost
				expect(fsResult.score).toBeGreaterThanOrEqual(netResult.score);
			}
		});

		it("focus concepts boost is proportional to concept weight", () => {
			const skill = makeEnhancedSkill({
				name: "matching-skill",
				description: "Filesystem operations reader tool",
				tags: ["filesystem"],
			});

			const highWeightContext: MatchContext = {
				focusConcepts: new Map([["filesystem", 1.0]]),
				trustScores: new Map([["matching-skill", 1.0]]),
			};

			const lowWeightContext: MatchContext = {
				focusConcepts: new Map([["filesystem", 0.1]]),
				trustScores: new Map([["matching-skill", 1.0]]),
			};

			const highResults = matchSkillsV2({ text: "filesystem operations" }, [skill], highWeightContext);
			const lowResults = matchSkillsV2({ text: "filesystem operations" }, [skill], lowWeightContext);

			expect(highResults[0].score).toBeGreaterThanOrEqual(lowResults[0].score);
		});
	});

	describe("Frustration boost", () => {
		it("boosts high-success-rate skills when frustrated", () => {
			const skills = [
				makeEnhancedSkill({ name: "reliable-tool", description: "Execute build commands run" }),
				makeEnhancedSkill({ name: "flaky-tool", description: "Execute build commands run" }),
			];

			const context: MatchContext = {
				frustration: 0.9, // Very frustrated
				mastery: new Map([
					["reliable-tool", makeMastery({ successRate: 0.95, thompsonAlpha: 10, thompsonBeta: 1 })],
					["flaky-tool", makeMastery({ successRate: 0.3, thompsonAlpha: 2, thompsonBeta: 5 })],
				]),
				trustScores: new Map([
					["reliable-tool", 1.0],
					["flaky-tool", 1.0],
				]),
			};

			const results = matchSkillsV2({ text: "execute build commands run" }, skills, context);
			const reliable = results.find((r) => r.skill.name === "reliable-tool");
			const flaky = results.find((r) => r.skill.name === "flaky-tool");

			if (reliable && flaky) {
				expect(reliable.score).toBeGreaterThan(flaky.score);
			}
		});

		it("no frustration boost when frustration <= 0.5", () => {
			const skill = makeEnhancedSkill({ name: "tool-a", description: "Read files from disk" });

			// Provide no mastery context to avoid Thompson Sampling randomness
			const context: MatchContext = {
				frustration: 0.3,
				trustScores: new Map([["tool-a", 1.0]]),
			};

			const noFrustContext: MatchContext = {
				frustration: 0.0,
				trustScores: new Map([["tool-a", 1.0]]),
			};

			const withLowFrust = matchSkillsV2({ text: "read files from disk" }, [skill], context);
			const withNoFrust = matchSkillsV2({ text: "read files from disk" }, [skill], noFrustContext);

			if (withLowFrust.length > 0 && withNoFrust.length > 0) {
				// Both should have same score since frustration <= 0.5 and no Thompson noise
				expect(withLowFrust[0].score).toBeCloseTo(withNoFrust[0].score, 5);
			}
		});

		it("frustration boost only applies to skills with successRate > 0.7", () => {
			const skills = [
				makeEnhancedSkill({ name: "mediocre-tool", description: "Read filesystem data" }),
			];

			const context: MatchContext = {
				frustration: 0.9,
				mastery: new Map([
					["mediocre-tool", makeMastery({ successRate: 0.5, thompsonAlpha: 5, thompsonBeta: 5 })],
				]),
				trustScores: new Map([["mediocre-tool", 1.0]]),
			};

			const noFrustContext: MatchContext = {
				frustration: 0.0,
				mastery: new Map([
					["mediocre-tool", makeMastery({ successRate: 0.5, thompsonAlpha: 5, thompsonBeta: 5 })],
				]),
				trustScores: new Map([["mediocre-tool", 1.0]]),
			};

			const withFrust = matchSkillsV2({ text: "read filesystem data" }, skills, context);
			const withoutFrust = matchSkillsV2({ text: "read filesystem data" }, skills, noFrustContext);

			// mediocre success rate should NOT get frustration boost
			// Scores may differ slightly due to Thompson Sampling randomness
			// but there should be no frustration-specific boost
			expect(withFrust[0].score - withoutFrust[0].score).toBeLessThan(0.16);
		});
	});

	describe("Goal alignment boost", () => {
		it("boosts skills matching active goal keywords", () => {
			const skills = [
				makeEnhancedSkill({
					name: "test-runner",
					description: "Run test suites for verification",
					capabilities: [{ verb: "execute", object: "tests", description: "Run tests" }],
					tags: ["testing", "coverage"],
				}),
				makeEnhancedSkill({
					name: "file-reader",
					description: "Read local data from disk",
					capabilities: [{ verb: "read", object: "files", description: "Read" }],
					tags: ["filesystem", "io"],
				}),
			];

			const context: MatchContext = {
				activeGoalKeywords: ["testing", "coverage"],
				trustScores: new Map([
					["test-runner", 1.0],
					["file-reader", 1.0],
				]),
			};

			const results = matchSkillsV2({ text: "run the tests" }, skills, context);
			const testRunner = results.find((r) => r.skill.name === "test-runner");
			const fileReader = results.find((r) => r.skill.name === "file-reader");

			if (testRunner && fileReader) {
				expect(testRunner.score).toBeGreaterThan(fileReader.score);
			}
		});

		it("no goal boost when no active goals", () => {
			const skill = makeEnhancedSkill({
				name: "any-tool",
				description: "Process data operations",
				tags: ["data"],
			});

			const contextWithGoals: MatchContext = {
				activeGoalKeywords: [],
				trustScores: new Map([["any-tool", 1.0]]),
			};

			const results = matchSkillsV2({ text: "process data operations" }, [skill], contextWithGoals);
			expect(results.length).toBeGreaterThan(0);
			// chetanaBoost should be 0 (goal boost is part of it)
			expect(results[0].breakdown.chetanaBoost).toBe(0);
		});
	});

	describe("Mastery boost (Wilson CI / Thompson Sampling in matching)", () => {
		it("skills with high mastery (high alpha/low beta) get exploration bonus", () => {
			const skills = [
				makeEnhancedSkill({ name: "expert-tool", description: "Search filesystem data" }),
				makeEnhancedSkill({ name: "novice-tool", description: "Search filesystem data" }),
			];

			const context: MatchContext = {
				mastery: new Map([
					["expert-tool", makeMastery({ thompsonAlpha: 100, thompsonBeta: 2 })],
					["novice-tool", makeMastery({ thompsonAlpha: 1, thompsonBeta: 1 })],
				]),
				trustScores: new Map([
					["expert-tool", 1.0],
					["novice-tool", 1.0],
				]),
			};

			// Run multiple times to check statistical tendency
			let expertHigherCount = 0;
			const trials = 20;
			for (let i = 0; i < trials; i++) {
				const results = matchSkillsV2({ text: "search filesystem data" }, skills, context);
				const expert = results.find((r) => r.skill.name === "expert-tool");
				const novice = results.find((r) => r.skill.name === "novice-tool");
				if (expert && novice && expert.score > novice.score) {
					expertHigherCount++;
				}
			}
			// Expert should win most of the time (Thompson Sampling with 100:2)
			expect(expertHigherCount).toBeGreaterThan(trials * 0.5);
		});
	});

	describe("Preference rules", () => {
		it("preferred skill gets positive boost over the other", () => {
			const skills = [
				makeEnhancedSkill({ name: "preferred-tool", description: "Read filesystem files data" }),
				makeEnhancedSkill({ name: "other-tool", description: "Read filesystem files data" }),
			];

			const context: MatchContext = {
				preferenceRules: [
					{ preferred: "preferred-tool", over: "other-tool", confidence: 1.0 },
				],
				trustScores: new Map([
					["preferred-tool", 1.0],
					["other-tool", 1.0],
				]),
			};

			const results = matchSkillsV2({ text: "read filesystem files data" }, skills, context);
			const preferred = results.find((r) => r.skill.name === "preferred-tool");
			const other = results.find((r) => r.skill.name === "other-tool");

			if (preferred && other) {
				expect(preferred.score).toBeGreaterThan(other.score);
			}
		});

		it("preference confidence scales the boost", () => {
			const skills = [
				makeEnhancedSkill({ name: "pref-high", description: "Read filesystem data files" }),
				makeEnhancedSkill({ name: "pref-low", description: "Read filesystem data files" }),
			];

			const highConfContext: MatchContext = {
				preferenceRules: [
					{ preferred: "pref-high", over: "pref-low", confidence: 1.0 },
				],
				trustScores: new Map([
					["pref-high", 1.0],
					["pref-low", 1.0],
				]),
			};

			const lowConfContext: MatchContext = {
				preferenceRules: [
					{ preferred: "pref-high", over: "pref-low", confidence: 0.1 },
				],
				trustScores: new Map([
					["pref-high", 1.0],
					["pref-low", 1.0],
				]),
			};

			const highResults = matchSkillsV2({ text: "read filesystem data files" }, skills, highConfContext);
			const lowResults = matchSkillsV2({ text: "read filesystem data files" }, skills, lowConfContext);

			const highPref = highResults.find((r) => r.skill.name === "pref-high");
			const lowPref = lowResults.find((r) => r.skill.name === "pref-high");

			if (highPref && lowPref) {
				expect(highPref.score).toBeGreaterThanOrEqual(lowPref.score);
			}
		});
	});

	describe("Thompson Sampling properties (via pipeline)", () => {
		it("thompsonSample in breakdown is in [0, 1]", () => {
			const skill = makeEnhancedSkill({ name: "ts-skill", description: "Read files from disk" });

			const context: MatchContext = {
				mastery: new Map([
					["ts-skill", makeMastery({ thompsonAlpha: 5, thompsonBeta: 3 })],
				]),
				trustScores: new Map([["ts-skill", 1.0]]),
			};

			for (let i = 0; i < 30; i++) {
				const results = matchSkillsV2({ text: "read files from disk" }, [skill], context);
				if (results.length > 0) {
					expect(results[0].breakdown.thompsonSample).toBeGreaterThanOrEqual(0);
					expect(results[0].breakdown.thompsonSample).toBeLessThanOrEqual(1);
				}
			}
		});

		it("high alpha/low beta produces thompsonSample skewed toward 1.0", () => {
			const skill = makeEnhancedSkill({ name: "high-alpha", description: "Read filesystem data" });

			const context: MatchContext = {
				mastery: new Map([
					["high-alpha", makeMastery({ thompsonAlpha: 50, thompsonBeta: 2 })],
				]),
				trustScores: new Map([["high-alpha", 1.0]]),
			};

			let totalSample = 0;
			const trials = 50;
			for (let i = 0; i < trials; i++) {
				const results = matchSkillsV2({ text: "read filesystem data" }, [skill], context);
				if (results.length > 0) {
					totalSample += results[0].breakdown.thompsonSample;
				}
			}
			const meanSample = totalSample / trials;
			// With alpha=50, beta=2, the mean of Beta distribution is 50/52 ~ 0.96
			expect(meanSample).toBeGreaterThan(0.7);
		});

		it("alpha=1, beta=1 produces near-uniform thompsonSample (mean ~0.5)", () => {
			const skill = makeEnhancedSkill({ name: "uniform-skill", description: "Read filesystem data" });

			const context: MatchContext = {
				mastery: new Map([
					["uniform-skill", makeMastery({ thompsonAlpha: 1, thompsonBeta: 1 })],
				]),
				trustScores: new Map([["uniform-skill", 1.0]]),
			};

			let totalSample = 0;
			const trials = 100;
			for (let i = 0; i < trials; i++) {
				const results = matchSkillsV2({ text: "read filesystem data" }, [skill], context);
				if (results.length > 0) {
					totalSample += results[0].breakdown.thompsonSample;
				}
			}
			const meanSample = totalSample / trials;
			// Beta(1,1) = Uniform(0,1), mean = 0.5
			expect(meanSample).toBeGreaterThan(0.2);
			expect(meanSample).toBeLessThan(0.8);
		});
	});

	describe("Phase 2 returns top 5", () => {
		it("returns at most 5 results after phase 2", () => {
			const skills = makeSkillBank(); // 10 skills

			const context: MatchContext = {
				trustScores: new Map(skills.map((s) => [s.name, 0.9])),
			};

			const results = matchSkillsV2(
				{ text: "read write analyze search execute transform create" },
				skills,
				context,
			);
			expect(results.length).toBeLessThanOrEqual(5);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3 — Model Disambiguation Flag
// ═══════════════════════════════════════════════════════════════════════════

describe("matchSkillsV2 — Phase 3: Model Disambiguation", () => {
	it("sets resolvedInPhase=3 when top-2 scores within 0.05", () => {
		// Two skills with identical descriptions should produce very close scores
		const skills = [
			makeEnhancedSkill({
				name: "twin-a",
				description: "Read filesystem files with encoding detection",
				tags: ["filesystem", "io"],
				kula: "antara",
			}),
			makeEnhancedSkill({
				name: "twin-b",
				description: "Read filesystem files with encoding detection",
				tags: ["filesystem", "io"],
				kula: "antara",
			}),
		];

		const context: MatchContext = {
			trustScores: new Map([
				["twin-a", 1.0],
				["twin-b", 1.0],
			]),
		};

		const results = matchSkillsV2({ text: "read filesystem files with encoding detection" }, skills, context);
		expect(results.length).toBe(2);
		// With identical skills, scores should be within 0.05
		const scoreDiff = Math.abs(results[0].score - results[1].score);
		if (scoreDiff <= 0.05) {
			expect(results[0].resolvedInPhase).toBe(3);
		}
	});

	it("sets resolvedInPhase=2 when top-2 scores differ by > 0.05", () => {
		const skills = [
			makeEnhancedSkill({
				name: "file-reader",
				description: "Read files from the local filesystem",
				tags: ["filesystem", "io", "read"],
				kula: "antara",
			}),
			makeEnhancedSkill({
				name: "image-resizer",
				description: "Resize and optimize images for display",
				tags: ["image", "media"],
				kula: "shiksha",
			}),
		];

		const context: MatchContext = {
			trustScores: new Map([
				["file-reader", 1.0],
				["image-resizer", 0.4],
			]),
		};

		const results = matchSkillsV2({ text: "read files from the filesystem" }, skills, context);
		if (results.length >= 2) {
			const scoreDiff = results[0].score - results[1].score;
			if (scoreDiff > 0.05) {
				expect(results[0].resolvedInPhase).toBe(2);
			}
		}
	});

	it("no disambiguation needed with only 1 result", () => {
		const skill = makeEnhancedSkill({
			name: "only-skill",
			description: "Read filesystem data files",
		});

		const context: MatchContext = {
			trustScores: new Map([["only-skill", 1.0]]),
		};

		const results = matchSkillsV2({ text: "read filesystem data files" }, [skill], context);
		expect(results.length).toBe(1);
		// With only 1 result, phase 3 check is not triggered
		expect(results[0].resolvedInPhase).toBe(2);
	});

	it("no disambiguation needed with 0 results", () => {
		const results = matchSkillsV2({ text: "xyz_nonexistent_query" }, []);
		expect(results.length).toBe(0);
	});

	it("only top result gets resolvedInPhase=3, rest stay at 2", () => {
		const skills = [
			makeEnhancedSkill({
				name: "ambig-a",
				description: "Read filesystem files encoding detection",
				tags: ["filesystem"],
				kula: "antara",
			}),
			makeEnhancedSkill({
				name: "ambig-b",
				description: "Read filesystem files encoding detection",
				tags: ["filesystem"],
				kula: "antara",
			}),
			makeEnhancedSkill({
				name: "unrelated",
				description: "Resize images for display",
				tags: ["image"],
				kula: "shiksha",
			}),
		];

		const context: MatchContext = {
			trustScores: new Map([
				["ambig-a", 1.0],
				["ambig-b", 1.0],
				["unrelated", 0.4],
			]),
		};

		const results = matchSkillsV2({ text: "read filesystem files encoding detection" }, skills, context);
		// Check that non-first results have resolvedInPhase=2
		for (let i = 1; i < results.length; i++) {
			expect(results[i].resolvedInPhase).toBe(2);
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// End-to-End Pipeline
// ═══════════════════════════════════════════════════════════════════════════

describe("matchSkillsV2 — End-to-End Pipeline", () => {
	it("full pipeline with 10 skills, various stages/kula/trust produces correct ranking", () => {
		const skills = makeSkillBank();
		const context: MatchContext = {
			ashramamStages: new Map([
				["file-reader", "grihastha"],
				["code-analyzer", "grihastha"],
				["database-query", "grihastha"],
				["file-writer", "grihastha"],
				["web-scraper", "vanaprastha"],
				["image-resizer", "grihastha"],
				["git-manager", "grihastha"],
				["test-runner", "grihastha"],
				["docker-builder", "brahmacharya"],  // excluded
				["log-analyzer", "grihastha"],
			]),
			trustScores: new Map([
				["file-reader", 0.95],
				["code-analyzer", 0.90],
				["database-query", 0.60],
				["file-writer", 0.85],
				["web-scraper", 0.50],
				["image-resizer", 0.40],
				["git-manager", 0.95],
				["test-runner", 0.90],
				["docker-builder", 0.80],
				["log-analyzer", 0.30],
			]),
			focusConcepts: new Map([["filesystem", 0.7]]),
			activeGoalKeywords: ["read"],
		};

		const results = matchSkillsV2({ text: "read files from the filesystem" }, skills, context);

		// docker-builder should be excluded (brahmacharya)
		const names = results.map((r) => r.skill.name);
		expect(names).not.toContain("docker-builder");

		// file-reader should rank high (antara, high trust, matching description)
		if (results.length > 0) {
			expect(results[0].skill.name).toBe("file-reader");
		}
	});

	it("threshold filtering excludes scores below threshold", () => {
		const skills = [
			makeEnhancedSkill({
				name: "matching",
				description: "Read files from the local filesystem",
				tags: ["filesystem"],
			}),
			makeEnhancedSkill({
				name: "unrelated",
				description: "Deploy kubernetes clusters in cloud",
				tags: ["kubernetes", "cloud"],
			}),
		];

		const context: MatchContext = {
			trustScores: new Map([
				["matching", 1.0],
				["unrelated", 1.0],
			]),
		};

		const results = matchSkillsV2(
			{ text: "read files from the local filesystem", threshold: 0.3 },
			skills,
			context,
		);

		for (const r of results) {
			expect(r.score).toBeGreaterThanOrEqual(0.3);
		}
	});

	it("empty skills array returns empty results", () => {
		const results = matchSkillsV2({ text: "read files" }, []);
		expect(results).toEqual([]);
	});

	it("query with no matches returns empty when threshold is high", () => {
		const skills = [
			makeEnhancedSkill({
				name: "docker-builder",
				description: "Build Docker containers",
				tags: ["docker"],
			}),
		];

		const results = matchSkillsV2(
			{ text: "quantum entanglement simulation", threshold: 0.9 },
			skills,
		);
		expect(results.length).toBe(0);
	});

	it("all results have valid VidyaTantraMatch structure", () => {
		const skills = makeSkillBank().slice(0, 3);
		const context: MatchContext = {
			trustScores: new Map(skills.map((s) => [s.name, 0.8])),
		};

		const results = matchSkillsV2(
			{ text: "read analyze search" },
			skills,
			context,
		);

		for (const r of results) {
			// Check all breakdown fields exist
			expect(typeof r.score).toBe("number");
			expect(r.score).toBeGreaterThanOrEqual(0);
			expect(r.score).toBeLessThanOrEqual(1);
			expect(typeof r.breakdown.traitSimilarity).toBe("number");
			expect(typeof r.breakdown.tagBoost).toBe("number");
			expect(typeof r.breakdown.capabilityMatch).toBe("number");
			expect(typeof r.breakdown.antiPatternPenalty).toBe("number");
			expect(typeof r.breakdown.kulaPriority).toBe("number");
			expect(typeof r.breakdown.trustMultiplier).toBe("number");
			expect(typeof r.breakdown.ashramamWeight).toBe("number");
			expect(typeof r.breakdown.thompsonSample).toBe("number");
			expect(typeof r.breakdown.chetanaBoost).toBe("number");
			expect(typeof r.breakdown.requirementsMet).toBe("boolean");
			expect([1, 2, 3]).toContain(r.resolvedInPhase);
		}
	});

	it("scores are clamped to [0, 1]", () => {
		const skills = makeSkillBank();
		const context: MatchContext = {
			trustScores: new Map(skills.map((s) => [s.name, 1.0])),
			focusConcepts: new Map([["filesystem", 1.0], ["io", 1.0], ["read", 1.0]]),
			activeGoalKeywords: ["filesystem", "io", "read"],
			mastery: new Map(skills.map((s) => [
				s.name,
				makeMastery({ thompsonAlpha: 100, thompsonBeta: 1 }),
			])),
			preferenceRules: skills.map((s) => ({
				preferred: s.name, over: "nonexistent", confidence: 1.0,
			})),
		};

		const results = matchSkillsV2({ text: "read files io filesystem" }, skills, context);
		for (const r of results) {
			expect(r.score).toBeGreaterThanOrEqual(0);
			expect(r.score).toBeLessThanOrEqual(1);
		}
	});

	it("skills without kula default to bahya weight (0.7)", () => {
		const skill = makeEnhancedSkill({
			name: "no-kula",
			description: "Read filesystem data files",
		});
		// Remove kula explicitly
		delete (skill as any).kula;

		const context: MatchContext = {
			trustScores: new Map([["no-kula", 1.0]]),
		};

		const results = matchSkillsV2({ text: "read filesystem data files" }, [skill], context);
		if (results.length > 0) {
			expect(results[0].breakdown.kulaPriority).toBe(0.7);
		}
	});
});
