/**
 * @chitragupta/anina — daily semantic refinement helpers.
 *
 * I keep selective re-embedding orchestration outside the main daemon class so
 * the daily consolidation flow stays readable and the repair policy remains
 * easy to test in isolation.
 */

export interface DailySelectiveReembeddingResult {
	candidates: number;
	reembedded: number;
	scopes: Array<{
		level: "daily" | "monthly" | "yearly";
		period: string;
		candidates: number;
		reembedded: number;
	}>;
}

export interface GlobalSemanticEpochRefreshResult {
	currentEpoch: string;
	previousEpoch: string | null;
	reason: "unchanged" | "bootstrap" | "epoch-changed" | "forced" | "retry-backoff";
	completed: boolean;
	refreshed: boolean;
	repair: {
		plan: { scanned: number; candidateCount: number };
		reembedded: number;
		remoteSynced: number;
		qualityDeferred: number;
	};
}

const REEMBED_REASONS_BY_LEVEL = {
	daily: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed"],
	monthly: ["stale_epoch", "stale_remote_epoch"],
	yearly: ["stale_epoch", "stale_remote_epoch"],
} as const;

const TEMPORAL_REEMBED_POLICY = {
	daily: { candidateLimit: 12, minMdlScore: 0.55, minSourceSessionCount: 1, minPriorityScore: 1.65 },
	monthly: { candidateLimit: 6, minMdlScore: 0.6, minSourceSessionCount: 2, minPriorityScore: 1.9 },
	yearly: { candidateLimit: 3, minMdlScore: 0.65, minSourceSessionCount: 4, minPriorityScore: 2.15 },
} as const;

function buildTemporalScopes(date: string): Array<{ level: "daily" | "monthly" | "yearly"; period: string; request: Record<string, unknown> }> {
	const month = date.slice(0, 7);
	const year = date.slice(0, 4);
	return [
		{
			level: "daily",
			period: date,
			request: {
				dates: [date],
				levels: ["daily"],
				...TEMPORAL_REEMBED_POLICY.daily,
			},
		},
		{
			level: "monthly",
			period: month,
			request: {
				periods: [month],
				levels: ["monthly"],
				...TEMPORAL_REEMBED_POLICY.monthly,
			},
		},
		{
			level: "yearly",
			period: year,
			request: {
				periods: [year],
				levels: ["yearly"],
				...TEMPORAL_REEMBED_POLICY.yearly,
			},
		},
	];
}

/**
 * I repair high-signal temporal artifacts when their semantic vectors drift
 * locally/remotely, and I allow quality-driven rebuilds for daily artifacts
 * when compaction falls below the MDL gate.
 *
 * Content-hash drift is still handled by normal regeneration; this pass is for
 * semantic freshness and bounded quality-driven rebuilds.
 */
export async function repairSelectiveReembeddingForDate(
	date: string,
): Promise<DailySelectiveReembeddingResult> {
	const { repairSelectiveReembedding } = await import("@chitragupta/smriti");
	const scopes = await Promise.all(
		buildTemporalScopes(date).map(async (scope) => {
			const result = await repairSelectiveReembedding({
				...scope.request,
				reasons: [...REEMBED_REASONS_BY_LEVEL[scope.level]],
				resyncRemote: false,
			} as Parameters<typeof repairSelectiveReembedding>[0] & Record<string, unknown>);
			return {
				level: scope.level,
				period: scope.period,
				candidates: result.plan.candidateCount,
				reembedded: result.reembedded,
			};
		}),
	);
	return {
		candidates: scopes.reduce((sum, scope) => sum + scope.candidates, 0),
		reembedded: scopes.reduce((sum, scope) => sum + scope.reembedded, 0),
		scopes,
	};
}

/**
 * I refresh the full curated semantic mirror when the active embedding epoch
 * changes, so provider/model upgrades become a daemon-owned self-heal instead
 * of waiting for an operator or a nightly pass.
 */
export async function refreshGlobalSemanticEpochDrift(
	force = false,
): Promise<GlobalSemanticEpochRefreshResult> {
	const { refreshGlobalSemanticEpochDrift: refresh } = await import("@chitragupta/smriti") as typeof import("@chitragupta/smriti") & {
		refreshGlobalSemanticEpochDrift: (
			options?: { force?: boolean },
		) => Promise<GlobalSemanticEpochRefreshResult>;
	};
	return await refresh({ force });
}
