import { dynamicImport } from "./chitragupta-nodes.js";
import {
	buildCarryContext,
	normalizeContextForReuseWithPolicy,
	unpackContextForReuseWithPolicy,
} from "./chitragupta-nodes-research-overnight-context.js";
import { loadResearchLoopCheckpoint } from "./chitragupta-nodes-research-checkpoints.js";
import type { ResearchCouncilSummary, ResearchScope } from "./chitragupta-nodes-research-shared.js";
import type {
	BaselineData,
	OvernightResearchCheckpoint,
	OvernightResearchProgress,
	ResearchPolicySnapshot,
	OvernightResearchRound,
	OvernightResearchStopReason,
	OvernightResearchRoundCounts,
	OvernightResearchSummary,
} from "./chitragupta-nodes-research-overnight-types.js";
import {
	assertCompatibleResearchPolicy,
	buildSummary,
	buildResearchPolicySnapshot,
	normalizeResearchUpdateBudgets,
	selectPrimaryResearchStopConditionHit,
} from "./chitragupta-nodes-research-overnight-types.js";
import {
	annotateParetoRounds,
	selectResearchStopReason,
} from "./chitragupta-nodes-research-optimization.js";

type StoredResearchExperiment = Awaited<
	ReturnType<(typeof import("@chitragupta/smriti"))["listResearchExperiments"]>
>[number];
type StoredResearchLoopSummary = Awaited<
	ReturnType<(typeof import("@chitragupta/smriti"))["listResearchLoopSummaries"]>
>[number];

/**
 * Restored overnight-loop state returned before the runner decides whether to
 * resume rounds, finish pending closure, or acknowledge a terminal summary.
 */
export type RestoredOvernightResearchState =
	| {
			kind: "fresh";
			loopKey: string;
	  }
	| {
			kind: "complete-pending";
			loopKey: string;
			summary: OvernightResearchSummary;
	  }
	| {
			kind: "terminal";
			loopKey: string;
			summary: OvernightResearchSummary;
	  }
	| {
			kind: "resume";
			loopKey: string;
			nextRoundNumber: number;
			currentBaseline: BaselineData;
			progress: OvernightResearchProgress;
			roundCounts: OvernightResearchRoundCounts;
			carryContext: string;
			rounds: OvernightResearchRound[];
			checkpoint: OvernightResearchCheckpoint | null;
	  };

const RESUMABLE_STOP_REASONS = new Set<OvernightResearchStopReason>([
	"control-plane-lost",
	"closure-failed",
	"round-failed",
]);

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? value as Record<string, unknown>
		: {};
}

function parseStopReason(value: unknown): OvernightResearchStopReason | null {
	switch (value) {
		case "max-rounds":
		case "no-improvement":
		case "pareto-stagnation":
		case "budget-exhausted":
		case "cancelled":
		case "control-plane-lost":
		case "unsafe-discard":
		case "round-failed":
		case "closure-failed":
			return value;
		default:
			return null;
	}
}

function parseStoredRound(experiment: StoredResearchExperiment): OvernightResearchRound {
	const record = asRecord(experiment.record);
	const finalize = asRecord(record.finalize);
	const paretoRank = typeof record.paretoRank === "number" ? record.paretoRank : undefined;
	const objectiveScores = Array.isArray(record.objectiveScores)
		? record.objectiveScores.filter(
			(value): value is import("./chitragupta-nodes-research-shared.js").ResearchObjectiveScore =>
				Boolean(value && typeof value === "object"),
		)
		: undefined;
	const stopConditionHits = Array.isArray(record.stopConditionHits)
		? record.stopConditionHits.filter(
			(value): value is import("./chitragupta-nodes-research-shared.js").ResearchStopConditionHit =>
				Boolean(value && typeof value === "object"),
		)
		: undefined;
	return {
		roundNumber: experiment.roundNumber ?? 1,
		decision: experiment.decision,
		observedMetric: experiment.observedMetric ?? null,
		delta: experiment.delta ?? null,
		finalizeAction:
			typeof finalize.action === "string" ? finalize.action : null,
		traceId: null,
		experimentId: experiment.id,
		packedRuntime: experiment.packedRuntime ?? null,
		packedSource: experiment.packedSource ?? null,
		selectedModelId: experiment.selectedModelId ?? null,
		selectedProviderId: experiment.selectedProviderId ?? null,
		executionRouteClass: experiment.executionRouteClass ?? null,
		objectiveScores,
		stopConditionHits,
		optimizerScore: typeof record.optimizerScore === "number" ? record.optimizerScore : null,
		paretoRank,
		paretoDominated:
			paretoRank !== undefined && typeof record.paretoDominated === "boolean"
				? record.paretoDominated
				: undefined,
	};
}

function parseExperimentPolicyFingerprint(experiment: StoredResearchExperiment): string | null {
	const record = asRecord(experiment.record);
	return typeof record.policyFingerprint === "string" && record.policyFingerprint.trim()
		? record.policyFingerprint
		: null;
}

function hasMeaningfulArray<T>(value: readonly T[] | undefined): value is readonly T[] {
	return Array.isArray(value) && value.length > 0;
}

function preferArray<T>(existing: readonly T[] | undefined, parsed: readonly T[] | undefined): T[] | undefined {
	return hasMeaningfulArray(existing)
		? [...existing]
		: (hasMeaningfulArray(parsed) ? [...parsed] : undefined);
}

function preferFreshArray<T>(parsed: readonly T[] | undefined, existing: readonly T[] | undefined): T[] | undefined {
	return hasMeaningfulArray(parsed)
		? [...parsed]
		: (hasMeaningfulArray(existing) ? [...existing] : undefined);
}

function hasCompleteObjectiveVectors(rounds: readonly OvernightResearchRound[]): boolean {
	return rounds.length > 0 && rounds.every((round) => Array.isArray(round.objectiveScores) && round.objectiveScores.length > 0);
}

function isCompatibleExperimentPolicyFingerprint(scope: ResearchScope, fingerprint: string): boolean {
	const current = buildResearchPolicySnapshot(scope);
	return current.fingerprint === fingerprint || current.legacyFingerprint === fingerprint;
}

function hasPersistedPolicyIdentity(
	persisted: ResearchPolicySnapshot | null | undefined,
): persisted is ResearchPolicySnapshot & { fingerprint: string } {
	return typeof persisted?.fingerprint === "string" && persisted.fingerprint.trim().length > 0;
}

/**
 * I fail closed when a resumable summary claims to carry policy structure but
 * omits the fingerprint that ties it to the original optimizer contract.
 *
 * Without that identity, a later resume could silently reinterpret the summary
 * under a different objective or stop-condition policy.
 */
function summaryHasResumablePolicyWithoutIdentity(
	summary: StoredResearchLoopSummary | null | undefined,
): boolean {
	if (!summary) return false;
	const stopReason = parseStopReason(summary.stopReason);
	if (stopReason && !RESUMABLE_STOP_REASONS.has(stopReason)) {
		return false;
	}
	const record = asRecord(summary.record);
	const policyRecord = asRecord(record.policy);
	if (Object.keys(policyRecord).length === 0) {
		return false;
	}
	return typeof policyRecord.fingerprint !== "string" || policyRecord.fingerprint.trim().length === 0;
}

function deriveTerminalStopReasonFromRounds(
	rounds: readonly OvernightResearchRound[],
): OvernightResearchStopReason | null {
	const latestTriggeredHits = [...rounds]
		.reverse()
		.find((round) => Array.isArray(round.stopConditionHits) && round.stopConditionHits.some((hit) => hit.triggered))
		?.stopConditionHits;
	return latestTriggeredHits && latestTriggeredHits.length > 0
		? selectResearchStopReason(latestTriggeredHits)
		: null;
}

function restoreParetoTruthIfMissing(rounds: OvernightResearchRound[]): OvernightResearchRound[] {
	if (!rounds.some((round) => Array.isArray(round.objectiveScores) && round.objectiveScores.length > 0)) {
		return rounds;
	}
	if (hasCompleteObjectiveVectors(rounds)) {
		// I always recompute the frontier when every round still carries its full
		// objective vector. Pareto truth is global loop state, so it should follow
		// the merged round set rather than whichever record happened to be fresher
		// for one individual round.
		return annotateParetoRounds(rounds);
	}
	const hasPersistedParetoTruth = rounds.some((round) => typeof round.paretoRank === "number");
	return hasPersistedParetoTruth ? rounds : annotateParetoRounds(rounds);
}

/**
 * Merge the latest durable experiment slice into the persisted loop-summary
 * rounds without throwing away older governance state.
 *
 * The experiment ledger query is intentionally bounded, so it may only return
 * the recent tail of a longer logical loop. I use the summary rounds as the
 * governance backbone, then overlay the freshest per-round execution facts from
 * the recent experiment slice.
 */
function mergeResumeRounds(
	summaryRounds: readonly OvernightResearchRound[],
	experiments: readonly StoredResearchExperiment[],
): OvernightResearchRound[] {
	const merged = new Map<number, OvernightResearchRound>();
	for (const round of summaryRounds) {
		merged.set(round.roundNumber, { ...round });
	}
	for (const experiment of experiments) {
		const parsed = parseStoredRound(experiment);
		const existing = merged.get(parsed.roundNumber);
		if (!existing) {
			merged.set(parsed.roundNumber, parsed);
			continue;
		}
			merged.set(parsed.roundNumber, {
				...existing,
			decision: parsed.decision,
			observedMetric: parsed.observedMetric,
			delta: parsed.delta,
			finalizeAction: parsed.finalizeAction ?? existing.finalizeAction ?? null,
			traceId: existing.traceId ?? parsed.traceId ?? null,
			experimentId: parsed.experimentId ?? existing.experimentId ?? null,
			packedRuntime: parsed.packedRuntime ?? existing.packedRuntime ?? null,
				packedSource: parsed.packedSource ?? existing.packedSource ?? null,
				selectedModelId: parsed.selectedModelId ?? existing.selectedModelId ?? null,
				selectedProviderId:
					parsed.selectedProviderId ?? existing.selectedProviderId ?? null,
				executionRouteClass:
					parsed.executionRouteClass ?? existing.executionRouteClass ?? null,
					objectiveScores: preferFreshArray(parsed.objectiveScores, existing.objectiveScores),
					stopConditionHits: preferFreshArray(parsed.stopConditionHits, existing.stopConditionHits),
					optimizerScore:
						typeof parsed.optimizerScore === "number" ? parsed.optimizerScore : (existing.optimizerScore ?? null),
					paretoRank:
						typeof existing.paretoRank === "number"
							? existing.paretoRank
							: (typeof parsed.paretoRank === "number" ? parsed.paretoRank : null),
					paretoDominated:
						typeof existing.paretoDominated === "boolean"
							? existing.paretoDominated
							: parsed.paretoDominated,
					});
				}
	return restoreParetoTruthIfMissing(
		[...merged.values()].sort((left, right) => left.roundNumber - right.roundNumber),
	);
}

/**
 * Collapse retry/repair attempts down to one effective experiment per logical
 * round when rebuilding resumable loop state.
 *
 * The research ledger can legitimately contain multiple rows for the same
 * round when a run retries or records an additional recovery attempt. Resume
 * logic must only count the latest durable state for each round; otherwise the
 * next round number, streak accounting, and total duration drift upward on
 * every retry.
 */
function collapseExperimentsForResume(
	experiments: StoredResearchExperiment[],
): StoredResearchExperiment[] {
	const byRound = new Map<number, StoredResearchExperiment>();
	const passthrough: StoredResearchExperiment[] = [];
	for (const experiment of experiments) {
		const roundNumber = experiment.roundNumber;
		if (typeof roundNumber !== "number" || !Number.isFinite(roundNumber)) {
			passthrough.push(experiment);
			continue;
		}
		const existing = byRound.get(roundNumber);
		if (!existing) {
			byRound.set(roundNumber, experiment);
			continue;
		}
		const existingAttempt = existing.attemptNumber ?? -1;
		const nextAttempt = experiment.attemptNumber ?? -1;
		if (nextAttempt > existingAttempt) {
			byRound.set(roundNumber, experiment);
			continue;
		}
		if (nextAttempt === existingAttempt && experiment.updatedAt >= existing.updatedAt) {
			byRound.set(roundNumber, experiment);
		}
	}
	return [
		...passthrough,
		...[...byRound.values()].sort((left, right) => {
			const leftRound = left.roundNumber ?? Number.MAX_SAFE_INTEGER;
			const rightRound = right.roundNumber ?? Number.MAX_SAFE_INTEGER;
			if (leftRound !== rightRound) return leftRound - rightRound;
			return left.updatedAt - right.updatedAt;
		}),
	];
}

function deriveTotalDurationMs(experiments: StoredResearchExperiment[]): number {
	return experiments.reduce((total, experiment) => {
		const run = asRecord(asRecord(experiment.record).run);
		const roundWallClockDurationMs =
			typeof run.roundWallClockDurationMs === "number"
				? run.roundWallClockDurationMs
				: null;
		const executionDurationMs =
			typeof run.durationMs === "number"
				? run.durationMs
				: 0;
		return total + (roundWallClockDurationMs ?? executionDurationMs);
	}, 0);
}

function deriveNoImprovementStreak(rounds: OvernightResearchRound[]): number {
	let streak = 0;
	for (let index = rounds.length - 1; index >= 0; index -= 1) {
		if (rounds[index]?.decision === "keep") break;
		streak += 1;
	}
	return streak;
}

/**
 * Keep resume reconstruction biased toward the persisted loop summary, but use a
 * wide ledger window when that summary is missing or incomplete.
 *
 * I only need enough experiment rows to rebuild the recent execution tail, yet
 * I intentionally over-sample when the summary is absent so resume does not
 * truncate older kept rounds just because one loop retried heavily.
 */
function deriveResumeExperimentLimit(
	scopeMaxRounds: number,
	summary: StoredResearchLoopSummary | null,
): number {
	const summaryRounds = summary?.roundsCompleted ?? 0;
	return Math.max(200, scopeMaxRounds * 16, summaryRounds * 12);
}

function parseStoredSummary(summary: StoredResearchLoopSummary): OvernightResearchSummary {
	const record = asRecord(summary.record);
	const persistedStopReason =
		typeof summary.stopReason === "string" && summary.stopReason.trim()
			? summary.stopReason.trim()
			: null;
	const rounds = Array.isArray(record.rounds)
		? record.rounds
			.map((value): OvernightResearchRound | null => {
				const round = asRecord(value);
				const roundNumber =
					typeof round.roundNumber === "number" ? round.roundNumber : null;
				if (roundNumber === null) return null;
					return {
						roundNumber,
					decision:
						typeof round.decision === "string" ? round.decision : "record",
					observedMetric:
						typeof round.observedMetric === "number" ? round.observedMetric : null,
					delta: typeof round.delta === "number" ? round.delta : null,
					finalizeAction:
						typeof round.finalizeAction === "string" ? round.finalizeAction : null,
					traceId: typeof round.traceId === "string" ? round.traceId : null,
					experimentId:
						typeof round.experimentId === "string" ? round.experimentId : null,
					packedRuntime:
						typeof round.packedRuntime === "string" ? round.packedRuntime : null,
					packedSource:
						typeof round.packedSource === "string" ? round.packedSource : null,
					selectedModelId:
						typeof round.selectedModelId === "string" ? round.selectedModelId : null,
					selectedProviderId:
						typeof round.selectedProviderId === "string" ? round.selectedProviderId : null,
					executionRouteClass:
						typeof round.executionRouteClass === "string"
							? round.executionRouteClass
							: null,
					objectiveScores: Array.isArray(round.objectiveScores)
						? round.objectiveScores.filter(
							(value): value is import("./chitragupta-nodes-research-shared.js").ResearchObjectiveScore =>
								Boolean(value && typeof value === "object"),
						)
						: undefined,
						stopConditionHits: Array.isArray(round.stopConditionHits)
							? round.stopConditionHits.filter(
								(value): value is import("./chitragupta-nodes-research-shared.js").ResearchStopConditionHit =>
									Boolean(value && typeof value === "object"),
							)
							: undefined,
						optimizerScore:
							typeof round.optimizerScore === "number" ? round.optimizerScore : null,
						paretoRank:
							typeof round.paretoRank === "number" ? round.paretoRank : undefined,
						paretoDominated:
							typeof round.paretoRank === "number" && typeof round.paretoDominated === "boolean"
								? round.paretoDominated
								: undefined,
					};
				})
			.filter((value): value is OvernightResearchRound => value !== null)
		: [];
	const frontier = Array.isArray(record.frontier)
		? record.frontier
			.map((value) => asRecord(value))
			.map((entry) => ({
				roundNumber: typeof entry.roundNumber === "number" ? entry.roundNumber : 0,
				optimizerScore: typeof entry.optimizerScore === "number" ? entry.optimizerScore : null,
				objectiveScores: Array.isArray(entry.objectiveScores)
					? entry.objectiveScores.filter(
						(value): value is import("./chitragupta-nodes-research-shared.js").ResearchObjectiveScore =>
							Boolean(value && typeof value === "object"),
					)
					: [],
			}))
			.filter((entry) => entry.roundNumber > 0)
		: rounds
			.filter((round) => round.paretoDominated === false && Array.isArray(round.objectiveScores))
				.map((round) => ({
					roundNumber: round.roundNumber,
					optimizerScore: typeof round.optimizerScore === "number" ? round.optimizerScore : null,
					objectiveScores: round.objectiveScores ?? [],
				}));
	const summaryStopConditionHits = Array.isArray(record.stopConditionHits)
		? record.stopConditionHits.filter(
			(value): value is import("./chitragupta-nodes-research-shared.js").ResearchStopConditionHit =>
				Boolean(value && typeof value === "object"),
		)
		: undefined;
	const policyRecord = asRecord(record.policy);
	const primaryStopCondition = selectPrimaryResearchStopConditionHit(summaryStopConditionHits);
	const persistedPrimaryStopConditionId =
		typeof record.primaryStopConditionId === "string" ? record.primaryStopConditionId : null;
	const persistedPrimaryStopConditionKind =
		record.primaryStopConditionKind === "budget-exhausted"
		|| record.primaryStopConditionKind === "max-rounds"
		|| record.primaryStopConditionKind === "no-improvement"
		|| record.primaryStopConditionKind === "pareto-stagnation"
			? record.primaryStopConditionKind
			: null;
	const policy = typeof policyRecord.fingerprint === "string"
		? {
			fingerprint: policyRecord.fingerprint,
			legacyFingerprint:
				typeof policyRecord.legacyFingerprint === "string" ? policyRecord.legacyFingerprint : null,
			objectives: Array.isArray(policyRecord.objectives)
				? policyRecord.objectives.filter(
					(value): value is ResearchPolicySnapshot["objectives"][number] =>
						Boolean(value && typeof value === "object"),
				)
				: [],
			stopConditions: Array.isArray(policyRecord.stopConditions)
				? policyRecord.stopConditions.filter(
					(value): value is ResearchPolicySnapshot["stopConditions"][number] =>
						Boolean(value && typeof value === "object"),
				)
				: [],
			// I normalize missing or partial persisted budgets back into the full
			// runtime envelope so resume keeps the original optimizer contract
			// instead of silently collapsing to defaults or fingerprint-only state.
			updateBudgets: normalizeResearchUpdateBudgets(
				policyRecord.updateBudgets as ResearchPolicySnapshot["updateBudgets"] | undefined,
			),
			primaryObjectiveId:
				typeof policyRecord.primaryObjectiveId === "string" ? policyRecord.primaryObjectiveId : null,
			primaryStopConditionId:
				typeof policyRecord.primaryStopConditionId === "string" ? policyRecord.primaryStopConditionId : null,
		}
		: null;
		return {
			loopKey: summary.loopKey ?? "",
			roundsRequested: summary.roundsRequested,
			roundsCompleted: summary.roundsCompleted,
			// I preserve unknown persisted terminal reasons verbatim so resume does
			// not rewrite a future/foreign daemon stop outcome into closure-failed.
			stopReason: (parseStopReason(persistedStopReason) ?? persistedStopReason ?? "closure-failed") as OvernightResearchStopReason,
		bestMetric: summary.bestMetric ?? null,
		bestRoundNumber: summary.bestRoundNumber ?? null,
		noImprovementStreak: summary.noImprovementStreak ?? 0,
		totalDurationMs: summary.totalDurationMs ?? 0,
		totalBudgetMs: summary.totalBudgetMs ?? 0,
		keptRounds: summary.keptRounds ?? 0,
		revertedRounds: summary.revertedRounds ?? 0,
		sessionId: summary.sessionId ?? null,
		sabhaId: summary.sabhaId ?? null,
		councilVerdict: summary.councilVerdict ?? "unknown",
		plannerRoute: record.plannerRoute && typeof record.plannerRoute === "object"
			? record.plannerRoute as Record<string, unknown>
			: null,
			executionRoute: record.executionRoute && typeof record.executionRoute === "object"
				? record.executionRoute as Record<string, unknown>
				: null,
			rounds,
			policy: policy ?? undefined,
			policyFingerprint:
				typeof record.policyFingerprint === "string"
					? record.policyFingerprint
					: (policy?.fingerprint ?? null),
			primaryObjectiveId:
				typeof record.primaryObjectiveId === "string"
					? record.primaryObjectiveId
					: (policy?.primaryObjectiveId ?? null),
				frontier,
				stopConditionHits: summaryStopConditionHits,
			primaryStopConditionId:
				primaryStopCondition?.id ?? persistedPrimaryStopConditionId,
			primaryStopConditionKind:
				primaryStopCondition?.kind ?? persistedPrimaryStopConditionKind,
			closureStatus: record.closureStatus === "degraded" ? "degraded" : "complete",
		closureError:
			typeof record.closureError === "string" ? record.closureError : null,
	};
}

/**
 * Rebuild resumable loop state directly from the durable checkpoint payload.
 *
 * I use this path before consulting the broader experiment ledger because an
 * active checkpoint is the freshest authoritative picture of an interrupted
 * loop.
 */
function resumeFromCheckpoint(
	baseline: BaselineData,
	loopKey: string,
	checkpoint: OvernightResearchCheckpoint,
): RestoredOvernightResearchState {
	return {
		kind: "resume",
		loopKey,
		nextRoundNumber: checkpoint.nextRoundNumber,
		currentBaseline: checkpoint.currentBaseline ?? { ...baseline },
		progress: checkpoint.progress,
		roundCounts: checkpoint.roundCounts,
		carryContext: checkpoint.carryContext,
		rounds: checkpoint.rounds,
		checkpoint,
	};
}

/**
 * Restore a resumable overnight loop from the strongest durable source
 * available.
 *
 * The order is:
 * 1. exact daemon-owned checkpoint
 * 2. persisted loop summary plus bounded experiment tail
 * 3. bounded experiment-only fallback when no summary survived
 *
 * This keeps timeout pickup exact when checkpoints exist and still lets older
 * runs recover without replaying already-recorded rounds from scratch.
 */
export async function restoreOvernightResearchLoopState(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	baseline: BaselineData,
	loopKey: string,
	signal?: AbortSignal,
): Promise<RestoredOvernightResearchState> {
	const checkpoint = await loadResearchLoopCheckpoint(scope, loopKey, signal);
	if (checkpoint) {
		if (
			checkpoint.phase !== "complete-pending"
			&& checkpoint.phase !== "terminal"
			&& checkpoint.policy
			&& !hasPersistedPolicyIdentity(checkpoint.policy)
		) {
			return { kind: "fresh", loopKey };
		}
		assertCompatibleResearchPolicy(scope, checkpoint.policy ?? null, `checkpoint ${loopKey}`);
		if (checkpoint.phase === "complete-pending" && checkpoint.terminalSummary) {
			return { kind: "complete-pending", loopKey, summary: checkpoint.terminalSummary };
		}
		if (checkpoint.phase === "terminal" && checkpoint.terminalSummary) {
			return { kind: "terminal", loopKey, summary: checkpoint.terminalSummary };
		}
		return resumeFromCheckpoint(baseline, loopKey, checkpoint);
	}
	const { listResearchExperiments, listResearchLoopSummaries } = await dynamicImport("@chitragupta/smriti");
	const [latestSummary] = listResearchLoopSummaries({
		projectPath: scope.projectPath,
		loopKey,
		limit: 1,
	});
	const experimentLimit = deriveResumeExperimentLimit(scope.maxRounds, latestSummary ?? null);
	const experiments = collapseExperimentsForResume(listResearchExperiments({
		projectPath: scope.projectPath,
		loopKey,
		limit: experimentLimit,
	}).sort((left: StoredResearchExperiment, right: StoredResearchExperiment) => {
		const leftRound = left.roundNumber ?? Number.MAX_SAFE_INTEGER;
		const rightRound = right.roundNumber ?? Number.MAX_SAFE_INTEGER;
		if (leftRound !== rightRound) return leftRound - rightRound;
		return left.updatedAt - right.updatedAt;
	}));

	if (!latestSummary && experiments.length === 0) {
		return { kind: "fresh", loopKey };
	}

	const parsedSummary = latestSummary ? parseStoredSummary(latestSummary) : null;
	if (summaryHasResumablePolicyWithoutIdentity(latestSummary ?? null)) {
		return { kind: "fresh", loopKey };
	}
	if (
		parsedSummary?.policy
		&& !hasPersistedPolicyIdentity(parsedSummary.policy)
		&& (!parsedSummary.stopReason || RESUMABLE_STOP_REASONS.has(parsedSummary.stopReason))
	) {
		return { kind: "fresh", loopKey };
	}
	if (parsedSummary?.policy) {
		assertCompatibleResearchPolicy(scope, parsedSummary.policy, `summary ${loopKey}`);
	}
	if (!parsedSummary?.policy && parsedSummary?.policyFingerprint) {
		if (!isCompatibleExperimentPolicyFingerprint(scope, parsedSummary.policyFingerprint)) {
			return { kind: "fresh", loopKey };
		}
	}
	const latestExperimentPolicyFingerprint = [...experiments]
		.reverse()
		.map(parseExperimentPolicyFingerprint)
		.find((fingerprint): fingerprint is string => Boolean(fingerprint));
	if (latestExperimentPolicyFingerprint && !isCompatibleExperimentPolicyFingerprint(scope, latestExperimentPolicyFingerprint)) {
		if (parsedSummary && parsedSummary.stopReason && !RESUMABLE_STOP_REASONS.has(parsedSummary.stopReason)) {
			return { kind: "terminal", loopKey, summary: parsedSummary };
		}
		return { kind: "fresh", loopKey };
	}
	if (!parsedSummary && experiments.length > 0) {
		if (!latestExperimentPolicyFingerprint) {
			// Older experiment-only rows do not carry policy identity, so resuming
			// them under a newer command/route/objective contract is unsafe. I fail
			// closed into a fresh logical loop instead of merging incompatible rounds.
			return { kind: "fresh", loopKey };
		}
	}
	const rounds = mergeResumeRounds(parsedSummary?.rounds ?? [], experiments);
	const derivedStopReason = deriveTerminalStopReasonFromRounds(rounds);
	const summaryStopReason = parsedSummary?.stopReason ?? null;
	const terminalStopReason = summaryStopReason && !RESUMABLE_STOP_REASONS.has(summaryStopReason)
		? summaryStopReason
		: derivedStopReason;
	if (parsedSummary && terminalStopReason && summaryStopReason === terminalStopReason) {
		return { kind: "terminal", loopKey, summary: parsedSummary };
	}
	const keptRounds = rounds.filter(
		(round: OvernightResearchRound) => round.finalizeAction === "kept",
	).length;
	const revertedRounds = rounds.filter(
		(round: OvernightResearchRound) => round.finalizeAction === "reverted",
	).length;
	const lastKept = [...rounds].reverse().find(
		(round) => round.decision === "keep" && typeof round.observedMetric === "number",
	);
	const currentBaseline = lastKept && typeof lastKept.observedMetric === "number"
		? { ...baseline, baselineMetric: lastKept.observedMetric }
		: { ...baseline };
	const progress: OvernightResearchProgress = {
		bestMetric: parsedSummary?.bestMetric ?? currentBaseline.baselineMetric,
		bestRoundNumber: parsedSummary?.bestRoundNumber ?? (lastKept?.roundNumber ?? null),
		noImprovementStreak: parsedSummary?.noImprovementStreak ?? deriveNoImprovementStreak(rounds),
		totalDurationMs: parsedSummary?.totalDurationMs ?? deriveTotalDurationMs(experiments),
	};
	if (terminalStopReason) {
		return {
			kind: "terminal",
			loopKey,
			summary: buildSummary(
				scope,
				council,
				rounds,
				terminalStopReason,
				progress.bestMetric,
				progress.bestRoundNumber,
				progress.noImprovementStreak,
				progress.totalDurationMs,
				keptRounds,
				revertedRounds,
				loopKey,
			),
		};
	}
	const nextRoundNumber = Math.max(
		experiments.at(-1)?.roundNumber ?? 0,
		rounds.at(-1)?.roundNumber ?? 0,
	) + 1;
	if (nextRoundNumber > scope.maxRounds) {
		const terminalStopReason = "max-rounds";
		return {
			kind: "terminal",
			loopKey,
			summary: parsedSummary ?? buildSummary(
				scope,
				council,
				rounds,
				terminalStopReason,
				progress.bestMetric,
				progress.bestRoundNumber,
				progress.noImprovementStreak,
				progress.totalDurationMs,
				keptRounds,
				revertedRounds,
				loopKey,
			),
		};
	}

	const lastPackedContext = experiments.at(-1)?.packedContext?.trim() ?? "";
	let carryContext = "";
	if (lastPackedContext) {
		// I keep resume rebuild on the same daemon-owned compression path as live
		// closure so resume cannot silently drift into a weaker local-only policy.
		const unpacked = await unpackContextForReuseWithPolicy(lastPackedContext, signal, "daemon-only");
		carryContext = await normalizeContextForReuseWithPolicy(
			buildCarryContext({ ...scope, loopKey }, rounds.at(-1) ?? {
				roundNumber: nextRoundNumber - 1,
				decision: "record",
				observedMetric: null,
				delta: null,
				finalizeAction: null,
				traceId: null,
				experimentId: null,
				packedRuntime: null,
				packedSource: null,
				selectedModelId: null,
				selectedProviderId: null,
				executionRouteClass: null,
			}, unpacked),
			signal,
			"daemon-only",
		);
	}

	return {
		kind: "resume",
		loopKey,
		nextRoundNumber,
		currentBaseline,
		progress,
		roundCounts: { keptRounds, revertedRounds },
		carryContext,
		rounds,
		checkpoint: null,
	};
}
