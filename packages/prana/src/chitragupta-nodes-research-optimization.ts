import type {
	ResearchFinalizeResult,
	ResearchObjectiveScore,
	ResearchObjectiveSpec,
	ResearchScope,
	ResearchStopConditionHit,
	ResearchStopConditionSpec,
} from "./chitragupta-nodes-research-shared.js";
import type {
	OvernightResearchRound,
	ResearchEvaluationRecord,
} from "./chitragupta-nodes-research-overnight-types.js";
import { buildResearchPolicySnapshot } from "./chitragupta-nodes-research-overnight-types.js";

/**
 * Minimal execution facts needed to score one completed overnight round.
 *
 * I keep this narrower than the full runtime state so objective scoring stays
 * deterministic and easy to reuse from resume/final-summary paths.
 */
type OptimizationContext = {
	scope: ResearchScope;
	evaluation: ResearchEvaluationRecord;
	run: {
		durationMs?: number | null;
		timedOut?: boolean;
	};
	finalize: Pick<ResearchFinalizeResult, "action"> | null;
	packed: {
		savings?: number | null;
		packed?: boolean;
	} | null;
};

/**
 * Older checkpoints and partially restored scopes can be missing the objective
 * registry. I normalize that case so resume paths degrade gracefully instead of
 * crashing the closure phase on `undefined.filter(...)`.
 */
function activeObjectives(scope: ResearchScope): readonly ResearchObjectiveSpec[] {
	return buildResearchPolicySnapshot(scope).objectives;
}

/**
 * Older checkpoints can also arrive without the stop-condition registry. I
 * normalize that to an empty list so resume paths do not fail in the final
 * closure phase when they recompute loop-stop state.
 */
function activeStopConditions(scope: ResearchScope): readonly ResearchStopConditionSpec[] {
	return buildResearchPolicySnapshot(scope).stopConditions;
}

function roundScore(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * Evaluate one configured objective into a comparable higher-is-better score.
 *
 * I keep the scoring normalized so Pareto comparison can stay simple and I do
 * not need per-objective dominance code scattered through the loop runtime.
 */
function evaluateObjectiveScore(
	objective: ResearchObjectiveSpec,
	context: OptimizationContext,
): ResearchObjectiveScore {
	switch (objective.metric) {
		case "metric-improvement": {
			const delta = typeof context.evaluation.delta === "number" ? context.evaluation.delta : null;
			const positiveDelta = delta ?? 0;
			const score = delta === null ? 0 : Math.max(0, positiveDelta);
			return {
				id: objective.id,
				label: objective.label,
				metric: objective.metric,
				score: roundScore(score),
				value: delta,
				threshold: objective.threshold,
				satisfied: objective.threshold == null ? score > 0 : score >= objective.threshold,
				explanation: delta == null
					? "No measurable metric delta was produced."
					: `Measured improvement delta ${roundScore(delta)} against the previous baseline.`,
			};
		}
		case "duration-efficiency": {
			const durationMs = typeof context.run.durationMs === "number" ? context.run.durationMs : null;
			const budgetMs = Math.max(1, context.scope.budgetMs);
			const score = durationMs == null ? 0 : clamp01(1 - (durationMs / budgetMs));
			return {
				id: objective.id,
				label: objective.label,
				metric: objective.metric,
				score: roundScore(score),
				value: durationMs,
				threshold: objective.threshold,
				satisfied: objective.threshold == null ? score > 0 : score >= objective.threshold,
				explanation: durationMs == null
					? "No round duration was recorded."
					: `Spent ${durationMs}ms of a ${budgetMs}ms round budget.`,
			};
		}
		case "packing-efficiency": {
			const savings = typeof context.packed?.savings === "number" ? context.packed.savings : null;
			const score = savings == null ? 0 : clamp01(savings / 100);
			return {
				id: objective.id,
				label: objective.label,
				metric: objective.metric,
				score: roundScore(score),
				value: savings,
				threshold: objective.threshold,
				satisfied: objective.threshold == null ? score > 0 : score >= objective.threshold,
				explanation: savings == null
					? "No packed carry-context savings were recorded."
					: `Packed carry-context reduced prompt payload by ${roundScore(savings)}%.`,
			};
		}
		case "stability": {
			const score = context.run.timedOut === true
				? 0
				: context.finalize?.action === "kept"
					? 1
					: context.finalize?.action === "reverted"
						? 0.35
						: 0.6;
			return {
				id: objective.id,
				label: objective.label,
				metric: objective.metric,
				score: roundScore(score),
				value: score,
				threshold: objective.threshold,
				satisfied: objective.threshold == null ? score > 0 : score >= objective.threshold,
				explanation: context.run.timedOut === true
					? "Execution timed out and lost stability credit."
					: context.finalize?.action === "reverted"
						? "Scope had to be reverted, so stability is degraded."
						: "Execution stayed inside the bounded workflow envelope.",
			};
		}
	}
}

/**
 * Score the configured objective registry for a completed round.
 */
export function evaluateResearchObjectives(context: OptimizationContext): ResearchObjectiveScore[] {
	return activeObjectives(context.scope)
		.filter((objective) => objective.enabled)
		.map((objective) => evaluateObjectiveScore(objective, context));
}

/**
 * Collapse one objective vector into a weighted scalar score.
 *
 * I only use this for ranking and summaries. The loop still keeps the full
 * vector plus Pareto annotations so one scalar score does not erase the trade
 * offs an operator may want to inspect later.
 */
function weightedObjectiveValue(scores: readonly ResearchObjectiveScore[], objectives: readonly ResearchObjectiveSpec[]): number {
	let weighted = 0;
	let weightTotal = 0;
	for (const objective of objectives) {
		if (!objective.enabled) continue;
		const score = scores.find((entry) => entry.id === objective.id);
		if (!score) continue;
		weighted += score.score * objective.weight;
		weightTotal += objective.weight;
	}
	return roundScore(weightTotal > 0 ? weighted / weightTotal : 0);
}

/**
 * Decide whether one recorded round Pareto-dominates another.
 *
 * The comparison is intentionally strict. If either side is missing one score,
 * I refuse to claim dominance from partial data.
 */
function dominates(left: OvernightResearchRound, right: OvernightResearchRound): boolean {
	if (!left.objectiveScores || !right.objectiveScores) return false;
	const leftScores = new Map(left.objectiveScores.map((score) => [score.id, score.score]));
	let strictlyBetter = false;
	// This is an intentionally simple Pareto dominance test across the current
	// objective vector, not a full multi-front ranking implementation.
	for (const candidate of right.objectiveScores) {
		const value = leftScores.get(candidate.id);
		if (typeof value !== "number") return false;
		if (value < candidate.score) return false;
		if (value > candidate.score) strictlyBetter = true;
	}
	return strictlyBetter;
}

/**
 * Recompute Pareto metadata for the current round set.
 *
 * I annotate every round in one pass so summaries and persisted experiment
 * records can point to the same frontier without ad hoc post-processing.
 */
export function annotateParetoRounds(rounds: readonly OvernightResearchRound[]): OvernightResearchRound[] {
	const annotated = rounds.map((round) => ({ ...round, paretoDominated: false, paretoRank: 0 }));
	// I only need a single dominated/non-dominated frontier for operator-facing
	// loop summaries right now, so rank 0 means frontier and rank 1 means
	// dominated. If we later need multiple fronts, this is the seam to expand.
	for (let index = 0; index < annotated.length; index += 1) {
		const round = annotated[index];
		let dominated = false;
		for (let compareIndex = 0; compareIndex < annotated.length; compareIndex += 1) {
			if (index === compareIndex) continue;
			if (dominates(annotated[compareIndex], round)) {
				dominated = true;
				break;
			}
		}
		round.paretoDominated = dominated;
		round.paretoRank = dominated ? 1 : 0;
	}
	return annotated;
}

/**
 * Evaluate the configured stop-condition registry against the current loop
 * state. Triggered conditions remain explicit operator-facing breadcrumbs even
 * when the loop ultimately stops for only one canonical stop reason.
 */
export function evaluateResearchStopConditions(args: {
	scope: ResearchScope;
	rounds: readonly OvernightResearchRound[];
	currentRound: number;
	noImprovementStreak: number;
	totalDurationMs: number;
}): ResearchStopConditionHit[] {
	return activeStopConditions(args.scope)
		.filter((condition) => condition.enabled)
		.map((condition): ResearchStopConditionHit => {
			switch (condition.kind) {
				case "budget-exhausted": {
					const triggered = args.totalDurationMs >= args.scope.totalBudgetMs;
					return {
						id: condition.id,
						kind: condition.kind,
						triggered,
						reason: triggered
							? `Loop consumed ${args.totalDurationMs}ms of ${args.scope.totalBudgetMs}ms.`
							: "Loop still has remaining budget.",
					};
				}
				case "max-rounds": {
					const threshold = Math.max(1, Math.floor(condition.threshold ?? args.scope.maxRounds));
					const triggered = args.currentRound >= threshold;
					return {
						id: condition.id,
						kind: condition.kind,
						triggered,
						reason: triggered
							? `Loop reached round ${args.currentRound} of ${threshold}.`
							: "Loop can still execute more rounds.",
					};
				}
				case "no-improvement": {
					const patience = Math.max(1, Math.floor(condition.patience ?? args.scope.stopAfterNoImprovementRounds));
					const triggered = args.noImprovementStreak >= patience;
					return {
						id: condition.id,
						kind: condition.kind,
						triggered,
						reason: triggered
							? `No-improvement streak reached ${args.noImprovementStreak}/${patience}.`
							: "Improvement pressure is still acceptable.",
					};
				}
				case "pareto-stagnation": {
					const patience = Math.max(2, Math.floor(condition.patience ?? 3));
					const recent = args.rounds.slice(-patience);
					const triggered = recent.length >= patience && recent.every((round) => round.paretoDominated === true);
					return {
						id: condition.id,
						kind: condition.kind,
						triggered,
						reason: triggered
							? `Last ${patience} rounds were Pareto-dominated by earlier outcomes.`
							: "Recent rounds still improve or maintain the frontier.",
					};
				}
			}
		});
}

/**
 * Map a triggered stop-condition set back into the canonical loop stop reason.
 */
export function selectResearchStopReason(
	hits: readonly ResearchStopConditionHit[],
): "budget-exhausted" | "no-improvement" | "max-rounds" {
	if (hits.some((hit) => hit.triggered && hit.kind === "budget-exhausted")) return "budget-exhausted";
	if (hits.some((hit) => hit.triggered && hit.kind === "pareto-stagnation")) return "no-improvement";
	if (hits.some((hit) => hit.triggered && hit.kind === "no-improvement")) return "no-improvement";
	return "max-rounds";
}

/**
 * Attach optimizer metadata to one completed round.
 */
export function withRoundOptimization(
	round: OvernightResearchRound,
	scope: ResearchScope,
): OvernightResearchRound {
	const overallScore = weightedObjectiveValue(round.objectiveScores ?? [], activeObjectives(scope));
	return {
		...round,
		optimizerScore: overallScore,
	};
}
