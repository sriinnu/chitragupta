import type {
	ResearchCouncilSummary,
	ResearchFinalizeResult,
	ResearchRunData,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import type {
	OvernightResearchSummary,
	OvernightResearchRound,
	ResearchEvaluationRecord,
} from "./chitragupta-nodes-research-overnight-types.js";
import { buildSummary } from "./chitragupta-nodes-research-overnight-types.js";
import type { RoundProgressState } from "./chitragupta-nodes-research-overnight-rounds.js";

/**
 * Build the canonical round shape before recording/packing enriches it with
 * trace ids and packed-runtime metadata.
 */
export function buildRoundBase(
	roundNumber: number,
	runData: ResearchRunData,
	evaluation: ResearchEvaluationRecord,
	finalize: ResearchFinalizeResult,
): OvernightResearchRound {
	return {
		roundNumber,
		decision: typeof evaluation.decision === "string" ? evaluation.decision : "record",
		observedMetric: typeof evaluation.observedMetric === "number" ? evaluation.observedMetric : null,
		delta: typeof evaluation.delta === "number" ? evaluation.delta : null,
		finalizeAction: typeof finalize.action === "string" ? finalize.action : null,
		traceId: null,
		experimentId: null,
		packedRuntime: null,
		packedSource: null,
		selectedModelId: typeof runData.selectedModelId === "string" ? runData.selectedModelId : null,
		selectedProviderId: typeof runData.selectedProviderId === "string" ? runData.selectedProviderId : null,
		executionRouteClass: typeof runData.executionRouteClass === "string" ? runData.executionRouteClass : null,
		objectiveScores: evaluation.objectiveScores ?? [],
		stopConditionHits: evaluation.stopConditionHits ?? [],
		optimizerScore: typeof evaluation.optimizerScore === "number" ? evaluation.optimizerScore : null,
		paretoRank: null,
		paretoDominated: false,
	};
}

/**
 * Normalize a failed run into the looser closure payload shape used by failure
 * recording/recovery. This keeps runtime errors and process exits on one path.
 */
export function buildFailedRun(
	error: unknown,
	roundScope: ResearchScope,
	roundStartedAt: number,
): Record<string, unknown> & {
	metric?: number | null;
	selectedModelId?: string | null;
	selectedProviderId?: string | null;
	executionRouteClass?: string | null;
	targetFilesChanged?: string[];
} {
	const runError = error as Error & Record<string, unknown>;
	return {
		metric: typeof runError.metric === "number" ? runError.metric : null,
		stdout: typeof runError.stdout === "string" ? runError.stdout : "",
		stderr: typeof runError.stderr === "string" ? runError.stderr : "",
		exitCode: typeof runError.exitCode === "number" ? runError.exitCode : null,
		timedOut: runError.timedOut === true,
		durationMs:
			typeof runError.durationMs === "number"
				? runError.durationMs
				: Date.now() - roundStartedAt,
		scopeGuard: runError.scopeGuard === "hash-only" ? "hash-only" : "git",
		targetFilesChanged: Array.isArray(runError.targetFilesChanged)
			? runError.targetFilesChanged.filter((value): value is string => typeof value === "string")
			: [],
		executionRouteClass:
			typeof runError.executionRouteClass === "string"
				? runError.executionRouteClass
				: roundScope.executionRouteClass,
		selectedCapabilityId:
			typeof runError.selectedCapabilityId === "string" ? runError.selectedCapabilityId : null,
		selectedModelId: typeof runError.selectedModelId === "string" ? runError.selectedModelId : null,
		selectedProviderId:
			typeof runError.selectedProviderId === "string" ? runError.selectedProviderId : null,
		gitBranch: typeof runError.gitBranch === "string" ? runError.gitBranch : null,
		gitHeadCommit: typeof runError.gitHeadCommit === "string" ? runError.gitHeadCommit : null,
		gitDirtyBefore:
			typeof runError.gitDirtyBefore === "boolean" ? runError.gitDirtyBefore : null,
		gitDirtyAfter:
			typeof runError.gitDirtyAfter === "boolean" ? runError.gitDirtyAfter : null,
		scopeSnapshot: runError.scopeSnapshot,
		errorMessage: error instanceof Error ? error.message : String(error),
	};
}

/**
 * Advance loop-best tracking from a round result.
 * Baseline advancement stays in the caller because it changes execution input
 * for subsequent rounds, while this helper keeps summary metrics consistent.
 */
export function applyProgressState(
	state: {
		bestMetric: number | null;
		bestRoundNumber: number | null;
		noImprovementStreak: number;
		totalDurationMs: number;
	},
	metric: number | null,
	decision: string,
	roundNumber: number,
): void {
	const improved = decision === "keep" && typeof metric === "number";
	if (improved) {
		state.bestMetric = metric;
		state.bestRoundNumber = roundNumber;
		state.noImprovementStreak = 0;
	} else {
		state.noImprovementStreak += 1;
	}
}

/**
 * Build a loop summary from the mutable overnight-loop state without forcing
 * callers to duplicate the same long summary construction block.
 */
export function buildLoopSummaryFromState(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	rounds: OvernightResearchRound[],
	stopReason: OvernightResearchSummary["stopReason"],
	progress: {
		bestMetric: number | null;
		bestRoundNumber: number | null;
		noImprovementStreak: number;
		totalDurationMs: number;
	},
	roundCounts: { keptRounds: number; revertedRounds: number },
	loopKey: string,
): OvernightResearchSummary {
	return buildSummary(
		scope,
		council,
		rounds,
		stopReason,
		progress.bestMetric,
		progress.bestRoundNumber,
		progress.noImprovementStreak,
		progress.totalDurationMs,
		roundCounts.keptRounds,
		roundCounts.revertedRounds,
		loopKey,
	);
}

/** Narrow a generic object into the record shape used by checkpoint payloads. */
export function asRoundRecord(value: object): Record<string, unknown> {
	return value as unknown as Record<string, unknown>;
}

/** A failed run only needs cleanup when it mutated bounded scope state. */
export function failedRunNeedsCleanup(run: Record<string, unknown>): boolean {
	return Boolean(run.scopeSnapshot)
		|| (Array.isArray(run.targetFilesChanged) && run.targetFilesChanged.length > 0);
}

/** Snapshot the mutable progress counters into the round-closure helper shape. */
export function buildRoundProgressState(
	bestMetric: number | null,
	bestRoundNumber: number | null,
	noImprovementStreak: number,
	totalDurationMs: number,
	loopKey: string,
): RoundProgressState {
	return {
		bestMetric,
		bestRoundNumber,
		noImprovementStreak,
		totalDurationMs,
		loopKey,
	};
}
