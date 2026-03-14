import { withResearchRoundScope } from "./chitragupta-nodes-research-shared.js";
import type {
	ResearchCouncilSummary,
	ResearchFinalizeResult,
	ResearchRunData,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import {
	cleanupResultRequiresFailure,
	executeResearchRun,
	evaluateResearchResult,
	finalizeResearchResult,
	recoverResearchFailure,
} from "./chitragupta-nodes-research-runner.js";
import {
	heartbeatResearchLoopInterrupt,
	type ResearchLoopInterruptHandle,
} from "./chitragupta-nodes-research-interrupt.js";
import { saveResearchLoopCheckpoint } from "./chitragupta-nodes-research-checkpoints.js";
import {
	type BaselineData,
	type OvernightResearchCheckpoint,
	type OvernightResearchMutableState,
	type OvernightResearchRound,
	type OvernightResearchSummary,
	stopReasonFromCancelReason,
} from "./chitragupta-nodes-research-overnight-types.js";
import { persistTerminalLoopSummary } from "./chitragupta-nodes-research-overnight-summary.js";
import { withinRemainingLoopBudget } from "./chitragupta-nodes-research-overnight-context.js";
import {
	applyCommittedRoundCounts,
	cancelledRound,
	processFailedRoundClosure,
	processSuccessfulRoundClosure,
	type SaveRoundCheckpoint,
} from "./chitragupta-nodes-research-overnight-rounds.js";
import {
	asRoundRecord,
	buildFailedRun,
	buildRoundProgressState,
	buildRoundBase,
	failedRunNeedsCleanup,
} from "./chitragupta-nodes-research-overnight-state.js";
import { isCancellationLikeError } from "./chitragupta-nodes-research-overnight-control.js";
import {
	degradedErrorForCancelledCleanup,
	recoverCancelledRoundCleanup,
	stopReasonForCancelledCleanup,
} from "./chitragupta-nodes-research-overnight-run-cancel.js";

type ResearchEvaluationData = Awaited<ReturnType<typeof evaluateResearchResult>>;
const MIN_SUCCESSFUL_CLOSURE_RESERVE_MS = 1_500;

/**
 * Run the bounded round loop, preserving resumable checkpoints and returning
 * the mutable state needed for final completion/recording.
 */
export async function runOvernightResearchRounds(args: {
	scope: ResearchScope;
	council: ResearchCouncilSummary;
	loopKey: string;
	interrupt: ResearchLoopInterruptHandle;
	state: OvernightResearchMutableState;
	startRoundNumber: number;
}): Promise<OvernightResearchMutableState> {
	const { scope, council, loopKey, interrupt } = args;
	let {
		currentBaseline,
		progress,
		roundCounts,
		carryContext,
		rounds,
		resumeCheckpoint,
		finalSummary,
	} = args.state;

	for (let roundNumber = args.startRoundNumber; roundNumber <= scope.maxRounds; roundNumber += 1) {
		const loopState = await heartbeatResearchLoopInterrupt(interrupt, scope, council, {
			currentRound: roundNumber,
			totalRounds: scope.maxRounds,
			attemptNumber: 1,
			phase: "before-round",
		});
		if (loopState.cancelled) {
			finalSummary = await persistTerminalLoopSummary({
				scope,
				council,
				rounds,
				stopReason: stopReasonFromCancelReason(loopState.reason),
				progress,
				roundCounts,
				loopKey,
			});
			break;
		}

		const remainingBudget = scope.totalBudgetMs - progress.totalDurationMs;
		// I reserve explicit budget for the success-closure path so the final
		// accepted round can still pack, record, and normalize before the loop
		// terminates on budget exhaustion.
		if (remainingBudget < 1_000 + MIN_SUCCESSFUL_CLOSURE_RESERVE_MS) {
			finalSummary = await persistTerminalLoopSummary({ scope, council, rounds, stopReason: "budget-exhausted", progress, roundCounts, loopKey });
			break;
		}

			const roundStartedAt = Date.now();
			// I cap the round budget below the remaining loop budget so a successful
			// round still leaves explicit time for pack -> record -> normalize closure
			// work instead of exhausting the loop on execution alone.
			const roundScope = withResearchRoundScope(
				{
					...scope,
					budgetMs: Math.max(1_000, Math.min(scope.budgetMs, remainingBudget - MIN_SUCCESSFUL_CLOSURE_RESERVE_MS)),
					interruptSignal: interrupt.signal,
				},
			loopKey,
			roundNumber,
			scope.maxRounds,
			1,
		);
		const saveCheckpoint: SaveRoundCheckpoint = async (phaseName, checkpoint) => {
			await saveResearchLoopCheckpoint(
				scope,
				council,
				phaseName,
				checkpoint,
				undefined,
				{
					requestedAt: interrupt.getCancelRequestedAt(),
					reason: interrupt.getCancelReason(),
				},
				interrupt.signal,
			);
			resumeCheckpoint = checkpoint;
		};

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
			const activeResumeRound = resumeCheckpoint?.activeRound ?? null;
			const resumingFailureClosure = Boolean(
				resumeCheckpoint
				&& resumeCheckpoint.nextRoundNumber === roundNumber
				&& activeResumeRound?.roundNumber === roundNumber
				&& resumeCheckpoint.phase.startsWith("failure-")
				&& activeResumeRound.failedRun,
			);
			const failureResumeCheckpoint =
				resumingFailureClosure && resumeCheckpoint ? resumeCheckpoint : null;
			if (resumingFailureClosure && activeResumeRound?.failedRun) {
				// Failure-closure checkpoints take precedence over success-closure
				// checkpoints for the same round because the failed run still needs a
				// durable terminal decision before I can safely advance the loop.
				phase = "closure";
				const failure = await processFailedRoundClosure({
					scope,
					council,
					interrupt,
					roundScope,
					roundNumber,
					roundStartedAt,
					failedRun: activeResumeRound.failedRun as Record<string, unknown> & {
						metric?: number | null;
						selectedModelId?: string | null;
						selectedProviderId?: string | null;
						executionRouteClass?: string | null;
					},
					currentBaseline,
					counts: roundCounts,
					state: buildRoundProgressState(
						progress.bestMetric,
						progress.bestRoundNumber,
						progress.noImprovementStreak,
						progress.totalDurationMs,
						loopKey,
					),
					carryContext,
					rounds,
					saveCheckpoint,
					resumeCheckpoint: failureResumeCheckpoint,
				});
				progress = { ...progress, totalDurationMs: failure.totalDurationMs };
				rounds.push(failure.round);
				resumeCheckpoint = null;
				finalSummary = await persistTerminalLoopSummary({
					scope,
					council,
					rounds,
					stopReason: failure.stopReason,
					progress,
					roundCounts,
					loopKey,
					degradedError: failure.degradedError,
				});
				break;
			}
			const resumingClosure = Boolean(
				resumeCheckpoint
				&& resumeCheckpoint.nextRoundNumber === roundNumber
				&& activeResumeRound?.roundNumber === roundNumber
				&& resumeCheckpoint.phase.startsWith("closure-")
				&& activeResumeRound.runData
				&& activeResumeRound.evaluation
				&& activeResumeRound.finalize
				&& activeResumeRound.roundBase,
			);
			let runData: ResearchRunData;
			let evaluation: ResearchEvaluationData;
			let finalize: ResearchFinalizeResult;
			let roundBase: OvernightResearchRound;
			const successResumeCheckpoint =
				resumingClosure && resumeCheckpoint ? resumeCheckpoint : null;
			if (resumingClosure && activeResumeRound) {
				// Success-closure resume reuses the already-recorded run/evaluation so
				// timeout pickup continues from the durable closure seam instead of
				// re-executing the experiment from scratch.
				runData = activeResumeRound.runData as unknown as ResearchRunData;
				evaluation = activeResumeRound.evaluation as ResearchEvaluationData;
				finalize = activeResumeRound.finalize as unknown as ResearchFinalizeResult;
				roundBase = activeResumeRound.roundBase as OvernightResearchRound;
			} else {
				await saveCheckpoint("run", {
					version: 1,
					loopKey,
					phase: "run",
					currentBaseline,
					progress: {
						bestMetric: progress.bestMetric,
						bestRoundNumber: progress.bestRoundNumber,
						noImprovementStreak: progress.noImprovementStreak,
						totalDurationMs: progress.totalDurationMs,
					},
					roundCounts: { ...roundCounts },
					carryContext,
					rounds: [...rounds],
					nextRoundNumber: roundNumber,
					activeRound: { roundNumber },
				});
				runData = await executeResearchRun(
					roundScope,
					asRoundRecord(council),
					{ roundNumber, totalRounds: scope.maxRounds, carryContext },
				);
				evaluation = await withinRemainingLoopBudget(
					scope,
					progress.totalDurationMs,
					roundStartedAt,
					"overnight evaluation",
					interrupt.signal,
					async () => await evaluateResearchResult(
						currentBaseline,
						asRoundRecord(runData),
						roundScope,
					) as ResearchEvaluationData,
				);
				finalize = await withinRemainingLoopBudget(
					scope,
					progress.totalDurationMs,
					roundStartedAt,
					"overnight finalize",
					interrupt.signal,
					async (signal) => await finalizeResearchResult(
						roundScope,
						asRoundRecord(runData),
						asRoundRecord(evaluation),
						signal,
					),
				);
				roundBase = buildRoundBase(roundNumber, runData, evaluation, finalize);
			}

				const roundDurationMs = Date.now() - roundStartedAt;

					phase = "closure";
					const forcedStopReason =
						// I still run unsafe discard through the durable closure path so pack,
						// record, and terminal governance stay identical to any other
						// successful round before the loop fails closed.
						roundBase.decision === "discard" && roundBase.finalizeAction !== "reverted"
							? "unsafe-discard"
							: progress.totalDurationMs + roundDurationMs >= scope.totalBudgetMs
							? "budget-exhausted"
							: null;
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
				state: buildRoundProgressState(
					progress.bestMetric,
					progress.bestRoundNumber,
					progress.noImprovementStreak,
					progress.totalDurationMs,
					loopKey,
				),
				currentBaseline,
					carryContext,
					rounds,
					saveCheckpoint,
					resumeCheckpoint: successResumeCheckpoint,
					forcedStopReason,
				});

			progress = {
				bestMetric: closureResult.state.bestMetric,
				bestRoundNumber: closureResult.state.bestRoundNumber,
				noImprovementStreak: closureResult.state.noImprovementStreak,
				totalDurationMs: closureResult.state.totalDurationMs,
			};
			rounds = [...closureResult.rounds];
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
				finalSummary = await persistTerminalLoopSummary({
					scope,
					council,
					rounds,
					stopReason: closureResult.stopReason,
					progress,
					roundCounts,
					loopKey,
					degradedError: closureResult.degradedError,
				});
				break;
			}

			carryContext = closureResult.nextCarryContext;
			resumeCheckpoint = null;
		} catch (error) {
			const failedRun = buildFailedRun(error, roundScope, roundStartedAt);

			if (isCancellationLikeError(error, interrupt)) {
					let finalizeAction: string | null = null;
					let recoveryError: unknown = null;
					if (failedRunNeedsCleanup(failedRun)) {
						try {
							// Cleanup is best-effort and should still try to restore bounded scope
							// even after the operator has already cancelled the active loop.
							// I run that cleanup behind a short grace budget instead of
							// letting a stuck restore hang terminal cancellation forever.
							const recovery = await recoverCancelledRoundCleanup(roundScope, failedRun);
							finalizeAction = typeof recovery.action === "string" ? recovery.action : null;
							if (cleanupResultRequiresFailure(recovery)) {
								recoveryError = new Error(
								recovery.reason
								?? "Cancelled round cleanup did not safely revert the bounded research scope.",
							);
						}
					} catch (cleanupError) {
						recoveryError = cleanupError;
					}
				}
				progress.totalDurationMs += Date.now() - roundStartedAt;
				const round = cancelledRound(roundNumber, failedRun, finalizeAction);
				rounds.push(round);
				applyCommittedRoundCounts(round, roundCounts);
				const stopReason = recoveryError == null
					? stopReasonFromCancelReason(interrupt.getCancelReason())
					: stopReasonForCancelledCleanup(recoveryError);
				finalSummary = await persistTerminalLoopSummary({
					scope,
					council,
					rounds,
					stopReason,
					progress,
					roundCounts,
					loopKey,
					degradedError: degradedErrorForCancelledCleanup(stopReason, recoveryError),
				});
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
				state: buildRoundProgressState(
					progress.bestMetric,
					progress.bestRoundNumber,
					progress.noImprovementStreak,
					progress.totalDurationMs,
					loopKey,
				),
				carryContext,
				rounds,
				saveCheckpoint,
				resumeCheckpoint: resumeCheckpoint?.phase.startsWith("failure-") ? resumeCheckpoint : null,
			});
			progress.totalDurationMs = failure.totalDurationMs;
			rounds.push(failure.round);
			resumeCheckpoint = null;
			finalSummary = await persistTerminalLoopSummary({
				scope,
				council,
				rounds,
				stopReason: failure.stopReason,
				progress,
				roundCounts,
				loopKey,
				degradedError: failure.degradedError,
			});
			break;
		} finally {
			clearInterval(poll);
		}
	}

	return {
		currentBaseline,
		progress,
		roundCounts,
		carryContext,
		rounds,
		resumeCheckpoint,
		finalSummary,
	};
}
