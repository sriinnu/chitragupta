import type {
	PersistedSabhaState,
	ReplicatedSabhaApplyResult,
} from "./services-collaboration-store.js";
import {
	applyReplicatedSabhaState,
	computePersistedSabhaSnapshotHash,
	getPersistedSabhaState,
	listPersistedSabhaEvents,
} from "./services-collaboration-store.js";
import type { SabhaEventRecord } from "./services-collaboration-types.js";

export interface ReplicatedSabhaMergeResult {
	applied: boolean;
	mode: ReplicatedSabhaApplyResult["mode"] | "fast-forward" | "local-ahead" | "conflict";
	currentRevision: number;
	snapshotHash: string;
	insertedEvents: number;
	conflict?: {
		reason: "diverged-same-revision" | "diverged-history" | "missing-history";
		localRevision: number;
		remoteRevision: number;
		localSnapshotHash: string | null;
		remoteSnapshotHash: string;
	};
}

function sameEvent(left: SabhaEventRecord, right: SabhaEventRecord): boolean {
	return left.eventId === right.eventId
		&& left.revision === right.revision
		&& left.parentRevision === right.parentRevision
		&& left.eventType === right.eventType
		&& JSON.stringify(left.payload ?? {}) === JSON.stringify(right.payload ?? {});
}

function localHistoryIsPrefix(localEvents: SabhaEventRecord[], remoteEvents: SabhaEventRecord[], localRevision: number): boolean {
	if (localRevision === 0) return true;
	if (remoteEvents.length < localRevision) return false;
	for (let index = 0; index < localRevision; index += 1) {
		const local = localEvents[index];
		const remote = remoteEvents[index];
		if (!local || !remote || !sameEvent(local, remote)) {
			return false;
		}
	}
	return true;
}

export function mergeReplicatedSabhaState(
	state: PersistedSabhaState,
	params: {
		expectedRevision?: number | null;
		events?: SabhaEventRecord[];
	},
): ReplicatedSabhaMergeResult {
	const localState = getPersistedSabhaState(state.sabha.id);
	if (!localState) {
		return applyReplicatedSabhaState(state, params);
	}
	const localRevision = localState.revision;
	const localSnapshotHash = computePersistedSabhaSnapshotHash(localState);
	const remoteSnapshotHash = computePersistedSabhaSnapshotHash(state);
	if (localRevision === state.revision) {
		if (localSnapshotHash === remoteSnapshotHash) {
			return applyReplicatedSabhaState(state, {
				expectedRevision: params.expectedRevision ?? localRevision,
				events: params.events,
			});
		}
		return {
			applied: false,
			mode: "conflict",
			currentRevision: localRevision,
			snapshotHash: localSnapshotHash,
			insertedEvents: 0,
			conflict: {
				reason: "diverged-same-revision",
				localRevision,
				remoteRevision: state.revision,
				localSnapshotHash,
				remoteSnapshotHash,
			},
		};
	}
	if (localRevision > state.revision) {
		return {
			applied: false,
			mode: "local-ahead",
			currentRevision: localRevision,
			snapshotHash: localSnapshotHash,
			insertedEvents: 0,
		};
	}
	const remoteEvents = params.events ?? [];
	if (remoteEvents.length > 0) {
		const localEvents = listPersistedSabhaEvents(state.sabha.id);
		if (!localHistoryIsPrefix(localEvents, remoteEvents, localRevision)) {
			return {
				applied: false,
				mode: "conflict",
				currentRevision: localRevision,
				snapshotHash: localSnapshotHash,
				insertedEvents: 0,
				conflict: {
					reason: "diverged-history",
					localRevision,
					remoteRevision: state.revision,
					localSnapshotHash,
					remoteSnapshotHash,
				},
			};
		}
		const applied = applyReplicatedSabhaState(state, {
			expectedRevision: params.expectedRevision ?? localRevision,
			events: remoteEvents,
		});
		return {
			...applied,
			mode: applied.applied ? "fast-forward" : applied.mode,
		};
	}
	if (localRevision > 0) {
		return {
			applied: false,
			mode: "conflict",
			currentRevision: localRevision,
			snapshotHash: localSnapshotHash,
			insertedEvents: 0,
			conflict: {
				reason: "missing-history",
				localRevision,
				remoteRevision: state.revision,
				localSnapshotHash,
				remoteSnapshotHash,
			},
		};
	}
	return applyReplicatedSabhaState(state, {
		expectedRevision: params.expectedRevision ?? localRevision,
		events: remoteEvents,
	});
}
