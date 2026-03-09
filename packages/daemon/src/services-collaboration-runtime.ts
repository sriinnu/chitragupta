import type { SabhaEngine, Sabha } from "@chitragupta/sutra";
import type { RpcRouter } from "./rpc-router.js";
import {
	getPersistedSabhaState,
	listPersistedSabhaEvents,
	listPersistedSabhaStates,
	recordPersistedSabhaMutation,
	savePersistedSabhaStateSnapshot,
} from "./services-collaboration-store.js";
import {
	dispatchSabhaMeshBinding,
	getCollaborationMeshLeaseOwner,
	_resetCollaborationMeshForTests,
} from "./services-collaboration-mesh.js";
import type { SabhaMeshDispatchRecord } from "./services-collaboration-types.js";
import {
	appendSabhaDispatchRecord,
	appendSabhaEventRecord,
	clearSabhaRuntimeState,
	getSabhaClientBindingMap,
	getSabhaDispatchLog,
	getSabhaEventLog,
	getSabhaMeshBindingMap,
	getSabhaPerspectiveMap,
	getSabhaTouchedAt,
	listSabhaMeshBindings,
	listTrackedSabhaIds,
	resetCollaborationStateMaps,
	setSabhaRevision,
	touchSabhaRuntime,
	withSabhaWriteLock,
} from "./services-collaboration-state.js";
import {
	assertExpectedRevision,
	buildPersistedSabhaState,
	emitSabhaNotification,
	shouldResumeMeshBinding,
} from "./services-collaboration-helpers.js";

let collaborationStateHydrated = false;
const CONCLUDED_SABHA_CACHE_TTL_MS = 15 * 60_000;
const MAX_CACHED_CONCLUDED_SABHA = 128;

function dropSabhaFromRuntime(sharedSabhaEngine: SabhaEngine, sabhaId: string): void {
	const engine = sharedSabhaEngine as SabhaEngine & { dropSabha?: (id: string) => void };
	if (typeof engine.dropSabha === "function") {
		engine.dropSabha(sabhaId);
	}
}

function restorePersistedSabhaState(
	sharedSabhaEngine: SabhaEngine,
	state: ReturnType<typeof listPersistedSabhaStates>[number],
): Sabha {
	const sabha = sharedSabhaEngine.restoreSabha(state.sabha);
	const clientBindings = getSabhaClientBindingMap(sabha.id);
	clientBindings.clear();
	for (const [participantId, clientId] of Object.entries(state.clientBindings)) {
		clientBindings.set(participantId, clientId);
	}
	const meshBindings = getSabhaMeshBindingMap(sabha.id);
	meshBindings.clear();
	for (const binding of state.meshBindings) {
		meshBindings.set(binding.participantId, binding);
	}
	const dispatchLog = getSabhaDispatchLog(sabha.id);
	dispatchLog.length = 0;
	dispatchLog.push(...state.dispatchLog);
	const perspectiveMap = getSabhaPerspectiveMap(sabha.id);
	perspectiveMap.clear();
	for (const perspective of state.perspectives) {
		perspectiveMap.set(perspective.participantId, perspective);
	}
	setSabhaRevision(sabha.id, state.revision);
	const events = listPersistedSabhaEvents(sabha.id);
	if (events.length > 0) {
		const eventLog = getSabhaEventLog(sabha.id);
		eventLog.length = 0;
		eventLog.push(...events);
	}
	touchSabhaRuntime(sabha.id);
	return sabha;
}

export function hydrateCollaborationState(sharedSabhaEngine: SabhaEngine): void {
	if (collaborationStateHydrated) return;
	const states = listPersistedSabhaStates();
	for (const state of states) {
		try {
			restorePersistedSabhaState(sharedSabhaEngine, state);
		} catch {
			// Ignore corrupted persisted Sabha rows and keep the daemon live.
		}
	}
	collaborationStateHydrated = true;
}

export function loadPersistedSabhaState(sharedSabhaEngine: SabhaEngine, sabhaId: string): Sabha | null {
	try {
		const state = getPersistedSabhaState(sabhaId);
		if (!state) return null;
		return restorePersistedSabhaState(sharedSabhaEngine, state);
	} catch {
		return null;
	}
}

export function refreshPersistedSabhaState(sharedSabhaEngine: SabhaEngine, sabhaId: string): Sabha | null {
	dropSabhaFromRuntime(sharedSabhaEngine, sabhaId);
	clearSabhaRuntimeState(sabhaId);
	return loadPersistedSabhaState(sharedSabhaEngine, sabhaId);
}

export function pruneCollaborationRuntime(sharedSabhaEngine: SabhaEngine, now = Date.now()): void {
	const trackedIds = listTrackedSabhaIds();
		const concludedCandidates = trackedIds
			.map((id) => ({ id, sabha: sharedSabhaEngine.getSabha(id), touchedAt: getSabhaTouchedAt(id) }))
			.filter((entry): entry is { id: string; sabha: Sabha; touchedAt: number } => {
				const sabha = entry.sabha;
				return sabha !== undefined
					&& (sabha.status === "concluded" || sabha.status === "escalated");
			});

	for (const entry of concludedCandidates) {
		const concludedAt = entry.sabha.concludedAt ?? entry.touchedAt;
		if (now - concludedAt < CONCLUDED_SABHA_CACHE_TTL_MS) continue;
		dropSabhaFromRuntime(sharedSabhaEngine, entry.id);
		clearSabhaRuntimeState(entry.id);
	}

	const remainingConcluded = concludedCandidates
		.filter((entry) => sharedSabhaEngine.getSabha(entry.id))
		.sort((left, right) => left.touchedAt - right.touchedAt);
	const overflow = remainingConcluded.length - MAX_CACHED_CONCLUDED_SABHA;
	if (overflow <= 0) return;
	for (const entry of remainingConcluded.slice(0, overflow)) {
		dropSabhaFromRuntime(sharedSabhaEngine, entry.id);
		clearSabhaRuntimeState(entry.id);
	}
}

export function recordSabhaMutation(
	sabha: Sabha,
	eventType: string,
	payload?: Record<string, unknown>,
) {
	touchSabhaRuntime(sabha.id);
	const state = buildPersistedSabhaState(sabha);
	const event = recordPersistedSabhaMutation(state, {
		expectedRevision: state.revision,
		eventType,
		payload,
	});
	appendSabhaEventRecord(event);
	return event;
}

export async function dispatchMeshConsultations(
	router: RpcRouter,
	sabha: Sabha,
	options?: {
		explicitTargets?: unknown;
		participantIds?: Iterable<string>;
		expectedRevision?: unknown;
		resumed?: boolean;
		forceFailed?: boolean;
	},
): Promise<SabhaMeshDispatchRecord[]> {
	return withSabhaWriteLock(sabha.id, async () => {
		assertExpectedRevision(sabha.id, options?.expectedRevision);
		const participantFilter = options?.participantIds ? new Set(options.participantIds) : null;
		const bindings = listSabhaMeshBindings(sabha.id);
		if (bindings.length === 0) return [];
		const perspectiveMap = getSabhaPerspectiveMap(sabha.id);
		const dispatches: SabhaMeshDispatchRecord[] = [];
		const leaseOwner = getCollaborationMeshLeaseOwner();
		for (const binding of bindings) {
			if (participantFilter && !participantFilter.has(binding.participantId)) continue;
			if (perspectiveMap.has(binding.participantId)) continue;
			if (
				options?.resumed === true
				&& !shouldResumeMeshBinding(sabha, binding, {
					forceFailed: options.forceFailed,
					leaseOwner,
				})
			) {
				continue;
			}
			const previousState = buildPersistedSabhaState(sabha);
			const pendingRecord: SabhaMeshDispatchRecord = {
				participantId: binding.participantId,
				target: binding.resolvedTarget?.trim() || binding.target,
				mode: binding.mode,
				status: "pending",
				attemptedAt: Date.now(),
				leaseOwner,
				leaseExpiresAt: Date.now() + Math.max(1_000, binding.timeoutMs),
				resumed: options?.resumed === true,
			};
			appendSabhaDispatchRecord(sabha.id, pendingRecord);
			savePersistedSabhaStateSnapshot(buildPersistedSabhaState(sabha), previousState);
			const dispatch = await dispatchSabhaMeshBinding(sabha, binding, {
				applyPerspective: (perspective) => {
					if (perspectiveMap.has(perspective.participantId)) return false;
					perspectiveMap.set(perspective.participantId, perspective);
					return true;
				},
			});
			if (dispatch.resolvedTarget && binding.target.startsWith("capability:")) {
				binding.resolvedTarget = dispatch.resolvedTarget;
				binding.resolvedAt = Date.now();
			}
			dispatch.resumed = options?.resumed === true;
			const acceptedPerspective = perspectiveMap.get(binding.participantId) ?? null;
			const acceptedPerspectiveData = acceptedPerspective
				? {
					participantId: acceptedPerspective.participantId,
					position: acceptedPerspective.position,
					summary: acceptedPerspective.summary,
				}
				: null;
			appendSabhaDispatchRecord(sabha.id, dispatch);
			recordSabhaMutation(sabha, options?.resumed === true ? "mesh_dispatch_resumed" : "mesh_dispatch", {
				participantId: binding.participantId,
				target: binding.target,
				status: dispatch.status,
				replyFrom: dispatch.replyFrom ?? null,
				replySummary: dispatch.replySummary ?? null,
				resolvedTarget: binding.resolvedTarget ?? null,
				resumed: options?.resumed === true,
				acceptedPerspective: acceptedPerspectiveData,
			});
			dispatches.push(dispatch);
			if (acceptedPerspective) {
				emitSabhaNotification(router, sabha, "sabha.perspective", {
					event: "perspective",
					perspective: acceptedPerspective,
				}, options?.explicitTargets);
			}
		}
		if (dispatches.length > 0) {
			emitSabhaNotification(router, sabha, "sabha.mesh_dispatch", {
				event: options?.resumed === true ? "mesh_dispatch_resumed" : "mesh_dispatch",
				dispatches,
			}, options?.explicitTargets);
		}
		return dispatches;
	});
}

export async function resumePendingMeshConsultations(
	router: RpcRouter,
	sabha: Sabha,
	options: {
		explicitTargets?: unknown;
		expectedRevision?: unknown;
		forceFailed?: boolean;
	} = {},
): Promise<SabhaMeshDispatchRecord[]> {
	return dispatchMeshConsultations(router, sabha, {
		explicitTargets: options.explicitTargets,
		expectedRevision: options.expectedRevision,
		resumed: true,
		forceFailed: options.forceFailed,
	});
}

export async function resumeActiveSabhaMeshDispatches(
	sharedSabhaEngine: SabhaEngine,
	router: RpcRouter,
): Promise<void> {
	for (const sabha of sharedSabhaEngine.listActive()) {
		try {
			await resumePendingMeshConsultations(router, sabha, { forceFailed: true });
		} catch {
			// Keep the daemon live; clients can gather or retry the Sabha later.
		}
	}
}

export function resetCollaborationRuntime(sharedSabhaEngine: SabhaEngine): void {
	sharedSabhaEngine.clear();
	resetCollaborationStateMaps();
	_resetCollaborationMeshForTests();
	collaborationStateHydrated = false;
}
