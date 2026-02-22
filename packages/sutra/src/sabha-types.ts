/**
 * @chitragupta/sutra — Sabha types, constants, and utility functions.
 *
 * Type definitions for the multi-agent deliberation protocol,
 * NLU keyword sets for fallacy detection, and utility functions.
 * Extracted from sabha.ts to keep file sizes under 450 LOC.
 *
 * @packageDocumentation
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** The 5 steps of Nyaya syllogism (Panchavayava). */
export interface NyayaSyllogism {
	/** Proposition: "The hill has fire." */
	pratijna: string;
	/** Reason: "Because there is smoke." */
	hetu: string;
	/** Example: "Wherever there is smoke, there is fire, as in a kitchen." */
	udaharana: string;
	/** Application: "The hill has smoke." */
	upanaya: string;
	/** Conclusion: "Therefore, the hill has fire." */
	nigamana: string;
}

/** The 5 types of logical fallacy (Hetvabhasa). */
export type HetvabhasaType =
	| "asiddha"         // Unestablished reason — premise not proven
	| "viruddha"        // Contradictory reason — proves opposite
	| "anaikantika"     // Inconclusive reason — too broad
	| "prakarana-sama"  // Circular reason — begs the question
	| "kalatita";       // Untimely reason — temporal invalidity

export interface HetvabhasaDetection {
	/** Which fallacy type was detected. */
	type: HetvabhasaType;
	/** Human-readable description of the detected fallacy. */
	description: string;
	/** 'fatal' halts deliberation; 'warning' is advisory. */
	severity: "fatal" | "warning";
	/** Which syllogism step is affected. */
	affectedStep: keyof NyayaSyllogism;
}

export interface SabhaParticipant {
	/** Unique participant identifier. */
	id: string;
	/** Role in the assembly (e.g., 'proposer', 'challenger', 'observer'). */
	role: string;
	/** Domain expertise score in [0, 1] — ideally a Wilson CI lower bound. */
	expertise: number;
	/** Running credibility score — updated by outcomes. */
	credibility: number;
}

export interface SabhaVote {
	/** Who cast the vote. */
	participantId: string;
	/** Position taken. */
	position: "support" | "oppose" | "abstain";
	/** Vote weight = expertise * credibility. */
	weight: number;
	/** Free-text justification for the position. */
	reasoning: string;
}

export interface ChallengeRecord {
	/** Who issued the challenge. */
	challengerId: string;
	/** Which syllogism step is targeted. */
	targetStep: keyof NyayaSyllogism;
	/** The challenge text. */
	challenge: string;
	/** Detected fallacy, if any. */
	fallacyDetected?: HetvabhasaDetection;
	/** Proposer's response to the challenge. */
	response?: string;
	/** Whether this challenge has been addressed. */
	resolved: boolean;
}

export type SabhaStatus = "convened" | "deliberating" | "voting" | "concluded" | "escalated";

export interface SabhaRound {
	/** 1-indexed round number. */
	roundNumber: number;
	/** The syllogism proposed in this round. */
	proposal: NyayaSyllogism;
	/** Challenges raised against the proposal. */
	challenges: ChallengeRecord[];
	/** Votes cast in this round. */
	votes: SabhaVote[];
	/** Round-level verdict (null while in progress). */
	verdict: "accepted" | "rejected" | "no-consensus" | null;
}

export interface Sabha {
	/** Unique Sabha identifier (FNV-1a hash). */
	id: string;
	/** Topic under deliberation. */
	topic: string;
	/** Current status of the Sabha. */
	status: SabhaStatus;
	/** Who convened the assembly. */
	convener: string;
	/** Assembly participants. */
	participants: SabhaParticipant[];
	/** Deliberation rounds. */
	rounds: SabhaRound[];
	/** Final verdict across all rounds (null while in progress). */
	finalVerdict: "accepted" | "rejected" | "escalated" | null;
	/** Unix timestamp (ms) when convened. */
	createdAt: number;
	/** Unix timestamp (ms) when concluded (null while in progress). */
	concludedAt: number | null;
}

export interface SabhaConfig {
	/** Maximum deliberation rounds before forced conclusion. Default: 3 */
	maxRounds: number;
	/** Maximum number of participants in a single Sabha. Default: 7 */
	maxParticipants: number;
	/** Weighted vote threshold for consensus. Default: 0.67 */
	consensusThreshold: number;
	/** Timeout for challenges in ms. Default: 30000 */
	challengeTimeout: number;
	/** Whether to escalate to user on no-consensus. Default: true */
	autoEscalate: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** FNV-1a 32-bit offset basis. */
export const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a 32-bit prime. */
export const FNV_PRIME = 0x01000193;

/** Default Sabha configuration. */
export const DEFAULT_CONFIG: SabhaConfig = {
	maxRounds: 3,
	maxParticipants: 7,
	consensusThreshold: 0.67,
	challengeTimeout: 30_000,
	autoEscalate: true,
};

/** System hard ceilings — cannot be overridden by user config. */
export const HARD_CEILINGS = {
	maxRounds: 10,
	maxParticipants: 20,
	consensusThreshold: { min: 0.5, max: 0.95 },
} as const;

/** Stop words for keyword extraction — filtered out during NLU analysis. */
export const STOP_WORDS = new Set([
	"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
	"have", "has", "had", "do", "does", "did", "will", "would", "shall",
	"should", "may", "might", "must", "can", "could", "of", "in", "to",
	"for", "with", "on", "at", "from", "by", "as", "into", "through",
	"during", "before", "after", "above", "below", "between", "under",
	"over", "and", "but", "or", "nor", "not", "no", "so", "if", "then",
	"than", "that", "this", "these", "those", "it", "its", "there",
	"their", "they", "we", "he", "she", "you", "i", "me", "my", "your",
	"his", "her", "our", "us", "them", "because", "therefore", "wherever",
	"whenever", "also", "just", "like", "about", "up", "out", "what",
	"which", "who", "whom", "how", "when", "where", "why",
]);

/** Keywords indicating contradiction (for Viruddha detection). */
export const NEGATION_WORDS = new Set([
	"not", "no", "never", "neither", "nor", "without", "lack", "lacks",
	"lacking", "absent", "absence", "impossible", "cannot", "doesn't",
	"don't", "won't", "isn't", "aren't", "wasn't", "weren't", "hasn't",
	"haven't", "hadn't", "shouldn't", "couldn't", "wouldn't", "unlike",
	"opposite", "contrary", "contradicts", "disproves", "refutes",
	"prevents", "prohibits", "excludes", "denies", "false", "untrue",
]);

/** Keywords indicating over-broad universals (for Anaikantika detection). */
export const UNIVERSAL_WORDS = new Set([
	"all", "every", "always", "everything", "everyone", "everywhere",
	"any", "anything", "anyone", "each", "entire", "universal",
	"universally", "necessarily", "inevitably", "absolutely", "certainly",
	"undoubtedly", "without exception", "in all cases",
]);

/** Keywords indicating past tense / temporal references (for Kalatita detection). */
export const PAST_INDICATORS = new Set([
	"was", "were", "had", "did", "used to", "formerly", "previously",
	"once", "ago", "earlier", "past", "historical", "historically",
	"ancient", "old", "obsolete", "deprecated", "legacy", "former",
	"bygone", "elapsed", "expired", "finished", "ended", "ceased",
]);

/** Keywords indicating future / predictive statements. */
export const FUTURE_INDICATORS = new Set([
	"will", "shall", "going to", "future", "predict", "predicts",
	"predicted", "forecast", "forecasts", "anticipate", "anticipates",
	"expect", "expects", "projected", "upcoming", "forthcoming",
	"eventually", "soon", "tomorrow", "next",
]);

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash → hex string.
 *
 * Produces deterministic identifiers from arbitrary text input.
 * Used for generating stable Sabha IDs.
 */
export function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME) >>> 0;
	}
	return hash.toString(16);
}

/**
 * Extract meaningful keywords from text.
 *
 * Lowercases, splits on non-alphanumeric boundaries, filters out
 * stop words and tokens shorter than 2 characters.
 */
export function extractKeywords(text: string): Set<string> {
	const words = text.toLowerCase().split(/[^a-z0-9]+/);
	const result = new Set<string>();
	for (const w of words) {
		if (w.length >= 2 && !STOP_WORDS.has(w)) {
			result.add(w);
		}
	}
	return result;
}

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|
 *
 * Returns 0 when both sets are empty.
 * Used for Prakarana-sama (circular reasoning) detection.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0;
	let intersection = 0;
	for (const item of a) {
		if (b.has(item)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

/**
 * Check if text contains any words from a given set.
 *
 * Splits on non-alpha boundaries and checks membership.
 */
export function containsAnyWord(text: string, wordSet: Set<string>): boolean {
	const words = text.toLowerCase().split(/[^a-z']+/);
	for (const w of words) {
		if (wordSet.has(w)) return true;
	}
	return false;
}

/**
 * Count how many words from a given set appear in the text.
 */
export function countMatchingWords(text: string, wordSet: Set<string>): number {
	const words = text.toLowerCase().split(/[^a-z']+/);
	let count = 0;
	for (const w of words) {
		if (wordSet.has(w)) count++;
	}
	return count;
}

/**
 * Clamp a numeric value to [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

