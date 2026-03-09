import type { RpcRouter } from "./rpc-router.js";
import { normalizeParams, parseLimit } from "./services-helpers.js";

function parseStringList(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
		return items.length > 0 ? items : undefined;
	}
	if (typeof value === "string" && value.trim()) {
		const items = value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
		return items.length > 0 ? items : undefined;
	}
	return undefined;
}

function parseArtifactQuery(params: Record<string, unknown>) {
	return {
		recentDailyLimit: parseLimit(params.recentDailyLimit ?? params.limit, 30, 90),
		recentPeriodicPerProject: parseLimit(params.recentPeriodicPerProject, 6, 24),
		dates: parseStringList(params.dates),
		projects: parseStringList(params.projects),
		periods: parseStringList(params.periods),
		levels: parseStringList(params.levels) as Array<"daily" | "monthly" | "yearly"> | undefined,
	};
}

export function registerSemanticMethods(router: RpcRouter): void {
	router.register("semantic.sync_status", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const options = parseArtifactQuery(params);
		const { inspectConsolidationVectorSync } = await import("@chitragupta/smriti/consolidation-indexer");
		const { inspectRemoteSemanticSync } = await import("@chitragupta/smriti");
		const [local, remote] = await Promise.all([
			inspectConsolidationVectorSync(options),
			inspectRemoteSemanticSync(options),
		]);
		return { local, remote };
	}, "Inspect local and remote semantic sync for curated consolidation artifacts");

	router.register("semantic.sync_curated", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const options = parseArtifactQuery(params);
		const { repairConsolidationVectorSync } = await import("@chitragupta/smriti/consolidation-indexer");
		const { syncRemoteSemanticMirror } = await import("@chitragupta/smriti");
		const local = await repairConsolidationVectorSync(options);
		const remote = await syncRemoteSemanticMirror(options);
		return { local, remote };
	}, "Repair local curated semantic sync and mirror curated artifacts to the remote semantic store");
}
