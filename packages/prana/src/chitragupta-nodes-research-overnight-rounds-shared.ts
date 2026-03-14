import type {
	ResearchScope,
	ResearchRunData,
} from "./chitragupta-nodes-research-shared.js";
import type {
	BaselineData,
	OvernightResearchCheckpoint,
	OvernightResearchCheckpointPhase,
	OvernightResearchProgress,
	OvernightResearchRound,
	OvernightResearchRoundCounts,
} from "./chitragupta-nodes-research-overnight-types.js";
import { buildResearchPolicySnapshot } from "./chitragupta-nodes-research-overnight-types.js";

/** Normalize rich round payloads into a serializable checkpoint shape. */
export function asRecord(value: object): Record<string, unknown> {
	return value as unknown as Record<string, unknown>;
}

/** Decide whether a partially-executed run still needs bounded cleanup. */
export function runNeedsCleanup(
	run: Pick<ResearchRunData, "targetFilesChanged" | "scopeSnapshot">,
): boolean {
	return Boolean(run.scopeSnapshot)
		|| (Array.isArray(run.targetFilesChanged) && run.targetFilesChanged.length > 0);
}

/** Build a synthetic cancelled round when a run is interrupted mid-flight. */
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
		objectiveScores: [],
		stopConditionHits: [],
		optimizerScore: 0,
		paretoRank: null,
		paretoDominated: false,
	};
}

/** Attach the durable recording ids and packing runtime to a completed round. */
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

/** Track how many rounds were kept vs reverted for loop summaries. */
export function applyCommittedRoundCounts(
	round: Pick<OvernightResearchRound, "finalizeAction">,
	counts: { keptRounds: number; revertedRounds: number },
): void {
	if (round.finalizeAction === "kept") counts.keptRounds += 1;
	if (round.finalizeAction === "reverted") counts.revertedRounds += 1;
}

/**
 * Mutable progress snapshot carried between round execution and closure.
 *
 * I keep this narrower than the full checkpoint payload so closure helpers can
 * update the moving loop state without rewriting unrelated round history.
 */
export type RoundProgressState = {
	bestMetric: OvernightResearchProgress["bestMetric"];
	bestRoundNumber: OvernightResearchProgress["bestRoundNumber"];
	noImprovementStreak: OvernightResearchProgress["noImprovementStreak"];
	totalDurationMs: OvernightResearchProgress["totalDurationMs"];
	loopKey: string;
};

/**
 * Persist one resumable checkpoint phase for the active overnight round.
 *
 * The overnight loop passes this seam down into round helpers so they can
 * checkpoint aggressively without importing daemon/storage details directly.
 */
export type SaveRoundCheckpoint = (
	phase: OvernightResearchCheckpointPhase,
	checkpoint: OvernightResearchCheckpoint,
) => Promise<void>;

/** Build a resumable checkpoint snapshot for the current round phase. */
export function buildCheckpoint(
	phase: OvernightResearchCheckpointPhase,
	scope: ResearchScope,
	loopKey: string,
	currentBaseline: BaselineData,
	state: RoundProgressState,
	counts: OvernightResearchRoundCounts,
	carryContext: string,
	rounds: OvernightResearchRound[],
	nextRoundNumber: number,
	activeRound: OvernightResearchCheckpoint["activeRound"],
): OvernightResearchCheckpoint {
	return {
		version: 1,
		loopKey,
		phase,
		policy: buildResearchPolicySnapshot(scope),
		currentBaseline,
		progress: {
			bestMetric: state.bestMetric,
			bestRoundNumber: state.bestRoundNumber,
			noImprovementStreak: state.noImprovementStreak,
			totalDurationMs: state.totalDurationMs,
		},
		roundCounts: { ...counts },
		carryContext,
		rounds: [...rounds],
		nextRoundNumber,
		activeRound,
	};
}
