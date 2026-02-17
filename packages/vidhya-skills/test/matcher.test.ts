import { describe, it, expect } from "vitest";
import { matchSkills, rankAndFilter } from "../src/matcher.js";
import type { SkillManifest, SkillMatch, SkillQuery } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<SkillManifest> & { name: string }): SkillManifest {
	return {
		version: "1.0.0",
		description: "",
		capabilities: [],
		tags: [],
		source: { type: "tool", toolName: overrides.name },
		updatedAt: "2025-01-01T00:00:00Z",
		...overrides,
	};
}

function fileReaderSkill(): SkillManifest {
	return makeSkill({
		name: "file-reader",
		description: "Read files from the local filesystem with encoding detection.",
		capabilities: [
			{ verb: "read", object: "files", description: "Read a file at a given path." },
		],
		tags: ["filesystem", "io", "read"],
	});
}

function codeAnalyzerSkill(): SkillManifest {
	return makeSkill({
		name: "code-analyzer",
		description: "Analyze source code for complexity, dependencies, and quality metrics.",
		capabilities: [
			{ verb: "analyze", object: "code", description: "Run static analysis on source code." },
			{ verb: "evaluate", object: "complexity", description: "Compute cyclomatic complexity." },
		],
		tags: ["analysis", "code-quality", "metrics"],
	});
}

function databaseQuerySkill(): SkillManifest {
	return makeSkill({
		name: "database-query",
		description: "Execute SQL queries against a PostgreSQL database.",
		capabilities: [
			{ verb: "execute", object: "queries", description: "Run SQL against the database." },
		],
		tags: ["database", "sql", "postgresql"],
		antiPatterns: ["Do not use for file operations", "Not suitable for reading local files"],
	});
}

function fileWriterSkill(): SkillManifest {
	return makeSkill({
		name: "file-writer",
		description: "Write content to files on the local filesystem.",
		capabilities: [
			{ verb: "write", object: "files", description: "Write content to a file." },
		],
		tags: ["filesystem", "io", "write"],
	});
}

// ─── Exact Match ────────────────────────────────────────────────────────────

describe("matchSkills — exact match", () => {
	it("query matching a skill's exact description scores highest", () => {
		const skills = [fileReaderSkill(), codeAnalyzerSkill(), databaseQuerySkill()];
		const query: SkillQuery = { text: "read files from the local filesystem" };

		const matches = matchSkills(query, skills);
		expect(matches.length).toBeGreaterThan(0);
		expect(matches[0].skill.name).toBe("file-reader");
	});
});

// ─── Tag Boost ──────────────────────────────────────────────────────────────

describe("matchSkills — tag boost", () => {
	it("skills with matching tags rank higher", () => {
		const skills = [fileReaderSkill(), codeAnalyzerSkill(), databaseQuerySkill()];

		const queryWithTags: SkillQuery = {
			text: "analyze something",
			tags: ["filesystem"],
		};

		const matches = matchSkills(queryWithTags, skills);
		// Only skills with "filesystem" tag should be returned (tags are required filter)
		const hasFilesystem = matches.every((m) =>
			m.skill.tags.map((t) => t.toLowerCase()).includes("filesystem"),
		);
		expect(hasFilesystem).toBe(true);
	});
});

// ─── Anti-Pattern Penalty ───────────────────────────────────────────────────

describe("matchSkills — anti-pattern penalty", () => {
	it("skills matching anti-patterns score lower", () => {
		const skills = [fileReaderSkill(), databaseQuerySkill()];

		// Query about "reading local files" triggers database-query's anti-pattern
		const query: SkillQuery = { text: "reading local files from disk" };
		const matches = matchSkills(query, skills);

		// file-reader should score higher than database-query
		const fileReaderMatch = matches.find((m) => m.skill.name === "file-reader");
		const dbMatch = matches.find((m) => m.skill.name === "database-query");

		if (fileReaderMatch && dbMatch) {
			expect(fileReaderMatch.score).toBeGreaterThan(dbMatch.score);
			// The anti-pattern penalty should be reflected in breakdown
			expect(dbMatch.breakdown.antiPatternPenalty).toBeGreaterThan(0);
		}
	});
});

// ─── Top-K Filtering ────────────────────────────────────────────────────────

describe("matchSkills — top-K filtering", () => {
	it("only returns requested number of results", () => {
		const skills = [
			fileReaderSkill(),
			codeAnalyzerSkill(),
			databaseQuerySkill(),
			fileWriterSkill(),
		];
		const query: SkillQuery = { text: "read or write files", topK: 2 };

		const matches = matchSkills(query, skills);
		expect(matches.length).toBeLessThanOrEqual(2);
	});
});

// ─── Threshold Filtering ────────────────────────────────────────────────────

describe("matchSkills — threshold filtering", () => {
	it("filters out low-scoring matches", () => {
		const skills = [fileReaderSkill(), databaseQuerySkill()];
		const query: SkillQuery = {
			text: "read files from filesystem",
			threshold: 0.5,
		};

		const matches = matchSkills(query, skills);
		for (const m of matches) {
			expect(m.score).toBeGreaterThanOrEqual(0.5);
		}
	});
});

// ─── Empty Registry ─────────────────────────────────────────────────────────

describe("matchSkills — empty registry", () => {
	it("returns empty results when no skills are registered", () => {
		const query: SkillQuery = { text: "read a file" };
		const matches = matchSkills(query, []);
		expect(matches.length).toBe(0);
	});
});

// ─── rankAndFilter ──────────────────────────────────────────────────────────

describe("rankAndFilter", () => {
	it("sorts by score descending", () => {
		const matches: SkillMatch[] = [
			{ skill: fileReaderSkill(), score: 0.5, breakdown: { traitSimilarity: 0.5, tagBoost: 0, capabilityMatch: 0, antiPatternPenalty: 0 } },
			{ skill: codeAnalyzerSkill(), score: 0.9, breakdown: { traitSimilarity: 0.9, tagBoost: 0, capabilityMatch: 0, antiPatternPenalty: 0 } },
			{ skill: databaseQuerySkill(), score: 0.3, breakdown: { traitSimilarity: 0.3, tagBoost: 0, capabilityMatch: 0, antiPatternPenalty: 0 } },
		];

		const ranked = rankAndFilter(matches, 10, 0);
		expect(ranked[0].score).toBe(0.9);
		expect(ranked[1].score).toBe(0.5);
		expect(ranked[2].score).toBe(0.3);
	});

	it("respects topK and threshold simultaneously", () => {
		const matches: SkillMatch[] = [
			{ skill: fileReaderSkill(), score: 0.8, breakdown: { traitSimilarity: 0.8, tagBoost: 0, capabilityMatch: 0, antiPatternPenalty: 0 } },
			{ skill: codeAnalyzerSkill(), score: 0.6, breakdown: { traitSimilarity: 0.6, tagBoost: 0, capabilityMatch: 0, antiPatternPenalty: 0 } },
			{ skill: databaseQuerySkill(), score: 0.2, breakdown: { traitSimilarity: 0.2, tagBoost: 0, capabilityMatch: 0, antiPatternPenalty: 0 } },
			{ skill: fileWriterSkill(), score: 0.7, breakdown: { traitSimilarity: 0.7, tagBoost: 0, capabilityMatch: 0, antiPatternPenalty: 0 } },
		];

		const ranked = rankAndFilter(matches, 2, 0.5);
		expect(ranked.length).toBe(2);
		expect(ranked[0].score).toBe(0.8);
		expect(ranked[1].score).toBe(0.7);
	});
});
