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
import {
	parseReplicatedSabhaState,
	parseReplicatedSabhaEvents,
	assertContiguousReplicatedSabhaEvents,
} from "./services-collaboration-replication-parsers.js";
import { withSabhaWriteLock } from "./services-collaboration-state.js";
import type {
	SabhaMeshBinding,
} from "./services-collaboration-types.js";

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
