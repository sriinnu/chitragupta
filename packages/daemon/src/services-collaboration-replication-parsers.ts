import { SabhaEngine } from "@chitragupta/sutra";
import type { PersistedSabhaState } from "./services-collaboration-store.js";
import type {
	SabhaEventRecord, SabhaMeshBinding, SabhaMeshDispatchRecord,
	SabhaPerspective, SabhaPerspectiveEvidence, SabhaPerspectivePosition,
} from "./services-collaboration-types.js";

export function parseRecord(value: unknown, errorMessage: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(errorMessage);
	}
	return value as Record<string, unknown>;
}
export function parsePlainObject(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? { ...(value as Record<string, unknown>) }
		: {};
}
export function parseStringMap(raw: unknown): Record<string, string> {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	return Object.fromEntries(
		Object.entries(raw as Record<string, unknown>)
			.filter(([, value]) => typeof value === "string")
			.map(([key, value]) => [key, String(value)]),
	);
}
export function parsePerspectiveEvidenceArray(raw: unknown): SabhaPerspectiveEvidence[] {
	if (raw == null) return [];
	if (!Array.isArray(raw)) throw new Error("Replicated Sabha perspective evidence must be an array.");
	return raw.map((value, index) => {
		const record = parseRecord(value, `Replicated Sabha evidence ${index} must be an object.`);
		const label = String(record.label ?? "").trim();
		const detail = String(record.detail ?? "").trim();
		const source = typeof record.source === "string" ? record.source : undefined;
		if (!label || !detail) {
			throw new Error(`Replicated Sabha evidence ${index} is missing label or detail.`);
		}
		return { label, detail, source };
	});
}
export function parseReplicatedPerspectives(raw: unknown): SabhaPerspective[] {
	if (raw == null) return [];
	if (!Array.isArray(raw)) throw new Error("Replicated Sabha perspectives must be an array.");
	return raw.map((value, index) => {
		const record = parseRecord(value, `Replicated Sabha perspective ${index} must be an object.`);
		const participantId = String(record.participantId ?? "").trim();
		const submittedAt = Number(record.submittedAt);
		const summary = String(record.summary ?? "").trim();
		const reasoning = String(record.reasoning ?? "").trim();
		const position = String(record.position ?? "").trim() as SabhaPerspectivePosition;
		const recommendedAction = typeof record.recommendedAction === "string" ? record.recommendedAction : null;
		const clientId = typeof record.clientId === "string" ? record.clientId : null;
		const transport = typeof record.transport === "string" ? record.transport : "unknown";
		const metadata = parsePlainObject(record.metadata);
		if (!participantId || !summary || !reasoning) {
			throw new Error(`Replicated Sabha perspective ${index} is missing participantId, summary, or reasoning.`);
		}
		if (!Number.isSafeInteger(submittedAt) || submittedAt <= 0) {
			throw new Error(`Replicated Sabha perspective ${index} has invalid submittedAt.`);
		}
		if (!["support", "oppose", "abstain", "observe"].includes(position)) {
			throw new Error(`Replicated Sabha perspective ${index} has invalid position.`);
		}
		return {
			participantId,
			submittedAt,
			summary,
			reasoning,
			position,
			recommendedAction,
			evidence: parsePerspectiveEvidenceArray(record.evidence),
			clientId,
			transport: transport as SabhaPerspective["transport"],
			metadata,
		};
	});
}
export function parseReplicatedMeshBindings(raw: unknown): SabhaMeshBinding[] {
	if (raw == null) return [];
	if (!Array.isArray(raw)) throw new Error("Replicated Sabha meshBindings must be an array.");
	return raw.map((value, index) => {
		const record = parseRecord(value, `Replicated Sabha mesh binding ${index} must be an object.`);
		const participantId = String(record.participantId ?? "").trim();
		const target = String(record.target ?? "").trim();
		const mode = String(record.mode ?? "").trim();
		const timeoutMs = Number(record.timeoutMs);
		const topic = typeof record.topic === "string" ? record.topic : undefined;
		const resolvedTarget = typeof record.resolvedTarget === "string" ? record.resolvedTarget : undefined;
		const resolvedAt = record.resolvedAt == null ? undefined : Number(record.resolvedAt);
		if (!participantId || !target) {
			throw new Error(`Replicated Sabha mesh binding ${index} is missing participantId or target.`);
		}
		if (!["ask", "tell"].includes(mode)) {
			throw new Error(`Replicated Sabha mesh binding ${index} has invalid mode.`);
		}
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
			throw new Error(`Replicated Sabha mesh binding ${index} has invalid timeoutMs.`);
		}
		if (resolvedAt != null && (!Number.isSafeInteger(resolvedAt) || resolvedAt <= 0)) {
			throw new Error(`Replicated Sabha mesh binding ${index} has invalid resolvedAt.`);
		}
		return {
			participantId,
			target,
			mode: mode as SabhaMeshBinding["mode"],
			timeoutMs,
			topic,
			resolvedTarget,
			resolvedAt,
		};
	});
}
export function parseReplicatedDispatchLog(raw: unknown): SabhaMeshDispatchRecord[] {
	if (raw == null) return [];
	if (!Array.isArray(raw)) throw new Error("Replicated Sabha dispatchLog must be an array.");
	return raw.map((value, index) => {
		const record = parseRecord(value, `Replicated Sabha dispatch record ${index} must be an object.`);
		const participantId = String(record.participantId ?? "").trim();
		const target = String(record.target ?? "").trim();
		const mode = String(record.mode ?? "").trim();
		const status = String(record.status ?? "").trim();
		const attemptedAt = Number(record.attemptedAt);
		const completedAt = record.completedAt == null ? undefined : Number(record.completedAt);
		const leaseOwner = typeof record.leaseOwner === "string" ? record.leaseOwner.trim() : "";
		const leaseExpiresAt = record.leaseExpiresAt == null ? undefined : Number(record.leaseExpiresAt);
		if (!participantId || !target) {
			throw new Error(`Replicated Sabha dispatch record ${index} is missing participantId or target.`);
		}
		if (!["ask", "tell"].includes(mode)) {
			throw new Error(`Replicated Sabha dispatch record ${index} has invalid mode.`);
		}
		if (!["pending", "delivered", "replied", "accepted", "failed"].includes(status)) {
			throw new Error(`Replicated Sabha dispatch record ${index} has invalid status.`);
		}
		if (!Number.isSafeInteger(attemptedAt) || attemptedAt <= 0) {
			throw new Error(`Replicated Sabha dispatch record ${index} has invalid attemptedAt.`);
		}
		if (completedAt != null && (!Number.isSafeInteger(completedAt) || completedAt <= 0)) {
			throw new Error(`Replicated Sabha dispatch record ${index} has invalid completedAt.`);
		}
		if (leaseExpiresAt != null && (!Number.isSafeInteger(leaseExpiresAt) || leaseExpiresAt <= 0)) {
			throw new Error(`Replicated Sabha dispatch record ${index} has invalid leaseExpiresAt.`);
		}
		return {
			participantId,
			target,
			mode: mode as SabhaMeshDispatchRecord["mode"],
			status: status as SabhaMeshDispatchRecord["status"],
			attemptedAt,
			completedAt,
			error: typeof record.error === "string" ? record.error : undefined,
			replySummary: typeof record.replySummary === "string" ? record.replySummary : undefined,
			replyFrom: typeof record.replyFrom === "string" ? record.replyFrom : undefined,
			resolvedTarget: typeof record.resolvedTarget === "string" ? record.resolvedTarget : undefined,
			leaseOwner: leaseOwner || undefined,
			leaseExpiresAt,
			resumed: record.resumed === true ? true : undefined,
		};
	});
}
export function parseReplicatedSabhaEvents(raw: unknown): SabhaEventRecord[] {
	if (raw == null) return [];
	if (!Array.isArray(raw)) throw new Error("Replicated Sabha events must be an array.");
	return raw.map((value, index) => {
		const record = parseRecord(value, `Replicated Sabha event ${index} must be an object.`);
		const sabhaId = String(record.sabhaId ?? "").trim();
		const eventId = String(record.eventId ?? "").trim();
		const revision = Number(record.revision);
		const parentRevision = Number(record.parentRevision);
		const eventType = String(record.eventType ?? "").trim();
		const createdAt = Number(record.createdAt);
		const payload = parsePlainObject(record.payload);
		if (!sabhaId || !eventId || !eventType) {
			throw new Error(`Replicated Sabha event ${index} is missing sabhaId, eventId, or eventType.`);
		}
		if (!Number.isSafeInteger(revision) || revision <= 0) {
			throw new Error(`Replicated Sabha event ${index} has invalid revision.`);
		}
		if (!Number.isSafeInteger(parentRevision) || parentRevision < 0) {
			throw new Error(`Replicated Sabha event ${index} has invalid parentRevision.`);
		}
		if (!Number.isSafeInteger(createdAt) || createdAt <= 0) {
			throw new Error(`Replicated Sabha event ${index} has invalid createdAt.`);
		}
		return { sabhaId, eventId, revision, parentRevision, eventType, createdAt, payload };
	}).sort((left, right) => left.revision - right.revision);
}
export function assertContiguousReplicatedSabhaEvents(
	sabhaId: string,
	revision: number,
	events: SabhaEventRecord[],
): void {
	let previousRevision = 0;
	for (const [index, event] of events.entries()) {
		if (event.sabhaId !== sabhaId) {
			throw new Error(`Replicated Sabha event ${index} belongs to '${event.sabhaId}', expected '${sabhaId}'.`);
		}
		if (event.revision > revision) {
			throw new Error(`Replicated Sabha event ${index} exceeds snapshot revision ${revision}.`);
		}
		if (event.parentRevision !== previousRevision) {
			throw new Error(
				`Replicated Sabha event ${index} has non-contiguous parentRevision ${event.parentRevision}; expected ${previousRevision}.`,
			);
		}
		if (event.revision !== previousRevision + 1) {
			throw new Error(
				`Replicated Sabha event ${index} has non-contiguous revision ${event.revision}; expected ${previousRevision + 1}.`,
			);
		}
		previousRevision = event.revision;
	}
	if (events.length > 0 && previousRevision !== revision) {
		throw new Error(
			`Replicated Sabha event chain ends at revision ${previousRevision}, expected snapshot revision ${revision}.`,
		);
	}
}
export function parseReplicatedSabhaState(raw: unknown): PersistedSabhaState {
	const record = parseRecord(raw, "Replicated Sabha state must be an object.");
	const sabhaRecord = parseRecord(record.sabha, "Replicated Sabha state is missing sabha.");
	const revision = Number(record.revision);
	if (!Number.isSafeInteger(revision) || revision < 0) {
		throw new Error("Replicated Sabha state has invalid revision.");
	}
	const state: PersistedSabhaState = {
		sabha: structuredClone(sabhaRecord) as unknown as PersistedSabhaState["sabha"],
		revision,
		clientBindings: parseStringMap(record.clientBindings),
		meshBindings: parseReplicatedMeshBindings(record.meshBindings),
		dispatchLog: parseReplicatedDispatchLog(record.dispatchLog),
		perspectives: parseReplicatedPerspectives(record.perspectives),
	};
	new SabhaEngine().restoreSabha(state.sabha);
	return state;
}
