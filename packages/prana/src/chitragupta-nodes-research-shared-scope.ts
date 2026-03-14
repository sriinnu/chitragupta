/**
 * Research scope parsing, budget construction, and validation.
 *
 * I keep scope construction out of the generic helper module so the parser can
 * evolve with the overnight loop without turning the utility file into an
 * unbounded kitchen sink.
 */

import path from "node:path";
import type { NodeContext } from "./chitragupta-nodes.js";
import {
	DEFAULT_BUDGET_MS,
	DEFAULT_IMMUTABLE_FILES,
	DEFAULT_METRIC_NAME,
	DEFAULT_METRIC_PATTERN,
	DEFAULT_MIN_IMPROVEMENT_DELTA,
	DEFAULT_NO_IMPROVEMENT_STOP,
	DEFAULT_OVERNIGHT_AGENT_COUNT,
	DEFAULT_OVERNIGHT_ROUNDS,
	DEFAULT_PLANNER_ROUTE_CLASS,
	DEFAULT_TARGET_FILES,
	MAX_BUDGET_MS,
	type ResearchObjective,
	type ResearchObjectiveSpec,
	type ResearchScope,
	type ResearchStopConditionSpec,
	type ResearchUpdateBudgets,
} from "./chitragupta-nodes-research-shared-types.js";
import {
	buildDefaultResearchObjectives,
	buildDefaultResearchStopConditions,
	buildDefaultResearchUpdateBudgets,
} from "./chitragupta-nodes-research-shared-defaults.js";
import {
	clampBudget,
	normalizeScopeFile,
	numberValue,
	objectiveValue,
	stringArrayValue,
	stringValue,
} from "./chitragupta-nodes-research-shared-helpers.js";

function clampRounds(value: number): number {
	return Math.max(1, Math.min(24, Math.floor(value)));
}

function clampTotalBudget(value: number, perRoundBudget: number, rounds: number): number {
	const fallback = perRoundBudget * rounds;
	const normalized = Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(perRoundBudget, Math.min(normalized, MAX_BUDGET_MS * 24));
}

function clampAgentCount(value: number): number {
	return Math.max(2, Math.min(5, Math.floor(value)));
}

function clampNoImprovementRounds(value: number, rounds: number): number {
	return Math.max(1, Math.min(rounds, Math.floor(value)));
}

function clampImprovementDelta(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function clampWeight(value: number, fallback: number): number {
	const normalized = Number.isFinite(value) ? value : fallback;
	return Math.max(0, Math.min(10, Math.round(normalized * 100) / 100));
}

function clampThreshold(value: number | undefined): number | undefined {
	if (!Number.isFinite(value)) return undefined;
	return Math.round(Math.max(0, value as number) * 1000) / 1000;
}

function clampTextBudget(value: unknown, fallback: number): number {
	const normalized = numberValue(value, fallback);
	return Math.max(256, Math.min(64_000, Math.floor(normalized)));
}

function clampReuseChars(value: unknown, fallback: number): number {
	const normalized = numberValue(value, fallback);
	return Math.max(512, Math.min(64_000, Math.floor(normalized)));
}

function clampCandidateLimit(value: unknown, fallback: number): number {
	const normalized = numberValue(value, fallback);
	return Math.max(1, Math.min(64, Math.floor(normalized)));
}

function clampScoreThreshold(value: unknown, fallback: number): number {
	const normalized = numberValue(value, fallback);
	return Math.max(0, Math.min(5, Math.round(normalized * 100) / 100));
}

function clampSourceSessionCount(value: unknown, fallback: number): number {
	const normalized = numberValue(value, fallback);
	return Math.max(1, Math.min(64, Math.floor(normalized)));
}

function clampFrontierEntries(value: unknown, fallback: number): number {
	const normalized = numberValue(value, fallback);
	return Math.max(1, Math.min(16, Math.floor(normalized)));
}

function clampProjectCycleLimit(value: unknown, fallback: number): number {
	const normalized = numberValue(value, fallback);
	return Math.max(1, Math.min(16, Math.floor(normalized)));
}

function clampSemanticPressure(value: unknown, fallback: number): number {
	const normalized = numberValue(value, fallback);
	return Math.max(1, Math.min(16, Math.floor(normalized)));
}

function optionalStringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function resolveResearchProjectPath(projectPath: string): string {
	return path.resolve(projectPath || process.cwd());
}

function resolveResearchCwd(projectPath: string, researchCwd: unknown): string {
	if (typeof researchCwd !== "string" || !researchCwd.trim()) {
		return projectPath;
	}
	const raw = researchCwd.trim();
	const resolved = path.isAbsolute(raw)
		? path.resolve(raw)
		: path.resolve(projectPath, raw);
	const relative = path.relative(projectPath, resolved);
	if (relative === "" || relative === ".") return projectPath;
	if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
		throw new Error(`Research cwd must stay within the canonical project path: ${projectPath}`);
	}
	return resolved;
}

function parseObjectiveSpecs(
	value: unknown,
	fallback: ResearchObjectiveSpec[],
): ResearchObjectiveSpec[] {
	if (!Array.isArray(value) || value.length === 0) return fallback;
	const parsed = value
		.map((entry, index): ResearchObjectiveSpec | null => {
			if (!entry || typeof entry !== "object") return null;
			const record = entry as Record<string, unknown>;
			const metric = (
				record.metric === "metric-improvement"
				|| record.metric === "duration-efficiency"
				|| record.metric === "packing-efficiency"
				|| record.metric === "stability"
			)
				? record.metric
				: null;
			if (!metric) return null;
			return {
				id: stringValue(record.id, `objective-${index + 1}`),
				label: stringValue(record.label, metric),
				metric,
				weight: clampWeight(numberValue(record.weight, 1), 1),
				threshold: clampThreshold(
					typeof record.threshold === "number" ? record.threshold : undefined,
				),
				enabled: booleanValue(record.enabled, true),
			};
		})
		.filter((entry): entry is ResearchObjectiveSpec => entry !== null && entry.enabled);
	return parsed.length > 0 ? parsed : fallback;
}

function parseStopConditionSpecs(
	value: unknown,
	fallback: ResearchStopConditionSpec[],
): ResearchStopConditionSpec[] {
	if (!Array.isArray(value) || value.length === 0) return fallback;
	const parsed = value
		.map((entry, index): ResearchStopConditionSpec | null => {
			if (!entry || typeof entry !== "object") return null;
			const record = entry as Record<string, unknown>;
			const kind = (
				record.kind === "max-rounds"
				|| record.kind === "no-improvement"
				|| record.kind === "budget-exhausted"
				|| record.kind === "pareto-stagnation"
			)
				? record.kind
				: null;
			if (!kind) return null;
			const patience = typeof record.patience === "number"
				? Math.max(1, Math.floor(record.patience))
				: undefined;
			return {
				id: stringValue(record.id, `stop-${index + 1}`),
				kind,
				patience,
				threshold: clampThreshold(
					typeof record.threshold === "number" ? record.threshold : undefined,
				),
				enabled: booleanValue(record.enabled, true),
			};
		})
		.filter((entry): entry is ResearchStopConditionSpec => entry !== null && entry.enabled);
	return parsed.length > 0 ? parsed : fallback;
}

/**
 * Parse optional subsystem budget overrides from the node context.
 *
 * I only allow bounded numeric overrides here so callers can steer one loop
 * without turning the research path into an unvalidated free-for-all.
 */
export function parseResearchUpdateBudgets(extra: Record<string, unknown>): ResearchUpdateBudgets {
	const defaults = buildDefaultResearchUpdateBudgets();
	return {
		packing: {
			maxStdoutChars: clampTextBudget(
				extra.researchPackingMaxStdoutChars,
				defaults.packing.maxStdoutChars,
			),
			maxStderrChars: clampTextBudget(
				extra.researchPackingMaxStderrChars,
				defaults.packing.maxStderrChars,
			),
			maxCarryContextChars: clampTextBudget(
				extra.researchPackingMaxCarryContextChars,
				defaults.packing.maxCarryContextChars,
			),
		},
		retrieval: {
			maxReuseChars: clampReuseChars(
				extra.researchRetrievalMaxReuseChars,
				defaults.retrieval.maxReuseChars,
			),
			maxFrontierEntries: clampFrontierEntries(
				extra.researchRetrievalMaxFrontierEntries,
				defaults.retrieval.maxFrontierEntries,
			),
		},
		refinement: {
			dailyCandidateLimit: clampCandidateLimit(
				extra.researchRefinementDailyCandidateLimit,
				defaults.refinement.dailyCandidateLimit,
			),
			projectCandidateLimit: clampCandidateLimit(
				extra.researchRefinementProjectCandidateLimit,
				defaults.refinement.projectCandidateLimit,
			),
			dailyMinMdlScore: clampScoreThreshold(
				extra.researchRefinementDailyMinMdlScore,
				defaults.refinement.dailyMinMdlScore,
			),
			projectMinMdlScore: clampScoreThreshold(
				extra.researchRefinementProjectMinMdlScore,
				defaults.refinement.projectMinMdlScore,
			),
			dailyMinPriorityScore: clampScoreThreshold(
				extra.researchRefinementDailyMinPriorityScore,
				defaults.refinement.dailyMinPriorityScore,
			),
			projectMinPriorityScore: clampScoreThreshold(
				extra.researchRefinementProjectMinPriorityScore,
				defaults.refinement.projectMinPriorityScore,
			),
			dailyMinSourceSessionCount: clampSourceSessionCount(
				extra.researchRefinementDailyMinSourceSessionCount,
				defaults.refinement.dailyMinSourceSessionCount,
			),
			projectMinSourceSessionCount: clampSourceSessionCount(
				extra.researchRefinementProjectMinSourceSessionCount,
				defaults.refinement.projectMinSourceSessionCount,
			),
		},
		nidra: {
			maxResearchProjectsPerCycle: clampProjectCycleLimit(
				extra.researchNidraMaxProjectsPerCycle,
				defaults.nidra.maxResearchProjectsPerCycle,
			),
			maxSemanticPressure: clampSemanticPressure(
				extra.researchNidraMaxSemanticPressure,
				defaults.nidra.maxSemanticPressure,
			),
		},
	};
}

/** Build one normalized research scope from a workflow node context. */
export function buildScope(ctx: NodeContext): ResearchScope {
	const projectPath = resolveResearchProjectPath(ctx.projectPath);
	const cwd = resolveResearchCwd(projectPath, ctx.extra.researchCwd);
	const maxRounds = clampRounds(
		numberValue(ctx.extra.researchRounds, DEFAULT_OVERNIGHT_ROUNDS),
	);
	const budgetMs = clampBudget(
		numberValue(ctx.extra.researchBudgetMs, DEFAULT_BUDGET_MS),
	);
	const objectives = parseObjectiveSpecs(
		ctx.extra.researchObjectives,
		buildDefaultResearchObjectives(),
	);
	const stopConditions = parseStopConditionSpecs(
		ctx.extra.researchStopConditions,
		buildDefaultResearchStopConditions(maxRounds),
	).map((condition) => condition.kind === "no-improvement"
		? {
			...condition,
			patience: clampNoImprovementRounds(
				numberValue(
					ctx.extra.researchStopAfterNoImprovementRounds,
					condition.patience ?? DEFAULT_NO_IMPROVEMENT_STOP,
				),
				maxRounds,
			),
		}
		: condition);
	return {
		hypothesis: stringValue(
			ctx.extra.researchHypothesis,
			"A bounded modification to train.py can improve validation quality.",
		),
		topic: stringValue(
			ctx.extra.researchTopic,
			"Bounded autoresearch experiment loop",
		),
		command: stringValue(ctx.extra.researchCommand, "uv"),
		commandArgs: stringArrayValue(ctx.extra.researchArgs, ["run", "train.py"]),
		projectPath,
		cwd,
		parentSessionId: optionalStringValue(
			ctx.extra.researchParentSessionId ?? ctx.extra.parentSessionId,
		),
		sessionLineageKey: optionalStringValue(
			ctx.extra.researchSessionLineageKey
			?? ctx.extra.sessionLineageKey
			?? ctx.extra.lineageKey,
		),
		targetFiles: stringArrayValue(
			ctx.extra.researchTargetFiles,
			DEFAULT_TARGET_FILES,
		),
		immutableFiles: stringArrayValue(
			ctx.extra.researchImmutableFiles,
			DEFAULT_IMMUTABLE_FILES,
		),
		metricName: stringValue(ctx.extra.researchMetricName, DEFAULT_METRIC_NAME),
		metricPattern: stringValue(
			ctx.extra.researchMetricPattern,
			DEFAULT_METRIC_PATTERN,
		),
		objective: objectiveValue(ctx.extra.researchObjective),
		budgetMs,
		totalBudgetMs: clampTotalBudget(
			numberValue(ctx.extra.researchTotalBudgetMs, budgetMs * maxRounds),
			budgetMs,
			maxRounds,
		),
		allowDirtyWorkspace: booleanValue(ctx.extra.researchAllowDirtyWorkspace, false),
		plannerRouteClass: stringValue(
			ctx.extra.researchPlannerRouteClass,
			DEFAULT_PLANNER_ROUTE_CLASS,
		),
		plannerCapability: optionalStringValue(ctx.extra.researchPlannerCapability),
		executionRouteClass: stringValue(ctx.extra.researchExecutionRouteClass, "tool.use.flex"),
		executionCapability: optionalStringValue(ctx.extra.researchExecutionCapability),
		maxRounds,
		agentCount: clampAgentCount(
			numberValue(ctx.extra.researchAgentCount, DEFAULT_OVERNIGHT_AGENT_COUNT),
		),
		stopAfterNoImprovementRounds: clampNoImprovementRounds(
			numberValue(
				ctx.extra.researchStopAfterNoImprovementRounds,
				DEFAULT_NO_IMPROVEMENT_STOP,
			),
			maxRounds,
		),
		minimumImprovementDelta: clampImprovementDelta(
			numberValue(ctx.extra.researchMinImprovementDelta, DEFAULT_MIN_IMPROVEMENT_DELTA),
		),
			objectives,
			stopConditions,
			updateBudgets: parseResearchUpdateBudgets(ctx.extra),
			leaseOwner: optionalStringValue(ctx.extra.researchLeaseOwner),
			requireTargetFileChangesForKeep: booleanValue(
				ctx.extra.researchRequireTargetFileChangesForKeep,
				true,
		),
		allowHashOnlyKeep: booleanValue(
			ctx.extra.researchAllowHashOnlyKeep,
			false,
		),
		loopKey: optionalStringValue(ctx.extra.researchLoopKey),
		roundNumber: null,
		totalRounds: null,
		attemptNumber: null,
	};
}

/** Validate one normalized research scope before execution starts. */
export function validateScope(scope: ResearchScope): void {
	if (!scope.command.trim()) throw new Error("Research command is required");
	if (scope.commandArgs.length === 0) throw new Error("Research command arguments are required");
	if (scope.targetFiles.length === 0) throw new Error("At least one target file is required");
	if (!scope.executionRouteClass && !scope.executionCapability) {
		throw new Error("Research execution route class or capability is required");
	}
	if (!scope.plannerRouteClass && !scope.plannerCapability) {
		throw new Error("Research planner route class or capability is required");
	}
	if (scope.objectives.length === 0) {
		throw new Error("At least one research objective is required");
	}
	if (scope.stopConditions.length === 0) {
		throw new Error("At least one research stop condition is required");
	}
	const duplicateObjectiveIds = scope.objectives.filter(
		(objective, index, all) => all.findIndex((candidate) => candidate.id === objective.id) !== index,
	);
	if (duplicateObjectiveIds.length > 0) {
		throw new Error(`Duplicate research objective ids are not allowed: ${[...new Set(duplicateObjectiveIds.map((objective) => objective.id))].join(", ")}`);
	}
	const duplicateStopConditionIds = scope.stopConditions.filter(
		(condition, index, all) => all.findIndex((candidate) => candidate.id === condition.id) !== index,
	);
	if (duplicateStopConditionIds.length > 0) {
		throw new Error(`Duplicate research stop-condition ids are not allowed: ${[...new Set(duplicateStopConditionIds.map((condition) => condition.id))].join(", ")}`);
	}
	const immutableOverlap = scope.targetFiles.filter((file) => scope.immutableFiles.includes(file));
	if (immutableOverlap.length > 0) {
		throw new Error(`Target files overlap immutable files: ${immutableOverlap.join(", ")}`);
	}
	const duplicateTargets = scope.targetFiles.filter((file, index, all) => all.indexOf(file) !== index);
	if (duplicateTargets.length > 0) {
		throw new Error(`Duplicate target files are not allowed: ${[...new Set(duplicateTargets)].join(", ")}`);
	}
}
