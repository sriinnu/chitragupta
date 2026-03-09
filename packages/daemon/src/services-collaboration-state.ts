import type {
	SabhaEventRecord,
	SabhaMeshBinding,
	SabhaMeshDispatchRecord,
	SabhaPerspective,
} from "./services-collaboration-types.js";

const sharedSabhaBindings = new Map<string, Map<string, string>>();
const sharedSabhaMeshBindings = new Map<string, Map<string, SabhaMeshBinding>>();
const sharedSabhaDispatchLog = new Map<string, SabhaMeshDispatchRecord[]>();
const sharedSabhaPerspectives = new Map<string, Map<string, SabhaPerspective>>();
const sharedSabhaRevision = new Map<string, number>();
const sharedSabhaEventLog = new Map<string, SabhaEventRecord[]>();
const sharedSabhaWriteQueue = new Map<string, Promise<void>>();
const sharedSabhaTouchedAt = new Map<string, number>();

function markSabhaTouched(sabhaId: string): void {
	sharedSabhaTouchedAt.set(sabhaId, Date.now());
}

export function getSabhaClientBindingMap(sabhaId: string): Map<string, string> {
	markSabhaTouched(sabhaId);
	let bindings = sharedSabhaBindings.get(sabhaId);
	if (!bindings) {
		bindings = new Map<string, string>();
		sharedSabhaBindings.set(sabhaId, bindings);
	}
	return bindings;
}

export function getSabhaPerspectiveMap(sabhaId: string): Map<string, SabhaPerspective> {
	markSabhaTouched(sabhaId);
	let perspectives = sharedSabhaPerspectives.get(sabhaId);
	if (!perspectives) {
		perspectives = new Map<string, SabhaPerspective>();
		sharedSabhaPerspectives.set(sabhaId, perspectives);
	}
	return perspectives;
}

export function getSabhaMeshBindingMap(sabhaId: string): Map<string, SabhaMeshBinding> {
	markSabhaTouched(sabhaId);
	let bindings = sharedSabhaMeshBindings.get(sabhaId);
	if (!bindings) {
		bindings = new Map<string, SabhaMeshBinding>();
		sharedSabhaMeshBindings.set(sabhaId, bindings);
	}
	return bindings;
}

export function listSabhaMeshBindings(sabhaId: string): SabhaMeshBinding[] {
	return [...getSabhaMeshBindingMap(sabhaId).values()].sort((a, b) =>
		a.participantId.localeCompare(b.participantId),
	);
}

export function getSabhaDispatchLog(sabhaId: string): SabhaMeshDispatchRecord[] {
	markSabhaTouched(sabhaId);
	let log = sharedSabhaDispatchLog.get(sabhaId);
	if (!log) {
		log = [];
		sharedSabhaDispatchLog.set(sabhaId, log);
	}
	return log;
}

export function getSabhaRevision(sabhaId: string): number {
	markSabhaTouched(sabhaId);
	return sharedSabhaRevision.get(sabhaId) ?? 0;
}

export function setSabhaRevision(sabhaId: string, revision: number): void {
	markSabhaTouched(sabhaId);
	sharedSabhaRevision.set(sabhaId, revision);
}

export function getSabhaEventLog(sabhaId: string): SabhaEventRecord[] {
	markSabhaTouched(sabhaId);
	let log = sharedSabhaEventLog.get(sabhaId);
	if (!log) {
		log = [];
		sharedSabhaEventLog.set(sabhaId, log);
	}
	return log;
}

export function appendSabhaDispatchRecord(sabhaId: string, record: SabhaMeshDispatchRecord): void {
	markSabhaTouched(sabhaId);
	const log = getSabhaDispatchLog(sabhaId);
	log.push(record);
	if (log.length > 100) {
		log.splice(0, log.length - 100);
	}
}

export function appendSabhaEventRecord(event: SabhaEventRecord): void {
	markSabhaTouched(event.sabhaId);
	setSabhaRevision(event.sabhaId, event.revision);
	const log = getSabhaEventLog(event.sabhaId);
	log.push(event);
	if (log.length > 200) {
		log.splice(0, log.length - 200);
	}
}

export function latestSabhaDispatchRecord(
	sabhaId: string,
	participantId: string,
): SabhaMeshDispatchRecord | undefined {
	const log = getSabhaDispatchLog(sabhaId);
	for (let index = log.length - 1; index >= 0; index -= 1) {
		if (log[index]?.participantId === participantId) return log[index];
	}
	return undefined;
}

export async function withSabhaWriteLock<T>(sabhaId: string, fn: () => Promise<T> | T): Promise<T> {
	markSabhaTouched(sabhaId);
	const previous = sharedSabhaWriteQueue.get(sabhaId) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const queued = previous.catch(() => undefined).then(() => current);
	sharedSabhaWriteQueue.set(sabhaId, queued);
	await previous.catch(() => undefined);
	try {
		return await fn();
	} finally {
		release();
		if (sharedSabhaWriteQueue.get(sabhaId) === queued) {
			sharedSabhaWriteQueue.delete(sabhaId);
		}
	}
}

export function touchSabhaRuntime(sabhaId: string): void {
	markSabhaTouched(sabhaId);
}

export function getSabhaTouchedAt(sabhaId: string): number {
	return sharedSabhaTouchedAt.get(sabhaId) ?? 0;
}

export function listTrackedSabhaIds(): string[] {
	return [...new Set([
		...sharedSabhaBindings.keys(),
		...sharedSabhaMeshBindings.keys(),
		...sharedSabhaDispatchLog.keys(),
		...sharedSabhaPerspectives.keys(),
		...sharedSabhaRevision.keys(),
		...sharedSabhaEventLog.keys(),
		...sharedSabhaWriteQueue.keys(),
		...sharedSabhaTouchedAt.keys(),
	])];
}

export function clearSabhaRuntimeState(sabhaId: string): void {
	sharedSabhaBindings.delete(sabhaId);
	sharedSabhaMeshBindings.delete(sabhaId);
	sharedSabhaDispatchLog.delete(sabhaId);
	sharedSabhaPerspectives.delete(sabhaId);
	sharedSabhaRevision.delete(sabhaId);
	sharedSabhaEventLog.delete(sabhaId);
	sharedSabhaWriteQueue.delete(sabhaId);
	sharedSabhaTouchedAt.delete(sabhaId);
}

export function listSabhaPerspectives(sabhaId: string): SabhaPerspective[] {
	return [...getSabhaPerspectiveMap(sabhaId).values()].sort((a, b) => {
		if (a.submittedAt !== b.submittedAt) return a.submittedAt - b.submittedAt;
		return a.participantId.localeCompare(b.participantId);
	});
}

export function resetCollaborationStateMaps(): void {
	sharedSabhaBindings.clear();
	sharedSabhaMeshBindings.clear();
	sharedSabhaDispatchLog.clear();
	sharedSabhaPerspectives.clear();
	sharedSabhaRevision.clear();
	sharedSabhaEventLog.clear();
	sharedSabhaWriteQueue.clear();
	sharedSabhaTouchedAt.clear();
}
