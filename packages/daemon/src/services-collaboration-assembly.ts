import type { NyayaReasoning } from "@chitragupta/anina";
import type { Sabha } from "@chitragupta/sutra";
import type { SabhaPerspective } from "./services-collaboration-types.js";
import type { RpcInvocationContext } from "./rpc-router.js";
import { currentRound } from "./services-collaboration-helpers.js";
import {
	listSabhaPerspectives,
} from "./services-collaboration-state.js";

export function buildSabhaReasoning(sabha: Sabha): NyayaReasoning {
	const round = currentRound(sabha);
	if (round) {
		return {
			thesis: round.proposal.pratijna,
			reason: round.proposal.hetu,
			example: round.proposal.udaharana,
			application: round.proposal.upanaya,
			conclusion: round.proposal.nigamana,
		};
	}

	return {
		thesis: `Deliberation requested for: ${sabha.topic}`,
		reason: "A Sabha consultation was convened to collect and challenge perspectives.",
		example: `Participants: ${sabha.participants.map((participant) => participant.id).join(", ") || "none"}.`,
		application: `Current Sabha status: ${sabha.status}.`,
		conclusion: `Current or final verdict: ${sabha.finalVerdict ?? sabha.status}.`,
	};
}

export function buildSabhaAlternatives(sabha: Sabha): Array<{ description: string; reason_rejected: string }> {
	const round = currentRound(sabha);
	const alternatives: Array<{ description: string; reason_rejected: string }> = [];
	if (round) {
		for (const vote of round.votes) {
			if (vote.position !== "oppose") continue;
			alternatives.push({
				description: `Opposing position from ${vote.participantId}`,
				reason_rejected: vote.reasoning,
			});
		}
		for (const challenge of round.challenges) {
			alternatives.push({
				description: `Challenge on ${challenge.targetStep}`,
				reason_rejected: challenge.response
					? `${challenge.challenge} Response: ${challenge.response}`
					: challenge.challenge,
			});
		}
	}
	for (const perspective of listSabhaPerspectives(sabha.id)) {
		if (perspective.position !== "oppose") continue;
		alternatives.push({
			description: `Perspective from ${perspective.participantId}`,
			reason_rejected: perspective.summary,
		});
	}
	return alternatives.slice(0, 8);
}

export function escalateSabha(sabha: Sabha, reason: string): Sabha {
	if (sabha.status === "concluded" || sabha.status === "escalated") {
		throw new Error(`Sabha ${sabha.id} has already ${sabha.status}.`);
	}
	sabha.status = "escalated";
	sabha.finalVerdict = "escalated";
	sabha.concludedAt = Date.now();
	const round = currentRound(sabha);
	if (round && round.verdict === null) {
		round.verdict = "no-consensus";
	}
	if (!reason.trim()) return sabha;
	if (round) {
		round.challenges.push({
			challengerId: "escalation",
			targetStep: "nigamana",
			challenge: reason.trim(),
			resolved: true,
			response: "Escalated to external authority",
		});
	}
	return sabha;
}

export function buildSabhaMetadata(
	sabha: Sabha,
	context?: RpcInvocationContext,
	extra?: Record<string, unknown>,
): Record<string, unknown> {
	const perspectives = listSabhaPerspectives(sabha.id);
	const respondedParticipantIds = perspectives.map((perspective) => perspective.participantId);
	const respondedSet = new Set(respondedParticipantIds);
	const pendingParticipantIds = sabha.participants
		.map((participant) => participant.id)
		.filter((participantId) => !respondedSet.has(participantId));
	return {
		sabhaId: sabha.id,
		convener: sabha.convener,
		participantIds: sabha.participants.map((participant) => participant.id),
		finalVerdict: sabha.finalVerdict,
		status: sabha.status,
		perspectiveCount: perspectives.length,
		respondedParticipantIds,
		pendingParticipantIds,
		perspectiveSummaries: perspectives.map((perspective) => ({
			participantId: perspective.participantId,
			position: perspective.position,
			summary: perspective.summary,
			recommendedAction: perspective.recommendedAction,
		})),
		clientId: context?.clientId ?? null,
		transport: context?.transport ?? "unknown",
		...extra,
	};
}
