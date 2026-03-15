import { getAgentDb } from "./session-db.js";
import type { ResearchRefinementBudgetOverride } from "./semantic-refinement-policy.js";
import type { ResearchNidraBudgetOverride } from "./research-refinement-budget.js";

/** Exact deferred repair intent captured from the failed immediate repair path. */
export interface ResearchRefinementRepairIntent {
	daily?: Record<string, unknown> | null;
	project?: Record<string, unknown> | null;
}

/**
 * Canonical project/session scope for deferred research semantic refinement.
 *
 * I keep this intentionally narrow: dates and periods are recomputed from the
 * research ledger when the daemon drains the queue, so the durable payload only
 * needs the project plus optional lineage identifiers.
 */
export interface ResearchRefinementQueuedScope {
	id: string;
	scopeKey: string;
	label: string;
	projectPath: string;
	sessionIds: string[];
	sessionLineageKeys: string[];
	policyFingerprints?: string[];
	primaryObjectiveIds?: string[];
	primaryStopConditionIds?: string[];
	primaryStopConditionKinds?: string[];
	frontierBestScore?: number | null;
	refinementBudget?: ResearchRefinementBudgetOverride | null;
	nidraBudget?: ResearchNidraBudgetOverride | null;
	repairIntent?: ResearchRefinementRepairIntent | null;
	parseError?: string | null;
	attemptCount: number;
	nextAttemptAt: number;
	lastError: string | null;
	createdAt: number;
	updatedAt: number;
}

function normalizeTextList(values: readonly string[] | undefined): string[] {
	return [...new Set((values ?? [])
		.map((value) => value.trim())
		.filter((value) => value.length > 0))]
		.sort();
}

function normalizeFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function takeWiderCap(left: number | undefined, right: number | undefined): number | undefined {
	if (typeof left === "number" && typeof right === "number") return Math.max(left, right);
	return typeof left === "number" ? left : right;
}

function takeWiderFloor(left: number | undefined, right: number | undefined): number | undefined {
	if (typeof left === "number" && typeof right === "number") return Math.min(left, right);
	return typeof left === "number" ? left : right;
}

/**
 * Preserve the widest already-authorized repair envelope when the same queued
 * scope is upserted repeatedly from immediate and deferred daemon paths.
 */
function mergeRefinementBudget(
	existing: ResearchRefinementBudgetOverride | null | undefined,
	next: ResearchRefinementBudgetOverride | null | undefined,
): ResearchRefinementBudgetOverride | null {
	const merged: ResearchRefinementBudgetOverride = {
		dailyCandidateLimit: takeWiderCap(existing?.dailyCandidateLimit, next?.dailyCandidateLimit),
		projectCandidateLimit: takeWiderCap(existing?.projectCandidateLimit, next?.projectCandidateLimit),
		dailyMinMdlScore: takeWiderFloor(existing?.dailyMinMdlScore, next?.dailyMinMdlScore),
		projectMinMdlScore: takeWiderFloor(existing?.projectMinMdlScore, next?.projectMinMdlScore),
		dailyMinPriorityScore: takeWiderFloor(existing?.dailyMinPriorityScore, next?.dailyMinPriorityScore),
		projectMinPriorityScore: takeWiderFloor(existing?.projectMinPriorityScore, next?.projectMinPriorityScore),
		dailyMinSourceSessionCount: takeWiderFloor(
			existing?.dailyMinSourceSessionCount,
			next?.dailyMinSourceSessionCount,
		),
		projectMinSourceSessionCount: takeWiderFloor(
			existing?.projectMinSourceSessionCount,
			next?.projectMinSourceSessionCount,
		),
	};
	return Object.values(merged).some((value) => typeof value === "number") ? merged : null;
}

/** Keep the broadest Nidra breadth cap already granted to one queued scope. */
function mergeNidraBudget(
	existing: ResearchNidraBudgetOverride | null | undefined,
	next: ResearchNidraBudgetOverride | null | undefined,
): ResearchNidraBudgetOverride | null {
	const merged: ResearchNidraBudgetOverride = {
		maxResearchProjectsPerCycle: takeWiderCap(
			existing?.maxResearchProjectsPerCycle,
			next?.maxResearchProjectsPerCycle,
		),
		maxSemanticPressure: takeWiderCap(existing?.maxSemanticPressure, next?.maxSemanticPressure),
	};
	return Object.values(merged).some((value) => typeof value === "number") ? merged : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((entry) => cloneJsonValue(entry));
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]),
	);
}

function mergeJsonValue(existing: unknown, next: unknown): unknown {
	if (Array.isArray(existing) && Array.isArray(next)) {
		const merged: unknown[] = [];
		const seen = new Set<string>();
		for (const entry of [...existing, ...next]) {
			const cloned = cloneJsonValue(entry);
			const key = JSON.stringify(cloned);
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(cloned);
		}
		return merged;
	}
	if (isRecord(existing) && isRecord(next)) {
		const keys = new Set([...Object.keys(existing), ...Object.keys(next)]);
		const merged: Record<string, unknown> = {};
		for (const key of keys) {
			merged[key] = mergeJsonValue(existing[key], next[key]);
		}
		return merged;
	}
	if (next === undefined) return cloneJsonValue(existing);
	if (next === null && existing !== undefined) return cloneJsonValue(existing);
	return cloneJsonValue(next);
}

/** Preserve every known exact repair frontier for one queued project scope. */
function mergeRepairIntent(
	existing: ResearchRefinementRepairIntent | null | undefined,
	next: ResearchRefinementRepairIntent | null | undefined,
): ResearchRefinementRepairIntent | null {
	const daily = mergeJsonValue(existing?.daily, next?.daily);
	const project = mergeJsonValue(existing?.project, next?.project);
	if (!isRecord(daily) && !isRecord(project)) return null;
	return {
		daily: isRecord(daily) ? daily : null,
		project: isRecord(project) ? project : null,
	};
}

function normalizeQueuedScopeInput(args: {
	label: string;
	projectPath: string;
	sessionIds?: readonly string[];
	sessionLineageKeys?: readonly string[];
	policyFingerprints?: readonly string[];
	primaryObjectiveIds?: readonly string[];
	primaryStopConditionIds?: readonly string[];
	primaryStopConditionKinds?: readonly string[];
	frontierBestScore?: number | null;
	refinementBudget?: ResearchRefinementBudgetOverride | null;
	nidraBudget?: ResearchNidraBudgetOverride | null;
	repairIntent?: ResearchRefinementRepairIntent | null;
}) {
	const projectPath = args.projectPath.trim();
	return {
		label: args.label.trim() || "research-refinement",
		projectPath,
		sessionIds: normalizeTextList(args.sessionIds),
		sessionLineageKeys: normalizeTextList(args.sessionLineageKeys),
		policyFingerprints: normalizeTextList(args.policyFingerprints),
		primaryObjectiveIds: normalizeTextList(args.primaryObjectiveIds),
		primaryStopConditionIds: normalizeTextList(args.primaryStopConditionIds),
		primaryStopConditionKinds: normalizeTextList(args.primaryStopConditionKinds),
		frontierBestScore: normalizeFiniteNumber(args.frontierBestScore),
		refinementBudget:
			args.refinementBudget && typeof args.refinementBudget === "object" && !Array.isArray(args.refinementBudget)
				? cloneJsonValue(args.refinementBudget) as ResearchRefinementBudgetOverride
				: undefined,
		nidraBudget:
			args.nidraBudget && typeof args.nidraBudget === "object" && !Array.isArray(args.nidraBudget)
				? cloneJsonValue(args.nidraBudget) as ResearchNidraBudgetOverride
				: undefined,
		repairIntent:
			args.repairIntent && typeof args.repairIntent === "object"
				? {
					daily:
						args.repairIntent.daily && typeof args.repairIntent.daily === "object" && !Array.isArray(args.repairIntent.daily)
							? args.repairIntent.daily
							: undefined,
					project:
						args.repairIntent.project && typeof args.repairIntent.project === "object" && !Array.isArray(args.repairIntent.project)
							? args.repairIntent.project
							: undefined,
				}
				: undefined,
	};
}

function buildScopeKey(scope: ReturnType<typeof normalizeQueuedScopeInput>): string {
	return JSON.stringify({
		projectPath: scope.projectPath,
		sessionIds: scope.sessionIds,
		sessionLineageKeys: scope.sessionLineageKeys,
	});
}

function selectQueuedScopeRow(scopeKey: string): {
	id: string;
	scope_key: string;
	label: string;
	project: string;
	scope_json: string;
	attempt_count: number;
	next_attempt_at: number;
	last_error: string | null;
	created_at: number;
	updated_at: number;
} | null {
	const db = getAgentDb();
	return db.prepare(`
		SELECT id, scope_key, label, project, scope_json, attempt_count, next_attempt_at, last_error, created_at, updated_at
		FROM research_refinement_queue
		WHERE scope_key = ?
		LIMIT 1
	`).get(scopeKey) as {
		id: string;
		scope_key: string;
		label: string;
		project: string;
		scope_json: string;
		attempt_count: number;
		next_attempt_at: number;
		last_error: string | null;
		created_at: number;
		updated_at: number;
	} | null;
}

function parseQueuedScopeRow(row: {
	id: string;
	scope_key: string;
	label: string;
	project: string;
	scope_json: string;
	attempt_count: number;
	next_attempt_at: number;
	last_error: string | null;
	created_at: number;
	updated_at: number;
}): ResearchRefinementQueuedScope {
	let parsed: {
		sessionIds?: string[];
		sessionLineageKeys?: string[];
		policyFingerprints?: string[];
		primaryObjectiveIds?: string[];
		primaryStopConditionIds?: string[];
		primaryStopConditionKinds?: string[];
		frontierBestScore?: number | null;
		refinementBudget?: ResearchRefinementBudgetOverride | null;
		nidraBudget?: ResearchNidraBudgetOverride | null;
		repairIntent?: ResearchRefinementRepairIntent | null;
	} = {};
	let parseError: string | null = null;
	try {
		parsed = JSON.parse(row.scope_json) as typeof parsed;
	} catch (error) {
		parseError = error instanceof Error ? error.message : String(error);
	}
	return {
		id: row.id,
		scopeKey: row.scope_key,
		label: row.label,
		projectPath: row.project,
		sessionIds: normalizeTextList(parsed.sessionIds),
		sessionLineageKeys: normalizeTextList(parsed.sessionLineageKeys),
		policyFingerprints: normalizeTextList(parsed.policyFingerprints),
		primaryObjectiveIds: normalizeTextList(parsed.primaryObjectiveIds),
		primaryStopConditionIds: normalizeTextList(parsed.primaryStopConditionIds),
		primaryStopConditionKinds: normalizeTextList(parsed.primaryStopConditionKinds),
		frontierBestScore: normalizeFiniteNumber(parsed.frontierBestScore) ?? null,
		refinementBudget:
			parsed.refinementBudget && typeof parsed.refinementBudget === "object" && !Array.isArray(parsed.refinementBudget)
				? parsed.refinementBudget
				: null,
		nidraBudget:
			parsed.nidraBudget && typeof parsed.nidraBudget === "object" && !Array.isArray(parsed.nidraBudget)
				? parsed.nidraBudget
				: null,
		repairIntent:
			parsed.repairIntent && typeof parsed.repairIntent === "object"
				? {
					daily:
						parsed.repairIntent.daily && typeof parsed.repairIntent.daily === "object" && !Array.isArray(parsed.repairIntent.daily)
							? parsed.repairIntent.daily
							: null,
					project:
						parsed.repairIntent.project && typeof parsed.repairIntent.project === "object" && !Array.isArray(parsed.repairIntent.project)
							? parsed.repairIntent.project
							: null,
					}
					: null,
		parseError,
		attemptCount: row.attempt_count,
		nextAttemptAt: row.next_attempt_at,
		lastError: row.last_error,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/**
 * Queue one or more research refinement scopes for a later daemon-owned retry.
 *
 * I upsert by normalized scope identity so repeated degraded repairs widen the
 * same durable queue entry instead of appending unbounded duplicates.
 */
export function upsertResearchRefinementQueue(
	scopes: Array<{
		label: string;
		projectPath: string;
		sessionIds?: readonly string[];
		sessionLineageKeys?: readonly string[];
		policyFingerprints?: readonly string[];
		primaryObjectiveIds?: readonly string[];
		primaryStopConditionIds?: readonly string[];
		primaryStopConditionKinds?: readonly string[];
		frontierBestScore?: number | null;
		refinementBudget?: ResearchRefinementBudgetOverride | null;
		nidraBudget?: ResearchNidraBudgetOverride | null;
		repairIntent?: ResearchRefinementRepairIntent | null;
	}>,
	options: { notBefore?: number; lastError?: string | null } = {},
): number {
	const db = getAgentDb();
	const now = Date.now();
	const nextAttemptAt = options.notBefore ?? now;
	const insert = db.prepare(`
			INSERT INTO research_refinement_queue (
				id,
				scope_key,
			label,
			project,
			scope_json,
			attempt_count,
			next_attempt_at,
			last_error,
			created_at,
			updated_at
			)
			VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
		`);
	const update = db.prepare(`
		UPDATE research_refinement_queue
		SET label = ?,
			project = ?,
			scope_json = ?,
			next_attempt_at = ?,
			last_error = ?,
			updated_at = ?
		WHERE scope_key = ?
	`);
	let queued = 0;
	for (const rawScope of scopes) {
		const scope = normalizeQueuedScopeInput(rawScope);
		if (!scope.projectPath) continue;
		const scopeKey = buildScopeKey(scope);
		const existingRow = selectQueuedScopeRow(scopeKey);
		if (!existingRow) {
			insert.run(
				scopeKey,
				scopeKey,
				scope.label,
				scope.projectPath,
					JSON.stringify({
						sessionIds: scope.sessionIds,
						sessionLineageKeys: scope.sessionLineageKeys,
						policyFingerprints: scope.policyFingerprints,
						primaryObjectiveIds: scope.primaryObjectiveIds,
						primaryStopConditionIds: scope.primaryStopConditionIds,
						primaryStopConditionKinds: scope.primaryStopConditionKinds,
						frontierBestScore: scope.frontierBestScore ?? null,
						refinementBudget: scope.refinementBudget ?? null,
						nidraBudget: scope.nidraBudget ?? null,
						repairIntent: scope.repairIntent ?? null,
					}),
				nextAttemptAt,
				options.lastError ?? null,
				now,
				now,
			);
			queued += 1;
			continue;
		}
		const existing = parseQueuedScopeRow(existingRow);
		update.run(
			scope.label || existing.label,
			scope.projectPath,
				JSON.stringify({
					sessionIds: normalizeTextList([...existing.sessionIds, ...scope.sessionIds]),
					sessionLineageKeys: normalizeTextList([...existing.sessionLineageKeys, ...scope.sessionLineageKeys]),
					policyFingerprints: normalizeTextList([...(existing.policyFingerprints ?? []), ...scope.policyFingerprints]),
					primaryObjectiveIds: normalizeTextList([...(existing.primaryObjectiveIds ?? []), ...scope.primaryObjectiveIds]),
					primaryStopConditionIds: normalizeTextList([...(existing.primaryStopConditionIds ?? []), ...scope.primaryStopConditionIds]),
					primaryStopConditionKinds: normalizeTextList([...(existing.primaryStopConditionKinds ?? []), ...scope.primaryStopConditionKinds]),
					frontierBestScore:
						Math.max(existing.frontierBestScore ?? Number.NEGATIVE_INFINITY, scope.frontierBestScore ?? Number.NEGATIVE_INFINITY) > Number.NEGATIVE_INFINITY
							? Math.max(existing.frontierBestScore ?? Number.NEGATIVE_INFINITY, scope.frontierBestScore ?? Number.NEGATIVE_INFINITY)
							: null,
					refinementBudget: mergeRefinementBudget(existing.refinementBudget, scope.refinementBudget),
					nidraBudget: mergeNidraBudget(existing.nidraBudget, scope.nidraBudget),
					repairIntent: mergeRepairIntent(existing.repairIntent, scope.repairIntent),
				}),
			Math.min(existing.nextAttemptAt, nextAttemptAt),
			options.lastError ?? existing.lastError,
			now,
			scopeKey,
		);
		queued += 1;
	}
	return queued;
}

/**
 * List due refinement scopes in the order the daemon should retry them.
 */
export function listQueuedResearchRefinementScopes(
	options: { limit?: number; now?: number } = {},
): ResearchRefinementQueuedScope[] {
	const db = getAgentDb();
	const limit = Math.max(1, Math.floor(options.limit ?? 25));
	const now = options.now ?? Date.now();
	const rows = db.prepare(`
		SELECT id, scope_key, label, project, scope_json, attempt_count, next_attempt_at, last_error, created_at, updated_at
		FROM research_refinement_queue
		WHERE next_attempt_at <= ?
		ORDER BY next_attempt_at ASC, updated_at ASC
		LIMIT ?
	`).all(now, limit) as Array<{
		id: string;
		scope_key: string;
		label: string;
		project: string;
		scope_json: string;
		attempt_count: number;
		next_attempt_at: number;
		last_error: string | null;
		created_at: number;
		updated_at: number;
	}>;
	return rows.map(parseQueuedScopeRow);
}

/**
 * Count due queued refinement scopes without draining them.
 *
 * I use this when the daemon's current cycle budget is zero but remote-sync
 * gating still needs truthful backlog visibility.
 */
export function countQueuedResearchRefinementScopes(options: { now?: number } = {}): number {
	const db = getAgentDb();
	const now = options.now ?? Date.now();
	const row = db.prepare(`
		SELECT COUNT(*) as count
		FROM research_refinement_queue
		WHERE next_attempt_at <= ?
	`).get(now) as { count: number } | undefined;
	return typeof row?.count === "number" && Number.isFinite(row.count) ? row.count : 0;
}

/**
 * Mark a queued scope as deferred again with bounded retry backoff.
 */
export function deferQueuedResearchRefinementScope(
	id: string,
	options: { backoffMs?: number; lastError?: string | null } = {},
): void {
	const db = getAgentDb();
	const now = Date.now();
	db.prepare(`
		UPDATE research_refinement_queue
		SET attempt_count = attempt_count + 1,
			next_attempt_at = ?,
			last_error = ?,
			updated_at = ?
		WHERE id = ?
	`).run(
		now + Math.max(options.backoffMs ?? 5 * 60 * 1000, 1000),
		options.lastError ?? null,
		now,
		id,
	);
}

/**
 * Remove a queued refinement scope once the daemon has fully repaired it.
 */
export function clearQueuedResearchRefinementScope(id: string): void {
	const db = getAgentDb();
	db.prepare("DELETE FROM research_refinement_queue WHERE id = ?").run(id);
}
