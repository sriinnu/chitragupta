import crypto from "node:crypto";
import path from "node:path";
import { getAgentDb } from "./session-db.js";

const RESEARCH_LOOP_SCHEDULE_PREFIX = "research_loop_schedule:";
const DEFAULT_RESEARCH_LOOP_LEASE_TTL_MS = 90_000;
const DEFAULT_RESEARCH_LOOP_LIST_LIMIT = 100;
const MAX_RESEARCH_LOOP_LIST_LIMIT = 200;

export type ResearchLoopScheduleStatus =
	| "queued"
	| "leased"
	| "cancelling"
	| "cancelled"
	| "completed"
	| "failed";

export interface ResearchLoopScheduleState {
	projectPath: string;
	loopKey: string;
	topic: string | null;
	hypothesis: string | null;
	sessionId: string | null;
	parentSessionId: string | null;
	sessionLineageKey: string | null;
	sabhaId: string | null;
	workflowId: string | null;
	status: ResearchLoopScheduleStatus;
	queuedAt: number;
	availableAt: number;
	updatedAt: number;
	leaseOwner: string | null;
	leaseExpiresAt: number | null;
	leaseHeartbeatAt: number | null;
	currentRound: number | null;
	totalRounds: number | null;
	attemptNumber: number | null;
	phase: string | null;
	cancelRequestedAt: number | null;
	cancelReason: string | null;
	requestedBy: string | null;
	stopReason: string | null;
	finishedAt: number | null;
	objectives: Array<Record<string, unknown>>;
	stopConditions: Array<Record<string, unknown>>;
	updateBudgets: Record<string, unknown> | null;
	policyFingerprint: string | null;
	primaryObjectiveId: string | null;
	primaryStopConditionId: string | null;
	workflowContext: Record<string, unknown> | null;
	parseError?: string | null;
}

export interface ResearchLoopScheduleUpsertInput {
	projectPath: string;
	loopKey: string;
	topic?: string | null;
	hypothesis?: string | null;
	sessionId?: string | null;
	parentSessionId?: string | null;
	sessionLineageKey?: string | null;
	sabhaId?: string | null;
	workflowId?: string | null;
	status?: ResearchLoopScheduleStatus;
	availableAt?: number | null;
	currentRound?: number | null;
	totalRounds?: number | null;
	attemptNumber?: number | null;
	phase?: string | null;
	objectives?: unknown;
	stopConditions?: unknown;
	updateBudgets?: unknown;
	policyFingerprint?: string | null;
	primaryObjectiveId?: string | null;
	primaryStopConditionId?: string | null;
	workflowContext?: unknown;
}

export interface ListResearchLoopSchedulesOptions {
	projectPath?: string;
	status?: ResearchLoopScheduleStatus | ResearchLoopScheduleStatus[];
	runnableOnly?: boolean;
	limit?: number;
	now?: number;
}

export interface ResearchLoopLeaseUpdateInput {
	projectPath: string;
	loopKey: string;
	leaseOwner: string;
	leaseTtlMs?: number;
	now?: number;
	currentRound?: number | null;
	totalRounds?: number | null;
	attemptNumber?: number | null;
	phase?: string | null;
}

function normalizeProjectPath(projectPath: string): string {
	return path.normalize(path.resolve(projectPath.trim()));
}

function buildScheduleName(projectPath: string, loopKey: string): string {
	const normalizedProjectPath = normalizeProjectPath(projectPath);
	const digest = crypto.createHash("sha1").update(`${normalizedProjectPath}\u0000${loopKey}`).digest("hex");
	return `${RESEARCH_LOOP_SCHEDULE_PREFIX}${digest}`;
}

function normalizeNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNullableNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeArrayOfRecords(value: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
	);
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? { ...(value as Record<string, unknown>) }
		: null;
}

function normalizeScheduleStatus(value: unknown): ResearchLoopScheduleStatus {
	switch (value) {
		case "leased":
		case "cancelling":
		case "cancelled":
		case "completed":
		case "failed":
			return value;
		default:
			return "queued";
	}
}

function normalizeListLimit(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_RESEARCH_LOOP_LIST_LIMIT;
	return Math.max(1, Math.min(MAX_RESEARCH_LOOP_LIST_LIMIT, Math.floor(value)));
}

function parseStoredSchedule(valueJson: string): ResearchLoopScheduleState | null {
	try {
		const parsed = JSON.parse(valueJson) as Partial<ResearchLoopScheduleState>;
		const projectPath = normalizeNullableString(parsed.projectPath);
		const loopKey = normalizeNullableString(parsed.loopKey);
		if (!projectPath || !loopKey) return null;
		return {
			projectPath: normalizeProjectPath(projectPath),
			loopKey,
			topic: normalizeNullableString(parsed.topic),
			hypothesis: normalizeNullableString(parsed.hypothesis),
			sessionId: normalizeNullableString(parsed.sessionId),
			parentSessionId: normalizeNullableString(parsed.parentSessionId),
			sessionLineageKey: normalizeNullableString(parsed.sessionLineageKey),
			sabhaId: normalizeNullableString(parsed.sabhaId),
			workflowId: normalizeNullableString(parsed.workflowId),
			status: normalizeScheduleStatus(parsed.status),
			queuedAt: normalizeNullableNumber(parsed.queuedAt) ?? Date.now(),
			availableAt: normalizeNullableNumber(parsed.availableAt) ?? Date.now(),
			updatedAt: normalizeNullableNumber(parsed.updatedAt) ?? Date.now(),
			leaseOwner: normalizeNullableString(parsed.leaseOwner),
			leaseExpiresAt: normalizeNullableNumber(parsed.leaseExpiresAt),
			leaseHeartbeatAt: normalizeNullableNumber(parsed.leaseHeartbeatAt),
			currentRound: normalizeNullableNumber(parsed.currentRound),
			totalRounds: normalizeNullableNumber(parsed.totalRounds),
			attemptNumber: normalizeNullableNumber(parsed.attemptNumber),
			phase: normalizeNullableString(parsed.phase),
			cancelRequestedAt: normalizeNullableNumber(parsed.cancelRequestedAt),
			cancelReason: normalizeNullableString(parsed.cancelReason),
			requestedBy: normalizeNullableString(parsed.requestedBy),
			stopReason: normalizeNullableString(parsed.stopReason),
			finishedAt: normalizeNullableNumber(parsed.finishedAt),
				objectives: normalizeArrayOfRecords(parsed.objectives),
				stopConditions: normalizeArrayOfRecords(parsed.stopConditions),
				updateBudgets: normalizeRecord(parsed.updateBudgets),
				policyFingerprint: normalizeNullableString(parsed.policyFingerprint),
				primaryObjectiveId: normalizeNullableString(parsed.primaryObjectiveId),
				primaryStopConditionId: normalizeNullableString(parsed.primaryStopConditionId),
				workflowContext: normalizeRecord(parsed.workflowContext),
				parseError: null,
			};
	} catch (error) {
		return {
			projectPath: "",
			loopKey: "",
			topic: null,
			hypothesis: null,
			sessionId: null,
			parentSessionId: null,
			sessionLineageKey: null,
			sabhaId: null,
			workflowId: null,
			status: "failed",
			queuedAt: Date.now(),
			availableAt: Date.now(),
			updatedAt: Date.now(),
			leaseOwner: null,
			leaseExpiresAt: null,
			leaseHeartbeatAt: null,
			currentRound: null,
			totalRounds: null,
			attemptNumber: null,
			phase: null,
			cancelRequestedAt: null,
			cancelReason: null,
			requestedBy: null,
			stopReason: null,
			finishedAt: null,
					objectives: [],
					stopConditions: [],
					updateBudgets: null,
					policyFingerprint: null,
					primaryObjectiveId: null,
					primaryStopConditionId: null,
					workflowContext: null,
					parseError: error instanceof Error ? error.message : "invalid research loop schedule",
				};
	}
}

function writeScheduleState(state: ResearchLoopScheduleState): ResearchLoopScheduleState {
	const db = getAgentDb();
	const name = buildScheduleName(state.projectPath, state.loopKey);
	db.prepare(`
		INSERT INTO semantic_runtime_state (name, value_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET
			value_json = excluded.value_json,
			updated_at = excluded.updated_at
	`).run(name, JSON.stringify(state), state.updatedAt);
	return state;
}

function isTerminalScheduleStatus(status: ResearchLoopScheduleStatus): boolean {
	return status === "completed" || status === "cancelled" || status === "failed";
}

function isLeaseActive(state: ResearchLoopScheduleState, now: number, owner: string | null = null): boolean {
	if (!state.leaseOwner || typeof state.leaseExpiresAt !== "number") return false;
	if (state.leaseExpiresAt <= now) return false;
	return owner == null ? true : state.leaseOwner === owner;
}

/** Read one persisted daemon-owned research-loop schedule row. */
export function getResearchLoopSchedule(projectPath: string, loopKey: string): ResearchLoopScheduleState | null {
	const db = getAgentDb();
	const row = db.prepare(
		"SELECT value_json FROM semantic_runtime_state WHERE name = ?",
	).get(buildScheduleName(projectPath, loopKey)) as { value_json: string } | undefined;
	if (!row?.value_json) return null;
	const parsed = parseStoredSchedule(row.value_json);
	return parsed && parsed.projectPath && parsed.loopKey ? parsed : null;
}

/** Insert or update one logical daemon-owned research schedule row. */
export function upsertResearchLoopSchedule(input: ResearchLoopScheduleUpsertInput): ResearchLoopScheduleState {
	const now = Date.now();
	const projectPath = normalizeProjectPath(input.projectPath);
	const loopKey = input.loopKey.trim();
	const existing = getResearchLoopSchedule(projectPath, loopKey);
	const status = input.status ?? existing?.status ?? "queued";
	return writeScheduleState({
		projectPath,
		loopKey,
		topic: normalizeNullableString(input.topic) ?? existing?.topic ?? null,
		hypothesis: normalizeNullableString(input.hypothesis) ?? existing?.hypothesis ?? null,
		sessionId: normalizeNullableString(input.sessionId) ?? existing?.sessionId ?? null,
		parentSessionId: normalizeNullableString(input.parentSessionId) ?? existing?.parentSessionId ?? null,
		sessionLineageKey: normalizeNullableString(input.sessionLineageKey) ?? existing?.sessionLineageKey ?? null,
		sabhaId: normalizeNullableString(input.sabhaId) ?? existing?.sabhaId ?? null,
		workflowId: normalizeNullableString(input.workflowId) ?? existing?.workflowId ?? null,
		status,
		queuedAt: existing?.queuedAt ?? now,
		availableAt: normalizeNullableNumber(input.availableAt) ?? existing?.availableAt ?? now,
		updatedAt: now,
		leaseOwner: status === "queued" ? null : existing?.leaseOwner ?? null,
		leaseExpiresAt: status === "queued" ? null : existing?.leaseExpiresAt ?? null,
		leaseHeartbeatAt: status === "queued" ? null : existing?.leaseHeartbeatAt ?? null,
		currentRound: normalizeNullableNumber(input.currentRound) ?? existing?.currentRound ?? null,
		totalRounds: normalizeNullableNumber(input.totalRounds) ?? existing?.totalRounds ?? null,
		attemptNumber: normalizeNullableNumber(input.attemptNumber) ?? existing?.attemptNumber ?? null,
		phase: normalizeNullableString(input.phase) ?? existing?.phase ?? null,
		cancelRequestedAt: existing?.cancelRequestedAt ?? null,
		cancelReason: existing?.cancelReason ?? null,
		requestedBy: existing?.requestedBy ?? null,
		stopReason: isTerminalScheduleStatus(status) ? existing?.stopReason ?? null : null,
		finishedAt: isTerminalScheduleStatus(status) ? existing?.finishedAt ?? now : null,
			objectives: normalizeArrayOfRecords(input.objectives).length > 0
				? normalizeArrayOfRecords(input.objectives)
				: existing?.objectives ?? [],
			stopConditions: normalizeArrayOfRecords(input.stopConditions).length > 0
				? normalizeArrayOfRecords(input.stopConditions)
				: existing?.stopConditions ?? [],
			updateBudgets: normalizeRecord(input.updateBudgets) ?? existing?.updateBudgets ?? null,
			policyFingerprint: normalizeNullableString(input.policyFingerprint) ?? existing?.policyFingerprint ?? null,
			primaryObjectiveId: normalizeNullableString(input.primaryObjectiveId) ?? existing?.primaryObjectiveId ?? null,
			primaryStopConditionId: normalizeNullableString(input.primaryStopConditionId) ?? existing?.primaryStopConditionId ?? null,
			workflowContext: normalizeRecord(input.workflowContext) ?? existing?.workflowContext ?? null,
			parseError: null,
		});
}

/** List persisted schedules for operator inspection or daemon dispatch. */
export function listResearchLoopSchedules(
	options: ListResearchLoopSchedulesOptions = {},
): ResearchLoopScheduleState[] {
	const db = getAgentDb();
	const rows = db.prepare(`
		SELECT value_json
		FROM semantic_runtime_state
		WHERE name LIKE ?
		ORDER BY updated_at DESC
		LIMIT ?
	`).all(`${RESEARCH_LOOP_SCHEDULE_PREFIX}%`, normalizeListLimit(options.limit) * 4) as Array<{ value_json: string }>;
	const now = typeof options.now === "number" ? options.now : Date.now();
	const allowedStatuses = Array.isArray(options.status)
		? new Set(options.status)
		: options.status
			? new Set([options.status])
			: null;
	const projectPath = options.projectPath ? normalizeProjectPath(options.projectPath) : null;
	return rows
		.map((row) => parseStoredSchedule(row.value_json))
		.filter((entry): entry is ResearchLoopScheduleState => Boolean(entry?.projectPath && entry.loopKey))
		.filter((entry) => !projectPath || entry.projectPath === projectPath)
		.filter((entry) => !allowedStatuses || allowedStatuses.has(entry.status))
		.filter((entry) => !options.runnableOnly || (
			(entry.status === "queued" || entry.status === "leased" || entry.status === "cancelling")
			&& !isTerminalScheduleStatus(entry.status)
			&& entry.availableAt <= now
			&& (entry.status === "queued" || !isLeaseActive(entry, now))
		))
		.sort((left, right) => left.availableAt - right.availableAt || right.updatedAt - left.updatedAt)
		.slice(0, normalizeListLimit(options.limit));
}

/** Claim or refresh the worker lease for one scheduled loop. */
export function claimResearchLoopSchedule(
	input: ResearchLoopLeaseUpdateInput,
): { claimed: boolean; schedule: ResearchLoopScheduleState | null } {
	const projectPath = normalizeProjectPath(input.projectPath);
	const existing = getResearchLoopSchedule(projectPath, input.loopKey);
	if (!existing || isTerminalScheduleStatus(existing.status)) {
		return { claimed: false, schedule: existing };
	}
	const now = typeof input.now === "number" ? input.now : Date.now();
	if ((existing.status === "queued" || existing.status === "cancelling") && existing.availableAt > now) {
		return { claimed: false, schedule: existing };
	}
	if (isLeaseActive(existing, now, input.leaseOwner)) {
		const updated = writeScheduleState({
			...existing,
			status: existing.cancelRequestedAt ? "cancelling" : "leased",
			leaseHeartbeatAt: now,
			leaseExpiresAt: now + Math.max(input.leaseTtlMs ?? DEFAULT_RESEARCH_LOOP_LEASE_TTL_MS, 5_000),
			currentRound: normalizeNullableNumber(input.currentRound) ?? existing.currentRound,
			totalRounds: normalizeNullableNumber(input.totalRounds) ?? existing.totalRounds,
			attemptNumber: normalizeNullableNumber(input.attemptNumber) ?? existing.attemptNumber,
			phase: normalizeNullableString(input.phase) ?? existing.phase,
			updatedAt: now,
		});
		return { claimed: true, schedule: updated };
	}
	if (isLeaseActive(existing, now) && existing.leaseOwner !== input.leaseOwner) {
		return { claimed: false, schedule: existing };
	}
	const updated = writeScheduleState({
		...existing,
		status: existing.cancelRequestedAt ? "cancelling" : "leased",
		leaseOwner: input.leaseOwner.trim(),
		leaseHeartbeatAt: now,
		leaseExpiresAt: now + Math.max(input.leaseTtlMs ?? DEFAULT_RESEARCH_LOOP_LEASE_TTL_MS, 5_000),
		currentRound: normalizeNullableNumber(input.currentRound) ?? existing.currentRound,
		totalRounds: normalizeNullableNumber(input.totalRounds) ?? existing.totalRounds,
		attemptNumber: normalizeNullableNumber(input.attemptNumber) ?? existing.attemptNumber,
		phase: normalizeNullableString(input.phase) ?? existing.phase,
		updatedAt: now,
	});
	return { claimed: true, schedule: updated };
}

/** Extend the active lease for one scheduled loop when the same owner heartbeats. */
export function heartbeatResearchLoopSchedule(
	input: ResearchLoopLeaseUpdateInput,
): ResearchLoopScheduleState | null {
	const claim = claimResearchLoopSchedule(input);
	return claim.claimed ? claim.schedule : null;
}

/** Mark a scheduled loop as operator-cancelling without deleting its durable state. */
export function cancelResearchLoopSchedule(args: {
	projectPath: string;
	loopKey: string;
	reason?: string | null;
	requestedBy?: string | null;
	now?: number;
}): ResearchLoopScheduleState | null {
	const existing = getResearchLoopSchedule(args.projectPath, args.loopKey);
	if (!existing || isTerminalScheduleStatus(existing.status)) return existing;
	const now = typeof args.now === "number" ? args.now : Date.now();
	return writeScheduleState({
		...existing,
		status: "cancelling",
		cancelRequestedAt: existing.cancelRequestedAt ?? now,
		cancelReason: normalizeNullableString(args.reason) ?? existing.cancelReason ?? "operator-interrupt",
		requestedBy: normalizeNullableString(args.requestedBy) ?? existing.requestedBy ?? null,
		updatedAt: now,
	});
}

/** Persist the terminal outcome for one scheduled loop. */
export function completeResearchLoopSchedule(args: {
	projectPath: string;
	loopKey: string;
	stopReason: string | null;
	now?: number;
	leaseOwner?: string | null;
}): ResearchLoopScheduleState | null {
	const existing = getResearchLoopSchedule(args.projectPath, args.loopKey);
	if (!existing) return null;
	const now = typeof args.now === "number" ? args.now : Date.now();
	const leaseOwner = normalizeNullableString(args.leaseOwner);
	if (leaseOwner && isLeaseActive(existing, now) && existing.leaseOwner !== leaseOwner) {
		return null;
	}
	const stopReason = normalizeNullableString(args.stopReason);
	const status: ResearchLoopScheduleStatus = stopReason === "cancelled"
		? "cancelled"
		: stopReason === "closure-failed"
			|| stopReason === "round-failed"
			|| stopReason === "unsafe-discard"
			|| stopReason === "control-plane-lost"
			|| stopReason === "dispatch-failed"
			? "failed"
			: "completed";
	return writeScheduleState({
		...existing,
		status,
		stopReason,
		leaseOwner: null,
		leaseExpiresAt: null,
		leaseHeartbeatAt: null,
		finishedAt: now,
		updatedAt: now,
	});
}
