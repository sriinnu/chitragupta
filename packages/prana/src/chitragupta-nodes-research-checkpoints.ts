/**
 * Daemon-first helpers for durable overnight research loop checkpoints.
 */

import { dynamicImport } from "./chitragupta-nodes.js";
import { withDaemonClient } from "./chitragupta-nodes-research-daemon.js";
import { throwIfResearchAborted } from "./chitragupta-nodes-research-abort.js";
import type {
	OvernightResearchCheckpoint,
	OvernightResearchCheckpointPhase,
	OvernightResearchSummary,
} from "./chitragupta-nodes-research-overnight-types.js";
import { buildResearchPolicySnapshot } from "./chitragupta-nodes-research-overnight-types.js";
import type { ResearchCouncilSummary, ResearchScope } from "./chitragupta-nodes-research-shared.js";

const DAEMON_UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ENOENT", "EACCES", "EPIPE", "ECONNRESET"]);

interface StoredResearchLoopCheckpointLike {
	checkpoint?: unknown;
	updatedAt?: number | null;
	createdAt?: number | null;
}

function shouldFallbackToLocalCheckpointStore(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (typeof code === "string" && DAEMON_UNAVAILABLE_CODES.has(code)) return true;
	if (!(error instanceof Error)) return false;
	return /daemon unavailable|connect econnrefused|enoent|eacces|epipe|econnreset|socket hang up|socket closed/i.test(
		error.message.toLowerCase(),
	);
}

/**
 * Local checkpoint fallback is only acceptable in tests or when an operator
 * explicitly opts into split-authority degraded mode.
 */
function allowLocalCheckpointFallback(): boolean {
	const raw = (process.env.CHITRAGUPTA_ALLOW_LOCAL_RUNTIME_FALLBACK ?? "").trim().toLowerCase();
	return raw === "1" || raw === "true" || process.env.NODE_ENV === "test";
}

function daemonCheckpointAuthorityError(action: "load" | "save", error: unknown): Error {
	const detail = error instanceof Error ? error.message : String(error);
	return new Error(
		`Research checkpoint ${action} requires the daemon-owned checkpoint store; local fallback is disabled (${detail})`,
	);
}

/**
 * Clear stale local fallback residue after the daemon-owned checkpoint store
 * accepts a write or clear. This keeps split-authority degraded state from
 * reviving an older loop after the daemon copy has already advanced.
 */
async function clearLocalCheckpointResidue(
	scope: ResearchScope,
	loopKey: string,
	signal?: AbortSignal,
): Promise<void> {
	try {
		const { clearResearchLoopCheckpoint: clearLocalResearchLoopCheckpoint } =
			await dynamicImport("@chitragupta/smriti");
		throwIfResearchAborted(signal);
		clearLocalResearchLoopCheckpoint(scope.projectPath, loopKey);
	} catch {
		// Best effort only. Daemon authority already succeeded; local cleanup
		// should never downgrade that into a hard failure.
	}
}

/**
 * Load the freshest durable loop checkpoint from daemon or local fallback.
 *
 * This is the read boundary between logical loop state and resumable process
 * state. Callers should treat the returned checkpoint as durable truth, not as
 * a hint.
 */
export async function loadResearchLoopCheckpoint(
	scope: ResearchScope,
	loopKey: string,
	signal?: AbortSignal,
): Promise<OvernightResearchCheckpoint | null> {
	throwIfResearchAborted(signal);
	let daemonCheckpointRecord: StoredResearchLoopCheckpointLike | null = null;
	let daemonUnavailable = false;
	try {
		daemonCheckpointRecord = await withDaemonClient(async (client) =>
			client.call("research.loops.checkpoint.get", {
				projectPath: scope.projectPath,
				loopKey,
			}, { signal }) as Promise<{ checkpoint?: StoredResearchLoopCheckpointLike | null }>,
		);
		throwIfResearchAborted(signal);
		daemonCheckpointRecord = daemonCheckpointRecord?.checkpoint ?? null;
	} catch (error) {
		if (!shouldFallbackToLocalCheckpointStore(error)) throw error;
		if (!allowLocalCheckpointFallback()) {
			throw daemonCheckpointAuthorityError("load", error);
		}
		daemonUnavailable = true;
	}
	const daemonCheckpoint = parseStoredLoopCheckpoint(daemonCheckpointRecord);
	if (!daemonUnavailable) {
		return daemonCheckpoint?.checkpoint ?? null;
	}
	const { getResearchLoopCheckpoint } = await dynamicImport("@chitragupta/smriti");
	throwIfResearchAborted(signal);
	const localCheckpoint = getResearchLoopCheckpoint(scope.projectPath, loopKey);
	return parseStoredLoopCheckpoint(localCheckpoint)?.checkpoint ?? null;
}

/**
 * I normalize daemon/local checkpoint records into one comparable shape before
 * choosing a resume source.
 */
function parseStoredLoopCheckpoint(
	record: StoredResearchLoopCheckpointLike | null | undefined,
): { checkpoint: OvernightResearchCheckpoint; updatedAt: number } | null {
	if (!record || !record.checkpoint || typeof record.checkpoint !== "object") return null;
	const updatedAt =
		typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
			? record.updatedAt
			: typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
				? record.createdAt
				: 0;
	return {
		checkpoint: record.checkpoint as OvernightResearchCheckpoint,
		updatedAt,
	};
}

/**
 * Persist the current resumable phase into the daemon-owned checkpoint store.
 *
 * Active checkpoints are resumable. Terminal and completion-pending checkpoints
 * are recovery artifacts that preserve stop truth until summary persistence and
 * daemon completion converge again.
 */
export async function saveResearchLoopCheckpoint(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	phase: OvernightResearchCheckpointPhase,
	checkpoint: OvernightResearchCheckpoint,
	status: "active" | "terminal" = "active",
	cancelState?: { requestedAt?: number | null; reason?: string | null },
	signal?: AbortSignal,
): Promise<void> {
	throwIfResearchAborted(signal);
	try {
		const daemonSaved = await withDaemonClient(async (client) =>
			client.call("research.loops.checkpoint.save", {
				projectPath: scope.projectPath,
				loopKey: checkpoint.loopKey,
				sessionId: council.sessionId ?? undefined,
				parentSessionId: scope.parentSessionId ?? undefined,
				sessionLineageKey: scope.sessionLineageKey ?? undefined,
				sabhaId: council.sabhaId ?? undefined,
				topic: scope.topic,
				hypothesis: scope.hypothesis,
				status,
				phase,
				currentRound: checkpoint.activeRound?.roundNumber ?? checkpoint.nextRoundNumber,
				nextRoundNumber: checkpoint.nextRoundNumber,
				totalRounds: scope.maxRounds,
				cancelRequestedAt: cancelState?.requestedAt ?? null,
				cancelReason: cancelState?.reason ?? null,
				checkpoint,
			}, { signal }) as Promise<unknown>,
		);
		throwIfResearchAborted(signal);
		if (daemonSaved !== null) return;
	} catch (error) {
		if (!shouldFallbackToLocalCheckpointStore(error)) throw error;
		if (!allowLocalCheckpointFallback()) {
			throw daemonCheckpointAuthorityError("save", error);
		}
	}
	const { upsertResearchLoopCheckpoint } = await dynamicImport("@chitragupta/smriti");
	throwIfResearchAborted(signal);
	upsertResearchLoopCheckpoint({
		projectPath: scope.projectPath,
		loopKey: checkpoint.loopKey,
		sessionId: council.sessionId ?? null,
		parentSessionId: scope.parentSessionId ?? null,
		sessionLineageKey: scope.sessionLineageKey ?? null,
		sabhaId: council.sabhaId ?? null,
		topic: scope.topic,
		hypothesis: scope.hypothesis,
		status,
		phase,
		currentRound: checkpoint.activeRound?.roundNumber ?? checkpoint.nextRoundNumber,
		nextRoundNumber: checkpoint.nextRoundNumber,
		totalRounds: scope.maxRounds,
		cancelRequestedAt: cancelState?.requestedAt ?? null,
		cancelReason: cancelState?.reason ?? null,
		checkpoint,
	});
}

/** Persist the final terminal summary so restart/resume can recover exact stop truth. */
export async function saveTerminalResearchLoopCheckpoint(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	summary: OvernightResearchSummary,
	signal?: AbortSignal,
): Promise<void> {
	await saveResearchLoopCheckpoint(
		scope,
		council,
		"terminal",
			{
				version: 1,
				loopKey: summary.loopKey,
				phase: "terminal",
				policy: summary.policy ?? buildResearchPolicySnapshot(scope),
				currentBaseline: {
				metricName: scope.metricName,
				objective: scope.objective,
				baselineMetric: summary.bestMetric,
				hypothesis: scope.hypothesis,
			},
			progress: {
				bestMetric: summary.bestMetric,
				bestRoundNumber: summary.bestRoundNumber,
				noImprovementStreak: summary.noImprovementStreak,
				totalDurationMs: summary.totalDurationMs,
			},
			roundCounts: {
				keptRounds: summary.keptRounds,
				revertedRounds: summary.revertedRounds,
			},
			carryContext: "",
			rounds: summary.rounds,
			nextRoundNumber: Math.min(summary.roundsCompleted + 1, summary.roundsRequested + 1),
			activeRound: null,
			terminalSummary: summary,
		},
		"terminal",
		undefined,
		signal,
	);
}

/**
 * Persist a completion-pending summary when local loop closure succeeded but
 * daemon control-plane completion could not be committed yet.
 */
export async function saveCompletionPendingResearchLoopCheckpoint(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	summary: OvernightResearchSummary,
	signal?: AbortSignal,
): Promise<void> {
	await saveResearchLoopCheckpoint(
		scope,
		council,
		"complete-pending",
			{
				version: 1,
				loopKey: summary.loopKey,
				phase: "complete-pending",
				policy: summary.policy ?? buildResearchPolicySnapshot(scope),
				currentBaseline: {
				metricName: scope.metricName,
				objective: scope.objective,
				baselineMetric: summary.bestMetric,
				hypothesis: scope.hypothesis,
			},
			progress: {
				bestMetric: summary.bestMetric,
				bestRoundNumber: summary.bestRoundNumber,
				noImprovementStreak: summary.noImprovementStreak,
				totalDurationMs: summary.totalDurationMs,
			},
			roundCounts: {
				keptRounds: summary.keptRounds,
				revertedRounds: summary.revertedRounds,
			},
			carryContext: "",
			rounds: summary.rounds,
			nextRoundNumber: Math.min(summary.roundsCompleted + 1, summary.roundsRequested + 1),
			activeRound: null,
			terminalSummary: summary,
		},
		"active",
		undefined,
		signal,
	);
}

/** Clear the durable checkpoint only after a loop has a safely persisted terminal record. */
export async function clearResearchLoopCheckpoint(
	scope: ResearchScope,
	loopKey: string,
	signal?: AbortSignal,
): Promise<void> {
	throwIfResearchAborted(signal);
	try {
		const daemonCleared = await withDaemonClient(async (client) =>
			client.call("research.loops.checkpoint.clear", {
				projectPath: scope.projectPath,
				loopKey,
			}, { signal }) as Promise<unknown>,
		);
		throwIfResearchAborted(signal);
		if (daemonCleared !== null) {
			await clearLocalCheckpointResidue(scope, loopKey, signal);
			return;
		}
	} catch (error) {
		if (!shouldFallbackToLocalCheckpointStore(error)) throw error;
	}
	const { clearResearchLoopCheckpoint: clearLocalResearchLoopCheckpoint } = await dynamicImport("@chitragupta/smriti");
	throwIfResearchAborted(signal);
	clearLocalResearchLoopCheckpoint(scope.projectPath, loopKey);
}
