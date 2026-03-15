import {
	buildResearchDayEpochRange,
	matchesResearchScopeSession,
	mergeResearchRefinementScopes,
	type ResearchRefinementProjectScope,
} from "./chitragupta-daemon-research-scope.js";
import type {
	ListResearchExperimentsOptions,
	ListResearchLoopSummariesOptions,
	ResearchNidraBudgetOverride,
	ResearchRefinementBudgetOverride,
	StoredResearchExperiment,
	StoredResearchLoopSummary,
} from "@chitragupta/smriti";

export {
	buildResearchDayEpochRange,
	matchesResearchScopeSession,
	mergeResearchRefinementScopes,
	type ResearchRefinementProjectScope,
} from "./chitragupta-daemon-research-scope.js";

const RESEARCH_REFINEMENT_TRACE_AGENT_ID = "anina:research-postprocess";
const DAILY_RESEARCH_DIGEST_PAGE_SIZE = 500;

/**
 * Deep-sleep project/session digestion needs a wider per-project ledger window
 * than day-scoped postprocess because one project can accumulate many research
 * rows across a long uninterrupted work session.
 */
function deriveProjectDigestQueryLimit(scope: Pick<ResearchRefinementProjectScope, "sessionIds" | "sessionLineageKeys">): number {
	const scopeBreadth = Math.max(1, (scope.sessionIds?.length ?? 0) + (scope.sessionLineageKeys?.length ?? 0));
	return Math.min(4_000, Math.max(400, scopeBreadth * 128));
}

function listAllResearchRowsForDay<T>(
	listRows: (options: {
		updatedAfter: number;
		updatedBefore: number;
		limit: number;
		offset: number;
	}) => T[],
	start: number,
	end: number,
) {
	const rows: T[] = [];
	for (let offset = 0; ; offset += DAILY_RESEARCH_DIGEST_PAGE_SIZE) {
		const batch = listRows({
			updatedAfter: start,
			updatedBefore: end,
			limit: DAILY_RESEARCH_DIGEST_PAGE_SIZE,
			offset,
		});
		rows.push(...batch);
		if (batch.length < DAILY_RESEARCH_DIGEST_PAGE_SIZE) break;
	}
	return rows;
}

function listAllResearchLoopSummariesForDay(
	listResearchLoopSummaries: (options: ListResearchLoopSummariesOptions) => StoredResearchLoopSummary[],
	start: number,
	end: number,
) {
	return listAllResearchRowsForDay(listResearchLoopSummaries, start, end);
}

function listAllResearchExperimentsForDay(
	listResearchExperiments: (options: ListResearchExperimentsOptions) => StoredResearchExperiment[],
	start: number,
	end: number,
) {
	return listAllResearchRowsForDay(listResearchExperiments, start, end);
}

function listAllProjectResearchRows<T>(
	listRows: (options: { projectPath: string; limit: number; offset: number }) => T[],
	projectPath: string,
	pageSize: number,
) {
	const rows: T[] = [];
	const effectivePageSize = Math.max(1, pageSize);
	for (let offset = 0; ; offset += effectivePageSize) {
		const batch = listRows({
			projectPath,
			limit: effectivePageSize,
			offset,
		});
		rows.push(...batch);
		if (batch.length < effectivePageSize) break;
	}
	return rows;
}

function renderResearchLoopMemoryEntry(summary: {
	id: string;
	loopKey?: string | null;
	topic: string;
	hypothesis?: string | null;
	stopReason: string;
	roundsRequested: number;
	roundsCompleted: number;
	bestMetric?: number | null;
	bestRoundNumber?: number | null;
	keptRounds?: number | null;
	revertedRounds?: number | null;
	totalDurationMs?: number | null;
	totalBudgetMs?: number | null;
	councilVerdict?: string | null;
	plannerRouteClass?: string | null;
	executionRouteClass?: string | null;
	sessionId?: string | null;
	sabhaId?: string | null;
	policyFingerprint?: string | null;
	primaryObjectiveId?: string | null;
	primaryStopConditionId?: string | null;
	primaryStopConditionKind?: string | null;
	frontierBestScore?: number | null;
}): string {
	const lines = [
		`## Overnight Research Loop [${summary.id}]`,
		`- topic: ${summary.topic}`,
		summary.hypothesis ? `- hypothesis: ${summary.hypothesis}` : "",
		summary.loopKey ? `- loopKey: ${summary.loopKey}` : "",
		`- rounds: ${summary.roundsCompleted}/${summary.roundsRequested}`,
		`- stopReason: ${summary.stopReason}`,
		typeof summary.bestMetric === "number" ? `- bestMetric: ${summary.bestMetric}` : "",
		typeof summary.bestRoundNumber === "number" ? `- bestRound: ${summary.bestRoundNumber}` : "",
		typeof summary.keptRounds === "number" ? `- keptRounds: ${summary.keptRounds}` : "",
		typeof summary.revertedRounds === "number" ? `- revertedRounds: ${summary.revertedRounds}` : "",
		typeof summary.totalDurationMs === "number" ? `- totalDurationMs: ${summary.totalDurationMs}` : "",
		typeof summary.totalBudgetMs === "number" ? `- totalBudgetMs: ${summary.totalBudgetMs}` : "",
		summary.councilVerdict ? `- councilVerdict: ${summary.councilVerdict}` : "",
		summary.policyFingerprint ? `- policyFingerprint: ${summary.policyFingerprint}` : "",
		summary.primaryObjectiveId ? `- primaryObjectiveId: ${summary.primaryObjectiveId}` : "",
		summary.primaryStopConditionId ? `- primaryStopConditionId: ${summary.primaryStopConditionId}` : "",
		summary.primaryStopConditionKind ? `- primaryStopConditionKind: ${summary.primaryStopConditionKind}` : "",
		typeof summary.frontierBestScore === "number" ? `- frontierBestScore: ${summary.frontierBestScore}` : "",
		summary.plannerRouteClass ? `- plannerRouteClass: ${summary.plannerRouteClass}` : "",
		summary.executionRouteClass ? `- executionRouteClass: ${summary.executionRouteClass}` : "",
		summary.sessionId ? `- sessionId: ${summary.sessionId}` : "",
		summary.sabhaId ? `- sabhaId: ${summary.sabhaId}` : "",
	].filter(Boolean);
	return lines.join("\n");
}

function renderResearchExperimentMemoryEntry(experiment: {
	id: string;
	experimentKey?: string | null;
	topic: string;
	metricName: string;
	objective: string;
	decision: string;
	status?: string | null;
	baselineMetric?: number | null;
	observedMetric?: number | null;
	delta?: number | null;
	roundNumber?: number | null;
	totalRounds?: number | null;
	loopKey?: string | null;
	sessionId?: string | null;
	sabhaId?: string | null;
	plannerRouteClass?: string | null;
	executionRouteClass?: string | null;
	packedRuntime?: string | null;
	packedSource?: string | null;
	gitBranch?: string | null;
	gitHeadCommit?: string | null;
	gitDirtyBefore?: boolean | null;
	gitDirtyAfter?: boolean | null;
	policyFingerprint?: string | null;
	primaryObjectiveId?: string | null;
	primaryStopConditionKind?: string | null;
	frontierBestScore?: number | null;
}): string {
	const lines = [
		`## Research Experiment [${experiment.id}]`,
		`- topic: ${experiment.topic}`,
		experiment.experimentKey ? `- experimentKey: ${experiment.experimentKey}` : "",
		experiment.loopKey ? `- loopKey: ${experiment.loopKey}` : "",
		typeof experiment.roundNumber === "number" && typeof experiment.totalRounds === "number"
			? `- round: ${experiment.roundNumber}/${experiment.totalRounds}`
			: "",
		`- metric: ${experiment.metricName} (${experiment.objective})`,
		`- decision: ${experiment.decision}`,
		experiment.status ? `- status: ${experiment.status}` : "",
		typeof experiment.baselineMetric === "number" ? `- baselineMetric: ${experiment.baselineMetric}` : "",
		typeof experiment.observedMetric === "number" ? `- observedMetric: ${experiment.observedMetric}` : "",
		typeof experiment.delta === "number" ? `- delta: ${experiment.delta}` : "",
		experiment.plannerRouteClass ? `- plannerRouteClass: ${experiment.plannerRouteClass}` : "",
		experiment.executionRouteClass ? `- executionRouteClass: ${experiment.executionRouteClass}` : "",
		experiment.packedRuntime ? `- packedRuntime: ${experiment.packedRuntime}` : "",
		experiment.packedSource ? `- packedSource: ${experiment.packedSource}` : "",
		experiment.policyFingerprint ? `- policyFingerprint: ${experiment.policyFingerprint}` : "",
		experiment.primaryObjectiveId ? `- primaryObjectiveId: ${experiment.primaryObjectiveId}` : "",
		experiment.primaryStopConditionKind ? `- primaryStopConditionKind: ${experiment.primaryStopConditionKind}` : "",
		typeof experiment.frontierBestScore === "number" ? `- frontierBestScore: ${experiment.frontierBestScore}` : "",
		experiment.gitBranch ? `- gitBranch: ${experiment.gitBranch}` : "",
		experiment.gitHeadCommit ? `- gitHeadCommit: ${experiment.gitHeadCommit}` : "",
		experiment.gitDirtyBefore != null ? `- gitDirtyBefore: ${String(experiment.gitDirtyBefore)}` : "",
		experiment.gitDirtyAfter != null ? `- gitDirtyAfter: ${String(experiment.gitDirtyAfter)}` : "",
		experiment.sessionId ? `- sessionId: ${experiment.sessionId}` : "",
		experiment.sabhaId ? `- sabhaId: ${experiment.sabhaId}` : "",
	].filter(Boolean);
	return lines.join("\n");
}

type ResearchLoopDigestSummary = {
	id: string;
	projectPath: string;
	topic: string;
	hypothesis?: string | null;
	stopReason: string;
	roundsRequested: number;
	roundsCompleted: number;
	bestMetric?: number | null;
	bestRoundNumber?: number | null;
	keptRounds?: number | null;
	revertedRounds?: number | null;
	policyFingerprint?: string | null;
	primaryObjectiveId?: string | null;
	primaryStopConditionId?: string | null;
	primaryStopConditionKind?: string | null;
	frontierBestScore?: number | null;
	refinementBudget?: ResearchRefinementBudgetOverride | null;
	nidraBudget?: ResearchNidraBudgetOverride | null;
};

type ResearchExperimentDigest = {
	id: string;
	projectPath: string;
	topic: string;
	hypothesis?: string | null;
	metricName: string;
	objective: string;
	decision: string;
	status?: string | null;
	baselineMetric?: number | null;
	observedMetric?: number | null;
	delta?: number | null;
	roundNumber?: number | null;
	totalRounds?: number | null;
	policyFingerprint?: string | null;
	primaryObjectiveId?: string | null;
	primaryStopConditionId?: string | null;
	primaryStopConditionKind?: string | null;
	frontierBestScore?: number | null;
	refinementBudget?: ResearchRefinementBudgetOverride | null;
	nidraBudget?: ResearchNidraBudgetOverride | null;
};

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asStopConditionKind(value: unknown): string | null {
	return value === "budget-exhausted"
		|| value === "max-rounds"
		|| value === "no-improvement"
		|| value === "pareto-stagnation"
		? value
		: null;
}

function parseRefinementBudget(value: unknown): ResearchRefinementBudgetOverride | null {
	const record = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
	if (!record) return null;
	const parsed: ResearchRefinementBudgetOverride = {};
	if (typeof record.dailyCandidateLimit === "number") parsed.dailyCandidateLimit = record.dailyCandidateLimit;
	if (typeof record.projectCandidateLimit === "number") parsed.projectCandidateLimit = record.projectCandidateLimit;
	if (typeof record.dailyMinMdlScore === "number") parsed.dailyMinMdlScore = record.dailyMinMdlScore;
	if (typeof record.projectMinMdlScore === "number") parsed.projectMinMdlScore = record.projectMinMdlScore;
	if (typeof record.dailyMinPriorityScore === "number") parsed.dailyMinPriorityScore = record.dailyMinPriorityScore;
	if (typeof record.projectMinPriorityScore === "number") parsed.projectMinPriorityScore = record.projectMinPriorityScore;
	if (typeof record.dailyMinSourceSessionCount === "number") parsed.dailyMinSourceSessionCount = record.dailyMinSourceSessionCount;
	if (typeof record.projectMinSourceSessionCount === "number") parsed.projectMinSourceSessionCount = record.projectMinSourceSessionCount;
	return Object.keys(parsed).length > 0 ? parsed : null;
}

function parseNidraBudget(value: unknown): ResearchNidraBudgetOverride | null {
	const record = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
	if (!record) return null;
	const parsed: ResearchNidraBudgetOverride = {};
	if (typeof record.maxResearchProjectsPerCycle === "number") {
		parsed.maxResearchProjectsPerCycle = record.maxResearchProjectsPerCycle;
	}
	if (typeof record.maxSemanticPressure === "number") {
		parsed.maxSemanticPressure = record.maxSemanticPressure;
	}
	return Object.keys(parsed).length > 0 ? parsed : null;
}

function parseRecordUpdateBudgets(record: Record<string, unknown>): {
	refinementBudget: ResearchRefinementBudgetOverride | null;
	nidraBudget: ResearchNidraBudgetOverride | null;
} {
	const updateBudgets = asRecord(record.updateBudgets);
	return {
		refinementBudget: parseRefinementBudget(updateBudgets.refinement),
		nidraBudget: parseNidraBudget(updateBudgets.nidra),
	};
}

function deriveLegacyLoopStopConditionKind(record: Record<string, unknown>): string | null {
	const topLevelHits = Array.isArray(record.stopConditionHits) ? record.stopConditionHits : [];
	for (const hit of topLevelHits) {
		const parsed = asRecord(hit);
		if (parsed.triggered === true) {
			const kind = asStopConditionKind(parsed.kind);
			if (kind) return kind;
		}
	}
	const rounds = Array.isArray(record.rounds) ? [...record.rounds].reverse() : [];
	for (const round of rounds) {
		const parsedRound = asRecord(round);
		const roundHits = Array.isArray(parsedRound.stopConditionHits) ? parsedRound.stopConditionHits : [];
		for (const hit of roundHits) {
			const parsedHit = asRecord(hit);
			if (parsedHit.triggered === true) {
				const kind = asStopConditionKind(parsedHit.kind);
				if (kind) return kind;
			}
		}
	}
	return null;
}

function deriveLegacyExperimentStopConditionKind(record: Record<string, unknown>): string | null {
	const topLevelHits = Array.isArray(record.stopConditionHits) ? record.stopConditionHits : [];
	for (const hit of topLevelHits) {
		const parsed = asRecord(hit);
		if (parsed.triggered === true) {
			const kind = asStopConditionKind(parsed.kind);
			if (kind) return kind;
		}
	}
	return null;
}

function deriveLegacyLoopFrontierBestScore(record: Record<string, unknown>): number | null {
	const frontier = Array.isArray(record.frontier) ? record.frontier : [];
	let best = frontier.reduce((currentBest, entry) => {
		const candidate = asRecord(entry).optimizerScore;
		return typeof candidate === "number" && Number.isFinite(candidate) ? Math.max(currentBest, candidate) : currentBest;
	}, Number.NEGATIVE_INFINITY);
	if (Number.isFinite(best)) return Math.round(best * 1000) / 1000;
	const rounds = Array.isArray(record.rounds) ? record.rounds : [];
	for (const round of rounds) {
		const parsed = asRecord(round);
		const optimizerScore = typeof parsed.optimizerScore === "number" ? parsed.optimizerScore : null;
		const objectiveScores = Array.isArray(parsed.objectiveScores) ? parsed.objectiveScores : [];
		if (objectiveScores.length === 0 || optimizerScore === null) continue;
		if (parsed.paretoDominated === true && Number.isFinite(best)) continue;
		best = Math.max(best, optimizerScore);
	}
	return Number.isFinite(best) ? Math.round(best * 1000) / 1000 : null;
}

/**
 * Normalize the optimizer-policy metadata embedded in one loop summary record.
 *
 * I pull this out once so both the refinement digest and the downstream scope
 * builder can consume the same policy truth without reparsing ad hoc fields.
 */
function withLoopPolicyMetadata<T extends {
	record?: Record<string, unknown> | null;
}>(loop: T): T & Pick<ResearchLoopDigestSummary,
	| "policyFingerprint"
	| "primaryObjectiveId"
	| "primaryStopConditionId"
	| "primaryStopConditionKind"
	| "frontierBestScore"
	| "refinementBudget"
	| "nidraBudget"
> {
	const record = asRecord(loop.record);
	const policy = asRecord(record.policy);
	const { refinementBudget, nidraBudget } = parseRecordUpdateBudgets(policy);
	return {
		...loop,
		policyFingerprint:
			typeof record.policyFingerprint === "string"
				? record.policyFingerprint
				: (typeof policy.fingerprint === "string" ? String(policy.fingerprint) : null),
		primaryObjectiveId:
			typeof record.primaryObjectiveId === "string"
				? record.primaryObjectiveId
				: (typeof policy.primaryObjectiveId === "string" ? String(policy.primaryObjectiveId) : null),
		primaryStopConditionId:
			typeof record.primaryStopConditionId === "string"
				? record.primaryStopConditionId
				: (typeof policy.primaryStopConditionId === "string" ? String(policy.primaryStopConditionId) : null),
		primaryStopConditionKind:
			asStopConditionKind(record.primaryStopConditionKind)
			?? deriveLegacyLoopStopConditionKind(record),
		frontierBestScore: deriveLegacyLoopFrontierBestScore(record),
		refinementBudget,
		nidraBudget,
	};
}

/**
 * Experiment rows can outlive or outrun their matching loop summary, so I also
 * normalize optimizer-policy metadata from the experiment record itself.
 */
function withExperimentPolicyMetadata<T extends {
	record?: Record<string, unknown> | null;
}>(experiment: T): T & Pick<ResearchExperimentDigest,
	| "policyFingerprint"
	| "primaryObjectiveId"
	| "primaryStopConditionId"
	| "primaryStopConditionKind"
	| "frontierBestScore"
	| "refinementBudget"
	| "nidraBudget"
> {
	const record = asRecord(experiment.record);
	const objectiveScores = Array.isArray(record.objectiveScores) ? record.objectiveScores : [];
	const optimizerScore = typeof record.optimizerScore === "number" ? record.optimizerScore : null;
	const { refinementBudget, nidraBudget } = parseRecordUpdateBudgets(record);
	return {
		...experiment,
		policyFingerprint: typeof record.policyFingerprint === "string" ? record.policyFingerprint : null,
		primaryObjectiveId: typeof record.primaryObjectiveId === "string" ? record.primaryObjectiveId : null,
		primaryStopConditionId: typeof record.primaryStopConditionId === "string" ? record.primaryStopConditionId : null,
		primaryStopConditionKind:
			asStopConditionKind(record.primaryStopConditionKind) ?? deriveLegacyExperimentStopConditionKind(record),
		frontierBestScore:
			optimizerScore !== null && objectiveScores.length > 0
				? Math.round(optimizerScore * 1000) / 1000
				: null,
		refinementBudget,
		nidraBudget,
	};
}

/**
 * Score how urgently one project scope should be refined after research runs.
 *
 * I weight unsafe terminal outcomes above pure improvement because semantic
 * repair should first protect the engine from unstable or degraded overnight
 * work, then preserve the highest-value successful experiments.
 */
function scoreResearchRefinementPriority(
	loops: readonly ResearchLoopDigestSummary[],
	experiments: readonly ResearchExperimentDigest[],
): number {
	let score = loops.length > 0 || experiments.length > 0 ? 1 : 0;
	const unsafeLoopCount = loops.filter((loop) => isUnsafeResearchStopReason(loop.stopReason)).length;
	const keptPositiveCount = experiments.filter((experiment) =>
		experiment.decision === "keep" && typeof experiment.delta === "number" && experiment.delta > 0
	).length;
	const revertedCount = loops.reduce(
		(sum, loop) => sum + (typeof loop.revertedRounds === "number" ? loop.revertedRounds : 0),
		0,
	);
	const paretoStagnationCount = [
		...loops.map((loop) => loop.primaryStopConditionKind),
		...experiments.map((experiment) => experiment.primaryStopConditionKind),
	].filter((kind) => kind === "pareto-stagnation").length;
	const strongestFrontierScore = [...loops, ...experiments].reduce((best, item) => {
		if (typeof item.frontierBestScore !== "number") return best;
		return Math.max(best, item.frontierBestScore);
	}, 0);
	const strongestDelta = experiments.reduce((best, experiment) => {
		if (typeof experiment.delta !== "number") return best;
		return Math.max(best, Math.abs(experiment.delta));
	}, 0);
	// I bias this mix toward unsafe outcomes first, then positive keeps, so the
	// daemon spends repair budget on protecting the engine before amplifying wins.
	score += Math.min(unsafeLoopCount * 1.2, 3);
	score += Math.min(paretoStagnationCount * 0.45, 1.35);
	score += Math.min(keptPositiveCount * 0.8, 2);
	score += Math.min(revertedCount * 0.35, 1.5);
	score += Math.min(strongestDelta * 10, 2);
	score += Math.min(strongestFrontierScore * 0.75, 0.75);
	return Math.round(score * 100) / 100;
}

function summarizeCounts(values: string[]): string {
	const counts = new Map<string, number>();
	for (const value of values) {
		const key = value.trim();
		if (!key) continue;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([key, count]) => `${key} (${count})`)
		.join(", ");
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
	return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function buildResearchNextSteps(
	loops: readonly ResearchLoopDigestSummary[],
	experiments: readonly ResearchExperimentDigest[],
): string[] {
	const steps: string[] = [];
	// I bias the digest toward concrete operator actions instead of echoing every
	// loop outcome. The point is to tell the next run what to do differently.
	const kept = experiments.filter((experiment) => experiment.decision === "keep" && typeof experiment.delta === "number" && experiment.delta > 0);
	if (kept.length > 0) {
		const best = [...kept].sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0];
		steps.push(`Promote the kept ${best.topic} experiment into the next refinement hypothesis and preserve its route/context bias.`);
	}
	// I prioritize unsafe terminal states above “no improvement” because they are
	// operational hygiene problems, not just optimization misses.
	const unsafe = loops.filter((loop) => isUnsafeResearchStopReason(loop.stopReason));
	if (unsafe.length > 0) {
		steps.push("Tighten scope snapshots or cleanup guards before the next unattended overnight run.");
	}
	// Only after stability is acceptable do I recommend changing the search
	// hypothesis or route envelope.
	const noImprovement = loops.filter((loop) => loop.stopReason === "no-improvement");
	if (loops.length > 0 && noImprovement.length === loops.length) {
		steps.push("Shift the hypothesis or widen the execution lane envelope instead of repeating the same overnight search.");
	}
	const reverted = loops.reduce((sum, loop) => sum + (typeof loop.revertedRounds === "number" ? loop.revertedRounds : 0), 0);
	if (reverted > 0) {
		steps.push("Review reverted rounds for reusable negative knowledge and feed that back into the next council plan.");
	}
	return steps.slice(0, 3);
}

function isUnsafeResearchStopReason(stopReason: string): boolean {
	return (
		stopReason === "unsafe-discard"
		|| stopReason === "round-failed"
		|| stopReason === "closure-failed"
		|| stopReason === "control-plane-lost"
	);
}

function renderResearchRefinementMemoryEntry(
	date: string,
	projectPath: string,
	loops: readonly ResearchLoopDigestSummary[],
	experiments: readonly ResearchExperimentDigest[],
): string {
	const stopReasons = summarizeCounts(loops.map((loop) => loop.stopReason));
	const decisions = summarizeCounts(experiments.map((experiment) => experiment.decision));
	const policyFingerprints = uniqueStrings([
		...loops.map((loop) => loop.policyFingerprint),
		...experiments.map((experiment) => experiment.policyFingerprint),
	]);
	const primaryObjectives = uniqueStrings([
		...loops.map((loop) => loop.primaryObjectiveId),
		...experiments.map((experiment) => experiment.primaryObjectiveId),
	]);
	const primaryStopKinds = uniqueStrings([
		...loops.map((loop) => loop.primaryStopConditionKind),
		...experiments.map((experiment) => experiment.primaryStopConditionKind),
	]);
	const hypotheses = uniqueStrings([
		...loops.map((loop) => loop.hypothesis),
		...experiments.map((experiment) => experiment.hypothesis),
	]);
	const frontierBestScore = [...loops, ...experiments].reduce((best, item) => {
		if (typeof item.frontierBestScore !== "number") return best;
		return Math.max(best, item.frontierBestScore);
	}, 0);
	const topDeltas = experiments
		.filter((experiment) => typeof experiment.delta === "number")
		.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
		.slice(0, 3)
		.map((experiment) => {
			const delta = typeof experiment.delta === "number" ? experiment.delta.toFixed(6) : "n/a";
			return `${experiment.topic}: ${delta} (${experiment.decision})`;
		});
	const nextSteps = buildResearchNextSteps(loops, experiments);
	const lines = [
		`## Research Refinement Digest [${date}]`,
		`- project: ${projectPath}`,
		`- overnightLoops: ${loops.length}`,
		`- experiments: ${experiments.length}`,
		stopReasons ? `- stopReasons: ${stopReasons}` : "",
		decisions ? `- decisions: ${decisions}` : "",
		policyFingerprints.length > 0 ? `- policyFingerprints: ${policyFingerprints.join(", ")}` : "",
		primaryObjectives.length > 0 ? `- primaryObjectives: ${primaryObjectives.join(", ")}` : "",
		primaryStopKinds.length > 0 ? `- primaryStopKinds: ${primaryStopKinds.join(", ")}` : "",
		frontierBestScore > 0 ? `- frontierBestScore: ${frontierBestScore.toFixed(3)}` : "",
		hypotheses.length > 0 ? `- hypotheses: ${hypotheses.join(" | ")}` : "",
		topDeltas.length > 0 ? `- topDeltas: ${topDeltas.join(" ; ")}` : "",
		"",
		"### Next Steps",
		...(nextSteps.length > 0 ? nextSteps.map((step) => `- ${step}`) : ["- No concrete next-step signal yet; keep the next overnight run bounded and comparison-driven."]),
	].filter(Boolean);
	return lines.join("\n");
}

async function persistResearchRefinementTrace(
	label: string,
	projectPath: string,
	loops: readonly ResearchLoopDigestSummary[],
	experiments: readonly ResearchExperimentDigest[],
	entry: string,
): Promise<void> {
	try {
		const { AkashaField, DatabaseManager } = await import("@chitragupta/smriti");
		const db = DatabaseManager.instance().get("agent");
		const akasha = new AkashaField();
		akasha.restore(db);
		const nextSteps = buildResearchNextSteps(loops, experiments);
		const traceType = loops.some((loop) => isUnsafeResearchStopReason(loop.stopReason))
			? "warning"
			: "pattern";
		akasha.leave(
			RESEARCH_REFINEMENT_TRACE_AGENT_ID,
			traceType,
			`research refinement ${projectPath}`,
			entry,
			{
				source: "research-refinement-digest",
				label,
				projectPath,
				loopCount: loops.length,
				experimentCount: experiments.length,
				stopReasons: uniqueStrings(loops.map((loop) => loop.stopReason)),
				decisions: uniqueStrings(experiments.map((experiment) => experiment.decision)),
				nextSteps,
			},
		);
		akasha.persist(db);
	} catch {
		// Best-effort: keep project-memory refinement artifacts even if Akasha is unavailable.
	}
}

/**
 * Append daily overnight-loop summaries into project memory for the given
 * date.
 *
 * I keep this write path explicit because the overnight loop itself records
 * round-level facts, while this digest step promotes the operator-facing loop
 * summary into long-lived project memory.
 */
export async function consolidateResearchLoopSummariesForDate(
	date: string,
): Promise<{ processed: number; projects: number; projectPaths: string[] }> {
	const { appendMemory, listResearchLoopSummaries } = await import("@chitragupta/smriti");
	const { start, end } = buildResearchDayEpochRange(date);
	const summaries = listAllResearchLoopSummariesForDay(listResearchLoopSummaries, start, end);
	if (summaries.length === 0) return { processed: 0, projects: 0, projectPaths: [] };

	const seenProjects = new Set<string>();
	for (const summary of summaries) {
		const normalizedSummary = withLoopPolicyMetadata(summary);
		await appendMemory(
			{ type: "project", path: summary.projectPath },
			renderResearchLoopMemoryEntry(normalizedSummary),
			{ dedupe: true },
		);
		seenProjects.add(summary.projectPath);
	}
	return { processed: summaries.length, projects: seenProjects.size, projectPaths: [...seenProjects] };
}

/**
 * Append daily experiment outcome summaries into project memory for the given
 * date.
 *
 * These entries are intentionally distinct from loop summaries so later
 * refinement can reason about the concrete experiment history, not only the
 * final loop narrative.
 */
export async function consolidateResearchExperimentsForDate(
	date: string,
): Promise<{ processed: number; projects: number; projectPaths: string[] }> {
	const { appendMemory, listResearchExperiments } = await import("@chitragupta/smriti");
	const { start, end } = buildResearchDayEpochRange(date);
	const experiments = listAllResearchExperimentsForDay(listResearchExperiments, start, end);
	if (experiments.length === 0) return { processed: 0, projects: 0, projectPaths: [] };

	const seenProjects = new Set<string>();
	for (const experiment of experiments) {
		const normalizedExperiment = withExperimentPolicyMetadata(experiment);
		await appendMemory(
			{ type: "project", path: experiment.projectPath },
			renderResearchExperimentMemoryEntry(normalizedExperiment),
			{ dedupe: true },
		);
		seenProjects.add(experiment.projectPath);
	}
	return { processed: experiments.length, projects: seenProjects.size, projectPaths: [...seenProjects] };
}

/**
 * Build one per-project refinement digest from the loop and experiment rows for
 * a date.
 *
 * I do three durable things here:
 * - append the digest to project memory
 * - persist a matching Akasha trace for later recall
 * - emit project/session scopes so semantic refinement can repair only the
 *   artifacts touched by the same research activity
 */
export async function consolidateResearchRefinementDigestsForDate(
	date: string,
): Promise<{
	processed: number;
	projects: number;
	projectPaths: string[];
	scopes: ResearchRefinementProjectScope[];
}> {
	const { appendMemory, listResearchLoopSummaries, listResearchExperiments } = await import("@chitragupta/smriti");
	const { start, end } = buildResearchDayEpochRange(date);
	const loops = listAllResearchLoopSummariesForDay(listResearchLoopSummaries, start, end);
	const experiments = listAllResearchExperimentsForDay(listResearchExperiments, start, end);
	const projectPaths = new Set<string>([
		...loops.map((loop) => loop.projectPath),
		...experiments.map((experiment) => experiment.projectPath),
	]);
	if (projectPaths.size === 0) return { processed: 0, projects: 0, projectPaths: [], scopes: [] };

	const sortedProjects = [...projectPaths].sort((a, b) => a.localeCompare(b));
	const scopes: ResearchRefinementProjectScope[] = [];
	for (const projectPath of sortedProjects) {
		const loopGroup = loops.filter((loop) => loop.projectPath === projectPath);
		const normalizedLoops = loopGroup.map((loop) => withLoopPolicyMetadata(loop));
		const experimentGroup = experiments
			.filter((experiment) => experiment.projectPath === projectPath)
			.map((experiment) => withExperimentPolicyMetadata(experiment));
		const entry = renderResearchRefinementMemoryEntry(
			date,
			projectPath,
			normalizedLoops as ResearchLoopDigestSummary[],
			experimentGroup as ResearchExperimentDigest[],
		);
		await appendMemory(
			{ type: "project", path: projectPath },
			entry,
			{ dedupe: true },
		);
		await persistResearchRefinementTrace(
				date,
				projectPath,
				normalizedLoops as ResearchLoopDigestSummary[],
				experimentGroup as ResearchExperimentDigest[],
				entry,
			);
		const mergedBudgetScope = mergeResearchRefinementScopes([
			...normalizedLoops.map((loop) => ({
				projectPath,
				refinementBudget: loop.refinementBudget,
				nidraBudget: loop.nidraBudget,
			})),
			...experimentGroup.map((experiment) => ({
				projectPath,
				refinementBudget: experiment.refinementBudget,
				nidraBudget: experiment.nidraBudget,
			})),
		]).at(0);
		scopes.push({
			projectPath,
			sessionIds: uniqueStrings([
				...loopGroup.flatMap((loop) => [loop.sessionId, loop.parentSessionId]),
				...experimentGroup.flatMap((experiment) => [experiment.sessionId, experiment.parentSessionId]),
			]),
				sessionLineageKeys: uniqueStrings([
					...normalizedLoops.map((loop) => loop.sessionLineageKey),
					...experimentGroup.map((experiment) => experiment.sessionLineageKey),
				]),
				priorityScore: scoreResearchRefinementPriority(
					normalizedLoops as ResearchLoopDigestSummary[],
					experimentGroup as ResearchExperimentDigest[],
				),
				policyFingerprints: uniqueStrings([
					...normalizedLoops.map((loop) => loop.policyFingerprint),
					...experimentGroup.map((experiment) => experiment.policyFingerprint),
				]),
				primaryObjectiveIds: uniqueStrings([
					...normalizedLoops.map((loop) => loop.primaryObjectiveId),
					...experimentGroup.map((experiment) => experiment.primaryObjectiveId),
				]),
				primaryStopConditionIds: uniqueStrings([
					...normalizedLoops.map((loop) => loop.primaryStopConditionId),
					...experimentGroup.map((experiment) => experiment.primaryStopConditionId),
				]),
				primaryStopConditionKinds: uniqueStrings([
					...normalizedLoops.map((loop) => loop.primaryStopConditionKind),
					...experimentGroup.map((experiment) => experiment.primaryStopConditionKind),
				]),
				frontierBestScore: [...normalizedLoops, ...experimentGroup].reduce((best, item) => {
					if (typeof item.frontierBestScore !== "number") return best;
					return Math.max(best, item.frontierBestScore);
				}, 0) || undefined,
				refinementBudget: mergedBudgetScope?.refinementBudget ?? null,
				nidraBudget: mergedBudgetScope?.nidraBudget ?? null,
			});
		}
	return {
		processed: sortedProjects.length,
		projects: sortedProjects.length,
		projectPaths: sortedProjects,
		scopes,
	};
}

/**
 * Consolidate recent research outcomes for the project/session scopes touched
 * by a deep-sleep cycle.
 *
 * This deep-sleep variant also appends project memory and emits refinement
 * scopes, but it narrows itself to the projects and sessions that Nidra just
 * surfaced instead of rescanning the whole day.
 */
export async function consolidateResearchRefinementDigestsForProjects(
	label: string,
	scopes: readonly ResearchRefinementProjectScope[],
): Promise<{
	processed: number;
	projects: number;
	projectPaths: string[];
	scopes: ResearchRefinementProjectScope[];
}> {
	const { appendMemory, listResearchLoopSummaries, listResearchExperiments } = await import("@chitragupta/smriti");
	const uniqueScopes = mergeResearchRefinementScopes(scopes);
	if (uniqueScopes.length === 0) {
		return { processed: 0, projects: 0, projectPaths: [], scopes: [] };
	}

	const processedProjectPaths: string[] = [];
	const refinedScopes: ResearchRefinementProjectScope[] = [];
	for (const scope of uniqueScopes) {
		const sessionIds = new Set(scope.sessionIds ?? []);
		const sessionLineageKeys = new Set(scope.sessionLineageKeys ?? []);
		const queryLimit = deriveProjectDigestQueryLimit(scope);
		const [loops, experiments] = await Promise.all([
			Promise.resolve(listAllProjectResearchRows(listResearchLoopSummaries, scope.projectPath, queryLimit)),
			Promise.resolve(listAllProjectResearchRows(listResearchExperiments, scope.projectPath, queryLimit)),
		]);
		// I filter by the exact project/day session set so one project's refinement
		// pressure cannot bleed into another project's digest when the raw research
		// tables are queried in bulk.
			const loopGroup = loops.filter((loop) => matchesResearchScopeSession(loop, sessionIds, sessionLineageKeys));
			const normalizedLoops = loopGroup.map((loop) => withLoopPolicyMetadata(loop));
		const experimentGroup = experiments
			.filter((experiment) => matchesResearchScopeSession(experiment, sessionIds, sessionLineageKeys))
			.map((experiment) => withExperimentPolicyMetadata(experiment));
		if (normalizedLoops.length === 0 && experimentGroup.length === 0) continue;
		// I rebuild one enriched scope from the exact digest groups so deep-sleep
		// refinement can reuse the policy/frontier/priority signal instead of
		// falling back to the raw pre-digest session filter.
		const mergedBudgetScope = mergeResearchRefinementScopes([
			...normalizedLoops.map((loop) => ({
				projectPath: scope.projectPath,
				refinementBudget: loop.refinementBudget,
				nidraBudget: loop.nidraBudget,
			})),
			...experimentGroup.map((experiment) => ({
				projectPath: scope.projectPath,
				refinementBudget: experiment.refinementBudget,
				nidraBudget: experiment.nidraBudget,
			})),
		]).at(0);
		refinedScopes.push({
			projectPath: scope.projectPath,
			sessionIds: uniqueStrings([
				...normalizedLoops.flatMap((loop) => [loop.sessionId, loop.parentSessionId]),
				...experimentGroup.flatMap((experiment) => [experiment.sessionId, experiment.parentSessionId]),
			]),
			sessionLineageKeys: uniqueStrings([
				...normalizedLoops.map((loop) => loop.sessionLineageKey),
				...experimentGroup.map((experiment) => experiment.sessionLineageKey),
			]),
			priorityScore: scoreResearchRefinementPriority(
				normalizedLoops as ResearchLoopDigestSummary[],
				experimentGroup as ResearchExperimentDigest[],
			),
			policyFingerprints: uniqueStrings([
				...normalizedLoops.map((loop) => loop.policyFingerprint),
				...experimentGroup.map((experiment) => experiment.policyFingerprint),
			]),
			primaryObjectiveIds: uniqueStrings([
				...normalizedLoops.map((loop) => loop.primaryObjectiveId),
				...experimentGroup.map((experiment) => experiment.primaryObjectiveId),
			]),
			primaryStopConditionIds: uniqueStrings([
				...normalizedLoops.map((loop) => loop.primaryStopConditionId),
				...experimentGroup.map((experiment) => experiment.primaryStopConditionId),
			]),
			primaryStopConditionKinds: uniqueStrings([
				...normalizedLoops.map((loop) => loop.primaryStopConditionKind),
				...experimentGroup.map((experiment) => experiment.primaryStopConditionKind),
			]),
			frontierBestScore: [...normalizedLoops, ...experimentGroup].reduce((best, item) => {
				if (typeof item.frontierBestScore !== "number") return best;
				return Math.max(best, item.frontierBestScore);
			}, 0) || undefined,
			refinementBudget: mergedBudgetScope?.refinementBudget ?? scope.refinementBudget ?? null,
			nidraBudget: mergedBudgetScope?.nidraBudget ?? scope.nidraBudget ?? null,
		});
		const entry = renderResearchRefinementMemoryEntry(
			label,
			scope.projectPath,
				normalizedLoops as ResearchLoopDigestSummary[],
				experimentGroup as ResearchExperimentDigest[],
			);

		await appendMemory(
			{ type: "project", path: scope.projectPath },
			entry,
			{ dedupe: true },
		);
		await persistResearchRefinementTrace(
				label,
				scope.projectPath,
				normalizedLoops as ResearchLoopDigestSummary[],
				experimentGroup as ResearchExperimentDigest[],
				entry,
			);
		processedProjectPaths.push(scope.projectPath);
	}

	return {
		processed: processedProjectPaths.length,
		projects: processedProjectPaths.length,
		projectPaths: processedProjectPaths,
		scopes: refinedScopes,
	};
}
