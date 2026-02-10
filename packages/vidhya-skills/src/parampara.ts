/**
 * @fileoverview Parampara (परम्परा) — Trust lineage with Merkle-inspired hash chain
 * @module @chitragupta/vidhya-skills/parampara
 *
 * Implements a tamper-evident trust chain for skill provenance tracking.
 * Each link represents an action (created, scanned, reviewed, updated, approved)
 * with cryptographic binding to previous links via SHA-256 hashing.
 *
 * Trust scoring considers:
 * - Origin (how the skill was created)
 * - Security scans (clean validation history)
 * - Human reviews (expert approval)
 * - Age (maturity over time)
 * - Freshness (recent maintenance)
 * - Chain integrity (tamper detection)
 */

import { createHash } from "node:crypto";
import type {
	ParamparaLink,
	ParamparaTrust,
	ParamparaChain,
	KulaType,
} from "./types-v2.js";
import { TRUST_WEIGHTS, KULA_WEIGHTS } from "./types-v2.js";

/**
 * Computes the Merkle-style link hash using SHA-256.
 * Binds the link to its predecessor and content.
 *
 * @param action - The action performed (created, scanned, etc.)
 * @param actor - Who performed the action
 * @param timestamp - ISO 8601 timestamp
 * @param contentHash - SHA-256 of skill content
 * @param prevHash - Hash of previous link (empty string for genesis)
 * @returns Hex-encoded SHA-256 hash
 */
export function computeLinkHash(
	action: string,
	actor: string,
	timestamp: string,
	contentHash: string,
	prevHash: string,
): string {
	const payload = `${action}|${actor}|${timestamp}|${contentHash}|${prevHash}`;
	return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Computes SHA-256 hash of skill content (typically SKILL.md body).
 *
 * @param content - The skill content to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function computeContentHash(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Creates the genesis (first) link in a Parampara chain.
 *
 * @param action - Initial action ("created" or "scanned")
 * @param actor - Who performed the action
 * @param contentHash - SHA-256 of initial content
 * @param note - Optional human-readable note
 * @returns Genesis ParamparaLink with prevHash = ""
 */
export function createGenesisLink(
	action: "created" | "scanned",
	actor: string,
	contentHash: string,
	note?: string,
): ParamparaLink {
	const timestamp = new Date().toISOString();
	const prevHash = "";
	const linkHash = computeLinkHash(action, actor, timestamp, contentHash, prevHash);

	return {
		action,
		actor,
		timestamp,
		contentHash,
		prevHash,
		linkHash,
		...(note && { note }),
	};
}

/**
 * Appends a new link to an existing Parampara chain.
 * Recomputes trust score after adding the link.
 *
 * @param chain - The existing chain
 * @param action - Action to record
 * @param actor - Who performed the action
 * @param contentHash - SHA-256 of current content
 * @param note - Optional note
 * @returns New chain with appended link (immutable)
 */
export function appendLink(
	chain: ParamparaChain,
	action: ParamparaLink["action"],
	actor: string,
	contentHash: string,
	note?: string,
): ParamparaChain {
	const timestamp = new Date().toISOString();
	const prevHash = chain.links.length > 0
		? chain.links[chain.links.length - 1].linkHash
		: "";

	const linkHash = computeLinkHash(action, actor, timestamp, contentHash, prevHash);

	const newLink: ParamparaLink = {
		action,
		actor,
		timestamp,
		contentHash,
		prevHash,
		linkHash,
		...(note && { note }),
	};

	const intermediateChain: ParamparaChain = {
		skillName: chain.skillName,
		links: [...chain.links, newLink],
		trust: chain.trust,
		chainIntact: chain.chainIntact,
	};

	const verification = verifyChain(intermediateChain);
	const kula = determineKulaFromChain(intermediateChain);

	return {
		skillName: intermediateChain.skillName,
		links: intermediateChain.links,
		chainIntact: verification.intact,
		trust: computeTrust(
			{ ...intermediateChain, chainIntact: verification.intact },
			kula,
		),
	};
}

/**
 * Verifies the integrity of the entire Merkle chain.
 * Checks that each link's hash matches recomputation and
 * that prevHash pointers are correct.
 *
 * @param chain - The chain to verify
 * @returns Verification result with broken link index if any
 */
export function verifyChain(chain: ParamparaChain): {
	intact: boolean;
	brokenAt?: number;
} {
	if (chain.links.length === 0) {
		return { intact: true };
	}

	for (let i = 0; i < chain.links.length; i++) {
		const link = chain.links[i];

		if (i === 0) {
			if (link.prevHash !== "") {
				return { intact: false, brokenAt: i };
			}
		} else {
			const expectedPrevHash = chain.links[i - 1].linkHash;
			if (link.prevHash !== expectedPrevHash) {
				return { intact: false, brokenAt: i };
			}
		}

		const recomputedHash = computeLinkHash(
			link.action,
			link.actor,
			link.timestamp,
			link.contentHash,
			link.prevHash,
		);

		if (link.linkHash !== recomputedHash) {
			return { intact: false, brokenAt: i };
		}
	}

	return { intact: true };
}

/**
 * Helper: Compute days between two ISO timestamps.
 *
 * @param iso1 - First ISO 8601 timestamp
 * @param iso2 - Second ISO 8601 timestamp
 * @returns Absolute number of days between timestamps
 */
function daysBetween(iso1: string, iso2: string): number {
	const ms1 = new Date(iso1).getTime();
	const ms2 = new Date(iso2).getTime();
	return Math.abs(ms2 - ms1) / (1000 * 60 * 60 * 24);
}

/**
 * Computes trust score from the Parampara chain and kula.
 *
 * Trust is a weighted combination of:
 * - Origin trust (how skill was created)
 * - Scan trust (security validation history)
 * - Review trust (human expert approval)
 * - Age trust (maturity over time)
 * - Freshness trust (recent maintenance)
 *
 * Chain integrity violations result in 90% penalty (×0.1).
 *
 * @param chain - The Parampara chain
 * @param kula - Skill family (antara skills get 1.0 automatically)
 * @returns Trust score with component breakdown
 */
export function computeTrust(
	chain: ParamparaChain,
	kula: KulaType,
): ParamparaTrust {
	if (kula === "antara") {
		return {
			score: 1.0,
			originTrust: 1.0,
			scanTrust: 1.0,
			reviewTrust: 1.0,
			ageTrust: 1.0,
			freshnessTrust: 1.0,
		};
	}

	if (chain.links.length === 0) {
		return {
			score: 0.1,
			originTrust: 0.1,
			scanTrust: 0.1,
			reviewTrust: 0.0,
			ageTrust: 0.2,
			freshnessTrust: 0.2,
		};
	}

	const genesisLink = chain.links[0];
	const lastLink = chain.links[chain.links.length - 1];
	const now = new Date().toISOString();

	let originTrust = 0.1;
	if (genesisLink.action === "created") {
		originTrust = 0.8;
	} else if (genesisLink.action === "scanned") {
		originTrust = 0.5;
	}

	const scanCount = chain.links.filter(l => l.action === "scanned").length;
	let scanTrust = 0.1;
	if (scanCount === 0) {
		scanTrust = 0.1;
	} else if (scanCount === 1) {
		scanTrust = 0.5;
	} else {
		scanTrust = Math.min(0.8, 0.5 + (scanCount - 1) * 0.15);
	}

	const reviewCount = chain.links.filter(l => l.action === "reviewed").length;
	let reviewTrust = 0.0;
	if (reviewCount === 0) {
		reviewTrust = 0.0;
	} else if (reviewCount === 1) {
		reviewTrust = 0.5;
	} else {
		reviewTrust = Math.min(0.8, 0.5 + (reviewCount - 1) * 0.25);
	}

	const daysSinceGenesis = daysBetween(genesisLink.timestamp, now);
	const ageTrust = Math.min(0.9, 0.2 + daysSinceGenesis / 250);

	const daysSinceLastUpdate = daysBetween(lastLink.timestamp, now);
	const freshnessTrust = Math.max(0.2, 1.0 - daysSinceLastUpdate / 400);

	let score =
		TRUST_WEIGHTS.origin * originTrust +
		TRUST_WEIGHTS.scan * scanTrust +
		TRUST_WEIGHTS.review * reviewTrust +
		TRUST_WEIGHTS.age * ageTrust +
		TRUST_WEIGHTS.freshness * freshnessTrust;

	if (!chain.chainIntact) {
		score *= 0.1;
	}

	score = Math.max(0, Math.min(1, score));

	return {
		score,
		originTrust,
		scanTrust,
		reviewTrust,
		ageTrust,
		freshnessTrust,
	};
}

/**
 * Creates a new Parampara chain with a genesis "created" link.
 *
 * @param skillName - Name of the skill
 * @param actor - Who created the skill
 * @param content - Initial skill content (SKILL.md body)
 * @param kula - Skill family
 * @param note - Optional note for genesis link
 * @returns New ParamparaChain
 */
export function createChain(
	skillName: string,
	actor: string,
	content: string,
	kula: KulaType,
	note?: string,
): ParamparaChain {
	const contentHash = computeContentHash(content);
	const genesisLink = createGenesisLink("created", actor, contentHash, note);

	const baseChain: ParamparaChain = {
		skillName,
		links: [genesisLink],
		trust: {
			score: 0,
			originTrust: 0,
			scanTrust: 0,
			reviewTrust: 0,
			ageTrust: 0,
			freshnessTrust: 0,
		},
		chainIntact: true,
	};

	return {
		...baseChain,
		trust: computeTrust(baseChain, kula),
	};
}

/**
 * Serializes a Parampara chain to JSONL format.
 * First line is the header with metadata.
 * Subsequent lines are individual links.
 *
 * @param chain - The chain to serialize
 * @returns JSONL string (newline-delimited JSON)
 */
export function serializeChain(chain: ParamparaChain): string {
	const header = {
		skillName: chain.skillName,
		trust: chain.trust,
		chainIntact: chain.chainIntact,
	};

	const lines = [JSON.stringify(header)];

	for (const link of chain.links) {
		lines.push(JSON.stringify(link));
	}

	return lines.join("\n");
}

/**
 * Deserializes a JSONL string back to a ParamparaChain.
 * Re-verifies chain integrity and recomputes trust (don't trust serialized values).
 *
 * @param content - JSONL string
 * @param kula - Skill family (needed for trust computation)
 * @returns Deserialized and verified ParamparaChain
 */
export function deserializeChain(
	content: string,
	kula: KulaType,
): ParamparaChain {
	const lines = content.trim().split("\n").filter(l => l.length > 0);

	if (lines.length === 0) {
		throw new Error("Empty Parampara chain content");
	}

	const header = JSON.parse(lines[0]) as {
		skillName: string;
		trust: ParamparaTrust;
		chainIntact: boolean;
	};

	const links: ParamparaLink[] = [];
	for (let i = 1; i < lines.length; i++) {
		const link = JSON.parse(lines[i]) as ParamparaLink;
		links.push(link);
	}

	const rawChain: ParamparaChain = {
		skillName: header.skillName,
		links,
		trust: header.trust,
		chainIntact: header.chainIntact,
	};

	const verification = verifyChain(rawChain);

	return {
		skillName: rawChain.skillName,
		links: rawChain.links,
		chainIntact: verification.intact,
		trust: computeTrust(
			{ ...rawChain, chainIntact: verification.intact },
			kula,
		),
	};
}

/**
 * Helper: Determines kula from chain (heuristic for deserialization).
 * If chain has no links or is from "system", assume antara.
 * Otherwise, assume bahya (external).
 *
 * @param chain - The chain to inspect
 * @returns Inferred KulaType
 */
function determineKulaFromChain(chain: ParamparaChain): KulaType {
	if (chain.links.length === 0) {
		return "bahya";
	}

	const genesisActor = chain.links[0].actor;
	if (genesisActor === "system" || genesisActor === "chitragupta") {
		return "antara";
	}

	return "bahya";
}
