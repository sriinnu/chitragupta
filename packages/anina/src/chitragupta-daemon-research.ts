function startOfDayEpoch(date: string): number {
	return new Date(`${date}T00:00:00`).getTime();
}

function endOfDayEpoch(date: string): number {
	return startOfDayEpoch(date) + 24 * 60 * 60 * 1000;
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
	const kept = experiments.filter((experiment) => experiment.decision === "keep" && typeof experiment.delta === "number" && experiment.delta > 0);
	if (kept.length > 0) {
		const best = [...kept].sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0];
		steps.push(`Promote the kept ${best.topic} experiment into the next refinement hypothesis and preserve its route/context bias.`);
	}
	const unsafe = loops.filter((loop) => loop.stopReason === "unsafe-discard" || loop.stopReason === "round-failed" || loop.stopReason === "closure-failed");
	if (unsafe.length > 0) {
		steps.push("Tighten scope snapshots or cleanup guards before the next unattended overnight run.");
	}
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

export async function consolidateResearchLoopSummariesForDate(
	date: string,
): Promise<{ processed: number; projects: number; projectPaths: string[] }> {
	const { appendMemory, listResearchLoopSummaries } = await import("@chitragupta/smriti");
	const summaries = listResearchLoopSummaries({
		updatedAfter: startOfDayEpoch(date),
		updatedBefore: endOfDayEpoch(date),
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

export async function consolidateResearchExperimentsForDate(
	date: string,
): Promise<{ processed: number; projects: number; projectPaths: string[] }> {
	const { appendMemory, listResearchExperiments } = await import("@chitragupta/smriti");
	const experiments = listResearchExperiments({
		updatedAfter: startOfDayEpoch(date),
		updatedBefore: endOfDayEpoch(date),
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

export async function consolidateResearchRefinementDigestsForDate(
	date: string,
): Promise<{ processed: number; projects: number; projectPaths: string[] }> {
	const { appendMemory, listResearchLoopSummaries, listResearchExperiments } = await import("@chitragupta/smriti");
	const query = {
		updatedAfter: startOfDayEpoch(date),
		updatedBefore: endOfDayEpoch(date),
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
	if (projectPaths.size === 0) return { processed: 0, projects: 0, projectPaths: [] };

	const sortedProjects = [...projectPaths].sort((a, b) => a.localeCompare(b));
	for (const projectPath of sortedProjects) {
		const loopGroup = loops.filter((loop) => loop.projectPath === projectPath);
		const experimentGroup = experiments.filter((experiment) => experiment.projectPath === projectPath);
		await appendMemory(
			{ type: "project", path: projectPath },
			renderResearchRefinementMemoryEntry(
				date,
				projectPath,
				loopGroup as ResearchLoopDigestSummary[],
				experimentGroup as ResearchExperimentDigest[],
			),
			{ dedupe: true },
		);
	}
	return { processed: sortedProjects.length, projects: sortedProjects.length, projectPaths: sortedProjects };
}
