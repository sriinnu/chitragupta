import { normalizeProjectPath } from "./services-helpers.js";
import type { ResearchRefinementBudgetOverride } from "@chitragupta/smriti";
import type { ResearchNidraBudgetOverride } from "@chitragupta/smriti";
export type {
	ResearchNidraBudgetOverride,
	ResearchRefinementBudgetOverride,
} from "@chitragupta/smriti";

/**
 * Immediate semantic-repair result triggered by a freshly recorded research
 * outcome.
 *
 * I keep daily and project scopes separate so Nidra-facing callers can tell
 * whether the signal only touched the current day or also escalated into the
 * wider project consolidation horizon.
 */
export interface ResearchOutcomeRefinementResult {
	status: "repaired" | "degraded";
	daily: {
		date: string;
		candidates: number;
		reembedded: number;
		remoteSynced: number;
		qualityDeferred: number;
	};
	project: {
		candidates: number;
		reembedded: number;
		remoteSynced: number;
		qualityDeferred: number;
	};
	error?: string;
}

function currentIsoDate(now = Date.now()): string {
	return new Date(now).toISOString().slice(0, 10);
}

/**
 * Research outcomes should increase semantic repair pressure immediately instead
 * of waiting for the next Nidra sweep.
 *
 * I keep this bounded to the touched day plus the owning project so the daemon
 * can self-heal high-value semantic drift without turning every recorded
 * outcome into a global re-index. Loop-local budget overrides only affect this
 * immediate repair pass; the broader daemon sweep still uses its own shared
 * base policy.
 */
export async function triggerImmediateResearchRefinement(
	projectPath: string,
	options: {
		date?: string;
		decision?: string | null;
		status?: string | null;
		updateBudgets?: {
			refinement?: ResearchRefinementBudgetOverride | null;
			nidra?: ResearchNidraBudgetOverride | null;
		} | null;
	} = {},
): Promise<ResearchOutcomeRefinementResult> {
	const normalizedProjectPath = normalizeProjectPath(projectPath);
	const date = options.date?.trim() || currentIsoDate();
	const decision = options.decision?.trim() ?? null;
	const status = options.status?.trim() ?? null;
	// Keeps and unstable failures both justify immediate semantic repair because
	// they tell me the loop touched high-value artifacts that should not wait for
	// the next daemon sweep to become semantically healthy again.
	const elevatedSignal =
		decision === "keep"
		|| status === "round-failed"
		|| status === "closure-failed"
		|| status === "control-plane-lost"
		|| status === "unsafe-discard";
	const refinementBudget = options.updateBudgets?.refinement ?? null;
	const nidraBudget = options.updateBudgets?.nidra ?? null;

	try {
		const {
			buildImmediateResearchRefinementRequests,
			repairSelectiveReembedding,
			upsertResearchRefinementBudget,
		} = await import("@chitragupta/smriti");
		const requests = buildImmediateResearchRefinementRequests({
			projectPath: normalizedProjectPath,
			date,
			elevatedSignal,
			override: refinementBudget,
		});
		if (refinementBudget || nidraBudget) {
			// I persist explicit loop-provided refinement budgets so the next daemon
			// sweep reuses the same operator-approved widening. Nidra-only overrides
			// matter too because the later postprocess phases need that budget even
			// when the immediate repair used the default refinement envelope.
			upsertResearchRefinementBudget({
				refinement: refinementBudget,
				nidra: nidraBudget,
				source: "research.outcome.immediate",
			});
		}
		// I always repair the exact touched day first, then widen into the
		// bounded project horizon for the same date. That keeps the immediate
		// path responsive without jumping to a full-project rewrite.
		const daily = await repairSelectiveReembedding(
			requests.daily as Parameters<typeof repairSelectiveReembedding>[0] & Record<string, unknown>,
		);
			const project = await repairSelectiveReembedding(
				requests.project as Parameters<typeof repairSelectiveReembedding>[0] & Record<string, unknown>,
			);
			const qualityDeferred = daily.qualityDeferred + project.qualityDeferred;
			return {
				status: qualityDeferred > 0 ? "degraded" : "repaired",
				daily: {
					date,
					candidates: daily.plan.candidateCount,
				reembedded: daily.reembedded,
				remoteSynced: daily.remoteSynced,
				qualityDeferred: daily.qualityDeferred,
			},
			project: {
				candidates: project.plan.candidateCount,
				reembedded: project.reembedded,
				remoteSynced: project.remoteSynced,
				qualityDeferred: project.qualityDeferred,
			},
		};
	} catch (error) {
		return {
			status: "degraded",
			daily: { date, candidates: 0, reembedded: 0, remoteSynced: 0, qualityDeferred: 0 },
			project: { candidates: 0, reembedded: 0, remoteSynced: 0, qualityDeferred: 0 },
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
