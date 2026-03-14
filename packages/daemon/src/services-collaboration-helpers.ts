import {
	computePersistedSabhaSnapshotHash,
} from "./services-collaboration-store.js";
import type { RpcInvocationContext, RpcRouter } from "./rpc-router.js";
import type {
	NyayaSyllogism,
	Sabha,
	SabhaParticipant,
	SabhaVote,
} from "@chitragupta/sutra";
import type {
	SabhaMeshBinding,
	SabhaPerspective,
	SabhaPerspectiveEvidence,
	SabhaPerspectivePosition,
	SabhaResumePlan,
} from "./services-collaboration-types.js";
import {
	getSabhaClientBindingMap,
	getSabhaDispatchLog,
	getSabhaEventLog,
	getSabhaPerspectiveMap,
	getSabhaRevision,
	listSabhaMeshBindings,
	listSabhaPerspectives,
	latestSabhaDispatchRecord,
} from "./services-collaboration-state.js";
import { buildSabhaResumePlan } from "./services-collaboration-resume.js";

const MESH_RETRY_BACKOFF_MS = 2_000;

export function inferMeshCapability(id: string, role: string): string | null {
	const text = `${id} ${role}`.toLowerCase();
	if (/(memory|smriti|recall|knowledge)/.test(text)) return "sabha.consult.memory";
	if (/(session|history|handover|continuity)/.test(text)) return "sabha.consult.session";
	return null;
}

export function parseParticipants(raw: unknown): {
	participants: SabhaParticipant[];
	clientBindings: Map<string, string>;
	meshBindings: Map<string, SabhaMeshBinding>;
} {
	if (raw == null) {
		return { participants: [], clientBindings: new Map(), meshBindings: new Map() };
	}
	if (!Array.isArray(raw)) throw new Error("Participants must be an array");
	const clientBindings = new Map<string, string>();
	const meshBindings = new Map<string, SabhaMeshBinding>();
	const participants = raw.map((value, index) => {
		const record = value as Record<string, unknown>;
		const id = String(record.id ?? "").trim();
		const role = String(record.role ?? "").trim();
		if (!id || !role) throw new Error(`Participant ${index} is missing id or role`);
		const expertise = Number(record.expertise ?? 0.5);
		const credibility = Number(record.credibility ?? 0.5);
		if (!Number.isFinite(expertise) || !Number.isFinite(credibility)) {
			throw new Error(`Participant ${index} has invalid expertise or credibility`);
		}
		const clientId = String(record.clientId ?? record.targetClientId ?? "").trim();
		if (clientId) {
			clientBindings.set(id, clientId);
		}
		const meshTarget = String(record.meshTarget ?? record.actorId ?? record.targetActorId ?? "").trim();
		const meshCapability = String(record.meshCapability ?? record.capability ?? "").trim();
		const inferredCapability = inferMeshCapability(id, role);
		const target = meshTarget
			|| (meshCapability ? `capability:${meshCapability}` : "")
			|| (inferredCapability ? `capability:${inferredCapability}` : "");
		if (target) {
			const mode = String(record.meshMode ?? "ask").trim().toLowerCase() === "tell" ? "tell" : "ask";
			const timeoutMs = Number(record.timeoutMs ?? record.meshTimeoutMs ?? 10_000);
			meshBindings.set(id, {
				participantId: id,
				target,
				mode,
				timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000,
				topic: String(record.meshTopic ?? record.topic ?? "sabha.consult").trim() || "sabha.consult",
			});
		}
		return {
			id,
			role,
			expertise,
			credibility,
		};
	});
	return { participants, clientBindings, meshBindings };
}

export function parseSyllogism(raw: unknown): NyayaSyllogism {
	const record = raw as Record<string, unknown>;
	const pratijna = String(record.pratijna ?? "").trim();
	const hetu = String(record.hetu ?? "").trim();
	const udaharana = String(record.udaharana ?? "").trim();
	const upanaya = String(record.upanaya ?? "").trim();
	const nigamana = String(record.nigamana ?? "").trim();
	if (!pratijna || !hetu || !udaharana || !upanaya || !nigamana) {
		throw new Error("Missing Nyaya syllogism fields");
	}
	return { pratijna, hetu, udaharana, upanaya, nigamana };
}

export function currentRound(sabha: Sabha) {
	return sabha.rounds.length > 0 ? sabha.rounds[sabha.rounds.length - 1] : undefined;
}

export function parseExpectedRevision(raw: unknown): number | null {
	if (raw == null || raw === "") return null;
	const expected = Number(raw);
	if (!Number.isSafeInteger(expected) || expected < 0) {
		throw new Error("expectedRevision must be a non-negative integer");
	}
	return expected;
}

export function assertExpectedRevision(sabhaId: string, raw: unknown): void {
	const expected = parseExpectedRevision(raw);
	if (expected == null) return;
	const current = getSabhaRevision(sabhaId);
	if (current !== expected) {
		throw new Error(`Sabha '${sabhaId}' revision mismatch: expected ${expected}, got ${current}.`);
	}
}

export function shouldResumeMeshBinding(
	sabha: Sabha,
	binding: SabhaMeshBinding,
	options: {
		forceFailed?: boolean;
		leaseOwner?: string;
	} = {},
): boolean {
	if (sabha.status === "concluded" || sabha.status === "escalated") return false;
	const perspectiveMap = getSabhaPerspectiveMap(sabha.id);
	if (perspectiveMap.has(binding.participantId)) return false;
	const latest = latestSabhaDispatchRecord(sabha.id, binding.participantId);
	if (!latest) return true;
	if (latest.status === "accepted") return false;
	if (latest.status === "pending") {
		if (
			options.forceFailed
			&& options.leaseOwner
			&& latest.leaseOwner
			&& latest.leaseOwner === options.leaseOwner
		) {
			return true;
		}
		const leaseExpiresAt = latest.leaseExpiresAt
			?? (latest.attemptedAt + Math.max(1_000, binding.timeoutMs));
		return Date.now() >= leaseExpiresAt;
	}
	if (options.forceFailed) {
		return latest.status === "failed"
			|| latest.status === "replied"
			|| (latest.status === "delivered" && binding.mode === "ask");
	}
	const completedAt = latest.completedAt ?? latest.attemptedAt;
	if (Date.now() - completedAt < Math.max(250, Math.min(binding.timeoutMs, MESH_RETRY_BACKOFF_MS))) {
		return false;
	}
	return latest.status === "failed"
		|| latest.status === "replied"
		|| (latest.status === "delivered" && binding.mode === "ask");
}

export function parsePerspectiveEvidence(raw: unknown): SabhaPerspectiveEvidence[] {
	if (raw == null) return [];
	if (!Array.isArray(raw)) throw new Error("Perspective evidence must be an array");
	return raw.map((value, index) => {
		const record = value as Record<string, unknown>;
		const label = String(record.label ?? record.title ?? `evidence-${index + 1}`).trim();
		const detail = String(record.detail ?? record.summary ?? record.content ?? record.value ?? "").trim();
		const source = String(record.source ?? record.ref ?? "").trim();
		if (!detail) {
			throw new Error(`Perspective evidence ${index} is missing detail`);
		}
		return {
			label: label || `evidence-${index + 1}`,
			detail,
			source: source || undefined,
		};
	});
}

export function parsePerspective(
	raw: Record<string, unknown>,
	context?: RpcInvocationContext,
): SabhaPerspective {
	const participantId = String(raw.participantId ?? "").trim();
	if (!participantId) throw new Error("Missing participantId");
	const summary = String(raw.summary ?? raw.reasoning ?? "").trim();
	const reasoning = String(raw.reasoning ?? raw.summary ?? "").trim();
	if (!summary || !reasoning) {
		throw new Error("Missing summary or reasoning");
	}
	const position = String(raw.position ?? "observe").trim().toLowerCase();
	if (!["support", "oppose", "abstain", "observe"].includes(position)) {
		throw new Error("Perspective position must be support, oppose, abstain, or observe");
	}
	const recommendedAction = String(raw.recommendedAction ?? raw.recommendation ?? "").trim();
	const metadata =
		typeof raw.metadata === "object" && raw.metadata !== null && !Array.isArray(raw.metadata)
			? { ...(raw.metadata as Record<string, unknown>) }
			: {};
	return {
		participantId,
		submittedAt: Date.now(),
		summary,
		reasoning,
		position: position as SabhaPerspectivePosition,
		recommendedAction: recommendedAction || null,
		evidence: parsePerspectiveEvidence(raw.evidence),
		clientId: context?.clientId ?? null,
		transport: context?.transport ?? "unknown",
		metadata,
	};
}

export function ensureSabhaParticipant(sabha: Sabha, participantId: string): void {
	if (!sabha.participants.some((participant) => participant.id === participantId)) {
		throw new Error(`Participant '${participantId}' is not part of Sabha '${sabha.id}'.`);
	}
}

export function notificationTargetsForSabha(sabhaId: string, explicitTargets?: unknown): string[] {
	const targets = new Set<string>();
	if (Array.isArray(explicitTargets)) {
		for (const value of explicitTargets) {
			const target = String(value ?? "").trim();
			if (target) targets.add(target);
		}
	}
	for (const target of getSabhaClientBindingMap(sabhaId).values()) {
		if (target) targets.add(target);
	}
	return [...targets];
}

export function summarizeVotes(votes: SabhaVote[]): Record<string, unknown> {
	let support = 0;
	let oppose = 0;
	let abstain = 0;
	for (const vote of votes) {
		if (vote.position === "support") support += vote.weight;
		else if (vote.position === "oppose") oppose += vote.weight;
		else abstain += vote.weight;
	}
	return {
		supportWeight: Number(support.toFixed(4)),
		opposeWeight: Number(oppose.toFixed(4)),
		abstainWeight: Number(abstain.toFixed(4)),
		count: votes.length,
	};
}

export function buildPersistedSabhaState(sabha: Sabha) {
	return {
		sabha: structuredClone(sabha),
		revision: getSabhaRevision(sabha.id),
		clientBindings: Object.fromEntries(getSabhaClientBindingMap(sabha.id).entries()),
		meshBindings: listSabhaMeshBindings(sabha.id),
		dispatchLog: [...getSabhaDispatchLog(sabha.id)],
		perspectives: listSabhaPerspectives(sabha.id),
	};
}

/**
 * Build a bounded, human-readable resume summary for timed-out or restarted
 * Sabha work so callers can continue from the last durable coordination point
 * instead of re-reading the entire event and dispatch history.
 */
export function buildSabhaResumeContext(sabha: Sabha): string {
	const dispatchLog = [...getSabhaDispatchLog(sabha.id)];
	const recentEvents = [...getSabhaEventLog(sabha.id)].slice(-8);
	const perspectives = listSabhaPerspectives(sabha.id);
	const responded = new Set(perspectives.map((perspective) => perspective.participantId));
	const pendingParticipants = sabha.participants
		.map((participant) => participant.id)
		.filter((participantId) => !responded.has(participantId));
	const pendingDispatches = dispatchLog
		.filter((dispatch) => dispatch.status === "pending" || dispatch.status === "failed")
		.slice(-6);

	if (
		pendingParticipants.length === 0
		&& pendingDispatches.length === 0
		&& recentEvents.length === 0
	) {
		return "";
	}

	const lines = [
		"Durable Sabha resume context:",
		`- revision: ${getSabhaRevision(sabha.id)}`,
		`- status: ${sabha.status}`,
		pendingParticipants.length > 0
			? `- pending participants: ${pendingParticipants.join(", ")}`
			: "- pending participants: none",
	];

	if (pendingDispatches.length > 0) {
		lines.push("- recent mesh dispatches:");
		for (const dispatch of pendingDispatches) {
			const detail = [
				dispatch.participantId,
				`target=${dispatch.resolvedTarget ?? dispatch.target}`,
				`status=${dispatch.status}`,
			];
			if (dispatch.error) detail.push(`error=${dispatch.error}`);
			lines.push(`  - ${detail.join(" | ")}`);
		}
	}

	if (recentEvents.length > 0) {
		lines.push("- recent Sabha events:");
		for (const event of recentEvents) {
			const summary =
				typeof event.payload.summary === "string" && event.payload.summary.trim()
					? event.payload.summary.trim()
					: typeof event.payload.participantId === "string"
						? `participant=${event.payload.participantId}`
						: "";
			lines.push(`  - ${event.eventType}${summary ? ` | ${summary}` : ""}`);
		}
	}

	lines.push("Resume from the last durable revision instead of restarting the full consultation.");
	return lines.join("\n");
}

export function gatherSabhaState(sabha: Sabha): Record<string, unknown> {
	const project = typeof (sabha as unknown as { project?: unknown }).project === "string"
		? (sabha as unknown as { project?: string }).project
		: null;
	const sessionId = typeof (sabha as unknown as { sessionId?: unknown }).sessionId === "string"
		? (sabha as unknown as { sessionId?: string }).sessionId
		: null;
	const rounds = sabha.rounds.map((round) => ({
		roundNumber: round.roundNumber,
		proposal: round.proposal,
		challenges: round.challenges,
		votes: round.votes,
		verdict: round.verdict,
	}));
	const round = rounds.length > 0 ? rounds[rounds.length - 1] : null;
	const clientBindings = Object.fromEntries(getSabhaClientBindingMap(sabha.id).entries());
	const meshBindings = listSabhaMeshBindings(sabha.id);
	const dispatchLog = [...getSabhaDispatchLog(sabha.id)];
	const recentEvents = [...getSabhaEventLog(sabha.id)].slice(-20);
	const snapshotHash = computePersistedSabhaSnapshotHash(buildPersistedSabhaState(sabha));
	const perspectives = listSabhaPerspectives(sabha.id);
	const respondedParticipantIds = perspectives.map((perspective) => perspective.participantId);
	const respondedSet = new Set(respondedParticipantIds);
	const pendingParticipantIds = sabha.participants
		.map((participant) => participant.id)
		.filter((participantId) => !respondedSet.has(participantId));
	const pendingDispatchParticipantIds = meshBindings
		.map((binding) => binding.participantId)
		.filter((participantId) => pendingParticipantIds.includes(participantId));
	const resumeContext = buildSabhaResumeContext(sabha);
	const resumePlan = buildSabhaResumePlan(sabha) as SabhaResumePlan | null;
	return {
		id: sabha.id,
		topic: sabha.topic,
		revision: getSabhaRevision(sabha.id),
		snapshotHash,
		project,
		sessionId,
		status: sabha.status,
		convener: sabha.convener,
		finalVerdict: sabha.finalVerdict,
		createdAt: sabha.createdAt,
		concludedAt: sabha.concludedAt,
		participants: sabha.participants,
		clientBindings,
		meshBindings,
		participantCount: sabha.participants.length,
		perspectives,
		dispatchLog,
		recentEvents,
		respondedParticipantIds,
		pendingParticipantIds,
		pendingDispatchParticipantIds,
		resumeContext,
		resumePlan,
		consultationSummary: {
			perspectiveCount: perspectives.length,
			respondedCount: respondedParticipantIds.length,
			pendingCount: pendingParticipantIds.length,
			meshBoundCount: meshBindings.length,
			pendingDispatchCount: pendingDispatchParticipantIds.length,
		},
		rounds,
		roundCount: rounds.length,
		currentRound: round
			? {
				roundNumber: round.roundNumber,
				proposal: round.proposal,
				unresolvedChallenges: round.challenges.filter((challenge) => !challenge.resolved),
				allChallenges: round.challenges,
				votes: round.votes,
				voteSummary: summarizeVotes(round.votes),
				verdict: round.verdict,
			}
			: null,
	};
}

export function emitSabhaNotification(
	router: RpcRouter,
	sabha: Sabha,
	method: string,
	params: Record<string, unknown>,
	explicitTargets?: unknown,
): number {
	const targetClientIds = notificationTargetsForSabha(sabha.id, explicitTargets);
	if (targetClientIds.length === 0) return 0;
	return router.notify(method, {
		sabhaId: sabha.id,
		sabha: gatherSabhaState(sabha),
		...params,
	}, targetClientIds);
}

export {
	buildSabhaReasoning,
	buildSabhaAlternatives,
	escalateSabha,
	buildSabhaMetadata,
} from "./services-collaboration-assembly.js";
