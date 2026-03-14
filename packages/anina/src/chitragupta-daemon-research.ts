import {
	buildResearchDayEpochRange,
	matchesResearchScopeSession,
	mergeResearchRefinementScopes,
	type ResearchRefinementProjectScope,
} from "./chitragupta-daemon-research-scope.js";

export {
	buildResearchDayEpochRange,
	matchesResearchScopeSession,
	mergeResearchRefinementScopes,
	type ResearchRefinementProjectScope,
} from "./chitragupta-daemon-research-scope.js";

const RESEARCH_REFINEMENT_TRACE_AGENT_ID = "anina:research-postprocess";

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
};

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
	const strongestDelta = experiments.reduce((best, experiment) => {
		if (typeof experiment.delta !== "number") return best;
		return Math.max(best, Math.abs(experiment.delta));
	}, 0);
	// I bias this mix toward unsafe outcomes first, then positive keeps, so the
	// daemon spends repair budget on protecting the engine before amplifying wins.
	score += Math.min(unsafeLoopCount * 1.2, 3);
	score += Math.min(keptPositiveCount * 0.8, 2);
	score += Math.min(revertedCount * 0.35, 1.5);
	score += Math.min(strongestDelta * 10, 2);
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
	const unsafe = loops.filter((loop) => loop.stopReason === "unsafe-discard" || loop.stopReason === "round-failed" || loop.stopReason === "closure-failed");
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
	const hypotheses = uniqueStrings([
		...loops.map((loop) => loop.hypothesis),
		...experiments.map((experiment) => experiment.hypothesis),
	]);
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
	// I keep this daily fetch horizon bounded because the daemon digest only needs
	// recent overnight outcomes for the touched day. Wider historical mining
	// belongs in Smriti retrieval, not in the daily maintenance pass.
	const summaries = listResearchLoopSummaries({
		updatedAfter: start,
		updatedBefore: end,
		limit: 500,
	});
	if (summaries.length === 0) return { processed: 0, projects: 0, projectPaths: [] };

	const seenProjects = new Set<string>();
	for (const summary of summaries) {
		await appendMemory(
			{ type: "project", path: summary.projectPath },
			renderResearchLoopMemoryEntry(summary),
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
	const experiments = listResearchExperiments({
		updatedAfter: start,
		updatedBefore: end,
		limit: 500,
	});
	if (experiments.length === 0) return { processed: 0, projects: 0, projectPaths: [] };

	const seenProjects = new Set<string>();
	for (const experiment of experiments) {
		await appendMemory(
			{ type: "project", path: experiment.projectPath },
			renderResearchExperimentMemoryEntry(experiment),
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
	const query = {
		updatedAfter: start,
		updatedBefore: end,
		limit: 500,
	};
	const [loops, experiments] = await Promise.all([
		listResearchLoopSummaries(query),
		listResearchExperiments(query),
	]);
	const projectPaths = new Set<string>([
		...loops.map((loop) => loop.projectPath),
		...experiments.map((experiment) => experiment.projectPath),
	]);
	if (projectPaths.size === 0) return { processed: 0, projects: 0, projectPaths: [], scopes: [] };

	const sortedProjects = [...projectPaths].sort((a, b) => a.localeCompare(b));
	const scopes: ResearchRefinementProjectScope[] = [];
	for (const projectPath of sortedProjects) {
		const loopGroup = loops.filter((loop) => loop.projectPath === projectPath);
		const experimentGroup = experiments.filter((experiment) => experiment.projectPath === projectPath);
		const entry = renderResearchRefinementMemoryEntry(
			date,
			projectPath,
			loopGroup as ResearchLoopDigestSummary[],
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
			loopGroup as ResearchLoopDigestSummary[],
			experimentGroup as ResearchExperimentDigest[],
			entry,
		);
		scopes.push({
			projectPath,
			sessionIds: uniqueStrings([
				...loopGroup.flatMap((loop) => [loop.sessionId, loop.parentSessionId]),
				...experimentGroup.flatMap((experiment) => [experiment.sessionId, experiment.parentSessionId]),
			]),
			sessionLineageKeys: uniqueStrings([
				...loopGroup.map((loop) => loop.sessionLineageKey),
				...experimentGroup.map((experiment) => experiment.sessionLineageKey),
			]),
			priorityScore: scoreResearchRefinementPriority(
				loopGroup as ResearchLoopDigestSummary[],
				experimentGroup as ResearchExperimentDigest[],
			),
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
): Promise<{ processed: number; projects: number; projectPaths: string[] }> {
	const { appendMemory, listResearchLoopSummaries, listResearchExperiments } = await import("@chitragupta/smriti");
	const uniqueScopes = mergeResearchRefinementScopes(scopes);
	if (uniqueScopes.length === 0) {
		return { processed: 0, projects: 0, projectPaths: [] };
	}

	const processedProjectPaths: string[] = [];
	for (const scope of uniqueScopes) {
		const sessionIds = new Set(scope.sessionIds ?? []);
		const sessionLineageKeys = new Set(scope.sessionLineageKeys ?? []);
		const [loops, experiments] = await Promise.all([
			listResearchLoopSummaries({ projectPath: scope.projectPath, limit: 200 }),
			listResearchExperiments({ projectPath: scope.projectPath, limit: 200 }),
		]);
		// I filter by the exact project/day session set so one project's refinement
		// pressure cannot bleed into another project's digest when the raw research
		// tables are queried in bulk.
		const loopGroup = loops.filter((loop) => matchesResearchScopeSession(loop, sessionIds, sessionLineageKeys));
		const experimentGroup = experiments.filter((experiment) => matchesResearchScopeSession(experiment, sessionIds, sessionLineageKeys));
		if (loopGroup.length === 0 && experimentGroup.length === 0) continue;
		const entry = renderResearchRefinementMemoryEntry(
			label,
			scope.projectPath,
			loopGroup as ResearchLoopDigestSummary[],
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
			loopGroup as ResearchLoopDigestSummary[],
			experimentGroup as ResearchExperimentDigest[],
			entry,
		);
		processedProjectPaths.push(scope.projectPath);
	}

	return {
		processed: processedProjectPaths.length,
		projects: processedProjectPaths.length,
		projectPaths: processedProjectPaths,
	};
}
