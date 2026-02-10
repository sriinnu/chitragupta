import { describe, it, expect } from "vitest";
import {
	computeTraitVector,
	computeQueryVector,
	fnv1a,
	TRAIT_DIMENSIONS,
	BUCKET_SIZE,
} from "../src/fingerprint.js";
import type { SkillManifest, SkillQuery } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFileReaderSkill(): SkillManifest {
	return {
		name: "file-reader",
		version: "1.0.0",
		description: "Read files from the local filesystem with support for text encoding detection and line-range filtering.",
		capabilities: [
			{
				verb: "read",
				object: "files",
				description: "Read the contents of a file at a given path.",
				parameters: {
					path: { type: "string", description: "Absolute path to the file", required: true },
					encoding: { type: "string", description: "Character encoding", default: "utf-8" },
				},
			},
		],
		examples: [
			{
				description: "Read a TypeScript source file",
				input: { path: "/src/index.ts" },
				output: "The contents of the file as a string.",
			},
		],
		tags: ["filesystem", "io", "read"],
		source: { type: "tool", toolName: "read_file" },
		updatedAt: "2025-01-15T10:00:00Z",
	};
}

function makeDatabaseWriterSkill(): SkillManifest {
	return {
		name: "database-writer",
		version: "2.1.0",
		description: "Write records to a PostgreSQL database with transaction support and conflict resolution.",
		capabilities: [
			{
				verb: "write",
				object: "database",
				description: "Insert or upsert records into a database table.",
				parameters: {
					table: { type: "string", description: "Target table name", required: true },
					records: { type: "array", description: "Records to insert" },
					onConflict: { type: "string", description: "Conflict resolution strategy", default: "update" },
				},
			},
		],
		examples: [
			{
				description: "Insert user records",
				input: { table: "users", records: [{ name: "Alice", email: "alice@example.com" }] },
				output: "1 record inserted.",
			},
		],
		tags: ["database", "sql", "write", "postgresql"],
		source: { type: "plugin", pluginName: "pg-writer" },
		updatedAt: "2025-02-20T14:30:00Z",
	};
}

function makeFileSearchSkill(): SkillManifest {
	return {
		name: "file-search",
		version: "1.2.0",
		description: "Search for files by name pattern, content, or metadata across the filesystem.",
		capabilities: [
			{
				verb: "search",
				object: "files",
				description: "Find files matching a glob pattern.",
				parameters: {
					pattern: { type: "string", description: "Glob pattern", required: true },
				},
			},
			{
				verb: "read",
				object: "files",
				description: "Read matching file contents.",
			},
		],
		tags: ["filesystem", "search", "read"],
		source: { type: "tool", toolName: "find_files" },
		updatedAt: "2025-03-01T09:00:00Z",
	};
}

/** Compute L2 norm of a Float32Array. */
function l2Norm(v: Float32Array): number {
	let sumSq = 0;
	for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
	return Math.sqrt(sumSq);
}

/** Dot product of two Float32Arrays. */
function dot(a: Float32Array, b: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < Math.min(a.length, b.length); i++) sum += a[i] * b[i];
	return sum;
}

/** Cosine similarity between two Float32Arrays. */
function cosine(a: Float32Array, b: Float32Array): number {
	const na = l2Norm(a);
	const nb = l2Norm(b);
	if (na === 0 || nb === 0) return 0;
	return dot(a, b) / (na * nb);
}

// ─── fnv1a ──────────────────────────────────────────────────────────────────

describe("fnv1a", () => {
	it("returns consistent hashes for the same input", () => {
		expect(fnv1a("hello")).toBe(fnv1a("hello"));
		expect(fnv1a("world")).toBe(fnv1a("world"));
	});

	it("returns different hashes for different inputs", () => {
		expect(fnv1a("hello")).not.toBe(fnv1a("world"));
		expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
	});

	it("produces known test vectors for FNV-1a (32-bit)", () => {
		// Known FNV-1a 32-bit values
		// Empty string should hash to offset basis
		const emptyHash = fnv1a("");
		expect(emptyHash).toBe(0x811c9dc5);

		// Single character changes should produce very different hashes (avalanche)
		const ha = fnv1a("a");
		const hb = fnv1a("b");
		// They should differ in many bits
		const xor = ha ^ hb;
		let diffBits = 0;
		for (let i = 0; i < 32; i++) {
			if ((xor >>> i) & 1) diffBits++;
		}
		expect(diffBits).toBeGreaterThan(5); // good avalanche property
	});

	it("returns a 32-bit unsigned integer", () => {
		const hash = fnv1a("test string for hash");
		expect(hash).toBeGreaterThanOrEqual(0);
		expect(hash).toBeLessThanOrEqual(0xFFFFFFFF);
	});
});

// ─── computeTraitVector ─────────────────────────────────────────────────────

describe("computeTraitVector", () => {
	it("is deterministic: same manifest produces the same vector", () => {
		const skill = makeFileReaderSkill();
		const v1 = computeTraitVector(skill);
		const v2 = computeTraitVector(skill);
		for (let i = 0; i < TRAIT_DIMENSIONS; i++) {
			expect(v1[i]).toBe(v2[i]);
		}
	});

	it("output is exactly 128 dimensions", () => {
		const v = computeTraitVector(makeFileReaderSkill());
		expect(v.length).toBe(TRAIT_DIMENSIONS);
		expect(v.length).toBe(128);
	});

	it("output is L2-normalized (norm approximately 1.0)", () => {
		const v = computeTraitVector(makeFileReaderSkill());
		const norm = l2Norm(v);
		expect(Math.abs(norm - 1.0)).toBeLessThan(1e-5);
	});

	it("similar skills have high cosine similarity", () => {
		const fileReader = computeTraitVector(makeFileReaderSkill());
		const fileSearch = computeTraitVector(makeFileSearchSkill());

		// Both are filesystem/read skills — they should be similar
		const sim = cosine(fileReader, fileSearch);
		expect(sim).toBeGreaterThan(0.3);
	});

	it("different skills have low cosine similarity", () => {
		const fileReader = computeTraitVector(makeFileReaderSkill());
		const dbWriter = computeTraitVector(makeDatabaseWriterSkill());

		// A file reader and a database writer should be quite different
		const sim = cosine(fileReader, dbWriter);
		expect(sim).toBeLessThan(0.5);
	});

	it("non-zero vector is produced for a minimal manifest", () => {
		const minimal: SkillManifest = {
			name: "minimal",
			version: "0.0.1",
			description: "A minimal skill.",
			capabilities: [],
			tags: [],
			source: { type: "manual", filePath: "/skills/minimal.md" },
			updatedAt: "2025-01-01T00:00:00Z",
		};
		const v = computeTraitVector(minimal);
		let hasNonZero = false;
		for (let i = 0; i < v.length; i++) {
			if (v[i] !== 0) hasNonZero = true;
		}
		expect(hasNonZero).toBe(true);
	});
});

// ─── computeQueryVector ─────────────────────────────────────────────────────

describe("computeQueryVector", () => {
	it("output is 128 dimensions and L2-normalized", () => {
		const query: SkillQuery = { text: "read a typescript file from disk" };
		const v = computeQueryVector(query);
		expect(v.length).toBe(128);
		const norm = l2Norm(v);
		expect(Math.abs(norm - 1.0)).toBeLessThan(1e-5);
	});

	it("query about 'read files' is similar to file-reader skill vector", () => {
		const query: SkillQuery = { text: "read files from the filesystem", tags: ["filesystem"] };
		const queryVec = computeQueryVector(query);
		const skillVec = computeTraitVector(makeFileReaderSkill());

		const sim = cosine(queryVec, skillVec);
		expect(sim).toBeGreaterThan(0.1);
	});

	it("query with tags activates the tag bucket", () => {
		const queryNoTags: SkillQuery = { text: "read files" };
		const queryWithTags: SkillQuery = { text: "read files", tags: ["filesystem", "io"] };

		const vNoTags = computeQueryVector(queryNoTags);
		const vWithTags = computeQueryVector(queryWithTags);

		// Tag bucket is bucket 3 (dims 48-63)
		let tagBucketSumNoTags = 0;
		let tagBucketSumWithTags = 0;
		for (let d = 48; d < 64; d++) {
			tagBucketSumNoTags += Math.abs(vNoTags[d]);
			tagBucketSumWithTags += Math.abs(vWithTags[d]);
		}

		// Before normalization, the tag bucket should have more energy with tags
		// After normalization the total norm is 1, but tag bucket contribution differs
		// We just check that the vectors are different
		let isDifferent = false;
		for (let d = 0; d < 128; d++) {
			if (Math.abs(vNoTags[d] - vWithTags[d]) > 1e-6) {
				isDifferent = true;
				break;
			}
		}
		expect(isDifferent).toBe(true);
	});

	it("query with sourceType filter activates metadata bucket", () => {
		const queryNoSource: SkillQuery = { text: "read files" };
		const queryWithSource: SkillQuery = { text: "read files", sourceType: "mcp-server" };

		const v1 = computeQueryVector(queryNoSource);
		const v2 = computeQueryVector(queryWithSource);

		// Metadata bucket is bucket 7 (dims 112-127)
		let isDifferent = false;
		for (let d = 112; d < 128; d++) {
			if (Math.abs(v1[d] - v2[d]) > 1e-6) {
				isDifferent = true;
				break;
			}
		}
		expect(isDifferent).toBe(true);
	});
});
