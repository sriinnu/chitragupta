import type { DailyDaemonPostprocessResult } from "./chitragupta-daemon-postprocess.js";
import type { ConsolidationEvent } from "./chitragupta-daemon-support.js";

type ConsolidationEmitter = (event: ConsolidationEvent) => boolean;

interface DeepSleepResearchSummary {
	processed: number;
	projects: number;
}

interface DeepSleepSemanticSummary {
	candidates: number;
	reembedded: number;
}

/**
 * Emit the user-facing progress events for daily daemon postprocess work.
 */
export function emitDailyPostprocessEvents(
	emit: ConsolidationEmitter,
	date: string,
	postprocess: DailyDaemonPostprocessResult,
): void {
	if (postprocess.research.processed > 0) {
		emit({
			type: "progress",
			date,
			phase: "research-loops",
			detail: `${postprocess.research.processed} overnight loop summaries across ${postprocess.research.projects} projects`,
		});
	}
	if (postprocess.research.refinements.processed > 0) {
		emit({
			type: "progress",
			date,
			phase: "research-refinement",
			detail: `${postprocess.research.refinements.processed} research refinement digests across ${postprocess.research.refinements.projects} projects`,
		});
	}
	if (postprocess.semantic.reembedded > 0) {
		emit({
			type: "progress",
			date,
			phase: "semantic-reembed",
			detail: `re-embedded ${postprocess.semantic.reembedded} of ${postprocess.semantic.candidates} stale daily artifacts`,
		});
	}
	if (postprocess.semantic.researchScoped.reembedded > 0) {
		emit({
			type: "progress",
			date,
			phase: "semantic-research-refine",
			detail: `${postprocess.semantic.researchScoped.reembedded}/${postprocess.semantic.researchScoped.candidates} project-scoped semantic artifacts refreshed from research outcomes`,
		});
	}
	if (postprocess.semantic.epochRefresh.refreshed || postprocess.semantic.epochRefresh.reason === "quality-debt") {
		emit({
			type: "progress",
			date,
			phase: "semantic-epoch-refresh",
			detail: `${postprocess.semantic.epochRefresh.reason}: qualityDebt=${postprocess.semantic.epochRefresh.qualityDebtCount}, remote=${postprocess.semantic.epochRefresh.repair.remoteSynced}`,
		});
	}
	if (postprocess.remote.enabled) {
		emit({
			type: "progress",
			date,
			phase: "remote-sync",
			detail: `remote semantic mirror synced ${postprocess.remote.synced} artifacts (daily=${postprocess.remote.sources.dailyRepair}, research=${postprocess.remote.sources.researchRepair}, epoch=${postprocess.remote.sources.epochRefresh}, postprocess=${postprocess.remote.sources.postprocessSync})`,
		});
	}
}

/**
 * Emit deep-sleep research and semantic refinement progress in a consistent format.
 */
export function emitDeepSleepResearchEvents(
	emit: ConsolidationEmitter,
	date: string,
	research: DeepSleepResearchSummary,
	semantic: DeepSleepSemanticSummary,
): void {
	if (research.processed > 0) {
		emit({
			type: "progress",
			date,
			phase: "deep-sleep:research-refinement",
			detail: `${research.processed} research refinement digests across ${research.projects} projects`,
		});
	}
	if (semantic.reembedded > 0 || semantic.candidates > 0) {
		emit({
			type: "progress",
			date,
			phase: "deep-sleep:semantic-refinement",
			detail: `${semantic.reembedded}/${semantic.candidates} project semantic artifacts refreshed from research outcomes`,
		});
	}
}
