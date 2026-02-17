import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	computeLinkHash,
	computeContentHash,
	createGenesisLink,
	createChain,
	appendLink,
	verifyChain,
	computeTrust,
	serializeChain,
	deserializeChain,
} from "../src/parampara.js";
import { TRUST_WEIGHTS } from "../src/types-v2.js";
import type { ParamparaChain, ParamparaLink } from "../src/types-v2.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const CONTENT_A = "# File Reader\nReads files from the local filesystem.";
const CONTENT_B = "# File Reader v2\nReads files with encoding detection.";

function hashOf(content: string): string {
	return computeContentHash(content);
}

/**
 * Build a chain of N links for testing, with controlled timestamps.
 * Links alternate between scan and review actions after genesis.
 */
function buildChainOfN(n: number, kula: "bahya" | "shiksha" = "bahya"): ParamparaChain {
	let chain = createChain("test-skill", "author-x", CONTENT_A, kula, "genesis");
	for (let i = 1; i < n; i++) {
		const action = i % 2 === 1 ? "scanned" : "reviewed";
		chain = appendLink(chain, action, `actor-${i}`, hashOf(CONTENT_A), `link-${i}`);
	}
	return chain;
}

/**
 * Deeply clone a chain so mutations don't affect the original.
 */
function cloneChain(chain: ParamparaChain): ParamparaChain {
	return JSON.parse(JSON.stringify(chain));
}

// ─── Chain Integrity (Merkle Properties) ────────────────────────────────────

describe("Parampara — Chain Integrity (Merkle Properties)", () => {
	it("genesis link has prevHash = '' (empty string)", () => {
		const chain = createChain("my-skill", "alice", CONTENT_A, "bahya");
		expect(chain.links).toHaveLength(1);
		expect(chain.links[0].prevHash).toBe("");
	});

	it("genesis link has a valid 64-char hex SHA-256 linkHash", () => {
		const chain = createChain("my-skill", "alice", CONTENT_A, "bahya");
		const hash = chain.links[0].linkHash;
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("linkHash is deterministic for the same inputs", () => {
		const h1 = computeLinkHash("created", "alice", "2025-01-01T00:00:00Z", "abc123", "");
		const h2 = computeLinkHash("created", "alice", "2025-01-01T00:00:00Z", "abc123", "");
		expect(h1).toBe(h2);
	});

	it("linkHash changes when any single field changes", () => {
		const base = computeLinkHash("created", "alice", "2025-01-01T00:00:00Z", "abc123", "");
		const diffAction = computeLinkHash("scanned", "alice", "2025-01-01T00:00:00Z", "abc123", "");
		const diffActor = computeLinkHash("created", "bob", "2025-01-01T00:00:00Z", "abc123", "");
		const diffTime = computeLinkHash("created", "alice", "2025-01-02T00:00:00Z", "abc123", "");
		const diffContent = computeLinkHash("created", "alice", "2025-01-01T00:00:00Z", "def456", "");
		const diffPrev = computeLinkHash("created", "alice", "2025-01-01T00:00:00Z", "abc123", "xyz");

		const all = [base, diffAction, diffActor, diffTime, diffContent, diffPrev];
		const unique = new Set(all);
		expect(unique.size).toBe(6);
	});

	it("appended links bind to the previous link's hash", () => {
		const chain = buildChainOfN(4);
		for (let i = 1; i < chain.links.length; i++) {
			expect(chain.links[i].prevHash).toBe(chain.links[i - 1].linkHash);
		}
	});

	it("verifyChain returns intact=true for a valid chain of 5 links", () => {
		const chain = buildChainOfN(5);
		const result = verifyChain(chain);
		expect(result.intact).toBe(true);
		expect(result.brokenAt).toBeUndefined();
	});

	it("empty chain verifies as intact", () => {
		const chain: ParamparaChain = {
			skillName: "empty",
			links: [],
			trust: { score: 0, originTrust: 0, scanTrust: 0, reviewTrust: 0, ageTrust: 0, freshnessTrust: 0 },
			chainIntact: true,
		};
		const result = verifyChain(chain);
		expect(result.intact).toBe(true);
	});

	it("tamper: modifying a link's action is detected", () => {
		const chain = cloneChain(buildChainOfN(4));
		// Tamper with link at index 2 — change action
		(chain.links[2] as unknown as Record<string, unknown>).action = "promoted";

		const result = verifyChain(chain);
		expect(result.intact).toBe(false);
		expect(result.brokenAt).toBe(2);
	});

	it("tamper: modifying a link's actor is detected", () => {
		const chain = cloneChain(buildChainOfN(4));
		(chain.links[1] as unknown as Record<string, unknown>).actor = "evil-actor";

		const result = verifyChain(chain);
		expect(result.intact).toBe(false);
		expect(result.brokenAt).toBe(1);
	});

	it("tamper: swapping two links is detected at the swap point", () => {
		const chain = cloneChain(buildChainOfN(5));
		// Swap links at index 2 and 3
		const temp = chain.links[2];
		chain.links[2] = chain.links[3];
		chain.links[3] = temp;

		const result = verifyChain(chain);
		expect(result.intact).toBe(false);
		// The swap breaks the chain at index 2 because link[2]'s prevHash
		// (which was originally link[2]'s predecessor) no longer matches link[1]'s hash
		expect(result.brokenAt).toBe(2);
	});

	it("tamper: inserting a link in the middle breaks the chain", () => {
		const chain = cloneChain(buildChainOfN(4));
		// Craft a fake link and insert at index 2
		const fakeLink: ParamparaLink = {
			action: "scanned",
			actor: "fake-scanner",
			timestamp: new Date().toISOString(),
			contentHash: hashOf(CONTENT_A),
			prevHash: chain.links[1].linkHash,
			linkHash: "0000000000000000000000000000000000000000000000000000000000000000",
		};
		chain.links.splice(2, 0, fakeLink);

		const result = verifyChain(chain);
		expect(result.intact).toBe(false);
		// The fake link's linkHash won't match recomputation, caught at index 2
		expect(result.brokenAt).toBe(2);
	});

	it("tamper: modifying genesis prevHash to non-empty is caught at index 0", () => {
		const chain = cloneChain(buildChainOfN(3));
		(chain.links[0] as unknown as Record<string, unknown>).prevHash = "tampered";

		const result = verifyChain(chain);
		expect(result.intact).toBe(false);
		expect(result.brokenAt).toBe(0);
	});

	it("tamper: changing linkHash directly is detected (hash ≠ recomputed)", () => {
		const chain = cloneChain(buildChainOfN(3));
		(chain.links[0] as unknown as Record<string, unknown>).linkHash = "aaaa".repeat(16);

		const result = verifyChain(chain);
		expect(result.intact).toBe(false);
		expect(result.brokenAt).toBe(0);
	});

	it("tamper: modifying contentHash on a middle link is detected", () => {
		const chain = cloneChain(buildChainOfN(4));
		(chain.links[2] as unknown as Record<string, unknown>).contentHash = hashOf("EVIL CONTENT");

		const result = verifyChain(chain);
		expect(result.intact).toBe(false);
		expect(result.brokenAt).toBe(2);
	});

	it("tamper: removing the last link doesn't break verification of remaining", () => {
		const chain = cloneChain(buildChainOfN(5));
		chain.links.pop(); // Remove last
		const result = verifyChain(chain);
		expect(result.intact).toBe(true);
	});

	it("tamper: removing a middle link breaks at the gap", () => {
		const chain = cloneChain(buildChainOfN(5));
		chain.links.splice(2, 1); // Remove link at index 2

		const result = verifyChain(chain);
		expect(result.intact).toBe(false);
		// Link originally at index 3 (now index 2) has prevHash pointing to
		// the removed link, but link[1]'s hash is different
		expect(result.brokenAt).toBe(2);
	});

	it("each link's hash is unique across the chain", () => {
		const chain = buildChainOfN(10);
		const hashes = chain.links.map(l => l.linkHash);
		expect(new Set(hashes).size).toBe(hashes.length);
	});

	it("single-link chain (genesis only) verifies as intact", () => {
		const chain = createChain("solo", "alice", CONTENT_A, "bahya");
		expect(verifyChain(chain).intact).toBe(true);
	});
});

// ─── Trust Scoring (Mathematical Correctness) ──────────────────────────────

describe("Parampara — Trust Scoring", () => {
	it("TRUST_WEIGHTS sum to exactly 1.0", () => {
		const sum = TRUST_WEIGHTS.origin + TRUST_WEIGHTS.scan + TRUST_WEIGHTS.review
			+ TRUST_WEIGHTS.age + TRUST_WEIGHTS.freshness;
		expect(sum).toBeCloseTo(1.0, 10);
	});

	it("TRUST_WEIGHTS individual values match the formula (0.3, 0.3, 0.2, 0.1, 0.1)", () => {
		expect(TRUST_WEIGHTS.origin).toBe(0.3);
		expect(TRUST_WEIGHTS.scan).toBe(0.3);
		expect(TRUST_WEIGHTS.review).toBe(0.2);
		expect(TRUST_WEIGHTS.age).toBe(0.1);
		expect(TRUST_WEIGHTS.freshness).toBe(0.1);
	});

	it("antara kula always returns trust 1.0 with all components at 1.0", () => {
		const chain: ParamparaChain = {
			skillName: "core-skill",
			links: [],
			trust: { score: 0, originTrust: 0, scanTrust: 0, reviewTrust: 0, ageTrust: 0, freshnessTrust: 0 },
			chainIntact: true,
		};
		const trust = computeTrust(chain, "antara");
		expect(trust.score).toBe(1.0);
		expect(trust.originTrust).toBe(1.0);
		expect(trust.scanTrust).toBe(1.0);
		expect(trust.reviewTrust).toBe(1.0);
		expect(trust.ageTrust).toBe(1.0);
		expect(trust.freshnessTrust).toBe(1.0);
	});

	it("antara kula returns 1.0 even for chains with links", () => {
		const chain = createChain("core-tool", "system", CONTENT_A, "bahya");
		// Force recompute with antara
		const trust = computeTrust(chain, "antara");
		expect(trust.score).toBe(1.0);
	});

	it("empty chain (non-antara) returns minimal trust score ~0.1", () => {
		const chain: ParamparaChain = {
			skillName: "empty-skill",
			links: [],
			trust: { score: 0, originTrust: 0, scanTrust: 0, reviewTrust: 0, ageTrust: 0, freshnessTrust: 0 },
			chainIntact: true,
		};
		const trust = computeTrust(chain, "bahya");
		expect(trust.score).toBeCloseTo(0.1, 1);
		expect(trust.originTrust).toBe(0.1);
		expect(trust.scanTrust).toBe(0.1);
		expect(trust.reviewTrust).toBe(0.0);
		expect(trust.ageTrust).toBe(0.2);
		expect(trust.freshnessTrust).toBe(0.2);
	});

	it("origin trust: 'created' genesis yields originTrust = 0.8", () => {
		const chain = createChain("created-skill", "alice", CONTENT_A, "bahya");
		const trust = computeTrust(chain, "bahya");
		expect(trust.originTrust).toBe(0.8);
	});

	it("origin trust: 'scanned' genesis yields originTrust = 0.5", () => {
		// Build a chain with scanned genesis manually
		const contentHash = hashOf(CONTENT_A);
		const genesis = createGenesisLink("scanned", "scanner-bot", contentHash);
		const chain: ParamparaChain = {
			skillName: "scanned-skill",
			links: [genesis],
			trust: { score: 0, originTrust: 0, scanTrust: 0, reviewTrust: 0, ageTrust: 0, freshnessTrust: 0 },
			chainIntact: true,
		};
		const trust = computeTrust(chain, "bahya");
		expect(trust.originTrust).toBe(0.5);
	});

	it("scan trust: 0 scans → 0.1", () => {
		// Chain with only a "created" genesis (no scans)
		const chain = createChain("no-scan", "alice", CONTENT_A, "bahya");
		const trust = computeTrust(chain, "bahya");
		expect(trust.scanTrust).toBe(0.1);
	});

	it("scan trust: 1 scan → 0.5", () => {
		let chain = createChain("one-scan", "alice", CONTENT_A, "bahya");
		chain = appendLink(chain, "scanned", "scanner", hashOf(CONTENT_A));
		expect(chain.trust.scanTrust).toBe(0.5);
	});

	it("scan trust: 2 scans → 0.65", () => {
		let chain = createChain("two-scans", "alice", CONTENT_A, "bahya");
		chain = appendLink(chain, "scanned", "scanner-1", hashOf(CONTENT_A));
		chain = appendLink(chain, "scanned", "scanner-2", hashOf(CONTENT_A));
		expect(chain.trust.scanTrust).toBeCloseTo(0.65, 5);
	});

	it("scan trust: 3 scans → 0.8 (capped)", () => {
		let chain = createChain("three-scans", "alice", CONTENT_A, "bahya");
		chain = appendLink(chain, "scanned", "s1", hashOf(CONTENT_A));
		chain = appendLink(chain, "scanned", "s2", hashOf(CONTENT_A));
		chain = appendLink(chain, "scanned", "s3", hashOf(CONTENT_A));
		// Formula: min(0.8, 0.5 + (3-1)*0.15) = min(0.8, 0.8) = 0.8
		expect(chain.trust.scanTrust).toBeCloseTo(0.8, 5);
	});

	it("scan trust caps at 0.8 even with many scans", () => {
		let chain = createChain("many-scans", "alice", CONTENT_A, "bahya");
		for (let i = 0; i < 10; i++) {
			chain = appendLink(chain, "scanned", `scanner-${i}`, hashOf(CONTENT_A));
		}
		expect(chain.trust.scanTrust).toBeLessThanOrEqual(0.8);
	});

	it("review trust: 0 reviews → 0.0", () => {
		const chain = createChain("no-review", "alice", CONTENT_A, "bahya");
		const trust = computeTrust(chain, "bahya");
		expect(trust.reviewTrust).toBe(0.0);
	});

	it("review trust: 1 review → 0.5", () => {
		let chain = createChain("one-review", "alice", CONTENT_A, "bahya");
		chain = appendLink(chain, "reviewed", "reviewer", hashOf(CONTENT_A));
		expect(chain.trust.reviewTrust).toBe(0.5);
	});

	it("review trust: 2 reviews → 0.75", () => {
		let chain = createChain("two-reviews", "alice", CONTENT_A, "bahya");
		chain = appendLink(chain, "reviewed", "r1", hashOf(CONTENT_A));
		chain = appendLink(chain, "reviewed", "r2", hashOf(CONTENT_A));
		expect(chain.trust.reviewTrust).toBeCloseTo(0.75, 5);
	});

	it("review trust: 3 reviews caps at 0.8", () => {
		let chain = createChain("three-reviews", "alice", CONTENT_A, "bahya");
		chain = appendLink(chain, "reviewed", "r1", hashOf(CONTENT_A));
		chain = appendLink(chain, "reviewed", "r2", hashOf(CONTENT_A));
		chain = appendLink(chain, "reviewed", "r3", hashOf(CONTENT_A));
		// Formula: min(0.8, 0.5 + (3-1)*0.25) = min(0.8, 1.0) = 0.8
		expect(chain.trust.reviewTrust).toBe(0.8);
	});

	it("broken chain penalty: trust score is multiplied by 0.1", () => {
		const chain = createChain("penalty-test", "alice", CONTENT_A, "bahya");
		const intactTrust = computeTrust({ ...chain, chainIntact: true }, "bahya");
		const brokenTrust = computeTrust({ ...chain, chainIntact: false }, "bahya");

		expect(brokenTrust.score).toBeCloseTo(intactTrust.score * 0.1, 5);
	});

	it("trust score is always clamped to [0, 1]", () => {
		// Test with intact chain
		const chain = createChain("clamp-test", "alice", CONTENT_A, "bahya");
		expect(chain.trust.score).toBeGreaterThanOrEqual(0);
		expect(chain.trust.score).toBeLessThanOrEqual(1);

		// Test with broken chain
		const broken = computeTrust({ ...chain, chainIntact: false }, "bahya");
		expect(broken.score).toBeGreaterThanOrEqual(0);
		expect(broken.score).toBeLessThanOrEqual(1);
	});

	it("weighted sum formula is correct: score = W*components", () => {
		// Create a chain and manually verify the weighted sum
		const chain = createChain("formula-test", "alice", CONTENT_A, "bahya");
		const trust = chain.trust;
		const expectedScore =
			TRUST_WEIGHTS.origin * trust.originTrust +
			TRUST_WEIGHTS.scan * trust.scanTrust +
			TRUST_WEIGHTS.review * trust.reviewTrust +
			TRUST_WEIGHTS.age * trust.ageTrust +
			TRUST_WEIGHTS.freshness * trust.freshnessTrust;
		expect(trust.score).toBeCloseTo(Math.max(0, Math.min(1, expectedScore)), 5);
	});

	it("trust components are independent (scan changes don't affect review)", () => {
		let chain = createChain("independence", "alice", CONTENT_A, "bahya");
		const baseTrust = chain.trust;

		chain = appendLink(chain, "scanned", "scanner", hashOf(CONTENT_A));
		const afterScan = chain.trust;

		// Scan trust should increase
		expect(afterScan.scanTrust).toBeGreaterThan(baseTrust.scanTrust);
		// Review trust should remain the same
		expect(afterScan.reviewTrust).toBe(baseTrust.reviewTrust);
		// Origin trust should remain the same
		expect(afterScan.originTrust).toBe(baseTrust.originTrust);
	});

	it("shiksha kula computes trust normally (not treated as antara)", () => {
		const chain = createChain("shiksha-skill", "shiksha-gen", CONTENT_A, "shiksha");
		expect(chain.trust.score).toBeLessThan(1.0);
		expect(chain.trust.score).toBeGreaterThan(0);
	});

	it("age trust increases with older genesis (formula: 0.2 + days/250, cap 0.9)", () => {
		// For a fresh chain, age trust should be ~0.2 (0 days old)
		const chain = createChain("fresh", "alice", CONTENT_A, "bahya");
		expect(chain.trust.ageTrust).toBeCloseTo(0.2, 1);
	});

	it("freshness trust starts high for recently active chains", () => {
		const chain = createChain("fresh-chain", "alice", CONTENT_A, "bahya");
		// Just created, freshness should be close to 1.0 (0 days since last update)
		expect(chain.trust.freshnessTrust).toBeCloseTo(1.0, 1);
	});
});

// ─── createChain and appendLink ─────────────────────────────────────────────

describe("Parampara — createChain and appendLink", () => {
	it("createChain produces a valid chain with one genesis link", () => {
		const chain = createChain("new-skill", "bob", CONTENT_A, "bahya", "initial creation");
		expect(chain.skillName).toBe("new-skill");
		expect(chain.links).toHaveLength(1);
		expect(chain.links[0].action).toBe("created");
		expect(chain.links[0].actor).toBe("bob");
		expect(chain.links[0].prevHash).toBe("");
		expect(chain.links[0].note).toBe("initial creation");
		expect(chain.chainIntact).toBe(true);
	});

	it("createChain omits note property when note is undefined", () => {
		const chain = createChain("no-note", "alice", CONTENT_A, "bahya");
		expect(chain.links[0]).not.toHaveProperty("note");
	});

	it("createChain genesis link contentHash matches content", () => {
		const chain = createChain("hash-check", "alice", CONTENT_A, "bahya");
		const expectedHash = computeContentHash(CONTENT_A);
		expect(chain.links[0].contentHash).toBe(expectedHash);
	});

	it("appendLink is immutable (original chain is unchanged)", () => {
		const original = createChain("immutable-test", "alice", CONTENT_A, "bahya");
		const originalLinks = [...original.links];
		const originalHash = original.links[0].linkHash;

		const extended = appendLink(original, "scanned", "scanner", hashOf(CONTENT_A));

		// Original is untouched
		expect(original.links).toHaveLength(1);
		expect(original.links[0].linkHash).toBe(originalHash);
		expect(original.links).toEqual(originalLinks);

		// Extended has new link
		expect(extended.links).toHaveLength(2);
	});

	it("multiple appends create a valid chain of N links", () => {
		const chain = buildChainOfN(8);
		expect(chain.links).toHaveLength(8);
		expect(verifyChain(chain).intact).toBe(true);
	});

	it("appendLink preserves skillName from original chain", () => {
		const chain = createChain("preserved-name", "alice", CONTENT_A, "bahya");
		const extended = appendLink(chain, "scanned", "scanner", hashOf(CONTENT_A));
		expect(extended.skillName).toBe("preserved-name");
	});

	it("appendLink sets chainIntact based on verification", () => {
		const chain = createChain("intact-check", "alice", CONTENT_A, "bahya");
		const extended = appendLink(chain, "reviewed", "reviewer", hashOf(CONTENT_A));
		expect(extended.chainIntact).toBe(true);
	});

	it("appendLink with note includes note in the new link", () => {
		const chain = createChain("note-test", "alice", CONTENT_A, "bahya");
		const extended = appendLink(chain, "scanned", "scanner", hashOf(CONTENT_A), "all clear");
		expect(extended.links[1].note).toBe("all clear");
	});

	it("appendLink supports all valid action types", () => {
		const actions: ParamparaLink["action"][] = [
			"scanned", "reviewed", "updated", "promoted", "demoted",
		];
		let chain = createChain("action-types", "alice", CONTENT_A, "bahya");
		for (const action of actions) {
			chain = appendLink(chain, action, "actor", hashOf(CONTENT_A));
		}
		expect(chain.links).toHaveLength(6);
		expect(verifyChain(chain).intact).toBe(true);
		expect(chain.links.map(l => l.action)).toEqual([
			"created", "scanned", "reviewed", "updated", "promoted", "demoted",
		]);
	});
});

// ─── computeContentHash ─────────────────────────────────────────────────────

describe("Parampara — computeContentHash", () => {
	it("produces a consistent SHA-256 hex string for the same input", () => {
		const h1 = computeContentHash("hello world");
		const h2 = computeContentHash("hello world");
		expect(h1).toBe(h2);
		expect(h1).toMatch(/^[0-9a-f]{64}$/);
	});

	it("different content yields different hashes", () => {
		const h1 = computeContentHash(CONTENT_A);
		const h2 = computeContentHash(CONTENT_B);
		expect(h1).not.toBe(h2);
	});

	it("empty string has a valid SHA-256 hash", () => {
		const h = computeContentHash("");
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		// SHA-256 of empty string is a known constant
		expect(h).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	});

	it("handles Unicode content correctly", () => {
		const h = computeContentHash("परम्परा — Trust Lineage");
		expect(h).toMatch(/^[0-9a-f]{64}$/);
	});
});

// ─── Serialization Round-Trip ───────────────────────────────────────────────

describe("Parampara — Serialization Round-Trip", () => {
	it("serializeChain → deserializeChain preserves skillName", () => {
		const chain = buildChainOfN(3);
		const serialized = serializeChain(chain);
		const restored = deserializeChain(serialized, "bahya");
		expect(restored.skillName).toBe(chain.skillName);
	});

	it("serializeChain → deserializeChain preserves all links", () => {
		const chain = buildChainOfN(5);
		const serialized = serializeChain(chain);
		const restored = deserializeChain(serialized, "bahya");
		expect(restored.links).toHaveLength(chain.links.length);
		for (let i = 0; i < chain.links.length; i++) {
			expect(restored.links[i].linkHash).toBe(chain.links[i].linkHash);
			expect(restored.links[i].action).toBe(chain.links[i].action);
			expect(restored.links[i].actor).toBe(chain.links[i].actor);
			expect(restored.links[i].prevHash).toBe(chain.links[i].prevHash);
			expect(restored.links[i].contentHash).toBe(chain.links[i].contentHash);
		}
	});

	it("deserialization re-verifies chain integrity (does not trust serialized trust values)", () => {
		const chain = buildChainOfN(3);
		const serialized = serializeChain(chain);

		// Tamper with the serialized trust value in the header
		const lines = serialized.split("\n");
		const header = JSON.parse(lines[0]);
		header.trust.score = 999; // bogus value
		lines[0] = JSON.stringify(header);
		const tampered = lines.join("\n");

		const restored = deserializeChain(tampered, "bahya");
		// Trust should be recomputed, not the bogus 999
		expect(restored.trust.score).toBeLessThanOrEqual(1.0);
		expect(restored.trust.score).toBeGreaterThanOrEqual(0);
		expect(restored.trust.score).not.toBe(999);
	});

	it("tampered serialized link content → deserialized chain has chainIntact=false", () => {
		const chain = buildChainOfN(4);
		const serialized = serializeChain(chain);

		const lines = serialized.split("\n");
		// Tamper with link at index 2 (lines[3] since line[0] is header)
		const link = JSON.parse(lines[3]);
		link.actor = "evil-tampered";
		lines[3] = JSON.stringify(link);
		const tampered = lines.join("\n");

		const restored = deserializeChain(tampered, "bahya");
		expect(restored.chainIntact).toBe(false);
	});

	it("serialized format is JSONL (newline-delimited JSON)", () => {
		const chain = buildChainOfN(3);
		const serialized = serializeChain(chain);
		const lines = serialized.split("\n");
		// First line = header, rest = links
		expect(lines).toHaveLength(4); // 1 header + 3 links
		// Each line is valid JSON
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});

	it("empty chain throws on deserialization", () => {
		expect(() => deserializeChain("", "bahya")).toThrow("Empty Parampara chain content");
	});

	it("round-trip preserves chain verification status for intact chains", () => {
		const chain = buildChainOfN(5);
		expect(chain.chainIntact).toBe(true);
		const restored = deserializeChain(serializeChain(chain), "bahya");
		expect(restored.chainIntact).toBe(true);
	});

	it("deserialization with antara kula yields trust score 1.0", () => {
		const chain = buildChainOfN(3);
		const serialized = serializeChain(chain);
		const restored = deserializeChain(serialized, "antara");
		expect(restored.trust.score).toBe(1.0);
	});

	it("round-trip preserves note fields on links", () => {
		let chain = createChain("note-roundtrip", "alice", CONTENT_A, "bahya", "genesis note");
		chain = appendLink(chain, "scanned", "scanner", hashOf(CONTENT_A), "scan note");
		chain = appendLink(chain, "reviewed", "reviewer", hashOf(CONTENT_A));

		const restored = deserializeChain(serializeChain(chain), "bahya");
		expect(restored.links[0].note).toBe("genesis note");
		expect(restored.links[1].note).toBe("scan note");
		expect(restored.links[2].note).toBeUndefined();
	});
});
