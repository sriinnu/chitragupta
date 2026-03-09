/**
 * @chitragupta/sutra — Sabha — Multi-Agent Deliberation Protocol.
 * @packageDocumentation
 */


import type {
	NyayaSyllogism,
	HetvabhasaType,
	HetvabhasaDetection,
	SabhaParticipant,
	SabhaVote,
	ChallengeRecord,
	SabhaStatus,
	SabhaRound,
	Sabha,
	SabhaConfig,
} from "./sabha-types.js";
import {
	DEFAULT_CONFIG,
	fnv1a,
	NEGATION_WORDS,
	UNIVERSAL_WORDS,
	PAST_INDICATORS,
	FUTURE_INDICATORS,
	clamp,
	extractKeywords,
	jaccardSimilarity,
	containsAnyWord,
	countMatchingWords,
} from "./sabha-types.js";
import {
	buildSabhaConfig,
	currentRound,
	requireParticipant,
	requireSabha,
	tallyRound,
	validateSyllogismFields,
} from "./sabha-engine-helpers.js";
import { detectFallacies } from "./sabha-fallacy.js";
import { explainSabha } from "./sabha-queries.js";

export type {
	NyayaSyllogism,
	HetvabhasaType,
	HetvabhasaDetection,
	SabhaParticipant,
	SabhaVote,
	ChallengeRecord,
	SabhaStatus,
	SabhaRound,
	Sabha,
	SabhaConfig,
};


// ─── SabhaEngine ────────────────────────────────────────────────────────────

/** Sabha Engine — structured multi-agent deliberation using Nyaya logic. */
export class SabhaEngine {
	private readonly config: SabhaConfig;
	private readonly sabhas = new Map<string, Sabha>();
	private conveneSequence = 0;

	/**
	 * Create a new SabhaEngine.
	 *
	 * Configuration follows two-tier pattern: user-provided values are
	 * merged with defaults, then clamped by system hard ceilings.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<SabhaConfig>) {
		this.config = buildSabhaConfig(config);
	}


	/**
	 * Convene a new Sabha (assembly) with the given participants.
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
			const sequence = this.conveneSequence++;
			const id = `sabha-${fnv1a(`${topic}:${convener}:${now}:${sequence}`)}`;

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


	/**
	 * Submit a proposal (Nyaya syllogism) to the Sabha.
	 *
	 * @param sabhaId - The Sabha to propose to.
	 * @param proposerId - The participant making the proposal.
	 * @param syllogism - The five-limbed Nyaya argument.
	 * @returns The newly created round.
	 * @throws If Sabha not found, already concluded, max rounds reached, or proposer not a participant.
	 */
	propose(sabhaId: string, proposerId: string, syllogism: NyayaSyllogism): SabhaRound {
			const sabha = requireSabha(this.sabhas, sabhaId);

		if (sabha.status === "concluded" || sabha.status === "escalated") {
			throw new Error(`Sabha ${sabhaId} has already ${sabha.status}. Cannot propose.`);
		}

		if (sabha.rounds.length >= this.config.maxRounds) {
			throw new Error(
				`Sabha ${sabhaId} has reached max rounds (${this.config.maxRounds}). ` +
				`Conclude or escalate.`,
			);
		}

			requireParticipant(sabha, proposerId);

			validateSyllogismFields(syllogism);

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


	/**
	 * Challenge a specific step of the current proposal.
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
			const sabha = requireSabha(this.sabhas, sabhaId);

		if (sabha.status !== "deliberating") {
			throw new Error(`Sabha ${sabhaId} is not in deliberating status. Current: ${sabha.status}.`);
		}

			requireParticipant(sabha, challengerId);

			const round = currentRound(sabha);
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


	/**
	 * Respond to a challenge in the current round.
	 *
	 * @param sabhaId - The Sabha.
	 * @param recordIndex - The 0-based index of the challenge in the current round.
	 * @param response - The response text.
	 * @throws If Sabha not found, not deliberating, or index out of bounds.
	 */
	respond(sabhaId: string, recordIndex: number, response: string): void {
			const sabha = requireSabha(this.sabhas, sabhaId);

		if (sabha.status !== "deliberating") {
			throw new Error(`Sabha ${sabhaId} is not in deliberating status. Current: ${sabha.status}.`);
		}

			const round = currentRound(sabha);
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


	/**
	 * Cast a vote in the current round.
	 * Vote weight = expertise * credibility. Each participant votes once per round.
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
			const sabha = requireSabha(this.sabhas, sabhaId);

		if (sabha.status !== "deliberating" && sabha.status !== "voting") {
			throw new Error(`Sabha ${sabhaId} is not accepting votes. Current status: ${sabha.status}.`);
		}

			const participant = requireParticipant(sabha, participantId);

			const round = currentRound(sabha);
		if (!round) {
			throw new Error(`Sabha ${sabhaId} has no active round. Submit a proposal first.`);
		}

		// Prevent duplicate votes
			const alreadyVoted = round.votes.some((vote: SabhaVote) => vote.participantId === participantId);
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


	/**
	 * Conclude the Sabha — tally weighted votes and determine final verdict.
	 *
	 * @param sabhaId - The Sabha to conclude.
	 * @returns The concluded Sabha with final verdict.
	 * @throws If Sabha not found or already concluded.
	 */
	conclude(sabhaId: string): Sabha {
			const sabha = requireSabha(this.sabhas, sabhaId);

		if (sabha.status === "concluded" || sabha.status === "escalated") {
			throw new Error(`Sabha ${sabhaId} has already ${sabha.status}.`);
		}

		// Tally each round
		for (const round of sabha.rounds) {
			if (round.verdict !== null) continue;
				round.verdict = tallyRound(round, this.config.consensusThreshold);
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


	/** Detect Hetvabhasa (logical fallacies) in a Nyaya syllogism. */
	detectFallacies(syllogism: NyayaSyllogism): HetvabhasaDetection[] {
		return detectFallacies(syllogism);
	}

	// ─── Private: Voting ──────────────────────────────────────────────

	// ─── Queries ──────────────────────────────────────────────────────

	/** Get a Sabha by ID. */
	getSabha(id: string): Sabha | undefined { return this.sabhas.get(id); }

	/** Restore a previously persisted Sabha snapshot into the engine. */
	restoreSabha(snapshot: Sabha): Sabha {
		if (!snapshot.id || !snapshot.topic || !snapshot.convener) {
			throw new Error("Persisted Sabha snapshot is missing required identity fields.");
		}
		if (snapshot.participants.length < 2) {
			throw new Error("Persisted Sabha snapshot requires at least 2 participants.");
		}
		if (snapshot.participants.length > this.config.maxParticipants) {
			throw new Error(
				`Persisted Sabha exceeds maxParticipants (${this.config.maxParticipants}). ` +
				`Provided: ${snapshot.participants.length}.`,
			);
		}
		const ids = new Set(snapshot.participants.map((participant) => participant.id));
		if (ids.size !== snapshot.participants.length) {
			throw new Error("Persisted Sabha snapshot has duplicate participant IDs.");
		}
		const restored = structuredClone(snapshot);
		this.sabhas.set(restored.id, restored);
		return restored;
	}

	/** Remove all in-memory Sabha state. Intended for controlled resets and tests. */
	clear(): void {
		this.sabhas.clear();
	}

	/** Remove one Sabha snapshot from in-memory runtime state. Persisted state remains untouched. */
	dropSabha(id: string): void {
		this.sabhas.delete(id);
	}

	/** List all active Sabhas. */
	listActive(): Sabha[] {
		const active: Sabha[] = [];
		for (const s of this.sabhas.values()) {
			if (s.status !== "concluded" && s.status !== "escalated") active.push(s);
		}
		return active;
	}

	/** Generate a human-readable deliberation summary. */
	explain(sabhaId: string): string {
			return explainSabha(requireSabha(this.sabhas, sabhaId));
	}

	// ─── Private: Helpers ─────────────────────────────────────────────

}
