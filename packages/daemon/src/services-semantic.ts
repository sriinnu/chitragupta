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
		recentDailyLimit: parseLimit(params.recentDailyLimit, 30, 90),
		recentPeriodicPerProject: parseLimit(params.recentPeriodicPerProject, 6, 24),
		ids: parseStringList(params.ids),
		dates: parseStringList(params.dates),
		projects: parseStringList(params.projects),
		periods: parseStringList(params.periods),
		levels: parseStringList(params.levels) as Array<"daily" | "monthly" | "yearly"> | undefined,
	};
}

function parseReembeddingReasons(params: Record<string, unknown>) {
	const raw = parseStringList(params.reasons);
	return raw && raw.length > 0 ? raw : undefined;
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

	router.register("semantic.reembed_plan", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const { planSelectiveReembedding } = await import("@chitragupta/smriti");
		const request = {
			...parseArtifactQuery(params),
			candidateLimit: parseLimit(params.candidateLimit ?? params.limit, 20, 200),
			reasons: parseReembeddingReasons(params),
		} as Parameters<typeof planSelectiveReembedding>[0];
		return await planSelectiveReembedding(request);
	}, "Plan selective re-embedding for high-value curated artifacts with stale embedding epochs");

	router.register("semantic.reembed_curated", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const { repairSelectiveReembedding } = await import("@chitragupta/smriti");
		const request = {
			...parseArtifactQuery(params),
			candidateLimit: parseLimit(params.candidateLimit ?? params.limit, 20, 200),
			reasons: parseReembeddingReasons(params),
			resyncRemote: params.resyncRemote !== false,
		} as Parameters<typeof repairSelectiveReembedding>[0];
		return await repairSelectiveReembedding(request);
	}, "Re-embed only the highest-value curated artifacts whose selected stale reasons match the requested repair policy");
}
