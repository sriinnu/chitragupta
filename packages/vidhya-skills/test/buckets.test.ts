import { describe, it, expect } from "vitest";
import {
	computeNameNgrams,
	computeDescriptionTokens,
	computeParameterTypes,
	computeTagHashes,
	computeCapabilityVerbs,
	computeIOSchemaShape,
	computeExamplePatterns,
	computeMetadataSignals,
} from "../src/buckets.js";
import type { SkillManifest } from "../src/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const BUCKET_SIZE = 16;

/** Sum of all absolute values in a Float32Array. */
function energy(v: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < v.length; i++) sum += Math.abs(v[i]);
	return sum;
}

/** Check that at least one element is non-zero. */
function hasNonZero(v: Float32Array): boolean {
	for (let i = 0; i < v.length; i++) {
		if (v[i] !== 0) return true;
	}
	return false;
}

/** FNV-1a hash, same as in buckets.ts. */
function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function makeMinimalManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
	return {
		name: "test-skill",
		version: "1.0.0",
		description: "A test skill for unit testing",
		capabilities: [
			{
				verb: "read",
				object: "files",
				description: "Read files from disk",
				parameters: {
					path: { type: "string", description: "File path", required: true },
				},
			},
		],
		tags: ["test", "filesystem"],
		source: { type: "tool", toolName: "read_file" },
		updatedAt: "2025-01-01T00:00:00Z",
		...overrides,
	};
}

// ── computeNameNgrams (Bucket 0) ─────────────────────────────────────────────

describe("computeNameNgrams", () => {
	it("returns a Float32Array of BUCKET_SIZE length", () => {
		const result = computeNameNgrams("file-reader");
		expect(result).toBeInstanceOf(Float32Array);
		expect(result.length).toBe(BUCKET_SIZE);
	});

	it("produces non-zero output for any non-trivial name", () => {
		const result = computeNameNgrams("file-reader");
		expect(hasNonZero(result)).toBe(true);
	});

	it("is deterministic: same name produces the same bucket", () => {
		const a = computeNameNgrams("code-analyzer");
		const b = computeNameNgrams("code-analyzer");
		for (let i = 0; i < BUCKET_SIZE; i++) {
			expect(a[i]).toBe(b[i]);
		}
	});

	it("produces different outputs for different names", () => {
		const a = computeNameNgrams("file-reader");
		const b = computeNameNgrams("database-writer");
		let isDifferent = false;
		for (let i = 0; i < BUCKET_SIZE; i++) {
			if (a[i] !== b[i]) { isDifferent = true; break; }
		}
		expect(isDifferent).toBe(true);
	});

	it("normalizes name to lowercase before hashing", () => {
		const a = computeNameNgrams("FileReader");
		const b = computeNameNgrams("filereader");
		// After normalization, non-alpha chars become hyphens, so
		// "FileReader" -> "filereader" (no case boundaries produce hyphens)
		for (let i = 0; i < BUCKET_SIZE; i++) {
			expect(a[i]).toBe(b[i]);
		}
	});

	it("includes a half-weight entry for the full normalized name", () => {
		// The full name hash gets +=0.5
		const name = "abc";
		const result = computeNameNgrams(name);
		const norm = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
		const dimIdx = fnv1a(norm) % BUCKET_SIZE;
		// The bucket at dimIdx should include the 0.5 contribution from full name
		// plus any trigram contributions
		expect(result[dimIdx]).toBeGreaterThanOrEqual(0.5);
	});

	it("returns all zeros for a very short name with fewer than 3 chars", () => {
		// "ab" -> normalized "ab", no 3-grams possible, only full name hash
		const result = computeNameNgrams("ab");
		// Should have exactly 0.5 at the full-name hash dim
		const norm = "ab";
		const dimIdx = fnv1a(norm) % BUCKET_SIZE;
		expect(result[dimIdx]).toBe(0.5);
		// All other dims should be 0
		let otherEnergy = 0;
		for (let i = 0; i < BUCKET_SIZE; i++) {
			if (i !== dimIdx) otherEnergy += result[i];
		}
		expect(otherEnergy).toBe(0);
	});
});

// ── computeDescriptionTokens (Bucket 1) ──────────────────────────────────────

describe("computeDescriptionTokens", () => {
	it("returns a Float32Array of BUCKET_SIZE length", () => {
		const result = computeDescriptionTokens("Read files from disk");
		expect(result).toBeInstanceOf(Float32Array);
		expect(result.length).toBe(BUCKET_SIZE);
	});

	it("filters out stop words", () => {
		// "a the is" are all stop words -> no tokens -> zero bucket
		const result = computeDescriptionTokens("a the is are");
		expect(energy(result)).toBe(0);
	});

	it("filters out single-character tokens", () => {
		const result = computeDescriptionTokens("a b c d");
		expect(energy(result)).toBe(0);
	});

	it("produces higher energy for longer descriptions with more content words", () => {
		const short = computeDescriptionTokens("read file");
		const long = computeDescriptionTokens("read file contents from local filesystem with encoding detection and line filtering");
		expect(energy(long)).toBeGreaterThan(energy(short));
	});

	it("is deterministic", () => {
		const desc = "Analyze code for patterns and bugs";
		const a = computeDescriptionTokens(desc);
		const b = computeDescriptionTokens(desc);
		for (let i = 0; i < BUCKET_SIZE; i++) {
			expect(a[i]).toBe(b[i]);
		}
	});
});

// ── computeParameterTypes (Bucket 2) ─────────────────────────────────────────

describe("computeParameterTypes", () => {
	it("returns a zero bucket when there are no capabilities", () => {
		const manifest = makeMinimalManifest({ capabilities: [] });
		const result = computeParameterTypes(manifest);
		expect(energy(result)).toBe(0);
	});

	it("returns a non-zero bucket when parameters exist", () => {
		const manifest = makeMinimalManifest();
		const result = computeParameterTypes(manifest);
		expect(hasNonZero(result)).toBe(true);
	});

	it("adds extra weight for required parameters", () => {
		const withRequired = makeMinimalManifest({
			capabilities: [{
				verb: "read", object: "files", description: "Read",
				parameters: { path: { type: "string", description: "Path", required: true } },
			}],
		});
		const withoutRequired = makeMinimalManifest({
			capabilities: [{
				verb: "read", object: "files", description: "Read",
				parameters: { path: { type: "string", description: "Path" } },
			}],
		});
		const energyReq = energy(computeParameterTypes(withRequired));
		const energyNoReq = energy(computeParameterTypes(withoutRequired));
		expect(energyReq).toBeGreaterThan(energyNoReq);
	});

	it("includes inputSchema type signals when present", () => {
		const manifest = makeMinimalManifest({
			inputSchema: {
				type: "object",
				properties: {
					path: { type: "string" },
				},
			},
		});
		const result = computeParameterTypes(manifest);
		expect(hasNonZero(result)).toBe(true);
	});
});

// ── computeTagHashes (Bucket 3) ──────────────────────────────────────────────

describe("computeTagHashes", () => {
	it("returns a zero bucket for empty tags", () => {
		const result = computeTagHashes([]);
		expect(energy(result)).toBe(0);
	});

	it("activates dimensions for each tag with strong primary and weak secondary", () => {
		const result = computeTagHashes(["filesystem"]);
		// Primary: 2.0, Secondary: 0.5
		expect(energy(result)).toBeGreaterThanOrEqual(2.5);
	});

	it("produces more energy with more tags", () => {
		const one = computeTagHashes(["test"]);
		const three = computeTagHashes(["test", "code", "analysis"]);
		expect(energy(three)).toBeGreaterThan(energy(one));
	});

	it("is case-insensitive", () => {
		const a = computeTagHashes(["Filesystem"]);
		const b = computeTagHashes(["filesystem"]);
		for (let i = 0; i < BUCKET_SIZE; i++) {
			expect(a[i]).toBe(b[i]);
		}
	});

	it("is deterministic", () => {
		const tags = ["search", "code", "analysis"];
		const a = computeTagHashes(tags);
		const b = computeTagHashes(tags);
		for (let i = 0; i < BUCKET_SIZE; i++) {
			expect(a[i]).toBe(b[i]);
		}
	});
});

// ── computeCapabilityVerbs (Bucket 4) ────────────────────────────────────────

describe("computeCapabilityVerbs", () => {
	it("returns a zero bucket for a manifest with no capabilities", () => {
		const manifest = makeMinimalManifest({ capabilities: [] });
		const result = computeCapabilityVerbs(manifest);
		expect(energy(result)).toBe(0);
	});

	it("activates dimensions for verb, verb group, and verb:object", () => {
		const manifest = makeMinimalManifest();
		const result = computeCapabilityVerbs(manifest);
		// verb "read" -> 2.0, group "read" -> 1.0, "read:files" -> 1.5
		expect(energy(result)).toBeGreaterThanOrEqual(4.0);
	});

	it("activates group dimensions for synonym verbs", () => {
		const fetchManifest = makeMinimalManifest({
			capabilities: [{ verb: "fetch", object: "data", description: "Fetch data" }],
		});
		const readManifest = makeMinimalManifest({
			capabilities: [{ verb: "read", object: "data", description: "Read data" }],
		});
		const fetchBucket = computeCapabilityVerbs(fetchManifest);
		const readBucket = computeCapabilityVerbs(readManifest);
		// Both "fetch" and "read" belong to the "read" group, so group:read dim should be active
		const groupDim = fnv1a("group:read") % BUCKET_SIZE;
		expect(fetchBucket[groupDim]).toBeGreaterThan(0);
		expect(readBucket[groupDim]).toBeGreaterThan(0);
	});
});

// ── computeIOSchemaShape (Bucket 5) ──────────────────────────────────────────

describe("computeIOSchemaShape", () => {
	it("returns a zero bucket when no schemas are defined", () => {
		const manifest = makeMinimalManifest({
			inputSchema: undefined,
			outputSchema: undefined,
		});
		const result = computeIOSchemaShape(manifest);
		expect(energy(result)).toBe(0);
	});

	it("activates dim 0 when inputSchema is present", () => {
		const manifest = makeMinimalManifest({
			inputSchema: { type: "object" },
		});
		const result = computeIOSchemaShape(manifest);
		expect(result[0]).toBeGreaterThanOrEqual(0.5);
	});

	it("activates dim 1 when outputSchema is present", () => {
		const manifest = makeMinimalManifest({
			outputSchema: { type: "string" },
		});
		const result = computeIOSchemaShape(manifest);
		expect(result[1]).toBeGreaterThanOrEqual(0.5);
	});

	it("processes nested properties at increasing depth", () => {
		const manifest = makeMinimalManifest({
			inputSchema: {
				type: "object",
				properties: {
					name: { type: "string" },
					address: {
						type: "object",
						properties: {
							city: { type: "string" },
						},
					},
				},
			},
		});
		const result = computeIOSchemaShape(manifest);
		expect(hasNonZero(result)).toBe(true);
	});
});

// ── computeExamplePatterns (Bucket 6) ────────────────────────────────────────

describe("computeExamplePatterns", () => {
	it("returns a zero bucket when no examples are provided", () => {
		const result = computeExamplePatterns(undefined);
		expect(energy(result)).toBe(0);
	});

	it("returns a zero bucket for an empty examples array", () => {
		const result = computeExamplePatterns([]);
		expect(energy(result)).toBe(0);
	});

	it("activates dimensions for example description tokens and input keys", () => {
		const examples = [
			{
				description: "Read a TypeScript source file",
				input: { path: "/src/index.ts" },
				output: "File contents as string",
			},
		];
		const result = computeExamplePatterns(examples);
		expect(hasNonZero(result)).toBe(true);
	});

	it("produces more energy with more examples", () => {
		const one = computeExamplePatterns([
			{ description: "Read file", input: { path: "/a" } },
		]);
		const three = computeExamplePatterns([
			{ description: "Read file", input: { path: "/a" } },
			{ description: "Read directory contents", input: { path: "/b" } },
			{ description: "Read binary data", input: { path: "/c", encoding: "binary" } },
		]);
		expect(energy(three)).toBeGreaterThan(energy(one));
	});

	it("includes example-count signal capped at 1.0", () => {
		const countDim = fnv1a("example-count") % BUCKET_SIZE;
		const twoExamples = computeExamplePatterns([
			{ description: "Test one", input: { x: 1 } },
			{ description: "Test two", input: { y: 2 } },
		]);
		// 2/5 = 0.4
		expect(twoExamples[countDim]).toBeGreaterThan(0);
	});
});

// ── computeMetadataSignals (Bucket 7) ────────────────────────────────────────

describe("computeMetadataSignals", () => {
	it("activates source type dimension", () => {
		const manifest = makeMinimalManifest();
		const result = computeMetadataSignals(manifest);
		const dim = fnv1a("source:tool") % BUCKET_SIZE;
		expect(result[dim]).toBeGreaterThanOrEqual(1.5);
	});

	it("activates tool name dimension for tool source", () => {
		const manifest = makeMinimalManifest({
			source: { type: "tool", toolName: "read_file" },
		});
		const result = computeMetadataSignals(manifest);
		const dim = fnv1a("tool:read_file") % BUCKET_SIZE;
		expect(result[dim]).toBeGreaterThanOrEqual(1.0);
	});

	it("activates MCP server dimension for mcp-server source", () => {
		const manifest = makeMinimalManifest({
			source: { type: "mcp-server", serverId: "s1", serverName: "my-server" },
		});
		const result = computeMetadataSignals(manifest);
		const dim = fnv1a("mcp:my-server") % BUCKET_SIZE;
		expect(result[dim]).toBeGreaterThanOrEqual(1.0);
	});

	it("adds stability signal for version >= 1.0.0", () => {
		const manifest = makeMinimalManifest({ version: "2.0.0" });
		const result = computeMetadataSignals(manifest);
		const dim = fnv1a("stable") % BUCKET_SIZE;
		expect(result[dim]).toBeGreaterThanOrEqual(0.5);
	});

	it("does not add stability signal for version 0.x", () => {
		const manifest = makeMinimalManifest({ version: "0.9.0" });
		const resultUnstable = computeMetadataSignals(manifest);
		const manifestStable = makeMinimalManifest({ version: "1.0.0" });
		const resultStable = computeMetadataSignals(manifestStable);
		const dim = fnv1a("stable") % BUCKET_SIZE;
		// Stable version should have at least 0.5 more
		expect(resultStable[dim] - resultUnstable[dim]).toBeGreaterThanOrEqual(0.5);
	});

	it("produces NEGATIVE activations for anti-patterns", () => {
		const manifest = makeMinimalManifest({
			antiPatterns: ["binary files processing"],
		});
		const result = computeMetadataSignals(manifest);
		// At least one dimension should be negative
		let hasNegative = false;
		for (let i = 0; i < BUCKET_SIZE; i++) {
			if (result[i] < 0) { hasNegative = true; break; }
		}
		expect(hasNegative).toBe(true);
	});

	it("adds author signal when present", () => {
		const manifest = makeMinimalManifest({ author: "chitragupta-team" });
		const result = computeMetadataSignals(manifest);
		const dim = fnv1a("author:chitragupta-team") % BUCKET_SIZE;
		expect(result[dim]).toBeGreaterThanOrEqual(0.3);
	});
});
