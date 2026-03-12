import {
	withResearchRoundScope,
} from "./chitragupta-nodes-research-shared.js";
import type {
	ResearchCouncilSummary,
	ResearchFinalizeResult,
	ResearchRunData,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import {
	executeResearchRun,
	evaluateResearchResult,
	finalizeResearchResult,
	recoverResearchFailure,
} from "./chitragupta-nodes-research-runner.js";
import {
	completeResearchLoopInterrupt,
	heartbeatResearchLoopInterrupt,
	startResearchLoopInterrupt,
} from "./chitragupta-nodes-research-interrupt.js";
import { recordResearchLoopSummary } from "./chitragupta-nodes-research-loop-recording.js";
import {
	buildSummary,
	buildRuntimeLoopKey,
	type BaselineData,
	type OvernightResearchRound,
	type OvernightResearchStopReason,
	type OvernightResearchSummary,
	withDegradedClosure,
} from "./chitragupta-nodes-research-overnight-types.js";
import {
	applyCommittedRoundCounts,
	cancelledRound,
	processFailedRoundClosure,
	processSuccessfulRoundClosure,
} from "./chitragupta-nodes-research-overnight-rounds.js";
import { buildFailedRun, buildRoundBase } from "./chitragupta-nodes-research-overnight-state.js";
import {
	isCancellationLikeError,
	refreshCancellationState,
} from "./chitragupta-nodes-research-overnight-control.js";
import type { ResearchEvaluationRecord } from "./chitragupta-nodes-research-overnight-types.js";

type ResearchEvaluationData = Awaited<ReturnType<typeof evaluateResearchResult>>;

function asRecord(value: object): Record<string, unknown> {
	return value as unknown as Record<string, unknown>;
}

function parseStopReason(value: unknown): OvernightResearchStopReason | null {
	switch (value) {
		case "max-rounds":
		case "no-improvement":
		case "budget-exhausted":
		case "cancelled":
		case "unsafe-discard":
		case "round-failed":
		case "closure-failed":
			return value;
		default:
			return null;
	}
}

/**
 * Execute a bounded overnight research loop with daemon-owned control state,
 * packed carry-context reuse, and early-stop semantics.
 */
export async function executeOvernightResearchLoop(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	baseline: BaselineData,
): Promise<OvernightResearchSummary> {
		const loopKey = scope.loopKey ?? buildRuntimeLoopKey(scope, asRecord(council));
	const interrupt = await startResearchLoopInterrupt(scope, council, loopKey);
	let currentBaseline = { ...baseline };
	const progress = {
		bestMetric: baseline.baselineMetric,
		bestRoundNumber: null as number | null,
		noImprovementStreak: 0,
		totalDurationMs: 0,
	};
	const roundCounts = { keptRounds: 0, revertedRounds: 0 };
	let carryContext = "";
	const rounds: OvernightResearchRound[] = [];

	let finalSummary: OvernightResearchSummary | null = null;
	let returnedSummary: (OvernightResearchSummary & {
		summaryId?: string | null;
		summarySource?: "daemon" | "fallback" | null;
	}) | null = null;
	let completionStopReason: OvernightResearchSummary["stopReason"] = "max-rounds";

	try {
		for (let roundNumber = 1; roundNumber <= scope.maxRounds; roundNumber += 1) {
			const loopState = await heartbeatResearchLoopInterrupt(interrupt, scope, council, {
				currentRound: roundNumber,
				totalRounds: scope.maxRounds,
				attemptNumber: 1,
				phase: "before-round",
			});
			if (loopState.cancelled) {
				finalSummary = buildSummary(
					scope,
					council,
					rounds,
					"cancelled",
					progress.bestMetric,
					progress.bestRoundNumber,
					progress.noImprovementStreak,
					progress.totalDurationMs,
					roundCounts.keptRounds,
					roundCounts.revertedRounds,
					loopKey,
				);
				break;
			}

			const remainingBudget = scope.totalBudgetMs - progress.totalDurationMs;
			if (remainingBudget < 1_000) {
				finalSummary = buildSummary(
					scope,
					council,
					rounds,
					"budget-exhausted",
					progress.bestMetric,
					progress.bestRoundNumber,
					progress.noImprovementStreak,
					progress.totalDurationMs,
					roundCounts.keptRounds,
					roundCounts.revertedRounds,
					loopKey,
				);
				break;
			}

			const roundStartedAt = Date.now();
			const roundScope = withResearchRoundScope(
				{
					...scope,
					budgetMs: Math.max(1_000, Math.min(scope.budgetMs, remainingBudget)),
					interruptSignal: interrupt.signal,
				},
				loopKey,
				roundNumber,
				scope.maxRounds,
				1,
			);

			let phase: "run" | "closure" = "run";
			const poll = setInterval(() => {
				void heartbeatResearchLoopInterrupt(interrupt, scope, council, {
					currentRound: roundNumber,
					totalRounds: scope.maxRounds,
					attemptNumber: 1,
					phase,
				});
			}, 500);

			try {
				const runData = await executeResearchRun(
					roundScope,
						asRecord(council),
					{ roundNumber, totalRounds: scope.maxRounds, carryContext },
				);
				const evaluation = await evaluateResearchResult(
					currentBaseline,
						asRecord(runData),
					) as ResearchEvaluationData;
					const finalize = await finalizeResearchResult(
						roundScope,
						asRecord(runData),
						asRecord(evaluation),
					);
				const roundBase = buildRoundBase(roundNumber, runData, evaluation, finalize);

				const roundDurationMs = Date.now() - roundStartedAt;
				if (roundBase.decision === "discard" && roundBase.finalizeAction !== "reverted") {
					progress.totalDurationMs += roundDurationMs;
					rounds.push(roundBase);
					applyCommittedRoundCounts(roundBase, roundCounts);
					finalSummary = buildSummary(
						scope,
						council,
						rounds,
						"unsafe-discard",
						progress.bestMetric,
						progress.bestRoundNumber,
						progress.noImprovementStreak,
						progress.totalDurationMs,
						roundCounts.keptRounds,
						roundCounts.revertedRounds,
						loopKey,
					);
					break;
				}

				if (progress.totalDurationMs + roundDurationMs >= scope.totalBudgetMs) {
					progress.totalDurationMs += roundDurationMs;
					rounds.push(roundBase);
					applyCommittedRoundCounts(roundBase, roundCounts);
					finalSummary = buildSummary(
						scope,
						council,
						rounds,
						"budget-exhausted",
						progress.bestMetric,
						progress.bestRoundNumber,
						progress.noImprovementStreak,
						progress.totalDurationMs,
						roundCounts.keptRounds,
						roundCounts.revertedRounds,
						loopKey,
					);
					break;
				}

				phase = "closure";
				const closureResult = await processSuccessfulRoundClosure({
					scope,
					council,
					interrupt,
					roundScope,
					roundNumber,
					roundStartedAt,
					roundBase,
						runData,
						evaluation,
						finalize,
					counts: roundCounts,
					state: {
						bestMetric: progress.bestMetric,
						bestRoundNumber: progress.bestRoundNumber,
						noImprovementStreak: progress.noImprovementStreak,
						totalDurationMs: progress.totalDurationMs,
						loopKey,
					},
				});

				progress.bestMetric = closureResult.state.bestMetric;
				progress.bestRoundNumber = closureResult.state.bestRoundNumber;
				progress.noImprovementStreak = closureResult.state.noImprovementStreak;
				progress.totalDurationMs = closureResult.state.totalDurationMs;
				rounds.push(closureResult.round);
				if (
					closureResult.round.decision === "keep"
					&& typeof closureResult.round.observedMetric === "number"
					&& (
						typeof closureResult.round.experimentId === "string"
						|| typeof closureResult.round.traceId === "string"
					)
				) {
					currentBaseline = {
						...currentBaseline,
						baselineMetric: closureResult.round.observedMetric,
					};
				}

				if (closureResult.kind === "stop") {
					const summary = buildSummary(
						scope,
						council,
						rounds,
						closureResult.stopReason,
						progress.bestMetric,
						progress.bestRoundNumber,
						progress.noImprovementStreak,
						progress.totalDurationMs,
						roundCounts.keptRounds,
						roundCounts.revertedRounds,
						loopKey,
					);
					finalSummary = closureResult.degradedError
						? withDegradedClosure(summary, closureResult.degradedError)
						: summary;
					break;
				}

				carryContext = closureResult.nextCarryContext;
			} catch (error) {
				const failedRun = buildFailedRun(error, roundScope, roundStartedAt);

				if (isCancellationLikeError(error, interrupt)) {
					let finalizeAction: string | null = null;
						if (failedRun.scopeSnapshot || (Array.isArray(failedRun.targetFilesChanged) && failedRun.targetFilesChanged.length > 0)) {
						try {
							const recovery = await recoverResearchFailure(roundScope, failedRun);
							finalizeAction = typeof recovery.action === "string" ? recovery.action : null;
						} catch {
							finalizeAction = null;
						}
					}
					progress.totalDurationMs += Date.now() - roundStartedAt;
					const round = cancelledRound(roundNumber, failedRun, finalizeAction);
					rounds.push(round);
					applyCommittedRoundCounts(round, roundCounts);
					finalSummary = buildSummary(
						scope,
						council,
						rounds,
						"cancelled",
						progress.bestMetric,
						progress.bestRoundNumber,
						progress.noImprovementStreak,
						progress.totalDurationMs,
						roundCounts.keptRounds,
						roundCounts.revertedRounds,
						loopKey,
					);
					break;
				}

				const failure = await processFailedRoundClosure({
					scope,
					council,
					interrupt,
					roundScope,
					roundNumber,
					roundStartedAt,
					failedRun,
					currentBaseline,
					counts: roundCounts,
					state: {
						bestMetric: progress.bestMetric,
						bestRoundNumber: progress.bestRoundNumber,
						noImprovementStreak: progress.noImprovementStreak,
						totalDurationMs: progress.totalDurationMs,
						loopKey,
					},
				});
				progress.totalDurationMs = failure.totalDurationMs;
				rounds.push(failure.round);
				const summary = buildSummary(
					scope,
					council,
					rounds,
					failure.stopReason,
					progress.bestMetric,
					progress.bestRoundNumber,
					progress.noImprovementStreak,
					progress.totalDurationMs,
					roundCounts.keptRounds,
					roundCounts.revertedRounds,
					loopKey,
				);
				finalSummary = failure.degradedError
					? withDegradedClosure(summary, failure.degradedError)
					: summary;
				break;
			} finally {
				clearInterval(poll);
			}
		}

		let summary = finalSummary
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
		if (cancelledBeforeComplete && summary.stopReason !== "cancelled") {
			summary = { ...summary, stopReason: "cancelled" };
		}
		const completionState = await completeResearchLoopInterrupt(interrupt, summary.stopReason);
		const canonicalStopReason = parseStopReason(completionState?.stopReason);
		if (canonicalStopReason) {
			summary = { ...summary, stopReason: canonicalStopReason };
		}
		completionStopReason = summary.stopReason;
		try {
			const recorded = await recordResearchLoopSummary(scope, council, summary);
			returnedSummary = {
				...summary,
				summaryId: recorded.summaryId,
				summarySource: recorded.source,
			};
		} catch (error) {
			returnedSummary = {
				...withDegradedClosure(summary, error),
				summaryId: null,
				summarySource: null,
			};
		}
	} finally {
		if (returnedSummary) return returnedSummary;
		return buildSummary(
			scope,
			council,
			rounds,
			completionStopReason,
			progress.bestMetric,
			progress.bestRoundNumber,
			progress.noImprovementStreak,
			progress.totalDurationMs,
			roundCounts.keptRounds,
			roundCounts.revertedRounds,
			loopKey,
		);
	}
}

export type {
	BaselineData,
	OvernightResearchRound,
	OvernightResearchSummary,
} from "./chitragupta-nodes-research-overnight-types.js";
