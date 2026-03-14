/**
 * Shared research workflow utility helpers.
 */

import type {
	CouncilParticipantSummary,
	ResearchObjective,
	ResearchScope,
} from "./chitragupta-nodes-research-shared-types.js";
import {
	DEFAULT_OVERNIGHT_AGENT_COUNT,
	MAX_BUDGET_MS,
} from "./chitragupta-nodes-research-shared-types.js";

/** Return a trimmed string or the supplied fallback. */
export function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** Normalize a string array config entry against a known fallback. */
export function stringArrayValue(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback;
	const normalized = value
		.map((entry) => (typeof entry === "string" ? normalizeScopeFile(entry) : ""))
		.filter(Boolean);
	return normalized.length > 0 ? normalized : fallback;
}

/** Return a finite number or the supplied fallback. */
export function numberValue(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Normalize the research objective into one of the supported directions. */
export function objectiveValue(value: unknown): ResearchObjective {
	return value === "maximize" ? "maximize" : "minimize";
}

/** Clamp one per-round research budget into the supported execution window. */
export function clampBudget(ms: number): number {
	return Math.max(1_000, Math.min(MAX_BUDGET_MS, Math.floor(ms)));
}

function clampAgentCount(value: number): number {
	return Math.max(2, Math.min(5, Math.floor(value)));
}
/** Normalize a repo-relative file path used by the scope guards. */
export function normalizeScopeFile(file: string): string {
	const normalized = file.replace(/\\/g, "/").trim();
	if (!normalized) return "";
	return normalized.replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Extract the tracked metric from one experiment output blob. */
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

/** Normalize a step/result payload into a plain record. */
export function resultData(step: unknown): Record<string, unknown> {
	if (!step || typeof step !== "object") return {};
	const record = step as Record<string, unknown>;
	if (record.data && typeof record.data === "object") {
		return record.data as Record<string, unknown>;
	}
	return record;
}

/** Build the default planner/executor/skeptic council roster. */
export function summarizeCouncilParticipants(agentCount = 5): CouncilParticipantSummary[] {
	const participants: CouncilParticipantSummary[] = [
		{ id: "planner", role: "planner", expertise: 0.84, credibility: 0.82 },
		{ id: "executor", role: "executor", expertise: 0.8, credibility: 0.84 },
		{ id: "evaluator", role: "evaluator", expertise: 0.9, credibility: 0.88 },
		{ id: "skeptic", role: "skeptic", expertise: 0.92, credibility: 0.86 },
		{ id: "recorder", role: "recorder", expertise: 0.74, credibility: 0.83 },
	];
	return participants.slice(0, clampAgentCount(agentCount));
}

/** Stamp one reusable round scope with the current loop coordinates. */
export function withResearchRoundScope(
	scope: ResearchScope,
	loopKey: string,
	roundNumber: number,
	totalRounds: number,
	attemptNumber = 1,
): ResearchScope {
	return {
		...scope,
		loopKey,
		roundNumber,
		totalRounds,
		attemptNumber,
	};
}

/** Build the bounded syllogism that seeds the research council. */
export function buildSyllogism(scope: ResearchScope) {
	return {
		pratijna: scope.hypothesis,
		hetu: `Only ${scope.targetFiles.join(", ")} will be modified under a ${scope.budgetMs}ms experiment budget.`,
		udaharana: `Bounded experiments are safer when immutable files like ${scope.immutableFiles.join(", ")} remain untouched.`,
		upanaya: `This run evaluates ${scope.metricName} with objective ${scope.objective}.`,
		nigamana: `Proceed only if the measured ${scope.metricName} ${scope.objective === "minimize" ? "decreases" : "increases"}.`,
	};
}

/** Normalize a council verdict into a support / non-support decision. */
export function councilSupports(finalVerdict: unknown): boolean {
	if (typeof finalVerdict !== "string") return false;
	const normalized = finalVerdict.trim().toLowerCase();
	return normalized === "accepted"
		|| normalized === "support"
		|| normalized === "supported"
		|| normalized === "approved"
		|| normalized === "proceed";
}
