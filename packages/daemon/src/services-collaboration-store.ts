import { createHash, randomUUID } from "node:crypto";
import { DatabaseManager, initAgentSchema } from "@chitragupta/smriti";
import type { Sabha } from "@chitragupta/sutra";
import type {
	SabhaEventRecord,
	SabhaMeshBinding,
	SabhaMeshDispatchRecord,
	SabhaPerspective,
} from "./services-collaboration-types.js";
import { localHistoryMatchesIncoming } from "./services-collaboration-store-events.js";

interface PersistedSabhaRow {
	id: string;
	revision: number;
	sabha_json: string;
	client_bindings_json: string;
	mesh_bindings_json: string;
	dispatch_log_json: string;
	perspectives_json: string;
}

interface PersistedSabhaEventRow {
	sabha_id: string;
	event_id: string;
	revision: number;
	parent_revision: number;
	event_type: string;
	event_json: string;
	created_at: number;
}

export interface PersistedSabhaState {
	sabha: Sabha;
	revision: number;
	clientBindings: Record<string, string>;
	meshBindings: SabhaMeshBinding[];
	dispatchLog: SabhaMeshDispatchRecord[];
	perspectives: SabhaPerspective[];
}

interface SerializedPersistedSabhaState {
	sabhaJson: string;
	clientBindingsJson: string;
	meshBindingsJson: string;
	dispatchLogJson: string;
	perspectivesJson: string;
}

export interface ReplicatedSabhaApplyResult {
	applied: boolean;
	mode: "noop" | "snapshot";
	currentRevision: number;
	snapshotHash: string;
	insertedEvents: number;
}

function getDb() {
	const dbm = DatabaseManager.instance();
	initAgentSchema(dbm);
	return dbm.get("agent");
}

function parseJson<T>(raw: string, fallback: T): T {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function rowToPersistedSabhaState(row: PersistedSabhaRow): PersistedSabhaState {
	return {
		sabha: parseJson<Sabha>(row.sabha_json, {
			id: row.id,
			topic: "",
			status: "convened",
			convener: "unknown",
			participants: [],
			rounds: [],
			finalVerdict: null,
			createdAt: 0,
			concludedAt: null,
		}),
		revision: Number.isFinite(row.revision) ? row.revision : 0,
		clientBindings: parseJson<Record<string, string>>(row.client_bindings_json, {}),
		meshBindings: parseJson<SabhaMeshBinding[]>(row.mesh_bindings_json, []),
		dispatchLog: parseJson<SabhaMeshDispatchRecord[]>(row.dispatch_log_json, []),
		perspectives: parseJson<SabhaPerspective[]>(row.perspectives_json, []),
	};
}

export function computePersistedSabhaSnapshotHash(state: PersistedSabhaState): string {
	const normalized = JSON.stringify({
		sabha: state.sabha,
		revision: state.revision,
		clientBindings: state.clientBindings,
		meshBindings: state.meshBindings,
		dispatchLog: state.dispatchLog,
		perspectives: state.perspectives,
	});
	return createHash("sha256").update(normalized).digest("hex");
}

export function listPersistedSabhaStates(): PersistedSabhaState[] {
	const rows = getDb().prepare(
		`SELECT id, revision, sabha_json, client_bindings_json, mesh_bindings_json, dispatch_log_json, perspectives_json
		 FROM sabha_state
		 ORDER BY updated_at ASC`,
	).all() as PersistedSabhaRow[];
	return rows.map((row) => rowToPersistedSabhaState(row));
}

export function getPersistedSabhaState(sabhaId: string): PersistedSabhaState | null {
	const row = getDb().prepare(
		`SELECT id, revision, sabha_json, client_bindings_json, mesh_bindings_json, dispatch_log_json, perspectives_json
		 FROM sabha_state
		 WHERE id = ?`,
	).get(sabhaId) as PersistedSabhaRow | undefined;
	if (!row) return null;
	return rowToPersistedSabhaState(row);
}

export function listPersistedSabhaEvents(sabhaId: string): SabhaEventRecord[] {
	const rows = getDb().prepare(
		`SELECT sabha_id, event_id, revision, parent_revision, event_type, event_json, created_at
		 FROM sabha_event_log
		 WHERE sabha_id = ?
		 ORDER BY revision ASC`,
	).all(sabhaId) as PersistedSabhaEventRow[];
	return rows.map((row) => ({
		sabhaId: row.sabha_id,
		eventId: row.event_id || `${row.sabha_id}:${row.revision}`,
		revision: Number.isFinite(row.revision) ? row.revision : 0,
		parentRevision: Number.isFinite(row.parent_revision) ? row.parent_revision : Math.max(0, (Number(row.revision) || 0) - 1),
		eventType: row.event_type,
		createdAt: row.created_at,
		payload: parseJson<Record<string, unknown>>(row.event_json, {}),
	}));
}

export function listPersistedSabhaEventsSince(
	sabhaId: string,
	sinceRevision: number,
	limit = 100,
): { events: SabhaEventRecord[]; hasMore: boolean } {
	const safeSince = Number.isSafeInteger(sinceRevision) && sinceRevision >= 0 ? sinceRevision : 0;
	const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;
	const rows = getDb().prepare(
		`SELECT sabha_id, event_id, revision, parent_revision, event_type, event_json, created_at
		 FROM sabha_event_log
		 WHERE sabha_id = ? AND revision > ?
		 ORDER BY revision ASC
		 LIMIT ?`,
	).all(sabhaId, safeSince, safeLimit + 1) as PersistedSabhaEventRow[];
	const hasMore = rows.length > safeLimit;
	const slice = hasMore ? rows.slice(0, safeLimit) : rows;
	return {
		events: slice.map((row) => ({
			sabhaId: row.sabha_id,
			eventId: row.event_id || `${row.sabha_id}:${row.revision}`,
			revision: Number.isFinite(row.revision) ? row.revision : 0,
			parentRevision: Number.isFinite(row.parent_revision) ? row.parent_revision : Math.max(0, (Number(row.revision) || 0) - 1),
			eventType: row.event_type,
			createdAt: row.created_at,
			payload: parseJson<Record<string, unknown>>(row.event_json, {}),
		})),
		hasMore,
	};
}

function upsertPersistedSabhaState(
	db: ReturnType<typeof getDb>,
	state: PersistedSabhaState,
	updatedAt: number,
	previousState?: PersistedSabhaState,
): void {
	const serialized = serializePersistedSabhaState(state);
	const previousSerialized = previousState ? serializePersistedSabhaState(previousState) : null;
	const result = db.prepare(
		previousSerialized
			? `INSERT INTO sabha_state (
				id, topic, status, convener, revision, sabha_json, client_bindings_json,
				mesh_bindings_json, dispatch_log_json, perspectives_json, created_at, concluded_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				topic = excluded.topic,
				status = excluded.status,
				convener = excluded.convener,
				revision = excluded.revision,
				sabha_json = excluded.sabha_json,
				client_bindings_json = excluded.client_bindings_json,
				mesh_bindings_json = excluded.mesh_bindings_json,
				dispatch_log_json = excluded.dispatch_log_json,
				perspectives_json = excluded.perspectives_json,
				created_at = excluded.created_at,
				concluded_at = excluded.concluded_at,
				updated_at = excluded.updated_at
			WHERE sabha_state.revision < excluded.revision
				OR (
					sabha_state.revision = excluded.revision
					AND sabha_state.sabha_json = ?
					AND sabha_state.client_bindings_json = ?
					AND sabha_state.mesh_bindings_json = ?
					AND sabha_state.dispatch_log_json = ?
					AND sabha_state.perspectives_json = ?
				)`
			: `INSERT INTO sabha_state (
				id, topic, status, convener, revision, sabha_json, client_bindings_json,
				mesh_bindings_json, dispatch_log_json, perspectives_json, created_at, concluded_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				topic = excluded.topic,
				status = excluded.status,
				convener = excluded.convener,
				revision = excluded.revision,
				sabha_json = excluded.sabha_json,
				client_bindings_json = excluded.client_bindings_json,
				mesh_bindings_json = excluded.mesh_bindings_json,
				dispatch_log_json = excluded.dispatch_log_json,
				perspectives_json = excluded.perspectives_json,
				created_at = excluded.created_at,
				concluded_at = excluded.concluded_at,
				updated_at = excluded.updated_at`,
	).run(
		state.sabha.id,
		state.sabha.topic,
		state.sabha.status,
		state.sabha.convener,
		state.revision,
		serialized.sabhaJson,
		serialized.clientBindingsJson,
		serialized.meshBindingsJson,
		serialized.dispatchLogJson,
		serialized.perspectivesJson,
		state.sabha.createdAt,
		state.sabha.concludedAt ?? null,
		updatedAt,
		...(previousSerialized ? [
			previousSerialized.sabhaJson,
			previousSerialized.clientBindingsJson,
			previousSerialized.meshBindingsJson,
			previousSerialized.dispatchLogJson,
			previousSerialized.perspectivesJson,
		] : []),
	);
	if (previousSerialized && result.changes === 0) {
		throw new Error(`Sabha '${state.sabha.id}' changed while acquiring a mesh dispatch lease; retry the consultation.`);
	}
}

function serializePersistedSabhaState(state: PersistedSabhaState): SerializedPersistedSabhaState {
	return {
		sabhaJson: JSON.stringify(state.sabha),
		clientBindingsJson: JSON.stringify(state.clientBindings),
		meshBindingsJson: JSON.stringify(state.meshBindings),
		dispatchLogJson: JSON.stringify(state.dispatchLog),
		perspectivesJson: JSON.stringify(state.perspectives),
	};
}

export function savePersistedSabhaStateSnapshot(
	state: PersistedSabhaState,
	previousState?: PersistedSabhaState,
): void {
	upsertPersistedSabhaState(getDb(), state, Date.now(), previousState);
}

function insertPersistedSabhaEvents(
	db: ReturnType<typeof getDb>,
	sabhaId: string,
	revision: number,
	events: SabhaEventRecord[],
): number {
	let inserted = 0;
	const sorted = [...events].sort((left, right) => left.revision - right.revision);
	for (const event of sorted) {
		if (event.sabhaId !== sabhaId) {
			throw new Error(`Replicated Sabha event '${event.eventId}' belongs to '${event.sabhaId}', expected '${sabhaId}'.`);
		}
		if (event.revision > revision) {
			throw new Error(
				`Replicated Sabha event '${event.eventId}' exceeds snapshot revision ${revision}.`,
			);
		}
		const result = db.prepare(
			`INSERT OR IGNORE INTO sabha_event_log (
				sabha_id, event_id, revision, parent_revision, event_type, event_json, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(
			event.sabhaId,
			event.eventId,
			event.revision,
			event.parentRevision,
			event.eventType,
			JSON.stringify(event.payload ?? {}),
			event.createdAt,
		);
		if (Number(result.changes) > 0) inserted += Number(result.changes);
	}
	return inserted;
}


export function recordPersistedSabhaMutation(
	state: Omit<PersistedSabhaState, "revision">,
	params: {
		expectedRevision: number;
		eventType: string;
		payload?: Record<string, unknown>;
	},
): SabhaEventRecord {
	const db = getDb();
	const run = db.transaction(() => {
		const current = db.prepare(
			`SELECT revision
			 FROM sabha_state
			 WHERE id = ?`,
		).get(state.sabha.id) as { revision?: number } | undefined;
		const currentRevision = Number.isFinite(current?.revision) ? Number(current?.revision) : 0;
		if (currentRevision !== params.expectedRevision) {
			throw new Error(
				`Sabha revision mismatch for '${state.sabha.id}': expected ${params.expectedRevision}, got ${currentRevision}.`,
			);
		}

		const nextRevision = currentRevision + 1;
		const createdAt = Date.now();
		const eventId = randomUUID();
		upsertPersistedSabhaState(db, { ...state, revision: nextRevision }, createdAt);
		db.prepare(
			`INSERT INTO sabha_event_log (
				sabha_id, event_id, revision, parent_revision, event_type, event_json, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(
			state.sabha.id,
			eventId,
			nextRevision,
			currentRevision,
			params.eventType,
			JSON.stringify(params.payload ?? {}),
			createdAt,
		);

		return {
			sabhaId: state.sabha.id,
			eventId,
			revision: nextRevision,
			parentRevision: currentRevision,
			eventType: params.eventType,
			createdAt,
			payload: params.payload ?? {},
		} satisfies SabhaEventRecord;
	});

	return run();
}

export function applyReplicatedSabhaState(
	state: PersistedSabhaState,
	params: {
		expectedRevision?: number | null;
		events?: SabhaEventRecord[];
	},
): ReplicatedSabhaApplyResult {
	const incomingHash = computePersistedSabhaSnapshotHash(state);
	const db = getDb();
	const run = db.transaction(() => {
		const row = db.prepare(
			`SELECT id, revision, sabha_json, client_bindings_json, mesh_bindings_json, dispatch_log_json, perspectives_json
			 FROM sabha_state
			 WHERE id = ?`,
		).get(state.sabha.id) as PersistedSabhaRow | undefined;
		const currentState = row ? rowToPersistedSabhaState(row) : null;
		const currentRevision = currentState?.revision ?? 0;
		const events = params.events ?? [];
		if (events.length > 0 && currentRevision > 0 && state.revision >= currentRevision) {
			const localEvents = listPersistedSabhaEvents(state.sabha.id);
			if (!localHistoryMatchesIncoming(localEvents, events, currentRevision)) {
				throw new Error(
					`Replicated Sabha history diverged for '${state.sabha.id}'; local history is not a prefix of the incoming oplog.`,
				);
			}
		}
		if (params.expectedRevision != null && currentRevision !== params.expectedRevision) {
			throw new Error(
				`Sabha revision mismatch for '${state.sabha.id}': expected ${params.expectedRevision}, got ${currentRevision}.`,
			);
		}
		if (currentRevision > state.revision) {
			throw new Error(
				`Refusing to apply older replicated Sabha state for '${state.sabha.id}': local revision ${currentRevision}, remote revision ${state.revision}.`,
			);
		}
		const currentHash = currentState ? computePersistedSabhaSnapshotHash(currentState) : null;
		if (currentRevision === state.revision && currentHash && currentHash !== incomingHash) {
			throw new Error(
				`Sabha snapshot mismatch for '${state.sabha.id}' at revision ${state.revision}.`,
			);
		}
		if (currentRevision < state.revision) {
			if (currentRevision > 0 && events.length === 0) {
				throw new Error(
					`Refusing to fast-forward Sabha '${state.sabha.id}' without oplog events from local revision ${currentRevision}.`,
				);
			}
		}
		if (currentRevision === state.revision && currentHash === incomingHash) {
			const insertedEvents = insertPersistedSabhaEvents(db, state.sabha.id, state.revision, events);
			return {
				applied: false,
				mode: "noop",
				currentRevision,
				snapshotHash: incomingHash,
				insertedEvents,
			} satisfies ReplicatedSabhaApplyResult;
		}

		upsertPersistedSabhaState(db, state, Date.now());
		const insertedEvents = insertPersistedSabhaEvents(db, state.sabha.id, state.revision, events);
		return {
			applied: true,
			mode: "snapshot",
			currentRevision: state.revision,
			snapshotHash: incomingHash,
			insertedEvents,
		} satisfies ReplicatedSabhaApplyResult;
	});

	return run();
}
