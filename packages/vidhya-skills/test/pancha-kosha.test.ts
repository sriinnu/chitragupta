import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
	scoreAnnamaya,
	scorePranamaya,
	scoreManomaya,
	scoreVijnanamaya,
	scoreAnandamaya,
	buildPanchaKosha,
	checkPranamaya,
	clearPranamayaCache,
} from "../src/pancha-kosha.js";
import type { PranamayaCheckResult } from "../src/pancha-kosha.js";
import type { SkillManifest, SkillCapability } from "../src/types.js";
import type {
	EnhancedSkillManifest,
	PranamayaRequirements,
	AnandamayaMastery,
	PanchaKoshaScores,
} from "../src/types-v2.js";
import { KOSHA_WEIGHTS, INITIAL_ANANDAMAYA } from "../src/types-v2.js";
import type { SurakshaScanResult } from "../src/suraksha.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCapability(
	verb = "read",
	object = "files",
	description = "Read file contents"
): SkillCapability {
	return { verb, object, description };
}

function makeBaseManifest(overrides?: Partial<SkillManifest>): SkillManifest {
	return {
		name: "test-skill",
		version: "1.0.0",
		description: "A test skill for unit tests",
		capabilities: [makeCapability()],
		tags: ["test", "unit", "sample"],
		source: { type: "manual", filePath: "/tmp/test.md" },
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function makeEnhancedManifest(
	overrides?: Partial<EnhancedSkillManifest>
): EnhancedSkillManifest {
	return {
		...makeBaseManifest(),
		...overrides,
	} as EnhancedSkillManifest;
}

function makeMastery(overrides?: Partial<AnandamayaMastery>): AnandamayaMastery {
	return {
		...INITIAL_ANANDAMAYA,
		...overrides,
	};
}

function makeScanResult(
	verdict: SurakshaScanResult["verdict"] = "clean",
	overrides?: Partial<SurakshaScanResult>
): SurakshaScanResult {
	return {
		skillName: "test-skill",
		verdict,
		findings: [],
		riskScore: verdict === "clean" ? 0 : 0.5,
		scanDurationMs: 10,
		contentHash: 12345,
		...overrides,
	};
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Pancha Kosha", () => {
	beforeEach(() => {
		clearPranamayaCache();
	});

	// ── scoreAnnamaya ────────────────────────────────────────────────────

	describe("scoreAnnamaya", () => {
		it("scores 0.3 for basic metadata (name + version + description)", () => {
			const manifest = makeBaseManifest({
				capabilities: [],
				tags: [],
				traitVector: undefined,
			});
			// No scan: +0.15 for unknown
			const score = scoreAnnamaya(manifest);
			expect(score).toBeCloseTo(0.3 + 0.15, 5);
		});

		it("scores 0 for a manifest missing name", () => {
			const manifest = makeBaseManifest({
				name: "",
				capabilities: [],
				tags: [],
				traitVector: undefined,
			});
			// name is falsy, so no 0.3. No scan: +0.15
			expect(scoreAnnamaya(manifest)).toBeCloseTo(0.15, 5);
		});

		it("adds 0.2 when capabilities are present", () => {
			const manifest = makeBaseManifest({
				tags: [],
				traitVector: undefined,
			});
			// metadata(0.3) + caps(0.2) + no scan(0.15)
			expect(scoreAnnamaya(manifest)).toBeCloseTo(0.65, 5);
		});

		it("adds 0.1 when traitVector is present", () => {
			const manifest = makeBaseManifest({
				tags: [],
				traitVector: [0.1, 0.2, 0.3],
			});
			// metadata(0.3) + caps(0.2) + trait(0.1) + no scan(0.15)
			expect(scoreAnnamaya(manifest)).toBeCloseTo(0.75, 5);
		});

		it("adds 0.1 when tags are present", () => {
			const manifest = makeBaseManifest({
				traitVector: undefined,
			});
			// metadata(0.3) + caps(0.2) + tags(0.1) + no scan(0.15)
			expect(scoreAnnamaya(manifest)).toBeCloseTo(0.75, 5);
		});

		it("scores full 1.0 with complete manifest + clean scan", () => {
			const manifest = makeBaseManifest({
				traitVector: [0.1, 0.2],
			});
			const scan = makeScanResult("clean");
			// metadata(0.3) + caps(0.2) + trait(0.1) + tags(0.1) + scan(0.3) = 1.0
			expect(scoreAnnamaya(manifest, scan)).toBeCloseTo(1.0, 5);
		});

		it("scores 0.15 for suspicious scan", () => {
			const manifest = makeBaseManifest({
				capabilities: [],
				tags: [],
				traitVector: undefined,
			});
			const scan = makeScanResult("suspicious");
			// metadata(0.3) + scan(0.15)
			expect(scoreAnnamaya(manifest, scan)).toBeCloseTo(0.45, 5);
		});

		it("scores 0.05 for dangerous scan", () => {
			const manifest = makeBaseManifest({
				capabilities: [],
				tags: [],
				traitVector: undefined,
			});
			const scan = makeScanResult("dangerous");
			// metadata(0.3) + scan(0.05)
			expect(scoreAnnamaya(manifest, scan)).toBeCloseTo(0.35, 5);
		});

		it("scores 0 for malicious scan", () => {
			const manifest = makeBaseManifest({
				capabilities: [],
				tags: [],
				traitVector: undefined,
			});
			const scan = makeScanResult("malicious");
			// metadata(0.3) + scan(0.0)
			expect(scoreAnnamaya(manifest, scan)).toBeCloseTo(0.3, 5);
		});

		it("scores 0.15 when no scan result is provided (unknown)", () => {
			const manifest = makeBaseManifest({
				capabilities: [],
				tags: [],
				traitVector: undefined,
			});
			// metadata(0.3) + no scan(0.15)
			expect(scoreAnnamaya(manifest)).toBeCloseTo(0.45, 5);
		});

		it("clamps to 1.0 maximum", () => {
			const manifest = makeBaseManifest({ traitVector: [0.1] });
			const scan = makeScanResult("clean");
			expect(scoreAnnamaya(manifest, scan)).toBeLessThanOrEqual(1.0);
		});

		it("handles empty trait vector (length 0 = not present)", () => {
			const manifest = makeBaseManifest({
				traitVector: [],
				tags: [],
				capabilities: [],
			});
			// metadata(0.3) + no scan(0.15) = 0.45 (no trait since empty)
			expect(scoreAnnamaya(manifest)).toBeCloseTo(0.45, 5);
		});

		it("handles empty capabilities array", () => {
			const manifest = makeBaseManifest({
				capabilities: [],
				tags: ["a"],
				traitVector: [1],
			});
			// metadata(0.3) + tags(0.1) + trait(0.1) + no scan(0.15) = 0.65
			expect(scoreAnnamaya(manifest)).toBeCloseTo(0.65, 5);
		});
	});

	// ── scorePranamaya ───────────────────────────────────────────────────

	describe("scorePranamaya", () => {
		it("returns 0.5 when no requirements are defined (undefined)", () => {
			expect(scorePranamaya(undefined)).toBe(0.5);
		});

		it("returns 1.0 when requirements exist but are all empty", () => {
			const reqs: PranamayaRequirements = {
				bins: [],
				env: [],
				os: [],
				network: false,
				privilege: false,
			};
			expect(scorePranamaya(reqs)).toBe(1.0);
		});

		it("returns 1.0 when all required bins exist (using known binary)", () => {
			const reqs: PranamayaRequirements = {
				bins: ["node"],  // node should always exist in test env
				env: [],
				os: [],
				network: false,
				privilege: false,
			};
			expect(scorePranamaya(reqs)).toBe(1.0);
		});

		it("returns partial score when some bins are missing", () => {
			const reqs: PranamayaRequirements = {
				bins: ["node", "nonexistent_binary_xyz_12345"],
				env: [],
				os: [],
				network: false,
				privilege: false,
			};
			const score = scorePranamaya(reqs);
			// 1 of 2 bins satisfied = 0.5
			expect(score).toBeCloseTo(0.5, 5);
		});

		it("returns 0 when all requirements fail", () => {
			const reqs: PranamayaRequirements = {
				bins: ["nonexistent_binary_xyz_12345"],
				env: [],
				os: [],
				network: false,
				privilege: false,
			};
			const score = scorePranamaya(reqs);
			expect(score).toBe(0);
		});

		it("checks env variable existence", () => {
			// Set a test env var
			process.env["__PANCHA_KOSHA_TEST_VAR__"] = "yes";
			const reqs: PranamayaRequirements = {
				bins: [],
				env: ["__PANCHA_KOSHA_TEST_VAR__"],
				os: [],
				network: false,
				privilege: false,
			};
			expect(scorePranamaya(reqs)).toBe(1.0);
			delete process.env["__PANCHA_KOSHA_TEST_VAR__"];
		});

		it("fails on missing env variable", () => {
			const reqs: PranamayaRequirements = {
				bins: [],
				env: ["__DEFINITELY_NOT_SET_VAR_XYZ_98765__"],
				os: [],
				network: false,
				privilege: false,
			};
			const score = scorePranamaya(reqs);
			expect(score).toBe(0);
		});

		it("scores correctly with mixed bins and env", () => {
			process.env["__PANCHA_KOSHA_MIXED_TEST__"] = "1";
			const reqs: PranamayaRequirements = {
				bins: ["node", "nonexistent_binary_abc_999"],
				env: ["__PANCHA_KOSHA_MIXED_TEST__", "__NOT_SET_FOO__"],
				os: [],
				network: false,
				privilege: false,
			};
			// 4 total checks: 2 satisfied (node + env var) / 4 = 0.5
			const score = scorePranamaya(reqs);
			expect(score).toBeCloseTo(0.5, 5);
			delete process.env["__PANCHA_KOSHA_MIXED_TEST__"];
		});

		it("score is always in [0, 1]", () => {
			const reqs: PranamayaRequirements = {
				bins: ["a", "b", "c", "d", "e"],
				env: ["X", "Y", "Z"],
				os: [],
				network: false,
				privilege: false,
			};
			const score = scorePranamaya(reqs);
			expect(score).toBeGreaterThanOrEqual(0);
			expect(score).toBeLessThanOrEqual(1);
		});
	});

	// ── scoreManomaya ────────────────────────────────────────────────────

	describe("scoreManomaya", () => {
		it("scores 0 for a minimal manifest (short desc, no extras)", () => {
			const manifest = makeBaseManifest({
				description: "Short",
				examples: undefined,
				antiPatterns: undefined,
				tags: [],
				capabilities: [],
				author: undefined,
			});
			expect(scoreManomaya(manifest)).toBe(0);
		});

		it("adds 0.2 for description > 50 chars", () => {
			const manifest = makeBaseManifest({
				description: "A".repeat(51),
				examples: undefined,
				antiPatterns: undefined,
				tags: [],
				capabilities: [],
				author: undefined,
			});
			expect(scoreManomaya(manifest)).toBeCloseTo(0.2, 5);
		});

		it("adds extra 0.1 for description > 200 chars", () => {
			const manifest = makeBaseManifest({
				description: "A".repeat(201),
				examples: undefined,
				antiPatterns: undefined,
				tags: [],
				capabilities: [],
				author: undefined,
			});
			// 0.2 (>50) + 0.1 (>200) = 0.3
			expect(scoreManomaya(manifest)).toBeCloseTo(0.3, 5);
		});

		it("adds 0.2 for having examples", () => {
			const manifest = makeBaseManifest({
				description: "short",
				examples: [{ description: "ex", input: {} }],
				antiPatterns: undefined,
				tags: [],
				capabilities: [],
				author: undefined,
			});
			expect(scoreManomaya(manifest)).toBeCloseTo(0.2, 5);
		});

		it("adds 0.1 for anti-patterns", () => {
			const manifest = makeBaseManifest({
				description: "short",
				examples: undefined,
				antiPatterns: ["Don't use for binary files"],
				tags: [],
				capabilities: [],
				author: undefined,
			});
			expect(scoreManomaya(manifest)).toBeCloseTo(0.1, 5);
		});

		it("adds 0.1 for >= 3 tags", () => {
			const manifest = makeBaseManifest({
				description: "short",
				examples: undefined,
				antiPatterns: undefined,
				tags: ["a", "b", "c"],
				capabilities: [],
				author: undefined,
			});
			expect(scoreManomaya(manifest)).toBeCloseTo(0.1, 5);
		});

		it("does not add tag bonus for < 3 tags", () => {
			const manifest = makeBaseManifest({
				description: "short",
				examples: undefined,
				antiPatterns: undefined,
				tags: ["a", "b"],
				capabilities: [],
				author: undefined,
			});
			expect(scoreManomaya(manifest)).toBe(0);
		});

		it("adds 0.2 for >= 2 capabilities with descriptions", () => {
			const manifest = makeBaseManifest({
				description: "short",
				examples: undefined,
				antiPatterns: undefined,
				tags: [],
				capabilities: [
					makeCapability("read", "files", "Read files from disk"),
					makeCapability("write", "files", "Write files to disk"),
				],
				author: undefined,
			});
			expect(scoreManomaya(manifest)).toBeCloseTo(0.2, 5);
		});

		it("does not add capability bonus for < 2 described capabilities", () => {
			const manifest = makeBaseManifest({
				description: "short",
				examples: undefined,
				antiPatterns: undefined,
				tags: [],
				capabilities: [makeCapability("read", "files", "Read files")],
				author: undefined,
			});
			expect(scoreManomaya(manifest)).toBe(0);
		});

		it("ignores capabilities without descriptions", () => {
			const manifest = makeBaseManifest({
				description: "short",
				examples: undefined,
				antiPatterns: undefined,
				tags: [],
				capabilities: [
					makeCapability("read", "files", "Read files"),
					{ verb: "write", object: "files", description: "" },
				],
				author: undefined,
			});
			expect(scoreManomaya(manifest)).toBe(0);
		});

		it("adds 0.1 for author", () => {
			const manifest = makeBaseManifest({
				description: "short",
				examples: undefined,
				antiPatterns: undefined,
				tags: [],
				capabilities: [],
				author: "tester",
			});
			expect(scoreManomaya(manifest)).toBeCloseTo(0.1, 5);
		});

		it("scores full 1.0 with all documentation criteria met", () => {
			const manifest = makeBaseManifest({
				description: "A".repeat(201),
				examples: [{ description: "ex", input: {} }],
				antiPatterns: ["Don't do this"],
				tags: ["a", "b", "c"],
				capabilities: [
					makeCapability("read", "files", "Read files"),
					makeCapability("write", "files", "Write files"),
				],
				author: "tester",
			});
			// 0.2 + 0.1 + 0.2 + 0.1 + 0.1 + 0.2 + 0.1 = 1.0
			expect(scoreManomaya(manifest)).toBeCloseTo(1.0, 5);
		});

		it("clamps score to 1.0", () => {
			const manifest = makeBaseManifest({
				description: "A".repeat(201),
				examples: [{ description: "ex", input: {} }],
				antiPatterns: ["Don't do this"],
				tags: ["a", "b", "c"],
				capabilities: [
					makeCapability("read", "files", "Read files"),
					makeCapability("write", "files", "Write files"),
				],
				author: "tester",
			});
			expect(scoreManomaya(manifest)).toBeLessThanOrEqual(1.0);
		});
	});

	// ── scoreVijnanamaya ─────────────────────────────────────────────────

	describe("scoreVijnanamaya", () => {
		it("returns 0 when no wisdom fields are present", () => {
			const manifest = makeEnhancedManifest();
			expect(scoreVijnanamaya(manifest)).toBe(0);
		});

		it("adds 0.3 for whenToUse", () => {
			const manifest = makeEnhancedManifest({
				whenToUse: ["When you need to read files"],
			});
			expect(scoreVijnanamaya(manifest)).toBeCloseTo(0.3, 5);
		});

		it("adds 0.2 for whenNotToUse", () => {
			const manifest = makeEnhancedManifest({
				whenNotToUse: ["When dealing with binary data"],
			});
			expect(scoreVijnanamaya(manifest)).toBeCloseTo(0.2, 5);
		});

		it("adds 0.2 for complements", () => {
			const manifest = makeEnhancedManifest({
				complements: ["file-writer"],
			});
			expect(scoreVijnanamaya(manifest)).toBeCloseTo(0.2, 5);
		});

		it("adds 0.1 for supersedes (even empty array)", () => {
			const manifest = makeEnhancedManifest({
				supersedes: [],
			});
			expect(scoreVijnanamaya(manifest)).toBeCloseTo(0.1, 5);
		});

		it("adds 0.2 for kula", () => {
			const manifest = makeEnhancedManifest({
				kula: "antara",
			});
			expect(scoreVijnanamaya(manifest)).toBeCloseTo(0.2, 5);
		});

		it("scores full 1.0 with all wisdom fields present", () => {
			const manifest = makeEnhancedManifest({
				whenToUse: ["When you need it"],
				whenNotToUse: ["When you don't"],
				complements: ["partner-skill"],
				supersedes: ["old-skill"],
				kula: "antara",
			});
			// 0.3 + 0.2 + 0.2 + 0.1 + 0.2 = 1.0
			expect(scoreVijnanamaya(manifest)).toBeCloseTo(1.0, 5);
		});

		it("handles empty whenToUse array (no credit)", () => {
			const manifest = makeEnhancedManifest({
				whenToUse: [],
				kula: "bahya", // need at least one wisdom field to not early-return
			});
			// whenToUse empty = no 0.3, kula = 0.2
			expect(scoreVijnanamaya(manifest)).toBeCloseTo(0.2, 5);
		});

		it("handles empty complements array (no credit)", () => {
			const manifest = makeEnhancedManifest({
				complements: [],
				kula: "shiksha",
			});
			// complements empty = no 0.2, kula = 0.2
			expect(scoreVijnanamaya(manifest)).toBeCloseTo(0.2, 5);
		});

		it("clamps to 1.0 maximum", () => {
			const manifest = makeEnhancedManifest({
				whenToUse: ["a"],
				whenNotToUse: ["b"],
				complements: ["c"],
				supersedes: ["d"],
				kula: "antara",
			});
			expect(scoreVijnanamaya(manifest)).toBeLessThanOrEqual(1.0);
		});
	});

	// ── scoreAnandamaya ──────────────────────────────────────────────────

	describe("scoreAnandamaya", () => {
		it("scores 0 for zero invocations, novice level", () => {
			const mastery = makeMastery();
			expect(scoreAnandamaya(mastery)).toBe(0);
		});

		it("adds 0.2 for having been invoked at all", () => {
			const mastery = makeMastery({
				totalInvocations: 1,
				successRate: 0,
				dreyfusLevel: "novice",
			});
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.2, 5);
		});

		it("adds 0.2 for >= 10 invocations", () => {
			const mastery = makeMastery({
				totalInvocations: 10,
				successRate: 0,
				dreyfusLevel: "novice",
			});
			// invoked(0.2) + >=10(0.2)
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.4, 5);
		});

		it("adds 0.3 for success rate >= 0.7", () => {
			const mastery = makeMastery({
				totalInvocations: 10,
				successRate: 0.7,
				dreyfusLevel: "novice",
			});
			// invoked(0.2) + >=10(0.2) + success(0.3)
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.7, 5);
		});

		it("does not add success bonus for rate < 0.7", () => {
			const mastery = makeMastery({
				totalInvocations: 10,
				successRate: 0.69,
				dreyfusLevel: "novice",
			});
			// invoked(0.2) + >=10(0.2) = 0.4
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.4, 5);
		});

		it("adds 0.2 for dreyfus level 'competent'", () => {
			const mastery = makeMastery({
				totalInvocations: 1,
				successRate: 0,
				dreyfusLevel: "competent",
			});
			// invoked(0.2) + dreyfus(0.2)
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.4, 5);
		});

		it("adds 0.2 for dreyfus level 'proficient'", () => {
			const mastery = makeMastery({
				totalInvocations: 1,
				dreyfusLevel: "proficient",
			});
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.4, 5);
		});

		it("adds 0.2 for dreyfus level 'expert'", () => {
			const mastery = makeMastery({
				totalInvocations: 1,
				dreyfusLevel: "expert",
			});
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.4, 5);
		});

		it("does not add dreyfus bonus for 'novice'", () => {
			const mastery = makeMastery({
				totalInvocations: 1,
				dreyfusLevel: "novice",
			});
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.2, 5);
		});

		it("does not add dreyfus bonus for 'advanced-beginner'", () => {
			const mastery = makeMastery({
				totalInvocations: 1,
				dreyfusLevel: "advanced-beginner",
			});
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.2, 5);
		});

		it("adds 0.1 for recent usage (within last 30 days)", () => {
			const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
			const mastery = makeMastery({
				totalInvocations: 1,
				lastInvokedAt: recent,
				dreyfusLevel: "novice",
			});
			// invoked(0.2) + recent(0.1)
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.3, 5);
		});

		it("does not add recent bonus for usage > 30 days ago", () => {
			const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
			const mastery = makeMastery({
				totalInvocations: 1,
				lastInvokedAt: old,
				dreyfusLevel: "novice",
			});
			// invoked(0.2) only
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.2, 5);
		});

		it("does not add recent bonus when lastInvokedAt is null", () => {
			const mastery = makeMastery({
				totalInvocations: 1,
				lastInvokedAt: null,
				dreyfusLevel: "novice",
			});
			expect(scoreAnandamaya(mastery)).toBeCloseTo(0.2, 5);
		});

		it("scores full 1.0 with maximum mastery", () => {
			const recent = new Date().toISOString();
			const mastery = makeMastery({
				totalInvocations: 100,
				successRate: 0.9,
				dreyfusLevel: "expert",
				lastInvokedAt: recent,
			});
			// invoked(0.2) + >=10(0.2) + success(0.3) + dreyfus(0.2) + recent(0.1) = 1.0
			expect(scoreAnandamaya(mastery)).toBeCloseTo(1.0, 5);
		});

		it("clamps to 1.0 maximum", () => {
			const recent = new Date().toISOString();
			const mastery = makeMastery({
				totalInvocations: 100,
				successRate: 0.9,
				dreyfusLevel: "expert",
				lastInvokedAt: recent,
			});
			expect(scoreAnandamaya(mastery)).toBeLessThanOrEqual(1.0);
		});
	});

	// ── buildPanchaKosha ─────────────────────────────────────────────────

	describe("buildPanchaKosha", () => {
		it("returns all five sheath scores plus overall", () => {
			const manifest = makeEnhancedManifest();
			const mastery = makeMastery();
			const result = buildPanchaKosha(manifest, mastery);
			expect(result).toHaveProperty("annamaya");
			expect(result).toHaveProperty("pranamaya");
			expect(result).toHaveProperty("manomaya");
			expect(result).toHaveProperty("vijnanamaya");
			expect(result).toHaveProperty("anandamaya");
			expect(result).toHaveProperty("overall");
		});

		it("computes correct weighted overall score", () => {
			const manifest = makeEnhancedManifest({
				traitVector: [0.1],
				whenToUse: ["use it"],
				whenNotToUse: ["don't use it"],
				complements: ["other"],
				supersedes: [],
				kula: "antara",
			});
			const mastery = makeMastery({
				totalInvocations: 100,
				successRate: 0.9,
				dreyfusLevel: "expert",
				lastInvokedAt: new Date().toISOString(),
			});
			const scan = makeScanResult("clean");
			const result = buildPanchaKosha(manifest, mastery, scan);

			const expected =
				KOSHA_WEIGHTS.annamaya * result.annamaya +
				KOSHA_WEIGHTS.pranamaya * result.pranamaya +
				KOSHA_WEIGHTS.manomaya * result.manomaya +
				KOSHA_WEIGHTS.vijnanamaya * result.vijnanamaya +
				KOSHA_WEIGHTS.anandamaya * result.anandamaya;

			expect(result.overall).toBeCloseTo(Math.min(expected, 1), 5);
		});

		it("overall score is in [0, 1]", () => {
			const manifest = makeEnhancedManifest();
			const mastery = makeMastery();
			const result = buildPanchaKosha(manifest, mastery);
			expect(result.overall).toBeGreaterThanOrEqual(0);
			expect(result.overall).toBeLessThanOrEqual(1);
		});

		it("passes through scanResult to scoreAnnamaya", () => {
			const manifest = makeEnhancedManifest({
				capabilities: [],
				tags: [],
				traitVector: undefined,
			});
			const mastery = makeMastery();

			const cleanResult = buildPanchaKosha(manifest, mastery, makeScanResult("clean"));
			const maliciousResult = buildPanchaKosha(manifest, mastery, makeScanResult("malicious"));

			// Clean scan gives higher annamaya than malicious
			expect(cleanResult.annamaya).toBeGreaterThan(maliciousResult.annamaya);
		});

		it("uses manifest.requirements for pranamaya scoring", () => {
			const withReqs = makeEnhancedManifest({
				requirements: {
					bins: ["nonexistent_binary_xyz_999"],
					env: [],
					os: [],
					network: false,
					privilege: false,
				},
			});
			const withoutReqs = makeEnhancedManifest();
			const mastery = makeMastery();

			const scoreWithReqs = buildPanchaKosha(withReqs, mastery);
			const scoreWithoutReqs = buildPanchaKosha(withoutReqs, mastery);

			// Missing binary gives 0.0, no requirements gives 0.5
			expect(scoreWithReqs.pranamaya).toBe(0);
			expect(scoreWithoutReqs.pranamaya).toBe(0.5);
		});

		it("each individual score is in [0, 1]", () => {
			const manifest = makeEnhancedManifest({
				traitVector: [1, 2, 3],
				whenToUse: ["a"],
				kula: "antara",
			});
			const mastery = makeMastery({
				totalInvocations: 50,
				successRate: 0.8,
				dreyfusLevel: "proficient",
				lastInvokedAt: new Date().toISOString(),
			});
			const result = buildPanchaKosha(manifest, mastery, makeScanResult("clean"));

			for (const key of ["annamaya", "pranamaya", "manomaya", "vijnanamaya", "anandamaya", "overall"] as const) {
				expect(result[key]).toBeGreaterThanOrEqual(0);
				expect(result[key]).toBeLessThanOrEqual(1);
			}
		});
	});

	// ── checkPranamaya ───────────────────────────────────────────────────

	describe("checkPranamaya", () => {
		it("is satisfied when no requirements are specified (empty arrays)", () => {
			const result = checkPranamaya({
				bins: [],
				env: [],
				os: [],
				network: false,
				privilege: false,
			});
			expect(result.satisfied).toBe(true);
			expect(result.missing.bins).toEqual([]);
			expect(result.missing.env).toEqual([]);
			expect(result.missing.os).toBe(false);
			expect(result.missing.privilege).toBe(false);
		});

		it("detects missing binaries", () => {
			const result = checkPranamaya({
				bins: ["nonexistent_binary_xyz_12345"],
				env: [],
				os: [],
				network: false,
				privilege: false,
			});
			expect(result.satisfied).toBe(false);
			expect(result.missing.bins).toContain("nonexistent_binary_xyz_12345");
		});

		it("passes for existing binaries (node)", () => {
			const result = checkPranamaya({
				bins: ["node"],
				env: [],
				os: [],
				network: false,
				privilege: false,
			});
			expect(result.satisfied).toBe(true);
			expect(result.missing.bins).toEqual([]);
		});

		it("detects missing env vars", () => {
			const result = checkPranamaya({
				bins: [],
				env: ["__NEVER_SET_VAR_ABC_12345__"],
				os: [],
				network: false,
				privilege: false,
			});
			expect(result.satisfied).toBe(false);
			expect(result.missing.env).toContain("__NEVER_SET_VAR_ABC_12345__");
		});

		it("passes for existing env vars", () => {
			process.env["__PRANAMAYA_CHECK_TEST__"] = "1";
			const result = checkPranamaya({
				bins: [],
				env: ["__PRANAMAYA_CHECK_TEST__"],
				os: [],
				network: false,
				privilege: false,
			});
			expect(result.satisfied).toBe(true);
			expect(result.missing.env).toEqual([]);
			delete process.env["__PRANAMAYA_CHECK_TEST__"];
		});

		it("detects unsupported OS", () => {
			// Use a platform that isn't the current one
			const fakeOS = process.platform === "win32" ? "linux" : "win32";
			const result = checkPranamaya({
				bins: [],
				env: [],
				os: [fakeOS as NodeJS.Platform],
				network: false,
				privilege: false,
			});
			expect(result.satisfied).toBe(false);
			expect(result.missing.os).toBe(true);
		});

		it("passes for current OS in supported list", () => {
			const result = checkPranamaya({
				bins: [],
				env: [],
				os: [process.platform],
				network: false,
				privilege: false,
			});
			expect(result.satisfied).toBe(true);
			expect(result.missing.os).toBe(false);
		});

		it("treats empty os array as all-platforms supported", () => {
			const result = checkPranamaya({
				bins: [],
				env: [],
				os: [],
				network: false,
				privilege: false,
			});
			expect(result.missing.os).toBe(false);
		});

		it("detects missing privilege (non-root tests)", () => {
			// In test environment, we're typically not root
			if (process.getuid?.() !== 0) {
				const result = checkPranamaya({
					bins: [],
					env: [],
					os: [],
					network: false,
					privilege: true,
				});
				expect(result.satisfied).toBe(false);
				expect(result.missing.privilege).toBe(true);
			}
		});

		it("passes privilege check when privilege is not required", () => {
			const result = checkPranamaya({
				bins: [],
				env: [],
				os: [],
				network: false,
				privilege: false,
			});
			expect(result.missing.privilege).toBe(false);
		});
	});

	// ── clearPranamayaCache ──────────────────────────────────────────────

	describe("clearPranamayaCache", () => {
		it("can be called without error", () => {
			expect(() => clearPranamayaCache()).not.toThrow();
		});

		it("clears cached binary results", () => {
			// First check populates cache
			checkPranamaya({
				bins: ["node"],
				env: [],
				os: [],
				network: false,
				privilege: false,
			});
			// Clear and re-check should still work
			clearPranamayaCache();
			const result = checkPranamaya({
				bins: ["node"],
				env: [],
				os: [],
				network: false,
				privilege: false,
			});
			expect(result.satisfied).toBe(true);
		});
	});
});
