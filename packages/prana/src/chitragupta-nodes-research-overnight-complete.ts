import {
	clearResearchLoopCheckpoint,
	saveCompletionPendingResearchLoopCheckpoint,
	saveTerminalResearchLoopCheckpoint,
} from "./chitragupta-nodes-research-checkpoints.js";
import { recordResearchLoopSummary } from "./chitragupta-nodes-research-loop-recording.js";
import {
	buildSummary,
	type OvernightResearchRound,
	type OvernightResearchStopReason,
	type OvernightResearchSummary,
	stopReasonFromCancelReason,
	withDegradedClosure,
} from "./chitragupta-nodes-research-overnight-types.js";
import {
	completeResearchLoopInterrupt,
	releaseResearchLoopInterrupt,
	type ResearchLoopInterruptHandle,
} from "./chitragupta-nodes-research-interrupt.js";
import type { ResearchCouncilSummary, ResearchScope } from "./chitragupta-nodes-research-shared.js";
import { refreshCancellationState } from "./chitragupta-nodes-research-overnight-control.js";

function parseStopReason(value: unknown): OvernightResearchStopReason | null {
	switch (value) {
		case "max-rounds":
		case "no-improvement":
		case "budget-exhausted":
		case "cancelled":
		case "control-plane-lost":
		case "unsafe-discard":
		case "round-failed":
		case "closure-failed":
			return value;
		default:
			return null;
	}
}

function isFailureStopReason(reason: OvernightResearchStopReason): boolean {
	return reason === "closure-failed"
		|| reason === "control-plane-lost"
		|| reason === "round-failed"
		|| reason === "unsafe-discard";
}

/**
 * Canonicalize terminal loop state, persist the final summary, and clear the
 * resumable checkpoint.
 *
 * Ordering matters:
 * 1. daemon loop completion decides the final stop reason
 * 2. terminal summary checkpoint preserves that truth durably
 * 3. summary recording writes the operator-facing ledger entry
 * 4. checkpoint clear happens only after a durable summary exists
 */
export async function finalizeOvernightResearchLoop(args: {
	scope: ResearchScope;
	council: ResearchCouncilSummary;
	interrupt: ResearchLoopInterruptHandle;
	loopKey: string;
	rounds: OvernightResearchRound[];
	progress: {
		bestMetric: number | null;
		bestRoundNumber: number | null;
		noImprovementStreak: number;
		totalDurationMs: number;
	};
	roundCounts: { keptRounds: number; revertedRounds: number };
	finalSummary: OvernightResearchSummary | null;
}): Promise<OvernightResearchSummary & {
	summaryId?: string | null;
	summarySource?: "daemon" | "fallback" | null;
}> {
	const { scope, council, interrupt, loopKey, rounds, progress, roundCounts } = args;
	let summary = args.finalSummary
		?? buildSummary(
			scope,
			council,
			rounds,
			"max-rounds",
			progress.bestMetric,
			progress.bestRoundNumber,
			progress.noImprovementStreak,
			progress.totalDurationMs,
			roundCounts.keptRounds,
			roundCounts.revertedRounds,
			loopKey,
		);
	const cancelledBeforeComplete = await refreshCancellationState(interrupt, scope, council, {
		currentRound: summary.roundsCompleted,
		totalRounds: summary.roundsRequested,
		attemptNumber: 1,
		phase: "before-complete",
	});
	if (
		cancelledBeforeComplete
		&& summary.stopReason !== "cancelled"
		&& summary.stopReason !== "control-plane-lost"
		&& !isFailureStopReason(summary.stopReason)
	) {
		summary = { ...summary, stopReason: stopReasonFromCancelReason(interrupt.getCancelReason()) };
	}
	const completionState = await completeResearchLoopInterrupt(interrupt, summary.stopReason);
	if (!completionState) {
		const degradedSummary = withDegradedClosure(
			summary,
			new Error("Research loop completion could not be committed to the daemon control plane"),
		);
		await saveCompletionPendingResearchLoopCheckpoint(scope, council, degradedSummary);
		releaseResearchLoopInterrupt(interrupt.loopKey);
		return {
			...degradedSummary,
			summaryId: null,
			summarySource: null,
		};
	}
	const canonicalStopReason = parseStopReason(completionState?.stopReason);
	if (canonicalStopReason) {
		summary = { ...summary, stopReason: canonicalStopReason };
	}
	// Final checkpoint persistence must not be blocked by a late abort.
	await saveTerminalResearchLoopCheckpoint(scope, council, summary);
	try {
		const recorded = await recordResearchLoopSummary(scope, council, summary);
		await clearResearchLoopCheckpoint(scope, loopKey);
		return {
			...summary,
			summaryId: recorded.summaryId,
			summarySource: recorded.source,
		};
	} catch (error) {
		const degradedSummary = withDegradedClosure(summary, error);
		await saveTerminalResearchLoopCheckpoint(scope, council, degradedSummary);
		return {
			...degradedSummary,
			summaryId: null,
			summarySource: null,
		};
	}
}
