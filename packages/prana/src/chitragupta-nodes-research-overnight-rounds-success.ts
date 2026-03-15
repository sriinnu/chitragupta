import type {
	ResearchCouncilSummary,
	ResearchFinalizeResult,
	ResearchRunData,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import type {
	BaselineData,
	OvernightResearchCheckpoint,
	OvernightResearchRound,
	OvernightResearchStopReason,
	ResearchEvaluationRecord,
} from "./chitragupta-nodes-research-overnight-types.js";
import { stopReasonFromCancelReason } from "./chitragupta-nodes-research-overnight-types.js";
import {
	buildCarryContext,
	normalizeContextForReuseWithPolicy,
	unpackContextForReuseWithPolicy,
	withinRemainingLoopBudget,
} from "./chitragupta-nodes-research-overnight-context.js";
import {
	heartbeatResearchLoopInterrupt,
	type ResearchLoopInterruptHandle,
} from "./chitragupta-nodes-research-interrupt.js";
import {
	packResearchContext,
	recordResearchOutcome,
	syncResearchExperimentRecord,
} from "./chitragupta-nodes-research-recording.js";
import {
	assertLoopNotCancelled,
	isCancellationLikeError,
	refreshCancellationState,
} from "./chitragupta-nodes-research-overnight-control.js";
import { applyProgressState } from "./chitragupta-nodes-research-overnight-state.js";
import {
	applyCommittedRoundCounts,
	asRecord,
	buildCheckpoint,
	buildRecordedRound,
	type RoundProgressState,
	type SaveRoundCheckpoint,
} from "./chitragupta-nodes-research-overnight-rounds-shared.js";
import {
	evaluateResearchStopConditions,
	selectResearchStopReason,
} from "./chitragupta-nodes-research-optimization.js";
import {
	buildCommittedOptimizedRound,
	handleCancelledSuccessfulClosure,
	resolveSuccessClosureStopReason,
	type RoundSuccessResult,
} from "./chitragupta-nodes-research-overnight-rounds-success-helpers.js";

/**
 * Complete the successful closure path for one overnight research round.
 * This stage packs context, records the durable result, and prepares the
 * next carry-context for the following round.
 */
export async function processSuccessfulRoundClosure(args: {
	scope: ResearchScope;
	council: ResearchCouncilSummary;
	interrupt: ResearchLoopInterruptHandle;
	roundScope: ResearchScope;
	roundNumber: number;
	roundStartedAt: number;
	roundBase: OvernightResearchRound;
	runData: ResearchRunData;
	evaluation: ResearchEvaluationRecord;
	finalize: ResearchFinalizeResult;
	counts: { keptRounds: number; revertedRounds: number };
	state: RoundProgressState;
	currentBaseline: BaselineData;
	carryContext: string;
	rounds: OvernightResearchRound[];
	saveCheckpoint: SaveRoundCheckpoint;
	resumeCheckpoint?: OvernightResearchCheckpoint | null;
	forcedStopReason?: OvernightResearchStopReason | null;
}): Promise<RoundSuccessResult> {
	const {
		scope, council, interrupt, roundScope, roundNumber, roundStartedAt,
		roundBase, runData, evaluation, finalize, counts,
	} = args;
	let state = { ...args.state };
	let packed: Record<string, unknown> | null = null;
	let recorded: Record<string, unknown> | null = null;
	let committed = false;
	let runDataForRecord: Record<string, unknown> = asRecord(runData);
	const resumeCheckpoint = args.resumeCheckpoint ?? null;
	const resumePhase = resumeCheckpoint?.phase ?? null;
	try {
		if (resumePhase && !resumePhase.startsWith("closure-")) {
			throw new Error(`Invalid resume phase for successful round closure: ${resumePhase}`);
		}
		packed = resumeCheckpoint?.activeRound?.packed ?? null;
		recorded = resumeCheckpoint?.activeRound?.recorded ?? null;
			if (resumePhase === null || resumePhase === "closure-pack") {
				await args.saveCheckpoint("closure-pack", buildCheckpoint(
					"closure-pack",
					scope,
					state.loopKey,
					args.currentBaseline,
				state,
				counts,
				args.carryContext,
				args.rounds,
				roundNumber,
				{
					roundNumber,
					roundBase,
					runData: asRecord(runData),
					evaluation,
					finalize: asRecord(finalize),
					packed,
					recorded,
				},
			));
			assertLoopNotCancelled(interrupt);
			packed = await withinRemainingLoopBudget(
				scope,
				state.totalDurationMs,
				roundStartedAt,
				"overnight context pack",
				interrupt.signal,
				async (signal) => packResearchContext(
					roundScope,
					asRecord(council),
					asRecord(runData),
					asRecord(evaluation),
					signal,
					{ fallbackPolicy: "daemon-only" },
				),
			);
			}
			assertLoopNotCancelled(interrupt);
			if (
				resumePhase === null
				|| resumePhase === "closure-pack"
				|| resumePhase === "closure-record"
				) {
					await args.saveCheckpoint("closure-record", buildCheckpoint(
						"closure-record",
						scope,
						state.loopKey,
						args.currentBaseline,
					state,
					counts,
					args.carryContext,
					args.rounds,
					roundNumber,
					{
						roundNumber,
						roundBase,
						runData: asRecord(runData),
						evaluation,
						finalize: asRecord(finalize),
						packed,
						recorded,
					},
				));
				runDataForRecord = {
					...asRecord(runData),
					roundWallClockDurationMs: Date.now() - roundStartedAt,
				};
				recorded = await withinRemainingLoopBudget(
					scope,
					state.totalDurationMs,
					roundStartedAt,
					"overnight outcome record",
					interrupt.signal,
					async (signal) => recordResearchOutcome(
						roundScope,
						asRecord(council),
						runDataForRecord,
						asRecord(evaluation),
						asRecord(finalize),
						packed ?? {},
						signal,
						{ fallbackPolicy: "daemon-only" },
					),
				);
			}
		committed = true;
		applyProgressState(
			state,
			roundBase.observedMetric,
			roundBase.decision,
			roundNumber,
		);
			assertLoopNotCancelled(interrupt);
			await args.saveCheckpoint("closure-unpack", buildCheckpoint(
				"closure-unpack",
				scope,
				state.loopKey,
				args.currentBaseline,
			state,
			counts,
			args.carryContext,
			args.rounds,
			roundNumber,
			{
				roundNumber,
				roundBase,
				runData: asRecord(runData),
				evaluation,
				finalize: asRecord(finalize),
				packed,
				recorded,
			},
		));
		const packedText = packed && typeof packed.packedText === "string" ? packed.packedText : "";
		// I only unpack after the round is durably recorded. That keeps the
		// committed round authoritative even if read-side carry-context recovery
		// fails or is cancelled after the durable write already succeeded.
		const unpacked = packedText
			? await withinRemainingLoopBudget(
				scope,
				state.totalDurationMs,
				roundStartedAt,
				"overnight context unpack",
				interrupt.signal,
					async (signal) => unpackContextForReuseWithPolicy(
						packedText,
						signal,
						"daemon-only",
					),
				)
				: "";
			assertLoopNotCancelled(interrupt);
			await args.saveCheckpoint("closure-normalize", buildCheckpoint(
				"closure-normalize",
				scope,
				state.loopKey,
				args.currentBaseline,
			state,
			counts,
			args.carryContext,
			args.rounds,
			roundNumber,
			{
				roundNumber,
				roundBase,
				runData: asRecord(runData),
				evaluation,
				finalize: asRecord(finalize),
				packed,
				recorded,
			},
		));
		// Normalization is the final read-side polish step. The loop can still
		// stop safely after a committed round even if this phase degrades, because
		// the durable round/ledger state was already written above.
			const nextCarryContext = await withinRemainingLoopBudget(
			scope,
			state.totalDurationMs,
			roundStartedAt,
			"overnight context normalize",
			interrupt.signal,
				async (signal) => normalizeContextForReuseWithPolicy(
					buildCarryContext(roundScope, roundBase, unpacked),
					signal,
					"daemon-only",
				),
			);
			assertLoopNotCancelled(interrupt);

			const roundWallClockDurationMs = Date.now() - roundStartedAt;
			runDataForRecord = {
				...runDataForRecord,
				roundWallClockDurationMs,
			};
			const projectedTotalDurationMs = state.totalDurationMs + roundWallClockDurationMs;
				const { round, rounds: annotatedRounds } = buildCommittedOptimizedRound({
				scope,
				roundScope,
				rounds: args.rounds,
			roundBase,
			runData,
			evaluation,
			finalize,
			packed,
			recorded,
				roundNumber,
					state,
					projectedTotalDurationMs,
				});
				await heartbeatResearchLoopInterrupt(interrupt, scope, council, {
					currentRound: roundNumber,
					totalRounds: scope.maxRounds,
					attemptNumber: 1,
					phase: "closure-record-sync",
				});
				await withinRemainingLoopBudget(
					scope,
					state.totalDurationMs,
					roundStartedAt,
					"overnight experiment sync",
					interrupt.signal,
					(signal) => syncResearchExperimentRecord(
						roundScope,
						asRecord(council),
						runDataForRecord,
						{
							...asRecord(evaluation),
							objectiveScores: round.objectiveScores ?? [],
							stopConditionHits: round.stopConditionHits ?? [],
							optimizerScore: round.optimizerScore ?? null,
							paretoRank: round.paretoRank ?? null,
							paretoDominated: round.paretoDominated ?? null,
						},
						asRecord(finalize),
						packed ?? {},
						signal,
						{ fallbackPolicy: "daemon-only" },
					),
				);
			applyCommittedRoundCounts(round, counts);
			state = {
				...state,
				totalDurationMs: projectedTotalDurationMs,
			};
			if (args.forcedStopReason) {
				// I stop only after the successful closure committed the round. That
				// keeps the final accepted round durable even when the loop budget is
				// exhausted immediately after the run completes.
				return {
					kind: "stop",
					round,
					rounds: annotatedRounds,
					stopReason: args.forcedStopReason,
					state,
				};
			}

			const postClosureLoopState = await heartbeatResearchLoopInterrupt(interrupt, scope, council, {
				currentRound: roundNumber,
				totalRounds: scope.maxRounds,
				attemptNumber: 1,
				phase: "after-closure",
			});
		if (postClosureLoopState.cancelled) {
			return {
				kind: "stop",
				round,
				rounds: annotatedRounds,
				stopReason: stopReasonFromCancelReason(postClosureLoopState.reason),
				state,
			};
		}
		const stopConditionHits = round.stopConditionHits ?? [];
		const triggeredStops = stopConditionHits.filter((hit) => hit.triggered);
		if (triggeredStops.length > 0) {
			return {
				kind: "stop",
				round,
				rounds: annotatedRounds,
				stopReason: selectResearchStopReason(triggeredStops),
				state,
			};
		}
		return {
			kind: "continue",
			round,
			rounds: annotatedRounds,
			nextCarryContext,
			state,
		};
	} catch (error) {
		const cancelled =
			isCancellationLikeError(error, interrupt)
			|| await refreshCancellationState(interrupt, scope, council, {
				currentRound: roundNumber,
				totalRounds: scope.maxRounds,
				attemptNumber: 1,
				phase: "closure-error",
			});
		state = {
			...state,
			totalDurationMs: state.totalDurationMs + (Date.now() - roundStartedAt),
		};
		if (cancelled) {
			return handleCancelledSuccessfulClosure({
				scope,
				council,
				interrupt,
				roundScope,
				roundNumber,
				runData,
				roundBase,
				evaluation,
				finalize,
				packed,
				recorded,
				committed,
				counts,
				rounds: args.rounds,
				state,
			});
		}
		if (committed) {
			applyProgressState(
				state,
				roundBase.observedMetric,
				roundBase.decision,
				roundNumber,
			);
			const { round, rounds } = buildCommittedOptimizedRound({
				scope,
				roundScope,
				rounds: args.rounds,
				roundBase,
				runData,
				evaluation,
				finalize,
				packed,
				recorded,
				roundNumber,
				state,
			});
			applyCommittedRoundCounts(round, counts);
			const stopReason = await resolveSuccessClosureStopReason({
				interrupt,
				scope,
				council,
				roundNumber,
				totalRounds: scope.maxRounds,
				phase: "closure-error-committed",
				closureError: error,
			});
			return {
				kind: "stop",
				round,
				rounds,
				stopReason,
				degradedError: error,
				state,
			};
		}
		const stopReason = await resolveSuccessClosureStopReason({
			interrupt,
			scope,
			council,
			roundNumber,
			totalRounds: scope.maxRounds,
			phase: "closure-error-uncommitted",
			closureError: error,
		});
		return {
			kind: "stop",
			round: recorded ? buildRecordedRound(roundBase, packed, recorded) : roundBase,
			rounds: [...args.rounds, recorded ? buildRecordedRound(roundBase, packed, recorded) : roundBase],
			stopReason,
			degradedError: error,
			state,
		};
	}
}

export type { RoundSuccessResult };
