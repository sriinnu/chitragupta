import {
	consolidateResearchExperimentsForDate,
	consolidateResearchRefinementDigestsForDate,
	consolidateResearchLoopSummariesForDate,
} from "./chitragupta-daemon-research.js";
import { repairSelectiveReembeddingForDate } from "./chitragupta-daemon-semantic.js";

export interface DailyDaemonPostprocessResult {
	research: {
		loops: { processed: number; projects: number };
		experiments: { processed: number; projects: number };
		refinements: { processed: number; projects: number };
		processed: number;
		projects: number;
	};
	semantic: {
		candidates: number;
		reembedded: number;
		scopes: Array<{ level: "daily" | "monthly" | "yearly"; period: string; candidates: number; reembedded: number }>;
	};
	remote: { enabled: boolean; synced: number };
}

export async function runDailyDaemonPostprocess(date: string): Promise<DailyDaemonPostprocessResult> {
	const [loopResearch, experimentResearch, refinementResearch] = await Promise.all([
		consolidateResearchLoopSummariesForDate(date),
		consolidateResearchExperimentsForDate(date),
		consolidateResearchRefinementDigestsForDate(date),
	]);
	const semantic = await repairSelectiveReembeddingForDate(date);
	const { syncRemoteSemanticMirror } = await import("@chitragupta/smriti");
	const month = date.slice(0, 7);
	const year = date.slice(0, 4);
	const remoteResults = await Promise.all([
		syncRemoteSemanticMirror({ levels: ["daily"], dates: [date] }),
		syncRemoteSemanticMirror({ levels: ["monthly"], periods: [month] }),
		syncRemoteSemanticMirror({ levels: ["yearly"], periods: [year] }),
	]);
	return {
		research: {
			loops: loopResearch,
			experiments: experimentResearch,
			refinements: refinementResearch,
			processed: loopResearch.processed + experimentResearch.processed + refinementResearch.processed,
			projects: new Set([
				...loopResearch.projectPaths,
				...experimentResearch.projectPaths,
				...refinementResearch.projectPaths,
			]).size,
		},
		semantic,
		remote: {
			enabled: remoteResults.some((result) => result.status.enabled),
			synced: remoteResults.reduce((sum, result) => sum + result.synced, 0),
		},
	};
}
