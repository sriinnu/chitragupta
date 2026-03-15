/**
 * @chitragupta/anina — daily semantic refinement helpers.
 *
 * I keep selective re-embedding orchestration outside the main daemon class so
 * the daily consolidation flow stays readable and the repair policy remains
 * easy to test in isolation.
 */

import type { ResearchRefinementProjectScope } from "./chitragupta-daemon-research-scope.js";
import { mergeResearchRefinementScopes } from "./chitragupta-daemon-research-scope.js";
import type {
	ResearchRefinementBudgetOverride,
	TemporalReembeddingLevel,
} from "@chitragupta/smriti";
import { buildTemporalSelectiveReembeddingRequest } from "@chitragupta/smriti";

/** Aggregated result of one daemon-owned temporal repair sweep. */
export interface DailySelectiveReembeddingResult {
	candidates: number;
	reembedded: number;
	remoteSynced: number;
	qualityDeferred: number;
	scopes: Array<{
		level: "daily" | "monthly" | "yearly";
		period: string;
		candidates: number;
		reembedded: number;
		remoteSynced: number;
		qualityDeferred: number;
	}>;
}

/** Operator-facing result of a global embedding epoch refresh. */
export interface GlobalSemanticEpochRefreshResult {
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
}

/** Research-scoped refinement result derived from project/session signals. */
export interface ResearchScopedSelectiveReembeddingResult {
	label: string;
	candidates: number;
	reembedded: number;
	remoteSynced: number;
	qualityDeferred: number;
	scopes: Array<{
		projectPath: string;
		dailyDates: string[];
		candidates: number;
		reembedded: number;
		remoteSynced: number;
		qualityDeferred: number;
	}>;
}

function widerCap(left?: number, right?: number): number | undefined {
	if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right)) {
		return Math.max(left, right);
	}
	return typeof left === "number" && Number.isFinite(left)
		? left
		: typeof right === "number" && Number.isFinite(right)
			? right
			: undefined;
}

function widerFloor(left?: number, right?: number): number | undefined {
	if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right)) {
		return Math.min(left, right);
	}
	return typeof left === "number" && Number.isFinite(left)
		? left
		: typeof right === "number" && Number.isFinite(right)
			? right
			: undefined;
}

/**
 * Research-derived scope budgets should widen the current daemon envelope, not
 * silently disappear when the scoped repair runs later through Nidra or queue replay.
 */
function mergeScopeRefinementBudget(
	activeBudget: ResearchRefinementBudgetOverride | null,
	scopeBudget: ResearchRefinementProjectScope["refinementBudget"],
): ResearchRefinementBudgetOverride | null {
	if (!activeBudget && !scopeBudget) return null;
	return {
		dailyCandidateLimit: widerCap(activeBudget?.dailyCandidateLimit, scopeBudget?.dailyCandidateLimit),
		projectCandidateLimit: widerCap(activeBudget?.projectCandidateLimit, scopeBudget?.projectCandidateLimit),
		dailyMinMdlScore: widerFloor(activeBudget?.dailyMinMdlScore, scopeBudget?.dailyMinMdlScore),
		projectMinMdlScore: widerFloor(activeBudget?.projectMinMdlScore, scopeBudget?.projectMinMdlScore),
		dailyMinPriorityScore: widerFloor(activeBudget?.dailyMinPriorityScore, scopeBudget?.dailyMinPriorityScore),
		projectMinPriorityScore: widerFloor(activeBudget?.projectMinPriorityScore, scopeBudget?.projectMinPriorityScore),
		dailyMinSourceSessionCount: widerFloor(activeBudget?.dailyMinSourceSessionCount, scopeBudget?.dailyMinSourceSessionCount),
		projectMinSourceSessionCount: widerFloor(activeBudget?.projectMinSourceSessionCount, scopeBudget?.projectMinSourceSessionCount),
	};
}

/**
 * Build one bounded selective-reembedding request for a temporal level.
 *
 * Daily scopes are allowed to widen into quality-driven repair under research
 * pressure. Monthly/yearly scopes stay freshness-led unless the current
 * research signal is strong enough to justify broader quality work.
 */
function buildTemporalRequest(
	level: TemporalReembeddingLevel,
	date: string,
	researchSignalCount = 0,
	budgetOverride: ResearchRefinementBudgetOverride | null = null,
): Record<string, unknown> {
	return buildTemporalSelectiveReembeddingRequest({
		level,
		date,
		researchSignalCount,
		override: budgetOverride,
	});
}

/**
 * Reuse the same temporal repair policy for batched monthly/yearly project
 * scopes so deep-sleep research refinement does not silently drop MDL pressure
 * on higher-horizon artifacts.
 */
function buildPeriodicResearchRequest(
	level: "monthly" | "yearly",
	projectPath: string,
	periods: readonly string[],
	researchSignalCount: number,
	budgetOverride: ResearchRefinementBudgetOverride | null = null,
): Record<string, unknown> {
	return buildTemporalSelectiveReembeddingRequest({
		level,
		date: periods[0] ?? "",
		researchSignalCount,
		projects: [projectPath],
		periods: [...periods],
		override: budgetOverride,
	});
}

function buildTemporalScopes(
	date: string,
	researchSignalCount = 0,
	budgetOverride: ResearchRefinementBudgetOverride | null = null,
): Array<{ level: TemporalReembeddingLevel; period: string; request: Record<string, unknown> }> {
	const month = date.slice(0, 7);
	const year = date.slice(0, 4);
	// I treat one day label as the canonical daemon repair frontier, then widen
	// it to monthly and yearly scopes so the same fresh evidence can repair the
	// nearest temporal aggregates in one serialized sweep.
	return [
		{
			level: "daily",
			period: date,
			request: buildTemporalRequest("daily", date, researchSignalCount, budgetOverride),
		},
		{
			level: "monthly",
			period: month,
			request: buildTemporalRequest("monthly", date, researchSignalCount, budgetOverride),
		},
		{
			level: "yearly",
			period: year,
			request: buildTemporalRequest("yearly", date, researchSignalCount, budgetOverride),
		},
	];
}

function matchesScopeSession(
	value: { sessionId?: string | null; parentSessionId?: string | null; sessionLineageKey?: string | null },
	sessionIds: ReadonlySet<string>,
	sessionLineageKeys: ReadonlySet<string>,
): boolean {
	if (sessionIds.size === 0 && sessionLineageKeys.size === 0) return true;
	// I accept direct session, parent session, or lineage-key matches because one
	// resumable research thread can legitimately reappear under any of those
	// identities as checkpoints and follow-up prompts attach to it.
	return (
		sessionIds.has(value.sessionId ?? "")
		|| sessionIds.has(value.parentSessionId ?? "")
		|| sessionLineageKeys.has(value.sessionLineageKey ?? "")
	);
}

/** Derive the canonical UTC day label from one persisted update timestamp. */
function dateFromUpdatedAt(updatedAt: unknown): string | null {
	if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
	const iso = new Date(updatedAt).toISOString();
	return iso.slice(0, 10);
}

interface ResearchScopeSignalSummary {
	researchSignalCount: number;
	activeDates: string[];
}

/**
 * Scoped research repair has to replay enough ledger history to cover the exact
 * session group Nidra handed over.
 *
 * A flat 200-row replay horizon can truncate long project sessions and erase
 * the dates/signal needed to continue the same bounded repair pass after a
 * restart or delayed drain.
 */
function deriveResearchScopeReplayLimit(scope: ResearchRefinementProjectScope): number {
	const scopeBreadth = Math.max(
		1,
		(scope.sessionIds?.length ?? 0)
		+ (scope.sessionLineageKeys?.length ?? 0),
	);
	return Math.min(4_000, Math.max(400, scopeBreadth * 128));
}

/**
 * Derive bounded repair pressure from the scope metadata that Nidra carried
 * forward from overnight optimizer summaries.
 */
function scopeSignalBoost(scope: ResearchRefinementProjectScope): number {
	let boost = 0;
	if ((scope.primaryStopConditionKinds ?? []).includes("pareto-stagnation")) boost += 1;
	// Budget exhaustion and no-improvement are weaker than unsafe failure, but
	// they still mean the optimizer hit a bounded ceiling worth re-checking in
	// the next semantic refinement pass.
	if (
		(scope.primaryStopConditionKinds ?? []).includes("budget-exhausted")
		|| (scope.primaryStopConditionKinds ?? []).includes("no-improvement")
	) {
		boost += 1;
	}
	if (typeof scope.frontierBestScore === "number" && scope.frontierBestScore >= 0.6) boost += 1;
	// Several policy fingerprints inside one project scope usually mean the loop
	// changed optimizer contract over time, so I allow one extra unit of repair
	// pressure to revisit the affected semantic summaries.
	if ((scope.policyFingerprints?.length ?? 0) > 1) boost += 1;
	if (typeof scope.priorityScore === "number" && scope.priorityScore >= 3) boost += 1;
	return Math.min(boost, 5);
}

/**
 * Collapse active daily dates into bounded monthly/yearly periods so research
 * refinement only touches periods the loop actually exercised.
 */
function uniqueResearchPeriods(
	activeDates: readonly string[],
	level: "monthly" | "yearly",
): string[] {
	const periods = new Set<string>();
	for (const date of activeDates) {
		if (typeof date !== "string" || date.length < 4) continue;
		periods.add(level === "monthly" ? date.slice(0, 7) : date.slice(0, 4));
	}
	return [...periods].sort();
}

function isIsoDateLabel(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Derive the refinement pressure produced by research outcomes for one scoped project.
 *
 * I treat positive keeps and unstable/failed loops as signals that the touched
 * temporal artifacts should be reconsidered, and I preserve the exact dates so
 * deep sleep can repair the same daily artifacts the normal daily pass would.
 */
async function deriveResearchScopeSignals(
	scope: ResearchRefinementProjectScope,
): Promise<ResearchScopeSignalSummary> {
	const { listResearchExperiments, listResearchLoopSummaries } = await import("@chitragupta/smriti");
	const sessionIds = new Set<string>(scope.sessionIds ?? []);
	const sessionLineageKeys = new Set<string>(scope.sessionLineageKeys ?? []);
	const replayLimit = deriveResearchScopeReplayLimit(scope);
	const [loops, experiments] = await Promise.all([
		listResearchLoopSummaries({ projectPath: scope.projectPath, limit: replayLimit }),
		listResearchExperiments({ projectPath: scope.projectPath, limit: replayLimit }),
	]);
	const scopedLoops = loops.filter((loop) => matchesScopeSession(loop, sessionIds, sessionLineageKeys));
	const scopedExperiments = experiments.filter((experiment) => matchesScopeSession(experiment, sessionIds, sessionLineageKeys));
	const positiveExperiments = scopedExperiments.filter(
		(experiment) => experiment.decision === "keep" && typeof experiment.delta === "number" && experiment.delta > 0,
	).length;
	const unstableLoops = scopedLoops.filter((loop) =>
		loop.stopReason === "round-failed"
		|| loop.stopReason === "closure-failed"
		|| loop.stopReason === "control-plane-lost"
		|| loop.stopReason === "unsafe-discard",
	).length;
	const activeDates = [
		...new Set([
			...scopedLoops.map((loop) => dateFromUpdatedAt(loop.updatedAt)),
			...scopedExperiments.map((experiment) => dateFromUpdatedAt(experiment.updatedAt)),
		].filter((value): value is string => Boolean(value))),
	].sort();
	return {
		// I carry forward optimizer-derived scope pressure as a bounded boost so
		// nightly repair does not forget a strong frontier or a Pareto stall just
		// because the narrower follow-up query saw fewer rows on replay.
		researchSignalCount: positiveExperiments + unstableLoops + scopeSignalBoost(scope),
		activeDates,
	};
}

/**
 * Run one bounded temporal semantic repair sweep for the given date.
 *
 * Daily artifacts may include quality-driven rebuild reasons. Monthly/yearly
 * scopes stay freshness-focused by default, but current research pressure can
 * widen them into bounded quality repair when the active loop has touched
 * those broader artifacts recently enough to justify it. When remote semantic
 * sync is enabled, the same repair pass can also resync the remote mirror for
 * the repaired artifacts instead of leaving local truth ahead of the remote
 * projection.
 */
export async function repairSelectiveReembeddingForDate(
	date: string,
	options: { researchSignalCount?: number } = {},
): Promise<DailySelectiveReembeddingResult> {
	const {
		readActiveResearchRefinementBudget,
		repairSelectiveReembedding,
	} = await import("@chitragupta/smriti");
	const activeBudget = readActiveResearchRefinementBudget()?.refinement ?? null;
	const scopes = await Promise.all(
		buildTemporalScopes(date, options.researchSignalCount ?? 0, activeBudget).map(async (scope) => {
			// Each temporal scope already carries the normalized freshness/quality
			// policy. I only fan the bounded request out across daily, monthly,
			// and yearly horizons here instead of recomputing thresholds locally.
			const result = await repairSelectiveReembedding({
				...scope.request,
			} as Parameters<typeof repairSelectiveReembedding>[0] & Record<string, unknown>);
			return {
				level: scope.level,
				period: scope.period,
				candidates: result.plan.candidateCount,
				reembedded: result.reembedded,
				remoteSynced: result.remoteSynced,
				qualityDeferred: result.qualityDeferred,
			};
		}),
	);
	return {
		candidates: scopes.reduce((sum, scope) => sum + scope.candidates, 0),
		reembedded: scopes.reduce((sum, scope) => sum + scope.reembedded, 0),
		remoteSynced: scopes.reduce((sum, scope) => sum + scope.remoteSynced, 0),
		qualityDeferred: scopes.reduce((sum, scope) => sum + scope.qualityDeferred, 0),
		scopes,
	};
}

/**
 * Use research outcomes as a refinement signal for project-scoped semantic
 * artifacts touched during deep sleep.
 *
 * This path can both rebuild local semantic artifacts and advance the remote
 * semantic mirror when the repair decision says the canonical local artifact
 * is healthy enough to promote.
 */
export async function repairSelectiveReembeddingForResearchScopes(
	label: string,
	scopes: readonly ResearchRefinementProjectScope[],
): Promise<ResearchScopedSelectiveReembeddingResult> {
	const {
		readActiveResearchRefinementBudget,
		repairSelectiveReembedding,
	} = await import("@chitragupta/smriti");
	const activeBudget = readActiveResearchRefinementBudget()?.refinement ?? null;
	const uniqueScopes = mergeResearchRefinementScopes(scopes);
	const results: ResearchScopedSelectiveReembeddingResult["scopes"] = [];
	for (const scope of uniqueScopes) {
		const scopeBudget = mergeScopeRefinementBudget(activeBudget, scope.refinementBudget);
		const { researchSignalCount, activeDates } = await deriveResearchScopeSignals(scope);
		// Research pressure widens the repair frontier here. Without a current
		// signal I leave background debt to the normal epoch-refresh pipeline so
		// this scoped path does not rewrite broad history opportunistically.
		if (researchSignalCount === 0) continue;
		// Optimizer-derived pressure can survive even when the replay query sees
		// no concrete rows yet. In that case I anchor the scoped repair to the
		// current Nidra label instead of silently dropping the signal.
		const effectiveActiveDates =
			activeDates.length > 0
				? activeDates
				: scopeSignalBoost(scope) > 0 && isIsoDateLabel(label)
					? [label]
					: [];
		let dailyCandidates = 0;
		let dailyReembedded = 0;
		let dailyRemoteSynced = 0;
		let dailyQualityDeferred = 0;
		// I repair the exact daily artifacts first, then widen to monthly/yearly
		// periods derived from those same dates. That keeps scoped refinement
		// grounded in observed activity instead of jumping straight to broad periods.
		for (const date of effectiveActiveDates) {
			const dailyResult = await repairSelectiveReembedding({
				...buildTemporalRequest("daily", date, researchSignalCount, scopeBudget),
				projects: [scope.projectPath],
			} as Parameters<typeof repairSelectiveReembedding>[0] & Record<string, unknown>);
			dailyCandidates += dailyResult.plan.candidateCount;
			dailyReembedded += dailyResult.reembedded;
			dailyRemoteSynced += dailyResult.remoteSynced;
			dailyQualityDeferred += dailyResult.qualityDeferred;
		}
		const monthlyPeriods = uniqueResearchPeriods(effectiveActiveDates, "monthly");
		const yearlyPeriods = uniqueResearchPeriods(effectiveActiveDates, "yearly");
		let periodicCandidates = 0;
		let periodicReembedded = 0;
		let periodicRemoteSynced = 0;
		let periodicQualityDeferred = 0;
		if (monthlyPeriods.length > 0) {
			const monthlyResult = await repairSelectiveReembedding({
				...buildPeriodicResearchRequest(
					"monthly",
					scope.projectPath,
					monthlyPeriods,
					researchSignalCount,
					scopeBudget,
				),
			} as Parameters<typeof repairSelectiveReembedding>[0] & Record<string, unknown>);
			periodicCandidates += monthlyResult.plan.candidateCount;
			periodicReembedded += monthlyResult.reembedded;
			periodicRemoteSynced += monthlyResult.remoteSynced;
			periodicQualityDeferred += monthlyResult.qualityDeferred;
		}
		if (yearlyPeriods.length > 0) {
			const yearlyResult = await repairSelectiveReembedding({
				...buildPeriodicResearchRequest(
					"yearly",
					scope.projectPath,
					yearlyPeriods,
					researchSignalCount,
					scopeBudget,
				),
			} as Parameters<typeof repairSelectiveReembedding>[0] & Record<string, unknown>);
			periodicCandidates += yearlyResult.plan.candidateCount;
			periodicReembedded += yearlyResult.reembedded;
			periodicRemoteSynced += yearlyResult.remoteSynced;
			periodicQualityDeferred += yearlyResult.qualityDeferred;
		}
		// If a scope contributes no active dates or the bounded repair produces no
		// widened candidates, I omit it entirely so downstream postprocess results
		// describe only the scopes that actually influenced current refinement.
		results.push({
			projectPath: scope.projectPath,
			dailyDates: effectiveActiveDates,
			candidates: dailyCandidates + periodicCandidates,
			reembedded: dailyReembedded + periodicReembedded,
			remoteSynced: dailyRemoteSynced + periodicRemoteSynced,
			qualityDeferred: dailyQualityDeferred + periodicQualityDeferred,
		});
	}
	return {
		label,
		candidates: results.reduce((sum, scope) => sum + scope.candidates, 0),
		reembedded: results.reduce((sum, scope) => sum + scope.reembedded, 0),
		remoteSynced: results.reduce((sum, scope) => sum + scope.remoteSynced, 0),
		qualityDeferred: results.reduce((sum, scope) => sum + scope.qualityDeferred, 0),
		scopes: results,
	};
}

/**
 * I refresh the full curated semantic mirror when the active embedding epoch
 * changes, so provider/model upgrades become a daemon-owned self-heal instead
 * of waiting for an operator or a nightly pass.
 */
export async function refreshGlobalSemanticEpochDrift(
	force = false,
): Promise<GlobalSemanticEpochRefreshResult> {
	const { refreshGlobalSemanticEpochDrift: refresh } = await import("@chitragupta/smriti") as typeof import("@chitragupta/smriti") & {
		refreshGlobalSemanticEpochDrift: (
			options?: { force?: boolean },
		) => Promise<GlobalSemanticEpochRefreshResult>;
	};
	return await refresh({ force });
}
