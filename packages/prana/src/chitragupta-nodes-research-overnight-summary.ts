import {
	saveTerminalResearchLoopCheckpoint,
} from "./chitragupta-nodes-research-checkpoints.js";
import type {
	ResearchCouncilSummary,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import { buildLoopSummaryFromState } from "./chitragupta-nodes-research-overnight-state.js";
import {
	type OvernightResearchRound,
	type OvernightResearchRoundCounts,
	type OvernightResearchSummary,
	type OvernightResearchProgress,
	withDegradedClosure,
} from "./chitragupta-nodes-research-overnight-types.js";

/**
 * Persist the terminal overnight summary immediately so cancellation or restart
 * cannot lose the final stop-reason truth after the loop exits.
 */
export async function persistTerminalResearchSummary(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	summary: OvernightResearchSummary,
): Promise<OvernightResearchSummary> {
	await saveTerminalResearchLoopCheckpoint(scope, council, summary);
	return summary;
}

/** Build and persist the final loop summary for a terminal stop condition. */
export async function persistTerminalLoopSummary(options: {
	scope: ResearchScope;
	council: ResearchCouncilSummary;
	rounds: OvernightResearchRound[];
	stopReason: OvernightResearchSummary["stopReason"];
	progress: OvernightResearchProgress;
	roundCounts: OvernightResearchRoundCounts;
	loopKey: string;
	degradedError?: unknown;
}): Promise<OvernightResearchSummary> {
	const summary = buildLoopSummaryFromState(
		options.scope,
		options.council,
		options.rounds,
		options.stopReason,
		options.progress,
		options.roundCounts,
		options.loopKey,
	);
	return persistTerminalResearchSummary(
		options.scope,
		options.council,
		options.degradedError ? withDegradedClosure(summary, options.degradedError) : summary,
	);
}
