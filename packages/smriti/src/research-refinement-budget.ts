import { getAgentDb } from "./session-db.js";
import type { ResearchRefinementBudgetOverride } from "./semantic-refinement-policy.js";

const RESEARCH_REFINEMENT_BUDGET_STATE = "research_refinement_budget";
const DEFAULT_RESEARCH_REFINEMENT_BUDGET_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Optional daemon-owned Nidra budget override derived from one overnight loop.
 *
 * I keep this small on purpose. The daily postprocess should only inherit the
 * parts of the loop budget that constrain daemon-wide refinement breadth.
 */
export interface ResearchNidraBudgetOverride {
	maxResearchProjectsPerCycle?: number;
	maxSemanticPressure?: number;
}

/**
 * Durable daemon-owned refinement budget state shared between immediate
 * research-triggered repair and the broader semantic refinement sweep.
 *
 * I keep this in SQLite-backed runtime state so transient loop-local budget
 * widening can survive process restarts long enough for the next daemon pass
 * to reuse it.
 */
export interface ResearchRefinementBudgetState {
	refinement: ResearchRefinementBudgetOverride;
	nidra?: ResearchNidraBudgetOverride;
	source: string | null;
	expiresAt: number;
	updatedAt: number;
	parseError?: string | null;
}

function normalizeBoundedNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	return Math.round(value * 1000) / 1000;
}

function normalizeBudgetOverride(
	override: ResearchRefinementBudgetOverride | null | undefined,
): ResearchRefinementBudgetOverride | null {
	if (!override) return null;
	const normalized: ResearchRefinementBudgetOverride = {};
	const dailyCandidateLimit = normalizeBoundedNumber(override.dailyCandidateLimit);
	const projectCandidateLimit = normalizeBoundedNumber(override.projectCandidateLimit);
	const dailyMinMdlScore = normalizeBoundedNumber(override.dailyMinMdlScore);
	const projectMinMdlScore = normalizeBoundedNumber(override.projectMinMdlScore);
	const dailyMinPriorityScore = normalizeBoundedNumber(override.dailyMinPriorityScore);
	const projectMinPriorityScore = normalizeBoundedNumber(override.projectMinPriorityScore);
	const dailyMinSourceSessionCount = normalizeBoundedNumber(override.dailyMinSourceSessionCount);
	const projectMinSourceSessionCount = normalizeBoundedNumber(override.projectMinSourceSessionCount);

	if (dailyCandidateLimit != null) normalized.dailyCandidateLimit = dailyCandidateLimit;
	if (projectCandidateLimit != null) normalized.projectCandidateLimit = projectCandidateLimit;
	if (dailyMinMdlScore != null) normalized.dailyMinMdlScore = dailyMinMdlScore;
	if (projectMinMdlScore != null) normalized.projectMinMdlScore = projectMinMdlScore;
	if (dailyMinPriorityScore != null) normalized.dailyMinPriorityScore = dailyMinPriorityScore;
	if (projectMinPriorityScore != null) normalized.projectMinPriorityScore = projectMinPriorityScore;
	if (dailyMinSourceSessionCount != null) normalized.dailyMinSourceSessionCount = dailyMinSourceSessionCount;
	if (projectMinSourceSessionCount != null) normalized.projectMinSourceSessionCount = projectMinSourceSessionCount;

	return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeNidraBudgetOverride(
	override: ResearchNidraBudgetOverride | null | undefined,
): ResearchNidraBudgetOverride | null {
	if (!override) return null;
	const normalized: ResearchNidraBudgetOverride = {};
	const maxResearchProjectsPerCycle = normalizeBoundedNumber(override.maxResearchProjectsPerCycle);
	const maxSemanticPressure = normalizeBoundedNumber(override.maxSemanticPressure);
	if (maxResearchProjectsPerCycle != null) {
		normalized.maxResearchProjectsPerCycle = Math.max(1, Math.min(16, Math.floor(maxResearchProjectsPerCycle)));
	}
	if (maxSemanticPressure != null) {
		normalized.maxSemanticPressure = Math.max(1, Math.min(16, Math.floor(maxSemanticPressure)));
	}
	return Object.keys(normalized).length > 0 ? normalized : null;
}

/**
 * Persist bounded daemon-owned budget overrides that the next wider semantic
 * sweep and Nidra postprocess cycle can reuse.
 */
export function upsertResearchRefinementBudget(args: {
	refinement?: ResearchRefinementBudgetOverride | null;
	nidra?: ResearchNidraBudgetOverride | null;
	source?: string | null;
	ttlMs?: number;
}): ResearchRefinementBudgetState {
	const refinement = normalizeBudgetOverride(args.refinement);
	const nidra = normalizeNidraBudgetOverride(args.nidra);
	if (!refinement && !nidra) {
		clearResearchRefinementBudget();
		return {
			refinement: {},
			source: args.source ?? null,
			expiresAt: Date.now(),
			updatedAt: Date.now(),
			parseError: null,
		};
	}
	const db = getAgentDb();
	const now = Date.now();
	const state: ResearchRefinementBudgetState = {
		refinement: refinement ?? {},
		nidra: nidra ?? undefined,
		source: args.source ?? null,
		expiresAt: now + Math.max(args.ttlMs ?? DEFAULT_RESEARCH_REFINEMENT_BUDGET_TTL_MS, 60_000),
		updatedAt: now,
		parseError: null,
	};
	db.prepare(`
		INSERT INTO semantic_runtime_state (name, value_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET
			value_json = excluded.value_json,
			updated_at = excluded.updated_at
	`).run(RESEARCH_REFINEMENT_BUDGET_STATE, JSON.stringify(state), state.updatedAt);
	return state;
}

/**
 * Return the currently active shared refinement budget, if one exists and is
 * still inside its TTL window.
 */
export function readActiveResearchRefinementBudget(
	now = Date.now(),
): ResearchRefinementBudgetState | null {
	const db = getAgentDb();
	const row = db.prepare(
		"SELECT value_json FROM semantic_runtime_state WHERE name = ?",
	).get(RESEARCH_REFINEMENT_BUDGET_STATE) as { value_json: string } | undefined;
	if (!row?.value_json) return null;
	try {
		const parsed = JSON.parse(row.value_json) as Partial<ResearchRefinementBudgetState>;
		const refinement = normalizeBudgetOverride(
			parsed.refinement as ResearchRefinementBudgetOverride | null | undefined,
		);
		const nidra = normalizeNidraBudgetOverride(
			parsed.nidra as ResearchNidraBudgetOverride | null | undefined,
		);
		const expiresAt = normalizeBoundedNumber(parsed.expiresAt);
		const updatedAt = normalizeBoundedNumber(parsed.updatedAt);
		if ((!refinement && !nidra) || expiresAt == null || updatedAt == null) return null;
		if (expiresAt <= now) {
			clearResearchRefinementBudget();
			return null;
		}
		return {
			refinement: refinement ?? {},
			nidra: nidra ?? undefined,
			source: typeof parsed.source === "string" ? parsed.source : null,
			expiresAt,
			updatedAt,
			parseError: null,
		};
	} catch (error) {
		return {
			refinement: {},
			source: null,
			expiresAt: now,
			updatedAt: now,
			parseError: error instanceof Error ? error.message : "invalid research refinement budget state",
		};
	}
}

/** Clear the active shared refinement budget once the daemon has consumed it. */
export function clearResearchRefinementBudget(): void {
	const db = getAgentDb();
	db.prepare("DELETE FROM semantic_runtime_state WHERE name = ?").run(RESEARCH_REFINEMENT_BUDGET_STATE);
}
