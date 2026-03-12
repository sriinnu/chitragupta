import { createHash, randomBytes } from "node:crypto";
import type {
	ResearchCouncilSummary,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";

export type BaselineData = {
	metricName: string;
	objective: "minimize" | "maximize";
	baselineMetric: number | null;
	hypothesis?: string;
};

export type OvernightResearchRound = {
	roundNumber: number;
	decision: string;
	observedMetric: number | null;
	delta: number | null;
	finalizeAction: string | null;
	traceId: string | null;
	experimentId: string | null;
	packedRuntime: string | null;
	packedSource: string | null;
	selectedModelId: string | null;
	selectedProviderId: string | null;
	executionRouteClass: string | null;
};

/**
 * Normalized evaluation payload shared across run closure, recording, and
 * loop-summary construction.
 */
export type ResearchEvaluationRecord = {
	metricName: string;
	objective: "minimize" | "maximize";
	baselineMetric: number | null;
	observedMetric: number | null;
	delta: number | null;
	improved: boolean;
	decision: string;
	status?: string;
	errorMessage?: string;
};

export type OvernightResearchStopReason =
	| "max-rounds"
	| "no-improvement"
	| "budget-exhausted"
	| "cancelled"
	| "unsafe-discard"
	| "round-failed"
	| "closure-failed";

export type OvernightResearchSummary = {
	loopKey: string;
	roundsRequested: number;
	roundsCompleted: number;
	stopReason: OvernightResearchStopReason;
	bestMetric: number | null;
	bestRoundNumber: number | null;
	noImprovementStreak: number;
	totalDurationMs: number;
	totalBudgetMs: number;
	keptRounds: number;
	revertedRounds: number;
	sessionId: string | null;
	sabhaId: string | null;
	councilVerdict: string;
	plannerRoute: Record<string, unknown> | null;
	executionRoute: Record<string, unknown> | null;
	rounds: OvernightResearchRound[];
	summaryId?: string | null;
	summarySource?: "daemon" | "fallback" | null;
	closureStatus?: "complete" | "degraded";
	closureError?: string | null;
};

export function buildLoopKey(scope: ResearchScope, council: Record<string, unknown>): string {
	const base = JSON.stringify({
		projectPath: scope.projectPath,
		topic: scope.topic,
		hypothesis: scope.hypothesis,
		sessionLineageKey: scope.sessionLineageKey,
		parentSessionId: scope.parentSessionId,
		sessionId: typeof council.sessionId === "string" ? council.sessionId : null,
		sabhaId: typeof council.sabhaId === "string" ? council.sabhaId : null,
	});
	return createHash("sha1").update(base).digest("hex").slice(0, 16);
}

export function buildRuntimeLoopKey(scope: ResearchScope, council: Record<string, unknown>): string {
	const base = buildLoopKey(scope, council);
	const nonce = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
	return `${base}-${nonce}`;
}

export function buildSummary(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	rounds: OvernightResearchRound[],
	stopReason: OvernightResearchStopReason,
	bestMetric: number | null,
	bestRoundNumber: number | null,
	noImprovementStreak: number,
	totalDurationMs: number,
	keptRounds: number,
	revertedRounds: number,
	loopKey: string,
): OvernightResearchSummary {
	return {
		loopKey,
		roundsRequested: scope.maxRounds,
		roundsCompleted: rounds.length,
		stopReason,
		bestMetric,
		bestRoundNumber,
		noImprovementStreak,
		totalDurationMs,
		totalBudgetMs: scope.totalBudgetMs,
		keptRounds,
		revertedRounds,
		sessionId: council.sessionId,
		sabhaId: council.sabhaId,
		councilVerdict: council.finalVerdict,
		plannerRoute: council.plannerRoute as Record<string, unknown> | null,
		executionRoute: council.executionRoute as Record<string, unknown> | null,
		rounds,
		closureStatus: "complete",
		closureError: null,
	};
}

export function withDegradedClosure(
	summary: OvernightResearchSummary,
	error: unknown,
): OvernightResearchSummary {
	return {
		...summary,
		closureStatus: "degraded",
		closureError: error instanceof Error ? error.message : String(error),
	};
}
