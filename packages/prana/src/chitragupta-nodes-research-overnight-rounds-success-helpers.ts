import type {
	ResearchCouncilSummary,
	ResearchFinalizeResult,
	ResearchRunData,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import type {
	OvernightResearchRound,
	OvernightResearchStopReason,
	ResearchEvaluationRecord,
} from "./chitragupta-nodes-research-overnight-types.js";
import { stopReasonFromCancelReason } from "./chitragupta-nodes-research-overnight-types.js";
import type { ResearchLoopInterruptHandle } from "./chitragupta-nodes-research-interrupt.js";
import {
	isCancellationLikeError,
	refreshCancellationState,
} from "./chitragupta-nodes-research-overnight-control.js";
import {
	applyCommittedRoundCounts,
	asRecord,
	buildRecordedRound,
	cancelledRound,
	runNeedsCleanup,
	type RoundProgressState,
} from "./chitragupta-nodes-research-overnight-rounds-shared.js";
import {
	annotateParetoRounds,
	evaluateResearchObjectives,
	evaluateResearchStopConditions,
	withRoundOptimization,
} from "./chitragupta-nodes-research-optimization.js";

/** Result shape for one successful-round closure attempt in the overnight loop. */
export type RoundSuccessResult =
	| {
		kind: "continue";
		round: OvernightResearchRound;
		rounds: OvernightResearchRound[];
		nextCarryContext: string;
		state: RoundProgressState;
	}
	| {
		kind: "stop";
		round: OvernightResearchRound;
		rounds: OvernightResearchRound[];
		stopReason: OvernightResearchStopReason;
		degradedError?: unknown;
		state: RoundProgressState;
	};

/** Decide whether a closure failure should resolve to `cancelled` or `closure-failed`. */
export async function resolveSuccessClosureStopReason(args: {
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

/**
 * Build the canonical committed-round shape with optimizer metadata and
 * stop-condition hits. I keep this in one helper so all committed paths
 * produce the same durable representation.
 */
export function buildCommittedOptimizedRound(args: {
	scope: ResearchScope;
	roundScope: ResearchScope;
	rounds: OvernightResearchRound[];
	roundBase: OvernightResearchRound;
	runData: ResearchRunData;
	evaluation: ResearchEvaluationRecord;
	finalize: ResearchFinalizeResult;
	packed: Record<string, unknown> | null;
	recorded: Record<string, unknown> | null;
	roundNumber: number;
	state: RoundProgressState;
	projectedTotalDurationMs?: number;
}): { round: OvernightResearchRound; rounds: OvernightResearchRound[] } {
	const optimizedRound = withRoundOptimization(
		buildRecordedRound(
			{
				...args.roundBase,
				objectiveScores: evaluateResearchObjectives({
					scope: args.roundScope,
					evaluation: args.evaluation,
					run: args.runData,
					finalize: args.finalize,
					packed: args.packed,
				}),
			},
			args.packed,
			args.recorded,
		),
		args.roundScope,
	);
	const annotatedRounds = annotateParetoRounds([...args.rounds, optimizedRound]);
	const round = annotatedRounds[annotatedRounds.length - 1];
	round.stopConditionHits = evaluateResearchStopConditions({
		scope: args.scope,
		rounds: annotatedRounds,
		currentRound: args.roundNumber,
		noImprovementStreak: args.state.noImprovementStreak,
		totalDurationMs: args.projectedTotalDurationMs ?? args.state.totalDurationMs,
	});
	return { round, rounds: annotatedRounds };
}

/**
 * Handle a late cancellation after a successful run reached closure. I centralize
 * the cleanup/recovery logic here so the main round processor stays readable.
 */
export async function handleCancelledSuccessfulClosure(args: {
	scope: ResearchScope;
	council: ResearchCouncilSummary;
	interrupt: ResearchLoopInterruptHandle;
	roundScope: ResearchScope;
	roundNumber: number;
	runData: ResearchRunData;
	roundBase: OvernightResearchRound;
	evaluation: ResearchEvaluationRecord;
	finalize: ResearchFinalizeResult;
	packed: Record<string, unknown> | null;
	recorded: Record<string, unknown> | null;
	committed: boolean;
	counts: { keptRounds: number; revertedRounds: number };
	rounds: OvernightResearchRound[];
	state: RoundProgressState;
}): Promise<RoundSuccessResult> {
	if (args.committed) {
		const { round, rounds } = buildCommittedOptimizedRound({
			scope: args.scope,
			roundScope: args.roundScope,
			rounds: args.rounds,
			roundBase: args.roundBase,
			runData: args.runData,
			evaluation: args.evaluation,
			finalize: args.finalize,
			packed: args.packed,
			recorded: args.recorded,
			roundNumber: args.roundNumber,
			state: args.state,
		});
		applyCommittedRoundCounts(round, args.counts);
		return {
			kind: "stop",
			round,
			rounds,
			stopReason: stopReasonFromCancelReason(args.interrupt.getCancelReason()),
			state: args.state,
		};
	}

	let finalizeAction: string | null = null;
	if (runNeedsCleanup(args.runData)) {
		try {
			const recovery = await (await import("./chitragupta-nodes-research-runner.js")).recoverResearchFailure(
				args.roundScope,
				asRecord(args.runData),
				args.interrupt.signal,
			);
			finalizeAction = typeof recovery.action === "string" ? recovery.action : null;
			if (recovery.action !== "reverted") {
				const recoveryCancelled =
					isCancellationLikeError(new Error(recovery.reason ?? "cancelled"), args.interrupt)
					|| await refreshCancellationState(args.interrupt, args.scope, args.council, {
						currentRound: args.roundNumber,
						totalRounds: args.scope.maxRounds,
						attemptNumber: 1,
						phase: "closure-cancelled-recovery",
					});
				if (recoveryCancelled) {
					const round = cancelledRound(args.roundNumber, args.runData, finalizeAction);
					applyCommittedRoundCounts(round, args.counts);
					return {
						kind: "stop",
						round,
						rounds: [...args.rounds, round],
						stopReason: stopReasonFromCancelReason(args.interrupt.getCancelReason()),
						state: args.state,
					};
				}
				const stopReason = await resolveSuccessClosureStopReason({
					interrupt: args.interrupt,
					scope: args.scope,
					council: args.council,
					roundNumber: args.roundNumber,
					totalRounds: args.scope.maxRounds,
					phase: "closure-cancelled-recovery-failed",
				});
				const round = cancelledRound(args.roundNumber, args.runData, finalizeAction);
				return {
					kind: "stop",
					round,
					rounds: [...args.rounds, round],
					stopReason,
					degradedError: new Error(
						recovery.reason
							?? "Cancelled closure could not safely revert the uncommitted research round.",
					),
					state: args.state,
				};
			}
		} catch (recoveryError) {
			const recoveryCancelled =
				isCancellationLikeError(recoveryError, args.interrupt)
				|| await refreshCancellationState(args.interrupt, args.scope, args.council, {
					currentRound: args.roundNumber,
					totalRounds: args.scope.maxRounds,
					attemptNumber: 1,
					phase: "closure-cancelled-recovery-error",
				});
			if (recoveryCancelled) {
				const round = cancelledRound(args.roundNumber, args.runData, null);
				applyCommittedRoundCounts(round, args.counts);
				return {
					kind: "stop",
					round,
					rounds: [...args.rounds, round],
					stopReason: stopReasonFromCancelReason(args.interrupt.getCancelReason()),
					state: args.state,
				};
			}
			const stopReason = await resolveSuccessClosureStopReason({
				interrupt: args.interrupt,
				scope: args.scope,
				council: args.council,
				roundNumber: args.roundNumber,
				totalRounds: args.scope.maxRounds,
				phase: "closure-cancelled-recovery-error-failed",
				closureError: recoveryError,
			});
			const round = cancelledRound(args.roundNumber, args.runData, null);
			return {
				kind: "stop",
				round,
				rounds: [...args.rounds, round],
				stopReason,
				degradedError: recoveryError,
				state: args.state,
			};
		}
	}

	const round = cancelledRound(args.roundNumber, args.runData, finalizeAction);
	applyCommittedRoundCounts(round, args.counts);
	return {
		kind: "stop",
		round,
		rounds: [...args.rounds, round],
		stopReason: stopReasonFromCancelReason(args.interrupt.getCancelReason()),
		state: args.state,
	};
}
