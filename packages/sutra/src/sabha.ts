/**
 * @chitragupta/sutra — Sabha — सभा — Multi-Agent Deliberation Protocol.
 *
 * In the Vedic tradition, a Sabha is the assembly hall where learned
 * scholars gather under strict procedural discipline to debate matters
 * of dharma, artha, and nyaya. Each proposition must withstand the
 * rigours of the Panchavayava (five-limbed syllogism) of Nyaya logic,
 * and opponents may invoke the five Hetvabhasa (logical fallacies) to
 * challenge weak reasoning.
 *
 * This module provides a structured deliberation engine for multi-agent
 * decision-making. Instead of a single agent deciding in isolation,
 * critical decisions pass through a Sabha where multiple perspectives
 * are voiced, challenged, and resolved through weighted consensus.
 *
 * ## Protocol Flow
 *
 * ```
 * convene() → propose(Panchavayava) → challenge(Hetvabhasa) → respond()
 *     ↓                                                          ↓
 *   vote(weighted) ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
 *     ↓
 * conclude() → accepted | rejected | escalated
 * ```
 *
 * ## Weighted Voting
 *
 * Each participant's vote is weighted by `expertise * credibility`:
 *   normalizedScore = Σ(weight * sign) / Σ|weight|
 *   verdict = score >= threshold → accepted
 *             score <= -threshold → rejected
 *             else → no-consensus (→ escalation if configured)
 *
 * ## Fallacy Detection (Hetvabhasa)
 *
 * Five classical fallacies detected via heuristic NLU (zero LLM cost):
 *   1. Asiddha   — unestablished premise
 *   2. Viruddha  — contradictory reason
 *   3. Anaikantika — inconclusive/over-broad reason
 *   4. Prakarana-sama — circular reasoning
 *   5. Kalatita  — untimely/temporal invalidity
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
const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/** Default Sabha configuration. */
const DEFAULT_CONFIG: SabhaConfig = {
	maxRounds: 3,
	maxParticipants: 7,
	consensusThreshold: 0.67,
	challengeTimeout: 30_000,
	autoEscalate: true,
};

/** System hard ceilings — cannot be overridden by user config. */
const HARD_CEILINGS = {
	maxRounds: 10,
	maxParticipants: 20,
	consensusThreshold: { min: 0.5, max: 0.95 },
} as const;

/** Stop words for keyword extraction — filtered out during NLU analysis. */
const STOP_WORDS = new Set([
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
const NEGATION_WORDS = new Set([
	"not", "no", "never", "neither", "nor", "without", "lack", "lacks",
	"lacking", "absent", "absence", "impossible", "cannot", "doesn't",
	"don't", "won't", "isn't", "aren't", "wasn't", "weren't", "hasn't",
	"haven't", "hadn't", "shouldn't", "couldn't", "wouldn't", "unlike",
	"opposite", "contrary", "contradicts", "disproves", "refutes",
	"prevents", "prohibits", "excludes", "denies", "false", "untrue",
]);

/** Keywords indicating over-broad universals (for Anaikantika detection). */
const UNIVERSAL_WORDS = new Set([
	"all", "every", "always", "everything", "everyone", "everywhere",
	"any", "anything", "anyone", "each", "entire", "universal",
	"universally", "necessarily", "inevitably", "absolutely", "certainly",
	"undoubtedly", "without exception", "in all cases",
]);

/** Keywords indicating past tense / temporal references (for Kalatita detection). */
const PAST_INDICATORS = new Set([
	"was", "were", "had", "did", "used to", "formerly", "previously",
	"once", "ago", "earlier", "past", "historical", "historically",
	"ancient", "old", "obsolete", "deprecated", "legacy", "former",
	"bygone", "elapsed", "expired", "finished", "ended", "ceased",
]);

/** Keywords indicating future / predictive statements. */
const FUTURE_INDICATORS = new Set([
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
function fnv1a(input: string): string {
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
function extractKeywords(text: string): Set<string> {
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
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
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
function containsAnyWord(text: string, wordSet: Set<string>): boolean {
	const words = text.toLowerCase().split(/[^a-z']+/);
	for (const w of words) {
		if (wordSet.has(w)) return true;
	}
	return false;
}

/**
 * Count how many words from a given set appear in the text.
 */
function countMatchingWords(text: string, wordSet: Set<string>): number {
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
function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// ─── SabhaEngine ────────────────────────────────────────────────────────────

/**
 * Sabha Engine — Multi-Agent Deliberation Protocol.
 *
 * Provides a structured deliberation framework based on Nyaya logic.
 * Multiple agents (or agent perspectives) can propose, challenge,
 * and vote on decisions using the Panchavayava syllogism.
 *
 * @example
 * ```ts
 * const engine = new SabhaEngine();
 * const sabha = engine.convene("Should we refactor the auth module?", "orchestrator", [
 *   { id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
 *   { id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
 *   { id: "anveshi", role: "observer", expertise: 0.7, credibility: 0.8 },
 * ]);
 *
 * engine.propose(sabha.id, "kartru", {
 *   pratijna: "The auth module should be refactored.",
 *   hetu: "Because it has accumulated technical debt.",
 *   udaharana: "Wherever modules have high cyclomatic complexity, refactoring improves maintainability, as in the payment module.",
 *   upanaya: "The auth module has high cyclomatic complexity.",
 *   nigamana: "Therefore, the auth module should be refactored.",
 * });
 *
 * engine.vote(sabha.id, "kartru", "support", "I proposed it.");
 * engine.vote(sabha.id, "parikshaka", "support", "The evidence is sound.");
 * engine.vote(sabha.id, "anveshi", "support", "I concur.");
 *
 * const concluded = engine.conclude(sabha.id);
 * // concluded.finalVerdict === "accepted"
 * ```
 */
export class SabhaEngine {
	private readonly config: SabhaConfig;
	private readonly sabhas = new Map<string, Sabha>();

	/**
	 * Create a new SabhaEngine.
	 *
	 * Configuration follows two-tier pattern: user-provided values are
	 * merged with defaults, then clamped by system hard ceilings.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<SabhaConfig>) {
		const merged = { ...DEFAULT_CONFIG, ...config };
		this.config = {
			maxRounds: Math.min(merged.maxRounds, HARD_CEILINGS.maxRounds),
			maxParticipants: Math.min(merged.maxParticipants, HARD_CEILINGS.maxParticipants),
			consensusThreshold: clamp(
				merged.consensusThreshold,
				HARD_CEILINGS.consensusThreshold.min,
				HARD_CEILINGS.consensusThreshold.max,
			),
			challengeTimeout: merged.challengeTimeout,
			autoEscalate: merged.autoEscalate,
		};
	}

	// ─── Lifecycle ────────────────────────────────────────────────────

	/**
	 * Convene a new Sabha (assembly).
	 *
	 * Creates a deliberation session with the given participants.
	 * The convener is the agent or entity requesting the deliberation.
	 *
	 * @param topic - The subject to be deliberated.
	 * @param convener - Identifier of the entity convening the assembly.
	 * @param participants - The agents participating in deliberation.
	 * @returns The newly created Sabha.
	 * @throws If participants exceed maxParticipants or if fewer than 2 participants.
	 */
	convene(topic: string, convener: string, participants: SabhaParticipant[]): Sabha {
		if (participants.length < 2) {
			throw new Error("Sabha requires at least 2 participants for meaningful deliberation.");
		}
		if (participants.length > this.config.maxParticipants) {
			throw new Error(
				`Sabha exceeds maxParticipants (${this.config.maxParticipants}). ` +
				`Provided: ${participants.length}.`,
			);
		}

		// Validate participant IDs are unique
		const ids = new Set(participants.map((p) => p.id));
		if (ids.size !== participants.length) {
			throw new Error("Sabha participants must have unique IDs.");
		}

		// Clamp expertise and credibility to [0, 1]
		const clamped = participants.map((p) => ({
			...p,
			expertise: clamp(p.expertise, 0, 1),
			credibility: clamp(p.credibility, 0, 1),
		}));

		const now = Date.now();
		const id = `sabha-${fnv1a(topic + convener + now.toString())}`;

		const sabha: Sabha = {
			id,
			topic,
			status: "convened",
			convener,
			participants: clamped,
			rounds: [],
			finalVerdict: null,
			createdAt: now,
			concludedAt: null,
		};

		this.sabhas.set(id, sabha);
		return sabha;
	}

	// ─── Proposal ─────────────────────────────────────────────────────

	/**
	 * Submit a proposal (Nyaya syllogism) to the Sabha.
	 *
	 * Creates a new deliberation round. Only participants with the
	 * 'proposer' role (or any role if none has that role) may propose.
	 *
	 * @param sabhaId - The Sabha to propose to.
	 * @param proposerId - The participant making the proposal.
	 * @param syllogism - The five-limbed Nyaya argument.
	 * @returns The newly created round.
	 * @throws If Sabha not found, already concluded, max rounds reached, or proposer not a participant.
	 */
	propose(sabhaId: string, proposerId: string, syllogism: NyayaSyllogism): SabhaRound {
		const sabha = this.requireSabha(sabhaId);

		if (sabha.status === "concluded" || sabha.status === "escalated") {
			throw new Error(`Sabha ${sabhaId} has already ${sabha.status}. Cannot propose.`);
		}

		if (sabha.rounds.length >= this.config.maxRounds) {
			throw new Error(
				`Sabha ${sabhaId} has reached max rounds (${this.config.maxRounds}). ` +
				`Conclude or escalate.`,
			);
		}

		this.requireParticipant(sabha, proposerId);

		// Validate syllogism fields are non-empty
		const fields: (keyof NyayaSyllogism)[] = ["pratijna", "hetu", "udaharana", "upanaya", "nigamana"];
		for (const field of fields) {
			if (!syllogism[field] || syllogism[field].trim().length === 0) {
				throw new Error(`Syllogism field '${field}' must not be empty.`);
			}
		}

		const round: SabhaRound = {
			roundNumber: sabha.rounds.length + 1,
			proposal: { ...syllogism },
			challenges: [],
			votes: [],
			verdict: null,
		};

		sabha.rounds.push(round);
		sabha.status = "deliberating";
		return round;
	}

	// ─── Challenge ────────────────────────────────────────────────────

	/**
	 * Challenge a specific step of the current proposal.
	 *
	 * Any participant (except the proposer themselves, by convention)
	 * may challenge a specific step of the Nyaya syllogism. The challenge
	 * is automatically checked for Hetvabhasa (logical fallacy) detection.
	 *
	 * @param sabhaId - The Sabha to challenge in.
	 * @param challengerId - The participant issuing the challenge.
	 * @param target - Which syllogism step to challenge.
	 * @param challenge - The challenge text.
	 * @returns The created challenge record.
	 * @throws If Sabha not found, not in deliberating status, or no active round.
	 */
	challenge(
		sabhaId: string,
		challengerId: string,
		target: keyof NyayaSyllogism,
		challenge: string,
	): ChallengeRecord {
		const sabha = this.requireSabha(sabhaId);

		if (sabha.status !== "deliberating") {
			throw new Error(`Sabha ${sabhaId} is not in deliberating status. Current: ${sabha.status}.`);
		}

		this.requireParticipant(sabha, challengerId);

		const round = this.currentRound(sabha);
		if (!round) {
			throw new Error(`Sabha ${sabhaId} has no active round. Submit a proposal first.`);
		}

		// Run fallacy detection on the challenged step
		const fallacies = this.detectFallacies(round.proposal);
		const relevantFallacy = fallacies.find((f) => f.affectedStep === target);

		const record: ChallengeRecord = {
			challengerId,
			targetStep: target,
			challenge,
			fallacyDetected: relevantFallacy,
			resolved: false,
		};

		round.challenges.push(record);
		return record;
	}

	// ─── Response ─────────────────────────────────────────────────────

	/**
	 * Respond to a challenge in the current round.
	 *
	 * The proposer (or any participant) addresses a specific challenge
	 * by providing a response. This marks the challenge as resolved.
	 *
	 * @param sabhaId - The Sabha.
	 * @param recordIndex - The 0-based index of the challenge in the current round.
	 * @param response - The response text.
	 * @throws If Sabha not found, not deliberating, or index out of bounds.
	 */
	respond(sabhaId: string, recordIndex: number, response: string): void {
		const sabha = this.requireSabha(sabhaId);

		if (sabha.status !== "deliberating") {
			throw new Error(`Sabha ${sabhaId} is not in deliberating status. Current: ${sabha.status}.`);
		}

		const round = this.currentRound(sabha);
		if (!round) {
			throw new Error(`Sabha ${sabhaId} has no active round.`);
		}

		if (recordIndex < 0 || recordIndex >= round.challenges.length) {
			throw new Error(
				`Challenge index ${recordIndex} out of bounds. ` +
				`Current round has ${round.challenges.length} challenges.`,
			);
		}

		const record = round.challenges[recordIndex];
		record.response = response;
		record.resolved = true;
	}

	// ─── Voting ───────────────────────────────────────────────────────

	/**
	 * Cast a vote in the current round.
	 *
	 * Vote weight is computed as `expertise * credibility` of the participant.
	 * Each participant may vote only once per round.
	 *
	 * @param sabhaId - The Sabha.
	 * @param participantId - Who is voting.
	 * @param position - 'support', 'oppose', or 'abstain'.
	 * @param reasoning - Justification for the vote.
	 * @returns The recorded vote.
	 * @throws If Sabha not found, not in deliberating/voting status, no active round, or already voted.
	 */
	vote(
		sabhaId: string,
		participantId: string,
		position: "support" | "oppose" | "abstain",
		reasoning: string,
	): SabhaVote {
		const sabha = this.requireSabha(sabhaId);

		if (sabha.status !== "deliberating" && sabha.status !== "voting") {
			throw new Error(`Sabha ${sabhaId} is not accepting votes. Current status: ${sabha.status}.`);
		}

		const participant = this.requireParticipant(sabha, participantId);

		const round = this.currentRound(sabha);
		if (!round) {
			throw new Error(`Sabha ${sabhaId} has no active round. Submit a proposal first.`);
		}

		// Prevent duplicate votes
		const alreadyVoted = round.votes.some((v) => v.participantId === participantId);
		if (alreadyVoted) {
			throw new Error(`Participant '${participantId}' has already voted in round ${round.roundNumber}.`);
		}

		const weight = participant.expertise * participant.credibility;

		const vote: SabhaVote = {
			participantId,
			position,
			weight,
			reasoning,
		};

		round.votes.push(vote);

		// Transition to voting status after first vote
		if (sabha.status === "deliberating") {
			sabha.status = "voting";
		}

		return vote;
	}

	// ─── Conclusion ───────────────────────────────────────────────────

	/**
	 * Conclude the Sabha — tally weighted votes and determine final verdict.
	 *
	 * Evaluates all rounds. If any round reaches consensus (accepted/rejected),
	 * that becomes the final verdict. If no round reaches consensus and
	 * `autoEscalate` is true, the verdict is 'escalated'.
	 *
	 * Weighted voting formula:
	 *   weightedScore = Σ vote.weight * sign(position)
	 *   normalizedScore = weightedScore / Σ |vote.weight|
	 *   verdict = normalizedScore >= threshold → accepted
	 *             normalizedScore <= -threshold → rejected
	 *             else → no-consensus
	 *
	 * @param sabhaId - The Sabha to conclude.
	 * @returns The concluded Sabha with final verdict.
	 * @throws If Sabha not found or already concluded.
	 */
	conclude(sabhaId: string): Sabha {
		const sabha = this.requireSabha(sabhaId);

		if (sabha.status === "concluded" || sabha.status === "escalated") {
			throw new Error(`Sabha ${sabhaId} has already ${sabha.status}.`);
		}

		// Tally each round
		for (const round of sabha.rounds) {
			if (round.verdict !== null) continue;
			round.verdict = this.tallyRound(round);
		}

		// Determine final verdict: use the last round with a decisive result,
		// or fall back to the last round's verdict
		let finalVerdict: "accepted" | "rejected" | "escalated" | null = null;

		for (const round of sabha.rounds) {
			if (round.verdict === "accepted" || round.verdict === "rejected") {
				finalVerdict = round.verdict;
			}
		}

		// If no decisive round, check auto-escalation
		if (finalVerdict === null) {
			finalVerdict = this.config.autoEscalate ? "escalated" : "escalated";
			// Even without autoEscalate, no-consensus is escalated since we
			// can't auto-decide. The difference is in how the caller handles it.
		}

		sabha.finalVerdict = finalVerdict;
		sabha.status = finalVerdict === "escalated" ? "escalated" : "concluded";
		sabha.concludedAt = Date.now();

		return sabha;
	}

	// ─── Fallacy Detection ────────────────────────────────────────────

	/**
	 * Detect Hetvabhasa (logical fallacies) in a Nyaya syllogism.
	 *
	 * Performs five heuristic checks using keyword matching and Jaccard
	 * similarity — zero LLM cost. Each detected fallacy is tagged with
	 * severity and the affected syllogism step.
	 *
	 * ### The Five Hetvabhasa
	 *
	 * 1. **Asiddha** — hetu references terms not grounded in udaharana
	 * 2. **Viruddha** — hetu contains negation that contradicts pratijna
	 * 3. **Anaikantika** — hetu uses overly broad universals
	 * 4. **Prakarana-sama** — nigamana is semantically identical to pratijna
	 * 5. **Kalatita** — hetu uses past-tense to justify future prediction
	 *
	 * @param syllogism - The Nyaya syllogism to analyze.
	 * @returns Array of detected fallacies (may be empty).
	 */
	detectFallacies(syllogism: NyayaSyllogism): HetvabhasaDetection[] {
		const detections: HetvabhasaDetection[] = [];

		// 1. Asiddha — Unestablished: hetu keywords not found in udaharana
		detections.push(...this.detectAsiddha(syllogism));

		// 2. Viruddha — Contradictory: hetu negates pratijna
		detections.push(...this.detectViruddha(syllogism));

		// 3. Anaikantika — Inconclusive: hetu uses over-broad universals
		detections.push(...this.detectAnaikantika(syllogism));

		// 4. Prakarana-sama — Circular: nigamana ≈ pratijna
		detections.push(...this.detectPrakaranaSama(syllogism));

		// 5. Kalatita — Untimely: hetu references past for future claims
		detections.push(...this.detectKalatita(syllogism));

		return detections;
	}

	// ─── Queries ──────────────────────────────────────────────────────

	/**
	 * Get a Sabha by ID.
	 *
	 * @param id - The Sabha identifier.
	 * @returns The Sabha, or undefined if not found.
	 */
	getSabha(id: string): Sabha | undefined {
		return this.sabhas.get(id);
	}

	/**
	 * List all active (non-concluded, non-escalated) Sabhas.
	 *
	 * @returns Array of active Sabhas.
	 */
	listActive(): Sabha[] {
		const active: Sabha[] = [];
		for (const sabha of this.sabhas.values()) {
			if (sabha.status !== "concluded" && sabha.status !== "escalated") {
				active.push(sabha);
			}
		}
		return active;
	}

	/**
	 * Generate a human-readable deliberation summary.
	 *
	 * Provides a structured explanation of the Sabha's proceedings:
	 * topic, participants, rounds, challenges, votes, and final verdict.
	 *
	 * @param sabhaId - The Sabha to summarize.
	 * @returns Multi-line summary string.
	 * @throws If Sabha not found.
	 */
	explain(sabhaId: string): string {
		const sabha = this.requireSabha(sabhaId);
		const lines: string[] = [];

		lines.push(`Sabha: ${sabha.topic}`);
		lines.push(`Status: ${sabha.status}`);
		lines.push(`Convener: ${sabha.convener}`);
		lines.push(`Participants: ${sabha.participants.map((p) => `${p.id} (${p.role})`).join(", ")}`);
		lines.push("");

		for (const round of sabha.rounds) {
			lines.push(`--- Round ${round.roundNumber} ---`);
			lines.push(`Proposition: ${round.proposal.pratijna}`);
			lines.push(`Reason: ${round.proposal.hetu}`);
			lines.push(`Example: ${round.proposal.udaharana}`);
			lines.push(`Application: ${round.proposal.upanaya}`);
			lines.push(`Conclusion: ${round.proposal.nigamana}`);

			if (round.challenges.length > 0) {
				lines.push("");
				lines.push("Challenges:");
				for (const ch of round.challenges) {
					lines.push(`  - [${ch.targetStep}] by ${ch.challengerId}: ${ch.challenge}`);
					if (ch.fallacyDetected) {
						lines.push(`    Fallacy: ${ch.fallacyDetected.type} (${ch.fallacyDetected.severity})`);
					}
					if (ch.response) {
						lines.push(`    Response: ${ch.response}`);
					}
					lines.push(`    Resolved: ${ch.resolved ? "yes" : "no"}`);
				}
			}

			if (round.votes.length > 0) {
				lines.push("");
				lines.push("Votes:");
				for (const v of round.votes) {
					lines.push(`  - ${v.participantId}: ${v.position} (weight: ${v.weight.toFixed(3)}) — ${v.reasoning}`);
				}
			}

			lines.push(`Verdict: ${round.verdict ?? "pending"}`);
			lines.push("");
		}

		if (sabha.finalVerdict) {
			lines.push(`Final Verdict: ${sabha.finalVerdict}`);
		}

		return lines.join("\n");
	}

	// ─── Private: Fallacy Detectors ───────────────────────────────────

	/**
	 * Asiddha (असिद्ध — Unestablished):
	 * The hetu references concepts not grounded in the udaharana.
	 * Check: hetu keywords that don't appear in udaharana.
	 */
	private detectAsiddha(s: NyayaSyllogism): HetvabhasaDetection[] {
		const hetuKeywords = extractKeywords(s.hetu);
		const udaharanaKeywords = extractKeywords(s.udaharana);

		if (hetuKeywords.size === 0) return [];

		// Count how many hetu keywords are grounded in udaharana
		let grounded = 0;
		for (const kw of hetuKeywords) {
			if (udaharanaKeywords.has(kw)) grounded++;
		}

		const groundedRatio = grounded / hetuKeywords.size;

		// If less than 20% of hetu keywords appear in udaharana, it's unestablished
		if (groundedRatio < 0.2) {
			return [{
				type: "asiddha",
				description: `Hetu references concepts not grounded in udaharana. ` +
					`Only ${Math.round(groundedRatio * 100)}% of reason keywords found in example.`,
				severity: "fatal",
				affectedStep: "hetu",
			}];
		}

		return [];
	}

	/**
	 * Viruddha (विरुद्ध — Contradictory):
	 * The hetu contains negation that directly opposes the pratijna.
	 * Check: hetu has negation words AND shares key concepts with pratijna.
	 */
	private detectViruddha(s: NyayaSyllogism): HetvabhasaDetection[] {
		const hetuHasNegation = containsAnyWord(s.hetu, NEGATION_WORDS);
		if (!hetuHasNegation) return [];

		// Check if hetu and pratijna share substantial keywords
		const hetuKeywords = extractKeywords(s.hetu);
		const pratijnaKeywords = extractKeywords(s.pratijna);

		let overlap = 0;
		for (const kw of hetuKeywords) {
			if (pratijnaKeywords.has(kw)) overlap++;
		}

		// If hetu has negation AND shares concepts with pratijna, it contradicts
		const overlapRatio = pratijnaKeywords.size > 0 ? overlap / pratijnaKeywords.size : 0;
		if (overlapRatio >= 0.3) {
			return [{
				type: "viruddha",
				description: `Hetu contains negation while sharing ${overlap} keywords with pratijna. ` +
					`The reason appears to contradict the proposition.`,
				severity: "fatal",
				affectedStep: "hetu",
			}];
		}

		return [];
	}

	/**
	 * Anaikantika (अनैकान्तिक — Inconclusive):
	 * The hetu uses overly broad universal quantifiers.
	 * Check: presence of "all", "every", "always", etc.
	 */
	private detectAnaikantika(s: NyayaSyllogism): HetvabhasaDetection[] {
		const universalCount = countMatchingWords(s.hetu, UNIVERSAL_WORDS);

		if (universalCount >= 2) {
			return [{
				type: "anaikantika",
				description: `Hetu uses ${universalCount} universal quantifiers, making the reason ` +
					`too broad to be conclusive. Over-general premises can apply to anything.`,
				severity: "warning",
				affectedStep: "hetu",
			}];
		}

		// Also check if just one universal with a short hetu (very high ratio)
		if (universalCount === 1) {
			const words = s.hetu.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 2);
			if (words.length <= 5) {
				return [{
					type: "anaikantika",
					description: `Hetu is brief and uses a universal quantifier, ` +
						`making it potentially too broad.`,
					severity: "warning",
					affectedStep: "hetu",
				}];
			}
		}

		return [];
	}

	/**
	 * Prakarana-sama (प्रकरण-सम — Circular):
	 * The nigamana is semantically identical to the pratijna.
	 * Check: Jaccard similarity > 0.8 between their keyword sets.
	 */
	private detectPrakaranaSama(s: NyayaSyllogism): HetvabhasaDetection[] {
		const pratijnaKw = extractKeywords(s.pratijna);
		const nigamanaKw = extractKeywords(s.nigamana);

		const similarity = jaccardSimilarity(pratijnaKw, nigamanaKw);

		if (similarity > 0.8) {
			return [{
				type: "prakarana-sama",
				description: `Nigamana is semantically near-identical to pratijna ` +
					`(Jaccard similarity: ${similarity.toFixed(3)}). The argument is circular.`,
				severity: "warning",
				affectedStep: "nigamana",
			}];
		}

		return [];
	}

	/**
	 * Kalatita (कालातीत — Untimely):
	 * The hetu uses past-tense evidence to justify a future-oriented pratijna.
	 * Check: hetu has past indicators AND pratijna/nigamana has future indicators.
	 */
	private detectKalatita(s: NyayaSyllogism): HetvabhasaDetection[] {
		const hetuHasPast = containsAnyWord(s.hetu, PAST_INDICATORS);
		const pratijnaHasFuture = containsAnyWord(s.pratijna, FUTURE_INDICATORS);
		const nigamanaHasFuture = containsAnyWord(s.nigamana, FUTURE_INDICATORS);

		if (hetuHasPast && (pratijnaHasFuture || nigamanaHasFuture)) {
			return [{
				type: "kalatita",
				description: `Hetu references past events to support a future-oriented claim. ` +
					`Temporal mismatch: past evidence does not necessarily predict future state.`,
				severity: "warning",
				affectedStep: "hetu",
			}];
		}

		return [];
	}

	// ─── Private: Voting ──────────────────────────────────────────────

	/**
	 * Tally a single round's votes using weighted scoring.
	 *
	 * Formula:
	 *   weightedScore = Σ vote.weight * sign(position)
	 *   normalizedScore = weightedScore / Σ |vote.weight|
	 *   verdict = score >= threshold → accepted
	 *             score <= -threshold → rejected
	 *             else → no-consensus
	 */
	private tallyRound(round: SabhaRound): "accepted" | "rejected" | "no-consensus" {
		if (round.votes.length === 0) return "no-consensus";

		let weightedScore = 0;
		let totalWeight = 0;

		for (const vote of round.votes) {
			const sign = vote.position === "support" ? 1 : vote.position === "oppose" ? -1 : 0;
			weightedScore += vote.weight * sign;
			totalWeight += Math.abs(vote.weight);
		}

		if (totalWeight === 0) return "no-consensus";

		const normalizedScore = weightedScore / totalWeight;

		if (normalizedScore >= this.config.consensusThreshold) return "accepted";
		if (normalizedScore <= -this.config.consensusThreshold) return "rejected";
		return "no-consensus";
	}

	// ─── Private: Helpers ─────────────────────────────────────────────

	/**
	 * Get a Sabha or throw if not found.
	 */
	private requireSabha(sabhaId: string): Sabha {
		const sabha = this.sabhas.get(sabhaId);
		if (!sabha) {
			throw new Error(`Sabha '${sabhaId}' not found.`);
		}
		return sabha;
	}

	/**
	 * Verify a participant exists in the Sabha, or throw.
	 */
	private requireParticipant(sabha: Sabha, participantId: string): SabhaParticipant {
		const participant = sabha.participants.find((p) => p.id === participantId);
		if (!participant) {
			throw new Error(
				`Participant '${participantId}' is not a member of Sabha '${sabha.id}'.`,
			);
		}
		return participant;
	}

	/**
	 * Get the current (most recent) round, or undefined if no rounds yet.
	 */
	private currentRound(sabha: Sabha): SabhaRound | undefined {
		return sabha.rounds.length > 0 ? sabha.rounds[sabha.rounds.length - 1] : undefined;
	}
}
