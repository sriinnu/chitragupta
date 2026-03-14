import type { ResearchLoopControlState } from "./services-research-loop-state.js";

interface ResearchLoopProgressLike {
	bestMetric?: unknown;
	bestRoundNumber?: unknown;
	noImprovementStreak?: unknown;
	totalDurationMs?: unknown;
}

interface ResearchLoopActiveRoundLike {
	roundNumber?: unknown;
}

interface ResearchLoopCheckpointSnapshotLike {
	phase?: unknown;
	nextRoundNumber?: unknown;
	progress?: unknown;
	activeRound?: unknown;
	terminalSummary?: unknown;
}

interface ResearchLoopCheckpointRecordLike {
	status?: unknown;
	phase?: unknown;
	currentRound?: unknown;
	nextRoundNumber?: unknown;
	totalRounds?: unknown;
	topic?: unknown;
	hypothesis?: unknown;
	checkpoint?: unknown;
}

/**
 * Canonical daemon-side resume decisions for a bounded research loop.
 *
 * I keep these explicit so callers can distinguish "resume work", "finish
 * closure", and "inspect failure" without stringly-typed guesswork.
 */
export type ResearchLoopResumeAction =
	| "resume-rounds"
	| "complete-pending"
	| "inspect-failure"
	| "acknowledge-cancelled"
	| "complete"
	| "none";

/**
 * Machine-usable timeout-pickup summary for a bounded research loop.
 *
 * This lets operators and automation decide whether to resume work, inspect a
 * failed loop, or simply acknowledge a terminal outcome without re-parsing the
 * human-readable resume context.
 */
export interface ResearchLoopResumePlan {
	loopKey: string | null;
	status: string | null;
	phase: string | null;
	stopReason: string | null;
	nextAction: ResearchLoopResumeAction;
	nextRoundNumber: number | null;
	needsHumanReview: boolean;
	detail: string | null;
}

function asFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asCheckpointSnapshot(value: unknown): ResearchLoopCheckpointSnapshotLike | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as ResearchLoopCheckpointSnapshotLike
		: null;
}

function asProgress(value: unknown): ResearchLoopProgressLike | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as ResearchLoopProgressLike
		: null;
}

function asActiveRound(value: unknown): ResearchLoopActiveRoundLike | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as ResearchLoopActiveRoundLike
		: null;
}

/**
 * Format one round counter for operator-facing resume output.
 */
function formatRound(current: number | null, total: number | null): string | null {
	if (current == null && total == null) return null;
	if (current != null && total != null) return `${current}/${total}`;
	return current != null ? String(current) : total != null ? `?/${total}` : null;
}

/**
 * Build a bounded operator-facing research resume hint from daemon loop state
 * plus the most recent durable checkpoint, when available.
 *
 * This mirrors the generic task-checkpoint and Sabha resume-context style so
 * long-running work can be inspected without raw JSON spelunking.
 */
export function buildResearchLoopResumeContext(
	state: ResearchLoopControlState | null,
	record: ResearchLoopCheckpointRecordLike | null,
): string {
	const checkpoint = asCheckpointSnapshot(record?.checkpoint);
	const progress = asProgress(checkpoint?.progress);
	const activeRound = asActiveRound(checkpoint?.activeRound);
	const terminalSummary =
		checkpoint?.terminalSummary && typeof checkpoint.terminalSummary === "object" && !Array.isArray(checkpoint.terminalSummary)
			? checkpoint.terminalSummary as Record<string, unknown>
			: null;

	const loopKey = asTrimmedString(state?.loopKey);
	const topic = asTrimmedString(record?.topic) ?? asTrimmedString(state?.topic);
	const hypothesis =
		asTrimmedString(record?.hypothesis)
		?? asTrimmedString(terminalSummary?.hypothesis)
		?? null;
	const roundText = formatRound(
		asFiniteNumber(record?.currentRound) ?? asFiniteNumber(state?.currentRound),
		asFiniteNumber(record?.totalRounds) ?? asFiniteNumber(state?.totalRounds),
	);
	const nextRoundNumber = asFiniteNumber(record?.nextRoundNumber)
		?? asFiniteNumber(checkpoint?.nextRoundNumber);
	const bestMetric = asFiniteNumber(progress?.bestMetric);
	const bestRoundNumber = asFiniteNumber(progress?.bestRoundNumber);
	const noImprovementStreak = asFiniteNumber(progress?.noImprovementStreak);
	const activeRoundNumber = asFiniteNumber(activeRound?.roundNumber);
	const stopReason = asTrimmedString(state?.stopReason) ?? asTrimmedString(terminalSummary?.stopReason);
	const checkpointPhase = asTrimmedString(record?.phase) ?? asTrimmedString(checkpoint?.phase);
	const checkpointStatus = asTrimmedString(record?.status);
	const cancelReason = asTrimmedString(state?.cancelReason);

	const lines = [
		"Durable research resume context:",
		loopKey ? `- loop key: ${loopKey}` : "",
		topic ? `- topic: ${topic}` : "",
		hypothesis ? `- hypothesis: ${hypothesis}` : "",
		state?.status ? `- control status: ${state.status}` : "",
		state?.phase ? `- control phase: ${state.phase}` : "",
		stopReason ? `- stop reason: ${stopReason}` : "",
		cancelReason ? `- cancel reason: ${cancelReason}` : "",
		roundText ? `- round: ${roundText}` : "",
		nextRoundNumber != null ? `- next round: ${nextRoundNumber}` : "",
		checkpointStatus ? `- durable checkpoint status: ${checkpointStatus}` : "",
		checkpointPhase ? `- durable checkpoint phase: ${checkpointPhase}` : "",
		activeRoundNumber != null ? `- active round checkpoint: ${activeRoundNumber}` : "",
		bestMetric != null ? `- best metric: ${bestMetric}` : "",
		bestRoundNumber != null ? `- best round: ${bestRoundNumber}` : "",
		noImprovementStreak != null ? `- no-improvement streak: ${noImprovementStreak}` : "",
		"Resume from the last durable research checkpoint instead of restarting completed rounds.",
	].filter(Boolean);

	return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * Build the machine-usable counterpart to the research-loop resume context.
 *
 * The daemon already stores enough terminal and checkpoint metadata to tell the
 * caller whether it should resume rounds, finish closure, or inspect a failed
 * loop instead of starting from scratch.
 */
export function buildResearchLoopResumePlan(
	state: ResearchLoopControlState | null,
	record: ResearchLoopCheckpointRecordLike | null,
): ResearchLoopResumePlan | null {
	const checkpoint = asCheckpointSnapshot(record?.checkpoint);
	const loopKey = asTrimmedString(state?.loopKey);
	const phase = asTrimmedString(state?.phase) ?? asTrimmedString(record?.phase) ?? asTrimmedString(checkpoint?.phase);
	const status = state?.status ?? asTrimmedString(record?.status);
	const stopReason =
		asTrimmedString(state?.stopReason)
		?? (
			checkpoint?.terminalSummary
			&& typeof checkpoint.terminalSummary === "object"
			&& !Array.isArray(checkpoint.terminalSummary)
				? asTrimmedString((checkpoint.terminalSummary as Record<string, unknown>).stopReason)
				: null
		);
	const nextRoundNumber =
		asFiniteNumber(record?.nextRoundNumber)
		?? asFiniteNumber(checkpoint?.nextRoundNumber)
		?? asFiniteNumber(record?.currentRound);

	if (!loopKey && !status && !phase && !stopReason && nextRoundNumber == null) return null;

	let nextAction: ResearchLoopResumeAction = "none";
	let needsHumanReview = false;
	let detail: string | null = null;

	const hasLostControlButDurableWork =
		stopReason === "control-plane-lost"
		&& (asTrimmedString(record?.status) === "active" || phase === "run" || phase === "closure-record");

	// I order these branches from strongest durable signal to weakest so a
	// terminal/cancelled loop cannot accidentally look resumable.
	if (phase === "complete-pending") {
		nextAction = "complete-pending";
		detail = "Resume closure and persist the terminal research loop summary.";
	} else if (hasLostControlButDurableWork) {
		nextAction = "resume-rounds";
		detail = nextRoundNumber != null
			? `Resume from durable round ${nextRoundNumber} after control-plane loss.`
			: "Resume from the last durable research checkpoint after control-plane loss.";
	} else if (status === "running" || status === "cancelling" || record?.status === "active") {
		nextAction = "resume-rounds";
		detail = nextRoundNumber != null
			? `Resume from durable round ${nextRoundNumber}.`
			: "Resume from the last durable research checkpoint.";
	} else if (status === "cancelled" || stopReason === "cancelled") {
		nextAction = "acknowledge-cancelled";
		detail = "The loop was cancelled cleanly. Inspect before starting a new run.";
	} else if (
		status === "failed"
		|| stopReason === "control-plane-lost"
		|| stopReason === "closure-failed"
		|| stopReason === "round-failed"
		|| stopReason === "unsafe-discard"
	) {
		nextAction = "inspect-failure";
		needsHumanReview = true;
		detail = "Inspect the failed research loop and decide whether to resume or fork a new loop key.";
	} else if (status === "completed") {
		nextAction = "complete";
		detail = "The loop already completed cleanly.";
	}

	return {
		loopKey,
		status,
		phase,
		stopReason,
		nextAction,
		nextRoundNumber,
		needsHumanReview,
		detail,
	};
}
