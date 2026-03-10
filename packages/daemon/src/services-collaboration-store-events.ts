import type { SabhaEventRecord } from "./services-collaboration-types.js";

export function samePersistedEvent(left: SabhaEventRecord, right: SabhaEventRecord): boolean {
	return left.eventId === right.eventId
		&& left.revision === right.revision
		&& left.parentRevision === right.parentRevision
		&& left.eventType === right.eventType
		&& JSON.stringify(left.payload ?? {}) === JSON.stringify(right.payload ?? {});
}

export function localHistoryMatchesIncoming(
	localEvents: SabhaEventRecord[],
	remoteEvents: SabhaEventRecord[],
	localRevision: number,
): boolean {
	if (localRevision === 0) return true;
	if (remoteEvents.length < localRevision) return false;
	for (let index = 0; index < localRevision; index += 1) {
		const local = localEvents[index];
		const remote = remoteEvents[index];
		if (!local || !remote || !samePersistedEvent(local, remote)) {
			return false;
		}
	}
	return true;
}
