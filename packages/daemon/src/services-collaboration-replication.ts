import { SabhaEngine, type Sabha } from "@chitragupta/sutra";
import type { RpcRouter } from "./rpc-router.js";
import {
	applyReplicatedSabhaState,
	computePersistedSabhaSnapshotHash,
	getPersistedSabhaState,
	listPersistedSabhaEventsSince,
	type PersistedSabhaState,
} from "./services-collaboration-store.js";
import { mergeReplicatedSabhaState } from "./services-collaboration-merge.js";
import {
	buildPersistedSabhaState,
	gatherSabhaState,
	parseExpectedRevision } from "./services-collaboration-helpers.js";
import { refreshPersistedSabhaState } from "./services-collaboration-runtime.js";
import { withSabhaWriteLock } from "./services-collaboration-state.js";
import type {
	SabhaEventRecord, SabhaMeshBinding, SabhaMeshDispatchRecord,
	SabhaPerspective, SabhaPerspectiveEvidence, SabhaPerspectivePosition,
} from "./services-collaboration-types.js";

function parseRecord(value: unknown, errorMessage: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(errorMessage);
	}
	return value as Record<string, unknown>;
}
function parsePlainObject(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? { ...(value as Record<string, unknown>) }
		: {};
}
function parseStringMap(raw: unknown): Record<string, string> {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	return Object.fromEntries(
		Object.entries(raw as Record<string, unknown>)
			.filter(([, value]) => typeof value === "string")
			.map(([key, value]) => [key, String(value)]),
	);
}
function parsePerspectiveEvidenceArray(raw: unknown): SabhaPerspectiveEvidence[] {
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
function parseReplicatedPerspectives(raw: unknown): SabhaPerspective[] {
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
function parseReplicatedMeshBindings(raw: unknown): SabhaMeshBinding[] {
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
function parseReplicatedDispatchLog(raw: unknown): SabhaMeshDispatchRecord[] {
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
function parseReplicatedSabhaEvents(raw: unknown): SabhaEventRecord[] {
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
function assertContiguousReplicatedSabhaEvents(
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
function parseReplicatedSabhaState(raw: unknown): PersistedSabhaState {
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
export function applyParticipantBindings(
	sabhaId: string,
	clientBindings: Record<string, string>,
	meshBindings: SabhaMeshBinding[],
	getBindingMap: (id: string) => Map<string, string>,
	getMeshBindingMap: (id: string) => Map<string, SabhaMeshBinding>,
): void {
	if (Object.keys(clientBindings).length > 0) {
		const liveBindings = getBindingMap(sabhaId);
		liveBindings.clear();
		for (const [participantId, clientId] of Object.entries(clientBindings)) {
			liveBindings.set(participantId, clientId);
		}
	}
	if (meshBindings.length > 0) {
		const liveBindings = getMeshBindingMap(sabhaId);
		liveBindings.clear();
		for (const binding of meshBindings) {
			liveBindings.set(binding.participantId, binding);
		}
	}
}
interface RegisterSabhaReplicationMethodsOptions {
	router: RpcRouter;
	sharedSabhaEngine: SabhaEngine;
	readSabhaId: (params: Record<string, unknown>) => string;
	getSabhaOrThrow: (id: string) => Sabha;
	getReplicatedSabhaStateOrThrow: (id: string) => PersistedSabhaState;
	getClientBindingMap: (id: string) => Map<string, string>;
	getMeshBindingMap: (id: string) => Map<string, SabhaMeshBinding>;
	resumePendingMeshConsultations: (
		router: RpcRouter,
		sabha: Sabha,
		options: {
			expectedRevision: unknown;
			explicitTargets: unknown;
			forceFailed: boolean;
		},
	) => Promise<unknown>;
}
export function registerSabhaReplicationMethods({
	router,
	sharedSabhaEngine,
	readSabhaId,
	getSabhaOrThrow,
	getReplicatedSabhaStateOrThrow,
	getClientBindingMap,
	getMeshBindingMap,
	resumePendingMeshConsultations,
}: RegisterSabhaReplicationMethodsOptions): void {
	router.register("sabha.events", async (params) => {
		const id = readSabhaId(params);
		const sabha = getSabhaOrThrow(id);
		const sinceRevision = parseExpectedRevision(params.sinceRevision) ?? 0;
		const limit = Number.isSafeInteger(Number(params.limit)) ? Number(params.limit) : 100;
		const { events, hasMore } = listPersistedSabhaEventsSince(id, sinceRevision, limit);
		const state = gatherSabhaState(sabha) as { revision: number; snapshotHash: string };
		return {
			sabhaId: id,
			currentRevision: state.revision,
			snapshotHash: state.snapshotHash,
			sinceRevision,
			events,
			hasMore,
		};
	}, "Read Sabha oplog events after a given revision");

	router.register("sabha.sync", async (params) => {
		const id = readSabhaId(params);
		const sabha = getSabhaOrThrow(id);
		const shouldResumeMesh = params.retryMesh === true || params.resumePending === true;
		const meshDispatches = shouldResumeMesh
			? await resumePendingMeshConsultations(router, sabha, {
				expectedRevision: params.expectedRevision,
				explicitTargets: params.targetClientIds,
				forceFailed: params.retryMesh === true,
			})
			: [];
		const state = gatherSabhaState(sabha) as Record<string, unknown> & { revision: number; snapshotHash: string };
		const sinceRevision = parseExpectedRevision(params.sinceRevision) ?? 0;
		const clientSnapshotHash = typeof params.snapshotHash === "string" ? params.snapshotHash.trim() : "";
		const limit = Number.isSafeInteger(Number(params.limit)) ? Number(params.limit) : 100;
		if (!clientSnapshotHash || clientSnapshotHash !== state.snapshotHash || sinceRevision > state.revision) {
			const reason = !clientSnapshotHash
				? "initial-sync"
				: sinceRevision > state.revision
					? "client-ahead"
					: "snapshot-mismatch";
			return {
				mode: "snapshot",
				sabha: state,
				meshDispatches,
				events: [],
				hasMore: false,
				conflict: {
					reason,
					clientSnapshotHash: clientSnapshotHash || null,
					serverSnapshotHash: state.snapshotHash,
					clientRevision: sinceRevision,
					serverRevision: state.revision,
				},
			};
		}
		const { events, hasMore } = listPersistedSabhaEventsSince(id, sinceRevision, limit);
		return {
			mode: "events",
			sabhaId: id,
			currentRevision: state.revision,
			snapshotHash: state.snapshotHash,
			meshDispatches,
			events,
			hasMore,
		};
	}, "Synchronize Sabha state by oplog when possible, or return a full snapshot when the client has drifted");

	router.register("sabha.repl.pull", async (params) => {
		const id = readSabhaId(params);
		const state = getReplicatedSabhaStateOrThrow(id);
		const snapshotHash = computePersistedSabhaSnapshotHash(state);
		const sinceRevision = parseExpectedRevision(params.sinceRevision) ?? 0;
		const clientSnapshotHash = typeof params.snapshotHash === "string" ? params.snapshotHash.trim() : "";
		const limit = Number.isSafeInteger(Number(params.limit)) ? Number(params.limit) : 100;
		if (!clientSnapshotHash || clientSnapshotHash !== snapshotHash || sinceRevision > state.revision) {
			return {
				mode: "snapshot",
				sabhaId: id,
				currentRevision: state.revision,
				snapshotHash,
				state: {
					...state,
					snapshotHash,
				},
				events: [],
				hasMore: false,
				conflict: {
					reason: !clientSnapshotHash
						? "initial-sync"
						: sinceRevision > state.revision
							? "client-ahead"
							: "snapshot-mismatch",
					clientSnapshotHash: clientSnapshotHash || null,
					serverSnapshotHash: snapshotHash,
					clientRevision: sinceRevision,
					serverRevision: state.revision,
				},
			};
		}
		const { events, hasMore } = listPersistedSabhaEventsSince(id, sinceRevision, limit);
		return {
			mode: "events",
			sabhaId: id,
			currentRevision: state.revision,
			snapshotHash,
			events,
			hasMore,
		};
	}, "Read replicated Sabha state without triggering mesh retries or other runtime side effects");

	router.register("sabha.repl.apply", async (params) => {
		const id = readSabhaId(params);
		return withSabhaWriteLock(id, async () => {
			const state = parseReplicatedSabhaState(params.state);
			if (state.sabha.id !== id) {
				throw new Error(`Replicated Sabha state belongs to '${state.sabha.id}', expected '${id}'.`);
			}
			const events = parseReplicatedSabhaEvents(params.events);
			const expectedRevision = parseExpectedRevision(params.expectedRevision);
			if (expectedRevision == null) {
				throw new Error("sabha.repl.apply requires expectedRevision.");
			}
			assertContiguousReplicatedSabhaEvents(id, state.revision, events);
			const result = applyReplicatedSabhaState(state, {
				expectedRevision,
				events,
			});
			applyParticipantBindings(
				id,
				state.clientBindings,
				state.meshBindings,
				getClientBindingMap,
				getMeshBindingMap,
			);
			const sabha = refreshPersistedSabhaState(sharedSabhaEngine, id);
			if (!sabha) throw new Error(`Sabha '${id}' could not be refreshed after replication apply.`);
			return {
				applied: result.applied,
				mode: result.mode,
				insertedEvents: result.insertedEvents,
				currentRevision: result.currentRevision,
				snapshotHash: result.snapshotHash,
				sabha: gatherSabhaState(sabha),
			};
		});
	}, "Apply a replicated Sabha snapshot into local durable state without triggering consultation side effects");

	router.register("sabha.repl.merge", async (params) => {
		const id = readSabhaId(params);
		return withSabhaWriteLock(id, async () => {
			const state = parseReplicatedSabhaState(params.state);
			if (state.sabha.id !== id) {
				throw new Error(`Replicated Sabha state belongs to '${state.sabha.id}', expected '${id}'.`);
			}
			const events = parseReplicatedSabhaEvents(params.events);
			assertContiguousReplicatedSabhaEvents(id, state.revision, events);
			const expectedRevision = parseExpectedRevision(params.expectedRevision);
			const result = mergeReplicatedSabhaState(state, {
				expectedRevision,
				events,
			});
			if (result.applied) {
				applyParticipantBindings(
					id,
					state.clientBindings,
					state.meshBindings,
					getClientBindingMap,
					getMeshBindingMap,
				);
			}
			const sabha = refreshPersistedSabhaState(sharedSabhaEngine, id);
			const currentSabha = sabha ?? getSabhaOrThrow(id);
			return {
				...result,
				sabha: gatherSabhaState(currentSabha),
			};
		});
	}, "Merge replicated Sabha state using oplog-aware fast-forward semantics when possible");
}
export function resolveReplicatedSabhaState(
	id: string,
	getSabhaOrThrow: (sabhaId: string) => Sabha,
): PersistedSabhaState {
	const persisted = getPersistedSabhaState(id);
	if (persisted) return persisted;
	return {
		...buildPersistedSabhaState(getSabhaOrThrow(id)),
	};
}
