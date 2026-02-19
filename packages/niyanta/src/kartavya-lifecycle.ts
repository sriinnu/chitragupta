/**
 * Kartavya lifecycle — pause/resume/retire, queries, persistence, and stats.
 *
 * Stateless functions extracted from KartavyaEngine. Each function takes
 * the engine's internal maps as arguments (reference-passed for mutation).
 */

import type {
	Kartavya,
	KartavyaStatus,
	KartavyaTrigger,
	KartavyaAction,
	NiyamaProposal,
	DatabaseLike,
} from "./kartavya.js";

// ─── Lifecycle Control ───────────────────────────────────────────────────────

/** Pause an active kartavya. Throws if not found or not active. */
export function pauseKartavya(kartavyas: Map<string, Kartavya>, id: string): void {
	const k = kartavyas.get(id);
	if (!k) throw new Error(`Kartavya '${id}' not found`);
	if (k.status !== "active") throw new Error(`Cannot pause kartavya in '${k.status}' status`);
	k.status = "paused";
	k.updatedAt = Date.now();
}

/** Resume a paused kartavya. Throws if not found or not paused. */
export function resumeKartavya(kartavyas: Map<string, Kartavya>, id: string): void {
	const k = kartavyas.get(id);
	if (!k) throw new Error(`Kartavya '${id}' not found`);
	if (k.status !== "paused") throw new Error(`Cannot resume kartavya in '${k.status}' status`);
	k.status = "active";
	k.updatedAt = Date.now();
}

/** Retire a kartavya permanently. Throws if not found. */
export function retireKartavya(kartavyas: Map<string, Kartavya>, id: string): void {
	const k = kartavyas.get(id);
	if (!k) throw new Error(`Kartavya '${id}' not found`);
	k.status = "retired";
	k.updatedAt = Date.now();
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** List all active kartavyas, optionally filtered by project. */
export function listActiveKartavyas(kartavyas: ReadonlyMap<string, Kartavya>, project?: string): Kartavya[] {
	const all: Kartavya[] = [];
	for (const k of kartavyas.values()) {
		if (k.status !== "active") continue;
		if (project !== undefined && k.project !== project) continue;
		all.push(k);
	}
	return all;
}

/** List all kartavyas, optionally filtered by project. */
export function listAllKartavyas(kartavyas: ReadonlyMap<string, Kartavya>, project?: string): Kartavya[] {
	const all: Kartavya[] = [];
	for (const k of kartavyas.values()) {
		if (project !== undefined && k.project !== project) continue;
		all.push(k);
	}
	return all;
}

/** Get all pending niyama proposals. */
export function getPendingProposals(proposals: ReadonlyMap<string, NiyamaProposal>): NiyamaProposal[] {
	const pending: NiyamaProposal[] = [];
	for (const p of proposals.values()) {
		if (p.status === "pending") pending.push(p);
	}
	return pending;
}

/** Count currently active kartavyas. */
export function countActiveKartavyas(kartavyas: ReadonlyMap<string, Kartavya>): number {
	let count = 0;
	for (const k of kartavyas.values()) {
		if (k.status === "active") count++;
	}
	return count;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Persist all kartavyas and niyama proposals to a SQLite database.
 * Creates tables if they do not exist, then upserts all rows.
 */
export function persistEngine(
	db: DatabaseLike,
	kartavyas: ReadonlyMap<string, Kartavya>,
	proposals: ReadonlyMap<string, NiyamaProposal>,
): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS kartavyas (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT,
			status TEXT NOT NULL DEFAULT 'proposed',
			source_vasana_id TEXT,
			source_niyama_id TEXT,
			trigger_json TEXT NOT NULL,
			action_json TEXT NOT NULL,
			confidence REAL NOT NULL DEFAULT 0,
			success_count INTEGER NOT NULL DEFAULT 0,
			failure_count INTEGER NOT NULL DEFAULT 0,
			last_executed INTEGER,
			project TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
	`);

	db.exec(`
		CREATE TABLE IF NOT EXISTS niyama_proposals (
			id TEXT PRIMARY KEY,
			vasana_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT,
			trigger_json TEXT NOT NULL,
			action_json TEXT NOT NULL,
			confidence REAL NOT NULL,
			evidence_json TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			created_at INTEGER NOT NULL
		);
	`);

	const upsertKartavya = db.prepare(`
		INSERT OR REPLACE INTO kartavyas
			(id, name, description, status, source_vasana_id, source_niyama_id,
			 trigger_json, action_json, confidence, success_count, failure_count,
			 last_executed, project, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	for (const k of kartavyas.values()) {
		upsertKartavya.run(
			k.id, k.name, k.description, k.status,
			k.sourceVasanaId ?? null, k.sourceNiyamaId ?? null,
			JSON.stringify(k.trigger), JSON.stringify(k.action),
			k.confidence, k.successCount, k.failureCount,
			k.lastExecuted ?? null, k.project ?? null,
			k.createdAt, k.updatedAt,
		);
	}

	const upsertProposal = db.prepare(`
		INSERT OR REPLACE INTO niyama_proposals
			(id, vasana_id, name, description, trigger_json, action_json,
			 confidence, evidence_json, status, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	for (const p of proposals.values()) {
		upsertProposal.run(
			p.id, p.vasanaId, p.name, p.description,
			JSON.stringify(p.proposedTrigger), JSON.stringify(p.proposedAction),
			p.confidence, JSON.stringify(p.evidence),
			p.status, p.createdAt,
		);
	}
}

/**
 * Restore kartavyas and proposals from a SQLite database.
 * Clears existing maps and loads fresh data.
 */
export function restoreEngine(
	db: DatabaseLike,
	kartavyas: Map<string, Kartavya>,
	proposals: Map<string, NiyamaProposal>,
): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS kartavyas (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT,
			status TEXT NOT NULL DEFAULT 'proposed',
			source_vasana_id TEXT,
			source_niyama_id TEXT,
			trigger_json TEXT NOT NULL,
			action_json TEXT NOT NULL,
			confidence REAL NOT NULL DEFAULT 0,
			success_count INTEGER NOT NULL DEFAULT 0,
			failure_count INTEGER NOT NULL DEFAULT 0,
			last_executed INTEGER,
			project TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
	`);

	db.exec(`
		CREATE TABLE IF NOT EXISTS niyama_proposals (
			id TEXT PRIMARY KEY,
			vasana_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT,
			trigger_json TEXT NOT NULL,
			action_json TEXT NOT NULL,
			confidence REAL NOT NULL,
			evidence_json TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			created_at INTEGER NOT NULL
		);
	`);

	kartavyas.clear();
	proposals.clear();

	const kartavyaRows = db.prepare("SELECT * FROM kartavyas").all() as Array<Record<string, unknown>>;
	for (const row of kartavyaRows) {
		try {
			const k: Kartavya = {
				id: row.id as string,
				name: row.name as string,
				description: (row.description as string) ?? "",
				status: row.status as KartavyaStatus,
				sourceVasanaId: row.source_vasana_id as string | undefined,
				sourceNiyamaId: row.source_niyama_id as string | undefined,
				trigger: JSON.parse(row.trigger_json as string) as KartavyaTrigger,
				action: JSON.parse(row.action_json as string) as KartavyaAction,
				confidence: row.confidence as number,
				successCount: row.success_count as number,
				failureCount: row.failure_count as number,
				lastExecuted: row.last_executed as number | undefined,
				project: row.project as string | undefined,
				createdAt: row.created_at as number,
				updatedAt: row.updated_at as number,
			};
			kartavyas.set(k.id, k);
		} catch {
			// Skip corrupted kartavya row
		}
	}

	const proposalRows = db.prepare("SELECT * FROM niyama_proposals").all() as Array<Record<string, unknown>>;
	for (const row of proposalRows) {
		try {
			const p: NiyamaProposal = {
				id: row.id as string,
				vasanaId: row.vasana_id as string,
				name: row.name as string,
				description: (row.description as string) ?? "",
				proposedTrigger: JSON.parse(row.trigger_json as string) as KartavyaTrigger,
				proposedAction: JSON.parse(row.action_json as string) as KartavyaAction,
				confidence: row.confidence as number,
				evidence: JSON.parse((row.evidence_json as string) ?? "[]") as string[],
				status: row.status as NiyamaProposal["status"],
				createdAt: row.created_at as number,
			};
			proposals.set(p.id, p);
		} catch {
			// Skip corrupted proposal row
		}
	}
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/** Aggregate engine statistics result. */
export interface EngineStats {
	total: number;
	active: number;
	paused: number;
	proposed: number;
	successRate: number;
	executionsThisHour: number;
}

/**
 * Compute aggregate statistics about the kartavya engine.
 * Also prunes the execution log as a side effect.
 */
export function computeEngineStats(
	kartavyas: ReadonlyMap<string, Kartavya>,
	proposals: ReadonlyMap<string, NiyamaProposal>,
	executionLog: number[],
): EngineStats {
	let total = 0;
	let active = 0;
	let paused = 0;
	let totalSuccess = 0;
	let totalExec = 0;

	for (const k of kartavyas.values()) {
		total++;
		if (k.status === "active") active++;
		if (k.status === "paused") paused++;
		totalSuccess += k.successCount;
		totalExec += k.successCount + k.failureCount;
	}

	const proposed = getPendingProposals(proposals).length;
	const successRate = totalExec > 0 ? totalSuccess / totalExec : 0;

	// Prune stale entries
	const now = Date.now();
	const oneHourAgo = now - 3_600_000;
	while (executionLog.length > 0 && executionLog[0] < oneHourAgo) {
		executionLog.shift();
	}

	return { total, active, paused, proposed, successRate, executionsThisHour: executionLog.length };
}
