import type { NyayaSyllogism, Sabha, SabhaConfig, SabhaParticipant, SabhaRound } from "./sabha-types.js";
import { clamp, DEFAULT_CONFIG, HARD_CEILINGS } from "./sabha-types.js";

export function buildSabhaConfig(config?: Partial<SabhaConfig>): SabhaConfig {
	const merged = { ...DEFAULT_CONFIG, ...config };
	return {
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

export function requireSabha(sabhas: Map<string, Sabha>, sabhaId: string): Sabha {
	const sabha = sabhas.get(sabhaId);
	if (!sabha) {
		throw new Error(`Sabha '${sabhaId}' not found.`);
	}
	return sabha;
}

export function requireParticipant(sabha: Sabha, participantId: string): SabhaParticipant {
	const participant = sabha.participants.find((candidate) => candidate.id === participantId);
	if (!participant) {
		throw new Error(`Participant '${participantId}' is not a member of Sabha '${sabha.id}'.`);
	}
	return participant;
}

export function currentRound(sabha: Sabha): SabhaRound | undefined {
	return sabha.rounds.length > 0 ? sabha.rounds[sabha.rounds.length - 1] : undefined;
}

export function tallyRound(
	round: SabhaRound,
	consensusThreshold: SabhaConfig["consensusThreshold"],
): "accepted" | "rejected" | "no-consensus" {
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
	if (normalizedScore >= consensusThreshold) return "accepted";
	if (normalizedScore <= -consensusThreshold) return "rejected";
	return "no-consensus";
}

export function validateSyllogismFields(syllogism: NyayaSyllogism): void {
	const fields: (keyof NyayaSyllogism)[] = ["pratijna", "hetu", "udaharana", "upanaya", "nigamana"];
	for (const field of fields) {
		if (!syllogism[field] || syllogism[field].trim().length === 0) {
			throw new Error(`Syllogism field '${field}' must not be empty.`);
		}
	}
}
