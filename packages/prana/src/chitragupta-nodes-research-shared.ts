/**
 * Shared research workflow types and pure helpers.
 */

import path from "node:path";
import type { NodeContext } from "./chitragupta-nodes.js";

export const DEFAULT_TARGET_FILES = ["train.py"];
export const DEFAULT_IMMUTABLE_FILES = ["prepare.py"];
export const DEFAULT_METRIC_NAME = "val_bpb";
export const DEFAULT_METRIC_PATTERN = "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)";
export const DEFAULT_BUDGET_MS = 300_000;
export const MAX_BUDGET_MS = 300_000;

export type ResearchObjective = "minimize" | "maximize";

export interface ResearchScope {
	hypothesis: string;
	topic: string;
	command: string;
	commandArgs: string[];
	projectPath: string;
	cwd: string;
	parentSessionId: string | null;
	sessionLineageKey: string | null;
	targetFiles: string[];
	immutableFiles: string[];
	metricName: string;
	metricPattern: string;
	objective: ResearchObjective;
	budgetMs: number;
	executionRouteClass: string;
	executionCapability: string | null;
}

export interface ResearchRunData {
	command: string;
	commandArgs: string[];
	cwd: string;
	metricName: string;
	metric: number | null;
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
	durationMs: number;
	scopeGuard: "git" | "hash-only";
	targetFilesChanged: string[];
}

export interface CouncilParticipantSummary {
	id: string;
	role: string;
	expertise: number;
	credibility: number;
}

export interface ResearchCouncilSummary {
	sabhaId: string;
	sessionId: string | null;
	topic: string;
	participantCount: number;
	participants: CouncilParticipantSummary[];
	finalVerdict: string;
	rounds: number;
	councilSummary: Array<{
		roundNumber: number;
		verdict: string;
		voteCount: number;
		challengeCount: number;
	}>;
	lucy: {
		hitEntity: string | null;
		predictionCount: number;
		criticalSignalCount: number;
		recommendation: "support" | "caution" | "block";
	};
	route: {
		routeClass: string | null;
		capability: string | null;
		selectedCapabilityId: string | null;
		degraded: boolean;
		discoverableOnly: boolean;
		reason: string | null;
		policyTrace: string[];
	} | null;
	executionRoute: {
		routeClass: string | null;
		capability: string | null;
		selectedCapabilityId: string | null;
		degraded: boolean;
		discoverableOnly: boolean;
		reason: string | null;
		policyTrace: string[];
	} | null;
	source: "daemon" | "local-fallback";
}

export function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function stringArrayValue(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback;
	const normalized = value
		.map((entry) => (typeof entry === "string" ? normalizeScopeFile(entry) : ""))
		.filter(Boolean);
	return normalized.length > 0 ? normalized : fallback;
}

export function numberValue(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function objectiveValue(value: unknown): ResearchObjective {
	return value === "maximize" ? "maximize" : "minimize";
}

export function clampBudget(ms: number): number {
	return Math.max(1_000, Math.min(MAX_BUDGET_MS, Math.floor(ms)));
}

export function normalizeScopeFile(file: string): string {
	const normalized = file.replace(/\\/g, "/").trim();
	if (!normalized) return "";
	return path.posix.normalize(normalized).replace(/^\.\//, "").replace(/^\/+/, "");
}

function optionalStringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
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

export function buildScope(ctx: NodeContext): ResearchScope {
	const projectPath = resolveResearchProjectPath(ctx.projectPath);
	const cwd = resolveResearchCwd(projectPath, ctx.extra.researchCwd);
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
		budgetMs: clampBudget(
			numberValue(ctx.extra.researchBudgetMs, DEFAULT_BUDGET_MS),
		),
		executionRouteClass: stringValue(ctx.extra.researchExecutionRouteClass, "tool.use.flex"),
		executionCapability: optionalStringValue(ctx.extra.researchExecutionCapability),
	};
}

export function validateScope(scope: ResearchScope): void {
	if (!scope.command.trim()) throw new Error("Research command is required");
	if (scope.commandArgs.length === 0) throw new Error("Research command arguments are required");
	if (scope.targetFiles.length === 0) throw new Error("At least one target file is required");
	if (!scope.executionRouteClass && !scope.executionCapability) {
		throw new Error("Research execution route class or capability is required");
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

export function pickMetric(text: string, pattern: string): number | null {
	try {
		const match = new RegExp(pattern, "im").exec(text);
		if (!match?.[1]) return null;
		const value = Number.parseFloat(match[1]);
		return Number.isFinite(value) ? value : null;
	} catch {
		return null;
	}
}

export function resultData(step: unknown): Record<string, unknown> {
	if (!step || typeof step !== "object") return {};
	const record = step as Record<string, unknown>;
	if (record.data && typeof record.data === "object") {
		return record.data as Record<string, unknown>;
	}
	return record;
}

export function summarizeCouncilParticipants(): CouncilParticipantSummary[] {
	return [
		{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
		{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
		{ id: "evaluator", role: "evaluator", expertise: 0.9, credibility: 0.88 },
		{ id: "skeptic", role: "skeptic", expertise: 0.92, credibility: 0.86 },
		{ id: "recorder", role: "recorder", expertise: 0.74, credibility: 0.83 },
	];
}

export function buildSyllogism(scope: ResearchScope) {
	return {
		pratijna: scope.hypothesis,
		hetu: `Only ${scope.targetFiles.join(", ")} will be modified under a ${scope.budgetMs}ms experiment budget.`,
		udaharana: `Bounded experiments are safer when immutable files like ${scope.immutableFiles.join(", ")} remain untouched.`,
		upanaya: `This run evaluates ${scope.metricName} with objective ${scope.objective}.`,
		nigamana: `Proceed only if the measured ${scope.metricName} ${scope.objective === "minimize" ? "decreases" : "increases"}.`,
	};
}

export function councilSupports(finalVerdict: unknown): boolean {
	if (typeof finalVerdict !== "string") return false;
	const normalized = finalVerdict.trim().toLowerCase();
	return normalized === "accepted"
		|| normalized === "support"
		|| normalized === "supported"
		|| normalized === "approved"
		|| normalized === "proceed";
}

export function buildResearchRecord(
	scope: ResearchScope,
	council: Record<string, unknown>,
	evaluation: Record<string, unknown>,
	packed: Record<string, unknown>,
): string {
	const observed = typeof evaluation.observedMetric === "number"
		? evaluation.observedMetric
		: "unknown";
	const baseline = typeof evaluation.baselineMetric === "number"
		? evaluation.baselineMetric
		: "unknown";
	const delta = typeof evaluation.delta === "number"
		? evaluation.delta.toFixed(6)
		: "n/a";
	const verdict = typeof council.finalVerdict === "string"
		? council.finalVerdict
		: "unknown";
	const sessionId = typeof council.sessionId === "string" ? council.sessionId : "none";
	const route = council.route && typeof council.route === "object"
		? council.route as {
			routeClass?: unknown;
			capability?: unknown;
			selectedCapabilityId?: unknown;
			reason?: unknown;
		}
		: null;
	const executionRoute = council.executionRoute && typeof council.executionRoute === "object"
		? council.executionRoute as {
			routeClass?: unknown;
			capability?: unknown;
			selectedCapabilityId?: unknown;
			reason?: unknown;
		}
		: null;
	const decision = typeof evaluation.decision === "string"
		? evaluation.decision
		: "record";
	const packRuntime = typeof packed.runtime === "string" ? packed.runtime : "none";
	const packSavings = typeof packed.savings === "number" ? `${packed.savings}%` : "n/a";
	const packSource = typeof packed.source === "string" ? packed.source : "unknown";
	const packSummary = typeof packed.packedText === "string" && packed.packedText.trim()
		? `\n\n### Packed Context\n${packed.packedText.trim()}`
		: "";
	return [
		`## Autoresearch Experiment`,
		``,
		`- topic: ${scope.topic}`,
		`- hypothesis: ${scope.hypothesis}`,
		`- command: ${scope.command} ${scope.commandArgs.join(" ")}`.trim(),
		`- cwd: ${scope.cwd}`,
		`- target files: ${scope.targetFiles.join(", ")}`,
		`- immutable files: ${scope.immutableFiles.join(", ")}`,
		`- metric: ${scope.metricName}`,
		`- objective: ${scope.objective}`,
		`- session id: ${sessionId}`,
		`- route class: ${typeof route?.routeClass === "string" ? route.routeClass : "none"}`,
		`- route capability: ${typeof route?.capability === "string" ? route.capability : "none"}`,
		`- route selected capability: ${typeof route?.selectedCapabilityId === "string" ? route.selectedCapabilityId : "none"}`,
		`- route reason: ${typeof route?.reason === "string" ? route.reason : "n/a"}`,
		`- execution route class: ${typeof executionRoute?.routeClass === "string" ? executionRoute.routeClass : "none"}`,
		`- execution capability: ${typeof executionRoute?.capability === "string" ? executionRoute.capability : "none"}`,
		`- execution selected capability: ${typeof executionRoute?.selectedCapabilityId === "string" ? executionRoute.selectedCapabilityId : "none"}`,
		`- execution route reason: ${typeof executionRoute?.reason === "string" ? executionRoute.reason : "n/a"}`,
		`- baseline: ${baseline}`,
		`- observed: ${observed}`,
		`- delta: ${delta}`,
		`- decision: ${decision}`,
		`- council verdict: ${verdict}`,
		`- packed runtime: ${packRuntime}`,
		`- packed source: ${packSource}`,
		`- packed savings: ${packSavings}`,
	].join("\n") + packSummary;
}
