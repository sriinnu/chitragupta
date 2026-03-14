import type {
	ResearchCouncilSummary,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import type {
	BaselineData,
	OvernightResearchCheckpoint,
	OvernightResearchRound,
	OvernightResearchStopReason,
} from "./chitragupta-nodes-research-overnight-types.js";
import { stopReasonFromCancelReason } from "./chitragupta-nodes-research-overnight-types.js";
import { withinRemainingLoopBudget } from "./chitragupta-nodes-research-overnight-context.js";
import {
	type ResearchLoopInterruptHandle,
} from "./chitragupta-nodes-research-interrupt.js";
import {
	packResearchContext,
	recordResearchFailure,
} from "./chitragupta-nodes-research-recording.js";
import {
	isCancellationLikeError,
	refreshCancellationState,
} from "./chitragupta-nodes-research-overnight-control.js";
import {
	applyCommittedRoundCounts,
	asRecord,
	buildCheckpoint,
	type RoundProgressState,
	type SaveRoundCheckpoint,
} from "./chitragupta-nodes-research-overnight-rounds-shared.js";
import {
	annotateParetoRounds,
	evaluateResearchObjectives,
	withRoundOptimization,
} from "./chitragupta-nodes-research-optimization.js";

/**
 * Narrow a partially restored finalize payload down to the action contract that
 * optimization scoring understands.
 */
function asFailureFinalizeAction(
	value: Record<string, unknown> | null,
): { action: "kept" | "reverted" | "skipped" } | null {
	if (
		value?.action === "kept"
		|| value?.action === "reverted"
		|| value?.action === "skipped"
	) {
		return { action: value.action };
	}
	return null;
}

/**
 * Project one failed run payload onto the minimal optimization context used by
 * Pareto/objective scoring.
 */
function asFailureOptimizationRun(
	value: Record<string, unknown>,
): { durationMs?: number | null; timedOut?: boolean } {
	return {
		durationMs: typeof value.durationMs === "number" ? value.durationMs : null,
		timedOut: value.timedOut === true,
	};
}

/**
 * Resolve the canonical stop reason for a failed round after its closure path
 * has already started.
 *
 * Cancellation wins when the interrupt state or daemon control plane says the
 * operator asked to stop, even if the closure work itself surfaced the error.
 */
async function resolveFailureClosureStopReason(args: {
	interrupt: ResearchLoopInterruptHandle;
	scope: ResearchScope;
	council: ResearchCouncilSummary;
	roundNumber: number;
	totalRounds: number;
	phase: string;
	closureError?: unknown;
}): Promise<OvernightResearchStopReason> {
	const cancelled =
		isCancellationLikeError(args.closureError, args.interrupt)
		|| await refreshCancellationState(args.interrupt, args.scope, args.council, {
			currentRound: args.roundNumber,
			totalRounds: args.totalRounds,
			attemptNumber: 1,
			phase: args.phase,
		});
	return cancelled ? stopReasonFromCancelReason(args.interrupt.getCancelReason()) : "closure-failed";
}

function buildAnnotatedFailureRound(args: {
	roundScope: ResearchScope;
	rounds: OvernightResearchRound[];
	roundNumber: number;
	failedRun: Record<string, unknown> & {
		metric?: number | null;
		selectedModelId?: string | null;
		selectedProviderId?: string | null;
		executionRouteClass?: string | null;
	};
	currentBaseline: BaselineData;
	failureFinalize: Record<string, unknown> | null;
	failurePacked: Record<string, unknown> | null;
	failureRecorded: Record<string, unknown> | null;
}): OvernightResearchRound {
	const optimized = withRoundOptimization({
		roundNumber: args.roundNumber,
		decision: "record",
		observedMetric: typeof args.failedRun.metric === "number" ? args.failedRun.metric : null,
		delta: null,
		finalizeAction: typeof args.failureFinalize?.action === "string" ? args.failureFinalize.action : null,
		traceId: typeof args.failureRecorded?.traceId === "string" ? args.failureRecorded.traceId : null,
		experimentId: typeof args.failureRecorded?.experimentId === "string" ? args.failureRecorded.experimentId : null,
		packedRuntime: typeof args.failurePacked?.runtime === "string" ? args.failurePacked.runtime : null,
		packedSource: typeof args.failurePacked?.source === "string" ? args.failurePacked.source : null,
		selectedModelId: typeof args.failedRun.selectedModelId === "string" ? args.failedRun.selectedModelId : null,
		selectedProviderId: typeof args.failedRun.selectedProviderId === "string" ? args.failedRun.selectedProviderId : null,
		executionRouteClass: typeof args.failedRun.executionRouteClass === "string" ? args.failedRun.executionRouteClass : null,
		objectiveScores: evaluateResearchObjectives({
			scope: args.roundScope,
			evaluation: {
				metricName: args.currentBaseline.metricName,
				objective: args.currentBaseline.objective,
				baselineMetric: args.currentBaseline.baselineMetric ?? null,
				observedMetric: typeof args.failedRun.metric === "number" ? args.failedRun.metric : null,
				delta: null,
				improved: false,
				decision: "record",
				status: "failed",
				errorMessage:
					typeof args.failedRun.errorMessage === "string"
						? args.failedRun.errorMessage
						: "Research round failed.",
			},
			run: asFailureOptimizationRun(args.failedRun),
			finalize: asFailureFinalizeAction(args.failureFinalize),
			packed: args.failurePacked as { savings?: number | null; packed?: boolean } | null,
		}),
		stopConditionHits: [],
		paretoRank: null,
		paretoDominated: false,
	} satisfies OvernightResearchRound, args.roundScope);
	return annotateParetoRounds([...args.rounds, optimized]).at(-1) ?? optimized;
}

/**
 * Finalize a failed round so its negative signal is still durable and resumable.
 */
export async function processFailedRoundClosure(args: {
	scope: ResearchScope;
	council: ResearchCouncilSummary;
	interrupt: ResearchLoopInterruptHandle;
	roundScope: ResearchScope;
	roundNumber: number;
	roundStartedAt: number;
	failedRun: Record<string, unknown> & {
		metric?: number | null;
		selectedModelId?: string | null;
		selectedProviderId?: string | null;
		executionRouteClass?: string | null;
	};
	currentBaseline: BaselineData;
	counts: { keptRounds: number; revertedRounds: number };
	state: RoundProgressState;
	carryContext: string;
	rounds: OvernightResearchRound[];
	saveCheckpoint: SaveRoundCheckpoint;
	resumeCheckpoint?: OvernightResearchCheckpoint | null;
}): Promise<{
	round: OvernightResearchRound;
	stopReason: OvernightResearchStopReason;
	totalDurationMs: number;
	degradedError?: unknown;
}> {
	const {
		scope, interrupt, roundScope, roundNumber,
		roundStartedAt, failedRun, counts,
	} = args;
	let failureFinalize: Record<string, unknown> | null = null;
	let failurePacked: Record<string, unknown> | null = null;
	let failureRecorded: Record<string, unknown> | null = null;
	let failedRunForRecord: Record<string, unknown> = failedRun;
	let totalDurationMs = args.state.totalDurationMs;
	const resumeCheckpoint = args.resumeCheckpoint ?? null;
	const resumePhase = resumeCheckpoint?.phase ?? null;
	try {
		if (resumePhase && !resumePhase.startsWith("failure-")) {
			throw new Error(`Invalid resume phase for failed round closure: ${resumePhase}`);
		}
		failureFinalize = resumeCheckpoint?.activeRound?.finalize ?? null;
		failurePacked = resumeCheckpoint?.activeRound?.packed ?? null;
		failureRecorded = resumeCheckpoint?.activeRound?.recorded ?? null;
		if (resumePhase === null || resumePhase === "failure-finalize") {
			await args.saveCheckpoint("failure-finalize", buildCheckpoint(
				"failure-finalize",
				scope,
				args.state.loopKey,
				args.currentBaseline,
				args.state,
				args.counts,
				args.carryContext,
				args.rounds,
				roundNumber,
				{
					roundNumber,
					failedRun,
					finalize: failureFinalize,
					packed: failurePacked,
					recorded: failureRecorded,
				},
			));
			failureFinalize = await withinRemainingLoopBudget(
				scope,
				totalDurationMs,
				roundStartedAt,
				"overnight failure finalize",
				interrupt.signal,
				async (signal) => (await import("./chitragupta-nodes-research-runner.js")).recoverResearchFailure(roundScope, failedRun, signal),
			).then((result) => asRecord(result));
		}
		if (resumePhase === null || resumePhase === "failure-finalize" || resumePhase === "failure-pack") {
			await args.saveCheckpoint("failure-pack", buildCheckpoint(
				"failure-pack",
				scope,
				args.state.loopKey,
				args.currentBaseline,
				args.state,
				args.counts,
				args.carryContext,
				args.rounds,
				roundNumber,
				{
					roundNumber,
					failedRun,
					finalize: failureFinalize,
					packed: failurePacked,
					recorded: failureRecorded,
				},
			));
				failurePacked = await withinRemainingLoopBudget(
					scope,
					totalDurationMs,
					roundStartedAt,
					"overnight failure context pack",
					interrupt.signal,
					async (signal) => packResearchContext(
						roundScope,
						args.council as unknown as Record<string, unknown>,
						failedRun,
						{
							metricName: args.currentBaseline.metricName,
							objective: args.currentBaseline.objective,
							baselineMetric: args.currentBaseline.baselineMetric ?? null,
							observedMetric: typeof failedRun.metric === "number" ? failedRun.metric : null,
							delta: null,
							improved: false,
							decision: "record",
							status: "failed",
							errorMessage:
								typeof failedRun.errorMessage === "string"
									? failedRun.errorMessage
									: undefined,
						},
						signal,
						{ fallbackPolicy: "daemon-only" },
					),
				);
			}
			if (
				resumePhase === null
				|| resumePhase === "failure-finalize"
				|| resumePhase === "failure-pack"
				|| resumePhase === "failure-record"
		) {
			await args.saveCheckpoint("failure-record", buildCheckpoint(
				"failure-record",
				scope,
				args.state.loopKey,
				args.currentBaseline,
				args.state,
				args.counts,
				args.carryContext,
				args.rounds,
				roundNumber,
					{
						roundNumber,
						failedRun,
						finalize: failureFinalize,
						packed: failurePacked,
						recorded: failureRecorded,
					},
				));
				failedRunForRecord = {
					...failedRun,
					roundWallClockDurationMs: Date.now() - roundStartedAt,
				};
				failureRecorded = await withinRemainingLoopBudget(
					scope,
					totalDurationMs,
					roundStartedAt,
					"overnight failure outcome record",
					interrupt.signal,
					async (signal) => recordResearchFailure(
						roundScope,
						args.council as unknown as Record<string, unknown>,
						failedRunForRecord,
						failurePacked as Record<string, unknown>,
						failureFinalize as Record<string, unknown>,
						signal,
						{ fallbackPolicy: "daemon-only" },
					),
				);
			}

		const round = buildAnnotatedFailureRound({
			roundScope,
			rounds: args.rounds,
			roundNumber,
			failedRun,
			currentBaseline: args.currentBaseline,
			failureFinalize,
			failurePacked,
			failureRecorded,
		});
		applyCommittedRoundCounts(round, counts);
		totalDurationMs += Date.now() - roundStartedAt;
		return { round, stopReason: "round-failed", totalDurationMs };
	} catch (closureError) {
		const stopReason = await resolveFailureClosureStopReason({
			interrupt,
			scope,
			council: args.council,
			roundNumber,
			totalRounds: scope.maxRounds,
			phase: "failure-closure-error",
			closureError,
		});
		totalDurationMs += Date.now() - roundStartedAt;
		const round = buildAnnotatedFailureRound({
			roundScope,
			rounds: args.rounds,
			roundNumber,
			failedRun,
			currentBaseline: args.currentBaseline,
			failureFinalize,
			failurePacked,
			failureRecorded,
		});
		return {
			round,
			stopReason,
			totalDurationMs,
			degradedError: closureError,
		};
	}
}
