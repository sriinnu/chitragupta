import {
	consolidateResearchExperimentsForDate,
	consolidateResearchRefinementDigestsForDate,
	consolidateResearchLoopSummariesForDate,
} from "./chitragupta-daemon-research.js";
import type { ResearchRefinementProjectScope } from "./chitragupta-daemon-research-scope.js";
import {
	refreshGlobalSemanticEpochDrift,
	repairSelectiveReembeddingForDate,
	repairSelectiveReembeddingForResearchScopes,
} from "./chitragupta-daemon-semantic.js";
import { drainQueuedResearchRefinementScopes } from "./chitragupta-daemon-semantic-queue.js";
import {
	buildDailyRefinementGovernorPlan,
	collectDailyRefinementHoldReasons,
	type DailyRefinementBudgetEnvelope,
	type DailyRefinementHoldReason,
	type DailyRefinementPhase,
} from "./chitragupta-daemon-refinement-governor.js";

/** Summary of one research-digest family produced during daily postprocess. */
type DailyResearchDigestFamily = {
	processed: number;
	projects: number;
	projectPaths: string[];
};

/** One period-level semantic repair result emitted by selective reembedding. */
type DailySemanticScopeResult = {
	level: "daily" | "monthly" | "yearly";
	period: string;
	candidates: number;
	reembedded: number;
	remoteSynced: number;
	qualityDeferred: number;
};

/** One research-scoped semantic repair result for a concrete project/date set. */
type DailyResearchSemanticScopeResult = {
	projectPath: string;
	dailyDates: string[];
	candidates: number;
	reembedded: number;
	remoteSynced: number;
	qualityDeferred: number;
};

/** Epoch refresh summary returned by the daemon-owned semantic self-heal path. */
type DailyEpochRefreshResult = {
	currentEpoch: string;
	previousEpoch: string | null;
	reason: "unchanged" | "bootstrap" | "epoch-changed" | "forced" | "retry-backoff" | "quality-debt";
	completed: boolean;
	freshnessCompleted: boolean;
	refreshed: boolean;
	qualityDebtCount: number;
	repair: {
		plan: { scanned: number; candidateCount: number };
		reembedded: number;
		remoteSynced: number;
		qualityDeferred: number;
	};
};

/** Queued research scopes that were drained after the primary daily repair pass. */
type DailyQueuedResearchRepairResult = {
	drained: number;
	repaired: number;
	deferred: number;
	remainingDue: number;
	carriedForward: number;
	remoteSynced: number;
	qualityDeferred: number;
};

/**
 * Structured result of one daemon-owned postprocess run after daily
 * consolidation.
 *
 * I keep research digestion, semantic repair, and remote-sync gating in one
 * operator-facing shape so the daemon can explain exactly what it refined and
 * why remote sync was or was not allowed to proceed.
 */
export interface DailyDaemonPostprocessResult {
	governor: {
		phases: DailyRefinementPhase[];
		effectiveBudget: DailyRefinementBudgetEnvelope | null;
		researchSignalCount: number;
		queuedDrainLimit: number | null;
		remoteHoldReasons: DailyRefinementHoldReason[];
	};
	research: {
		loops: DailyResearchDigestFamily;
		experiments: DailyResearchDigestFamily;
		refinements: DailyResearchDigestFamily & {
			scopes: ResearchRefinementProjectScope[];
			deferredScopes: ResearchRefinementProjectScope[];
		};
		processed: number;
		projects: number;
		projectPaths: string[];
	};
	semantic: {
		candidates: number;
		reembedded: number;
		remoteSynced: number;
		qualityDeferred: number;
		scopes: DailySemanticScopeResult[];
		researchScoped: {
			candidates: number;
			reembedded: number;
			remoteSynced: number;
			qualityDeferred: number;
			scopes: DailyResearchSemanticScopeResult[];
		};
		epochRefresh: DailyEpochRefreshResult;
		queuedResearch: DailyQueuedResearchRepairResult;
	};
	remote: {
		enabled: boolean;
		synced: number;
		skippedDueToOutstandingRepair: boolean;
		sources: {
			dailyRepair: number;
			researchRepair: number;
			queuedResearch: number;
			epochRefresh: number;
			postprocessSync: number;
		};
	};
}

/**
 * Persist semantic-debt breadcrumbs into project memory whenever research
 * repair still leaves unresolved quality work.
 *
 * I keep this separate from the main research digest so an operator can tell
 * the difference between "what the loop learned" and "why the semantic mirror
 * still needs healing before the next unattended run".
 */
async function persistResearchSemanticDebtNotes(args: {
	date: string;
	researchScoped: DailyDaemonPostprocessResult["semantic"]["researchScoped"];
	epochRefresh: DailyDaemonPostprocessResult["semantic"]["epochRefresh"];
}): Promise<void> {
	const debtScopes = args.researchScoped.scopes.filter((scope) => scope.qualityDeferred > 0);
	if (debtScopes.length === 0 && args.epochRefresh.qualityDebtCount <= 0) return;

	const { appendMemory } = await import("@chitragupta/smriti");

	for (const scope of debtScopes) {
		const lines = [
			`## Semantic Repair Debt [${args.date}]`,
			`- project: ${scope.projectPath}`,
			`- unresolvedCandidates: ${scope.qualityDeferred}`,
			`- dailyDates: ${scope.dailyDates.join(", ") || "none"}`,
			...(args.epochRefresh.qualityDebtCount > 0
				? [`- globalEpochDebt: ${args.epochRefresh.qualityDebtCount}`]
				: []),
			"- nextStep: repair semantic debt before widening the next unattended loop.",
		];
		await appendMemory(
			{ type: "project", path: scope.projectPath },
			lines.join("\n"),
			{ dedupe: true },
		);
	}

	if (debtScopes.length === 0 && args.epochRefresh.qualityDebtCount > 0) {
		const lines = [
			`## Semantic Repair Debt [${args.date}]`,
			"- scope: global",
			`- globalEpochDebt: ${args.epochRefresh.qualityDebtCount}`,
			"- nextStep: complete epoch-driven semantic repair before widening unattended refinement.",
		];
		await appendMemory({ type: "global" }, lines.join("\n"), { dedupe: true });
	}
}

/**
 * Run the daemon-owned daily postprocess pipeline after daily consolidation.
 *
 * I keep date-scoped repair, project-scoped research refinement, and global
 * epoch/quality self-heal in one place so the daemon remains the single source
 * of refinement policy.
 */
export async function runDailyDaemonPostprocess(date: string): Promise<DailyDaemonPostprocessResult> {
	const [loopResearch, experimentResearch, refinementResearch] = await Promise.all([
		consolidateResearchLoopSummariesForDate(date),
		consolidateResearchExperimentsForDate(date),
		consolidateResearchRefinementDigestsForDate(date),
	]);
	const {
		clearResearchRefinementBudget,
		readActiveResearchRefinementBudget,
		syncRemoteSemanticMirror,
		upsertResearchRefinementQueue,
		upsertResearchRefinementBudget,
	} = await import("@chitragupta/smriti");
	const governor = buildDailyRefinementGovernorPlan({
		loopProjects: loopResearch.projects,
		experimentProjects: experimentResearch.projects,
		refinementScopes: refinementResearch.scopes,
		activeBudget: readActiveResearchRefinementBudget(),
	});
	const effectiveBudget = governor.effectiveBudget;
	if (effectiveBudget) {
		// I persist the merged budget before the repair passes start so the shared
		// semantic helpers can consume the same bounded envelope during this cycle.
		upsertResearchRefinementBudget({
			refinement: effectiveBudget.refinement,
			nidra: effectiveBudget.nidra,
			source: "nidra.postprocess",
		});
	}
	const budgetedRefinementScopes = governor.selectedScopes;
	const deferredRefinementScopes = governor.deferredScopes;
	const carriedForwardRefinementScopes = deferredRefinementScopes.length > 0
		? upsertResearchRefinementQueue(
			deferredRefinementScopes.map((scope) => ({
				label: date,
				projectPath: scope.projectPath,
				sessionIds: scope.sessionIds,
				sessionLineageKeys: scope.sessionLineageKeys,
			})),
			{
				notBefore: Date.now(),
				lastError: "deferred:nidra-project-budget",
			},
			)
		: 0;
	const semantic = await repairSelectiveReembeddingForDate(date, {
		researchSignalCount: governor.researchSignalCount,
	});
	const researchScoped = budgetedRefinementScopes.length > 0
		? await repairSelectiveReembeddingForResearchScopes(date, budgetedRefinementScopes)
		: {
			label: date,
			candidates: 0,
			reembedded: 0,
			remoteSynced: 0,
			qualityDeferred: 0,
			scopes: [],
		};
	// I drain queued research scopes before global epoch refresh so project-level
	// debt is resolved or deferred explicitly before I widen into a broader
	// semantic self-heal pass.
	const drainedQueuedResearch = await drainQueuedResearchRefinementScopes({
		label: date,
		excludeScopes: budgetedRefinementScopes,
		limit: governor.queuedDrainLimit ?? undefined,
	});
	const queuedResearch = {
		...drainedQueuedResearch,
		carriedForward: carriedForwardRefinementScopes,
	};
	const epochRefresh = await refreshGlobalSemanticEpochDrift(false);

	await persistResearchSemanticDebtNotes({ date, researchScoped, epochRefresh });
	const remoteHoldReasons = collectDailyRefinementHoldReasons({
		semanticQualityDeferred: semantic.qualityDeferred,
		researchQualityDeferred: researchScoped.qualityDeferred,
		queuedDeferred: queuedResearch.deferred,
		queuedRemainingDue: queuedResearch.remainingDue,
		queuedCarriedForward: queuedResearch.carriedForward,
		queuedQualityDeferred: queuedResearch.qualityDeferred,
		epochQualityDebtCount: epochRefresh.qualityDebtCount,
		epochCompleted: epochRefresh.completed,
		epochFreshnessCompleted: epochRefresh.freshnessCompleted,
	});
	// I block the final remote publish while any local repair backlog remains.
	// The explicit reasons keep the daemon truthful about which phase is still
	// holding the semantic mirror back.
	const shouldHoldRemoteSync = remoteHoldReasons.length > 0;
	if (!shouldHoldRemoteSync) {
		// I clear the widened research budget only after every local repair pass
		// comes back clean. That lets one immediate research signal widen the next
		// daemon sweep without leaving the daemon stuck in an elevated mode forever.
		clearResearchRefinementBudget();
	}

	const month = date.slice(0, 7);
	const year = date.slice(0, 4);
	const remoteResults = shouldHoldRemoteSync
		? []
		: await Promise.all([
			syncRemoteSemanticMirror({ levels: ["daily"], dates: [date] }),
			syncRemoteSemanticMirror({ levels: ["monthly"], periods: [month] }),
			syncRemoteSemanticMirror({ levels: ["yearly"], periods: [year] }),
		]);

	const projectPaths = [
		...new Set([
			...loopResearch.projectPaths,
			...experimentResearch.projectPaths,
			...refinementResearch.projectPaths,
		]),
	];

	return {
		governor: {
			phases: governor.phases,
			effectiveBudget,
			researchSignalCount: governor.researchSignalCount,
			queuedDrainLimit: governor.queuedDrainLimit,
			remoteHoldReasons,
		},
		research: {
			loops: loopResearch,
			experiments: experimentResearch,
				refinements: {
					...refinementResearch,
					scopes: budgetedRefinementScopes,
					deferredScopes: deferredRefinementScopes,
				},
			processed:
				loopResearch.processed
				+ experimentResearch.processed
				+ refinementResearch.processed,
			// I union project paths from loops, experiments, and deferred
			// refinements so the postprocess result describes every project the
			// daemon touched in this cycle, not only the first matching source.
			projectPaths,
			projects: projectPaths.length,
		},
		semantic: {
			...semantic,
			researchScoped,
			epochRefresh,
			queuedResearch,
		},
		remote: {
			enabled:
				semantic.remoteSynced > 0
				|| researchScoped.remoteSynced > 0
				|| queuedResearch.remoteSynced > 0
				|| epochRefresh.repair.remoteSynced > 0
				|| remoteResults.some((result) => result.status.enabled),
			synced:
				semantic.remoteSynced
				+ researchScoped.remoteSynced
				+ queuedResearch.remoteSynced
				+ epochRefresh.repair.remoteSynced
				+ remoteResults.reduce((sum, result) => sum + result.synced, 0),
				skippedDueToOutstandingRepair: shouldHoldRemoteSync,
			sources: {
				dailyRepair: semantic.remoteSynced,
				researchRepair: researchScoped.remoteSynced,
				queuedResearch: queuedResearch.remoteSynced,
				epochRefresh: epochRefresh.repair.remoteSynced,
				postprocessSync: remoteResults.reduce((sum, result) => sum + result.synced, 0),
			},
		},
	};
}
