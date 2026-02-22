/**
 * @chitragupta/sutra — Sabha query and reporting functions.
 * Extracted from sabha.ts to keep file sizes under 450 LOC.
 */
import type { Sabha } from "./sabha-types.js";

/**
 * Generate a human-readable deliberation summary.
 * @param sabha - The Sabha to summarize.
 * @returns Multi-line summary string.
 */
export function explainSabha(sabha: Sabha): string {
	const lines: string[] = [];
	lines.push("Sabha: " + sabha.topic);
	lines.push("Status: " + sabha.status);
	lines.push("Convener: " + sabha.convener);
	lines.push("Participants: " + sabha.participants.map((p) => p.id + " (" + p.role + ")").join(", "));
	lines.push("");
	for (const round of sabha.rounds) {
		lines.push("--- Round " + round.roundNumber + " ---");
		lines.push("Proposition: " + round.proposal.pratijna);
		lines.push("Reason: " + round.proposal.hetu);
		lines.push("Example: " + round.proposal.udaharana);
		lines.push("Application: " + round.proposal.upanaya);
		lines.push("Conclusion: " + round.proposal.nigamana);
		if (round.challenges.length > 0) {
			lines.push("");
			lines.push("Challenges:");
			for (const ch of round.challenges) {
				lines.push("  - [" + ch.targetStep + "] by " + ch.challengerId + ": " + ch.challenge);
				if (ch.fallacyDetected) lines.push("    Fallacy: " + ch.fallacyDetected.type + " (" + ch.fallacyDetected.severity + ")");
				if (ch.response) lines.push("    Response: " + ch.response);
				lines.push("    Resolved: " + (ch.resolved ? "yes" : "no"));
			}
		}
		if (round.votes.length > 0) {
			lines.push("");
			lines.push("Votes:");
			for (const v of round.votes) {
				lines.push("  - " + v.participantId + ": " + v.position + " (weight: " + v.weight.toFixed(3) + ") — " + v.reasoning);
			}
		}
		lines.push("Verdict: " + (round.verdict ?? "pending"));
		lines.push("");
	}
	if (sabha.finalVerdict) lines.push("Final Verdict: " + sabha.finalVerdict);
	return lines.join("\n");
}
