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
		scanAll: params.scanAll === true,
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
	router.register("semantic.epoch_status", async () => {
		const { getSemanticEpochRefreshStatus } = await import("@chitragupta/smriti") as typeof import("@chitragupta/smriti") & {
			getSemanticEpochRefreshStatus: () => Promise<unknown>;
		};
		return await getSemanticEpochRefreshStatus();
	}, "Report the current semantic embedding epoch, persisted repair state, and whether a refresh is in flight");

	router.register("semantic.epoch_refresh", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const { refreshGlobalSemanticEpochDrift } = await import("@chitragupta/smriti");
		return await refreshGlobalSemanticEpochDrift({
			force: params.force === true,
		});
	}, "Force or inspect the daemon-owned semantic epoch self-heal for curated artifacts");

	router.register("semantic.sync_status", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const options = parseArtifactQuery(params);
		const {
			inspectConsolidationVectorSync,
			inspectRemoteSemanticSync,
		} = await import("@chitragupta/smriti") as typeof import("@chitragupta/smriti") & {
			inspectConsolidationVectorSync: typeof import("@chitragupta/smriti/consolidation-indexer").inspectConsolidationVectorSync;
			inspectRemoteSemanticSync: typeof import("@chitragupta/smriti").inspectRemoteSemanticSync;
		};
		const [local, remote] = await Promise.all([
			inspectConsolidationVectorSync(options),
			inspectRemoteSemanticSync(options),
		]);
		return { local, remote };
	}, "Inspect local and remote semantic sync for curated consolidation artifacts");

	router.register("semantic.sync_curated", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const options = parseArtifactQuery(params);
		const {
			inspectConsolidationVectorSync,
			inspectRemoteSemanticSync,
			persistSemanticEpochRepairState,
			repairSelectiveReembedding,
		} = await import("@chitragupta/smriti") as typeof import("@chitragupta/smriti") & {
			inspectConsolidationVectorSync: typeof import("@chitragupta/smriti/consolidation-indexer").inspectConsolidationVectorSync;
			inspectRemoteSemanticSync: typeof import("@chitragupta/smriti").inspectRemoteSemanticSync;
			persistSemanticEpochRepairState: typeof import("@chitragupta/smriti").persistSemanticEpochRepairState;
			repairSelectiveReembedding: typeof import("@chitragupta/smriti").repairSelectiveReembedding;
		};
		const repair = await repairSelectiveReembedding({
			...options,
			scanAll: options.scanAll,
			resyncRemote: true,
		});
		await persistSemanticEpochRepairState(repair);
		const [local, remote] = await Promise.all([
			inspectConsolidationVectorSync(options),
			inspectRemoteSemanticSync(options),
		]);
		return { repair, local, remote };
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
	}, "Plan selective re-embedding for curated artifacts whose drift or MDL-quality reasons match the requested repair policy");

	router.register("semantic.reembed_curated", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const {
			persistSemanticEpochRepairState,
			repairSelectiveReembedding,
		} = await import("@chitragupta/smriti");
		const request = {
			...parseArtifactQuery(params),
			candidateLimit: parseLimit(params.candidateLimit ?? params.limit, 20, 200),
			reasons: parseReembeddingReasons(params),
			resyncRemote: params.resyncRemote !== false,
		} as Parameters<typeof repairSelectiveReembedding>[0];
		const repair = await repairSelectiveReembedding(request);
		await persistSemanticEpochRepairState(repair);
		return repair;
	}, "Repair only the highest-value curated artifacts whose selected drift or quality reasons match the requested repair policy");
}
