import type {
	ResearchCouncilSummary,
	ResearchFinalizeResult,
	ResearchRunData,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import type {
	BaselineData,
	OvernightResearchRound,
	OvernightResearchStopReason,
	ResearchEvaluationRecord,
} from "./chitragupta-nodes-research-overnight-types.js";
import {
	buildCarryContext,
	normalizeContextForReuse,
	unpackContextForReuse,
	withinRemainingLoopBudget,
} from "./chitragupta-nodes-research-overnight-context.js";
import {
	heartbeatResearchLoopInterrupt,
	type ResearchLoopInterruptHandle,
} from "./chitragupta-nodes-research-interrupt.js";
import {
	packResearchContext,
	recordResearchFailure,
	recordResearchOutcome,
} from "./chitragupta-nodes-research-recording.js";
import {
	assertLoopNotCancelled,
	isCancellationLikeError,
	refreshCancellationState,
} from "./chitragupta-nodes-research-overnight-control.js";
import {
	applyProgressState,
	buildFailedRun,
	buildRoundBase,
} from "./chitragupta-nodes-research-overnight-state.js";

function asRecord(value: object): Record<string, unknown> {
	return value as unknown as Record<string, unknown>;
}

export function cancelledRound(
	roundNumber: number,
	runData: {
		metric?: number | null;
		selectedModelId?: string | null;
		selectedProviderId?: string | null;
		executionRouteClass?: string | null;
	} = {},
	finalizeAction: string | null = null,
): OvernightResearchRound {
	return {
		roundNumber,
		decision: "cancelled",
		observedMetric: typeof runData.metric === "number" ? runData.metric : null,
		delta: null,
		finalizeAction,
		traceId: null,
		experimentId: null,
		packedRuntime: null,
		packedSource: null,
		selectedModelId: typeof runData.selectedModelId === "string" ? runData.selectedModelId : null,
		selectedProviderId: typeof runData.selectedProviderId === "string" ? runData.selectedProviderId : null,
		executionRouteClass: typeof runData.executionRouteClass === "string" ? runData.executionRouteClass : null,
	};
}

export function buildRecordedRound(
	roundBase: OvernightResearchRound,
	packed: Record<string, unknown> | null,
	recorded: Record<string, unknown> | null,
): OvernightResearchRound {
	return {
		...roundBase,
		traceId: recorded && typeof recorded.traceId === "string" ? recorded.traceId : null,
		experimentId: recorded && typeof recorded.experimentId === "string" ? recorded.experimentId : null,
		packedRuntime: packed && typeof packed.runtime === "string" ? packed.runtime : null,
		packedSource: packed && typeof packed.source === "string" ? packed.source : null,
	};
}

export function applyCommittedRoundCounts(
	round: Pick<OvernightResearchRound, "finalizeAction">,
	counts: { keptRounds: number; revertedRounds: number },
): void {
	if (round.finalizeAction === "kept") counts.keptRounds += 1;
	if (round.finalizeAction === "reverted") counts.revertedRounds += 1;
}

type RoundProgressState = {
	bestMetric: number | null;
	bestRoundNumber: number | null;
	noImprovementStreak: number;
	totalDurationMs: number;
	loopKey: string;
};

type RoundSuccessResult =
	| {
		kind: "continue";
		round: OvernightResearchRound;
		nextCarryContext: string;
		state: RoundProgressState;
	}
	| {
		kind: "stop";
		round: OvernightResearchRound;
		stopReason: OvernightResearchStopReason;
		degradedError?: unknown;
		state: RoundProgressState;
	};

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
}): Promise<RoundSuccessResult> {
	const {
		scope, council, interrupt, roundScope, roundNumber, roundStartedAt,
		roundBase, runData, evaluation, finalize, counts,
	} = args;
	let state = { ...args.state };
	let packed: Record<string, unknown> | null = null;
	let recorded: Record<string, unknown> | null = null;
	let committed = false;
	try {
		assertLoopNotCancelled(interrupt);
		packed = await withinRemainingLoopBudget(
			scope,
			state.totalDurationMs,
			roundStartedAt,
			"overnight context pack",
			interrupt.signal,
				async (signal) => packResearchContext(roundScope, asRecord(council), asRecord(runData), asRecord(evaluation), signal),
		);
		assertLoopNotCancelled(interrupt);
		recorded = await withinRemainingLoopBudget(
			scope,
			state.totalDurationMs,
			roundStartedAt,
			"overnight outcome record",
			interrupt.signal,
					async (signal) => recordResearchOutcome(roundScope, asRecord(council), asRecord(runData), asRecord(evaluation), asRecord(finalize), packed ?? {}, signal),
			);
		committed = true;
		applyProgressState(
			state,
			roundBase.observedMetric,
			roundBase.decision,
			roundNumber,
		);
		assertLoopNotCancelled(interrupt);
		const packedText = packed && typeof packed.packedText === "string" ? packed.packedText : "";
		const unpacked = packedText
			? await withinRemainingLoopBudget(
				scope,
				state.totalDurationMs,
				roundStartedAt,
				"overnight context unpack",
				interrupt.signal,
				async (signal) => unpackContextForReuse(packedText, signal),
			)
			: "";
		assertLoopNotCancelled(interrupt);
		const nextCarryContext = await withinRemainingLoopBudget(
			scope,
			state.totalDurationMs,
			roundStartedAt,
			"overnight context normalize",
			interrupt.signal,
			async (signal) => normalizeContextForReuse(buildCarryContext(roundScope, roundBase, unpacked), signal),
		);
		assertLoopNotCancelled(interrupt);

		const round = buildRecordedRound(roundBase, packed, recorded);
		applyCommittedRoundCounts(round, counts);
		state = {
			...state,
			totalDurationMs: state.totalDurationMs + (Date.now() - roundStartedAt),
		};

		const postClosureLoopState = await heartbeatResearchLoopInterrupt(interrupt, scope, council, {
			currentRound: roundNumber,
			totalRounds: scope.maxRounds,
			attemptNumber: 1,
			phase: "after-closure",
		});
		if (postClosureLoopState.cancelled) {
			return { kind: "stop", round, stopReason: "cancelled", state };
		}
		if (state.totalDurationMs >= scope.totalBudgetMs) {
			return { kind: "stop", round, stopReason: "budget-exhausted", state };
		}
		if (state.noImprovementStreak >= scope.stopAfterNoImprovementRounds) {
			return { kind: "stop", round, stopReason: "no-improvement", state };
		}
		return {
			kind: "continue",
			round,
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
			const round = recorded
				? buildRecordedRound(roundBase, packed, recorded)
				: cancelledRound(roundNumber, runData, roundBase.finalizeAction);
			if (committed) {
				applyCommittedRoundCounts(round, counts);
			}
			return { kind: "stop", round, stopReason: "cancelled", state };
		}
		const round = recorded ? buildRecordedRound(roundBase, packed, recorded) : roundBase;
		if (committed) {
			applyCommittedRoundCounts(round, counts);
		}
		return { kind: "stop", round, stopReason: "closure-failed", degradedError: error, state };
	}
}

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
	let totalDurationMs = args.state.totalDurationMs;
	try {
			failureFinalize = await withinRemainingLoopBudget(
				scope,
				totalDurationMs,
				roundStartedAt,
				"overnight failure finalize",
				interrupt.signal,
				async () => (await import("./chitragupta-nodes-research-runner.js")).recoverResearchFailure(roundScope, failedRun),
			).then((result) => asRecord(result));
		assertLoopNotCancelled(interrupt);
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
					errorMessage: typeof failedRun.errorMessage === "string" ? failedRun.errorMessage : undefined,
				},
				signal,
			),
		);
		assertLoopNotCancelled(interrupt);
		failureRecorded = await withinRemainingLoopBudget(
			scope,
			totalDurationMs,
			roundStartedAt,
			"overnight failure outcome record",
			interrupt.signal,
			async (signal) => recordResearchFailure(
				roundScope,
				args.council as unknown as Record<string, unknown>,
				failedRun,
				failurePacked as Record<string, unknown>,
				failureFinalize as Record<string, unknown>,
				signal,
			),
		);

		const round = {
			roundNumber,
			decision: "record",
			observedMetric: typeof failedRun.metric === "number" ? failedRun.metric : null,
			delta: null,
			finalizeAction: typeof failureFinalize?.action === "string" ? failureFinalize.action : null,
			traceId: typeof failureRecorded?.traceId === "string" ? failureRecorded.traceId : null,
			experimentId: typeof failureRecorded?.experimentId === "string" ? failureRecorded.experimentId : null,
			packedRuntime: typeof failurePacked?.runtime === "string" ? failurePacked.runtime : null,
			packedSource: typeof failurePacked?.source === "string" ? failurePacked.source : null,
			selectedModelId: typeof failedRun.selectedModelId === "string" ? failedRun.selectedModelId : null,
			selectedProviderId: typeof failedRun.selectedProviderId === "string" ? failedRun.selectedProviderId : null,
			executionRouteClass: typeof failedRun.executionRouteClass === "string" ? failedRun.executionRouteClass : null,
		} satisfies OvernightResearchRound;
		applyCommittedRoundCounts(round, counts);
		totalDurationMs += Date.now() - roundStartedAt;
		return { round, stopReason: "round-failed", totalDurationMs };
	} catch (closureError) {
		const cancelled =
			isCancellationLikeError(closureError, interrupt)
			|| await refreshCancellationState(interrupt, scope, args.council, {
				currentRound: roundNumber,
				totalRounds: scope.maxRounds,
				attemptNumber: 1,
				phase: "failure-closure-error",
			});
		totalDurationMs += Date.now() - roundStartedAt;
		const round = {
			roundNumber,
			decision: "record",
			observedMetric: typeof failedRun.metric === "number" ? failedRun.metric : null,
			delta: null,
			finalizeAction: typeof failureFinalize?.action === "string" ? failureFinalize.action : null,
			traceId: typeof failureRecorded?.traceId === "string" ? failureRecorded.traceId : null,
			experimentId: typeof failureRecorded?.experimentId === "string" ? failureRecorded.experimentId : null,
			packedRuntime: typeof failurePacked?.runtime === "string" ? failurePacked.runtime : null,
			packedSource: typeof failurePacked?.source === "string" ? failurePacked.source : null,
			selectedModelId: typeof failedRun.selectedModelId === "string" ? failedRun.selectedModelId : null,
			selectedProviderId: typeof failedRun.selectedProviderId === "string" ? failedRun.selectedProviderId : null,
			executionRouteClass: typeof failedRun.executionRouteClass === "string" ? failedRun.executionRouteClass : null,
		} satisfies OvernightResearchRound;
		return {
			round,
			stopReason: cancelled ? "cancelled" : "closure-failed",
			totalDurationMs,
			degradedError: closureError,
		};
	}
}
