import type { Sabha } from "@chitragupta/sutra";
import type { SabhaResumePlan } from "./services-collaboration-types.js";
import {
	getSabhaDispatchLog,
	getSabhaEventLog,
	getSabhaPerspectiveMap,
	getSabhaRevision,
} from "./services-collaboration-state.js";

/**
 * Derive a machine-usable timeout-pickup plan for a persisted Sabha.
 *
 * This gives operators and future automated resume flows a concrete next action
 * without forcing them to infer state from raw dispatch/event logs.
 */
export function buildSabhaResumePlan(sabha: Sabha): SabhaResumePlan | null {
	const dispatchLog = [...getSabhaDispatchLog(sabha.id)];
	const recentEvents = [...getSabhaEventLog(sabha.id)].slice(-8);
	const responded = new Set(getSabhaPerspectiveMap(sabha.id).keys());
	const pendingParticipantIds = sabha.participants
		.map((participant) => participant.id)
		.filter((participantId) => !responded.has(participantId));
	const pendingDispatchParticipantIds = dispatchLog
		.filter((dispatch) => dispatch.status === "pending")
		.map((dispatch) => dispatch.participantId);
	const failedDispatchParticipantIds = dispatchLog
		.filter((dispatch) => dispatch.status === "failed")
		.map((dispatch) => dispatch.participantId);

	if (
		pendingParticipantIds.length === 0
		&& pendingDispatchParticipantIds.length === 0
		&& failedDispatchParticipantIds.length === 0
		&& recentEvents.length === 0
		&& (sabha.status === "concluded" || sabha.status === "escalated")
	) {
		return {
			sabhaId: sabha.id,
			revision: getSabhaRevision(sabha.id),
			status: sabha.status,
			nextAction: "complete",
			pendingParticipantIds: [],
			pendingDispatchParticipantIds: [],
			failedDispatchParticipantIds: [],
			needsHumanReview: false,
			detail: "Sabha already reached a terminal verdict.",
		};
	}

	let nextAction: SabhaResumePlan["nextAction"] = "none";
	let needsHumanReview = false;
	let detail: string | null = null;

	if (pendingDispatchParticipantIds.length > 0) {
		nextAction = "resume-mesh-dispatches";
		detail = "Resume pending mesh consultations from the last durable lease boundary.";
	} else if (failedDispatchParticipantIds.length > 0) {
		nextAction = "inspect-failed-dispatches";
		needsHumanReview = true;
		detail = "Inspect or retry failed mesh consultations before concluding the Sabha.";
	} else if (pendingParticipantIds.length > 0) {
		nextAction = "await-perspectives";
		detail = "Await remaining perspectives before deliberation.";
	} else if (sabha.status === "concluded" || sabha.status === "escalated") {
		nextAction = "complete";
		detail = "Sabha already reached a terminal verdict.";
	} else if (sabha.participants.length > 0) {
		nextAction = "deliberate";
		detail = "All currently expected perspectives are durable; the Sabha can deliberate.";
	}

	return {
		sabhaId: sabha.id,
		revision: getSabhaRevision(sabha.id),
		status: sabha.status,
		nextAction,
		pendingParticipantIds,
		pendingDispatchParticipantIds,
		failedDispatchParticipantIds,
		needsHumanReview,
		detail,
	};
}
