import type {
	OvernightResearchSummary,
} from "./chitragupta-nodes-research-overnight.js";
import type { ResearchCouncilSummary, ResearchScope } from "./chitragupta-nodes-research-shared.js";
import { throwIfResearchAborted } from "./chitragupta-nodes-research-abort.js";
import { dynamicImport } from "./chitragupta-nodes.js";
import { withDaemonClient } from "./chitragupta-nodes-research-daemon.js";

const DAEMON_UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ENOENT", "EACCES", "EPIPE", "ECONNRESET"]);

function selectedBindingField(
	route: Record<string, unknown> | null | undefined,
	key: "selectedModelId" | "selectedProviderId",
): string | null {
	const binding = route?.executionBinding as
		| {
				selectedModelId?: unknown;
				selectedProviderId?: unknown;
		  }
		| undefined;
	const value = binding?.[key];
	return typeof value === "string" ? value : null;
}

function shouldFallbackToLocalLoopRecording(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (typeof code === "string" && DAEMON_UNAVAILABLE_CODES.has(code)) return true;
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	return /daemon unavailable|connect econnrefused|enoent|eacces|epipe|econnreset|socket hang up|socket closed|method not found|unknown method|not implemented|research\.loops\.record/i.test(
		message,
	);
}

export async function recordResearchLoopSummary(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	summary: OvernightResearchSummary,
	signal?: AbortSignal,
): Promise<{ summaryId: string; source: "daemon" | "fallback" }> {
	throwIfResearchAborted(signal);
	const payload = {
		projectPath: scope.projectPath,
		loopKey: summary.loopKey,
		sessionId: summary.sessionId,
		parentSessionId: scope.parentSessionId,
		sessionLineageKey: scope.sessionLineageKey,
		sabhaId: summary.sabhaId,
		councilVerdict: summary.councilVerdict,
		topic: scope.topic,
		hypothesis: scope.hypothesis,
		roundsRequested: summary.roundsRequested,
		roundsCompleted: summary.roundsCompleted,
		stopReason: summary.stopReason,
		bestMetric: summary.bestMetric,
		bestRoundNumber: summary.bestRoundNumber,
		noImprovementStreak: summary.noImprovementStreak,
		totalDurationMs: summary.totalDurationMs,
		totalBudgetMs: summary.totalBudgetMs,
		keptRounds: summary.keptRounds,
		revertedRounds: summary.revertedRounds,
		plannerRouteClass:
			summary.plannerRoute && typeof summary.plannerRoute.routeClass === "string"
				? summary.plannerRoute.routeClass
				: null,
		plannerSelectedCapabilityId:
			summary.plannerRoute && typeof summary.plannerRoute.selectedCapabilityId === "string"
				? summary.plannerRoute.selectedCapabilityId
				: null,
		plannerSelectedModelId:
			selectedBindingField(summary.plannerRoute, "selectedModelId"),
		plannerSelectedProviderId:
			selectedBindingField(summary.plannerRoute, "selectedProviderId"),
		executionRouteClass:
			summary.executionRoute && typeof summary.executionRoute.routeClass === "string"
				? summary.executionRoute.routeClass
				: null,
		selectedCapabilityId:
			summary.executionRoute && typeof summary.executionRoute.selectedCapabilityId === "string"
				? summary.executionRoute.selectedCapabilityId
				: null,
		selectedModelId:
			selectedBindingField(summary.executionRoute, "selectedModelId"),
		selectedProviderId:
			selectedBindingField(summary.executionRoute, "selectedProviderId"),
		record: {
			...summary,
			council,
		},
	};

	try {
		const daemonSummary = await withDaemonClient(async (client) => {
			throwIfResearchAborted(signal);
			const result = await client.call("research.loops.record", payload) as {
				summary?: { id?: string };
			};
			return typeof result.summary?.id === "string" ? result.summary.id : null;
		});
		if (daemonSummary) {
			return { summaryId: daemonSummary, source: "daemon" };
		}
	} catch (error) {
		if (!shouldFallbackToLocalLoopRecording(error)) throw error;
	}

	const { upsertResearchLoopSummary } = await dynamicImport("@chitragupta/smriti");
	throwIfResearchAborted(signal);
	const stored = upsertResearchLoopSummary(payload);
	return { summaryId: stored.id, source: "fallback" };
}
