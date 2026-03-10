import path from "node:path";
import { createLogger } from "@chitragupta/core";
import type {
	KoshaConfig,
	ModelCard,
	ModelRegistry,
} from "kosha-discovery";
import type { RpcRouter } from "./rpc-router.js";
import { resolvePaths } from "./paths.js";
import { resolveDiscoveryRouteQuery, type DiscoveryRouteQuery } from "./services-discovery-routing.js";
import {
	assertRefreshNotRequested,
	extractPreferredModelIds,
	normalizeCheapestOptions,
	normalizeModelQueryOptions,
	normalizeRoleQueryOptions,
	summarizeModels,
	summarizeProviders,
	summarizeRoles,
} from "./services-discovery-helpers.js";

const log = createLogger("daemon:discovery");
const DISCOVERY_TIMEOUT_MS = 5_000;
const DISCOVERY_SNAPSHOT_TTL_MS = 60_000;

interface DiscoveryPackage {
	ModelRegistry: {
		new (config?: KoshaConfig): ModelRegistry;
		loadConfigFile(overrides?: KoshaConfig): Promise<KoshaConfig>;
	};
}

export interface DiscoveryProviderHealth {
	providerId: string;
	state: string;
	failureCount: number;
	lastError?: string | null;
}

interface DiscoveryRegistry {
	capabilities(filter?: { capability?: string }): Array<Record<string, unknown>>;
	providerHealth(): DiscoveryProviderHealth[];
}

export interface DiscoveryStatus {
	packageAvailable: boolean;
	discovered: boolean;
	lastDiscoveredAt: number | null;
	providerCount: number;
	modelCount: number;
	capabilityCount: number;
	missingCredentialCount: number;
	healthyProviderCount: number;
	degradedProviderCount: number;
	openProviderCount: number;
	error?: string | null;
}

export interface DiscoveryRouteHints {
	capability: string;
	query: DiscoveryRouteQuery;
	status: DiscoveryStatus;
	capabilities: Array<Record<string, unknown>>;
	models: ModelCard[];
	providerHealth: DiscoveryProviderHealth[];
	cheapest: unknown;
}

export interface DiscoveryModelInventory {
	status: DiscoveryStatus;
	models: ModelCard[];
	providerHealth: DiscoveryProviderHealth[];
}

let sharedDiscoveryPackagePromise: Promise<DiscoveryPackage | null> | null = null;
let sharedDiscoveryRegistryPromise: Promise<ModelRegistry> | null = null;
let sharedDiscoveryRegistry: ModelRegistry | null = null;
let sharedDiscoverySnapshotCachedAt: number | null = null;
let sharedDiscoverySnapshotPromise: Promise<{ registry: ModelRegistry; status: DiscoveryStatus }> | null = null;
let sharedDiscoveryStatus: DiscoveryStatus = {
	packageAvailable: false,
	discovered: false,
	lastDiscoveredAt: null,
	providerCount: 0,
	modelCount: 0,
	capabilityCount: 0,
	missingCredentialCount: 0,
	healthyProviderCount: 0,
	degradedProviderCount: 0,
	openProviderCount: 0,
	error: null,
};

function asErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function updateDiscoveryError(error: unknown, overrides: Partial<DiscoveryStatus> = {}): DiscoveryStatus {
	sharedDiscoveryStatus = {
		...sharedDiscoveryStatus,
		...overrides,
		error: asErrorMessage(error),
	};
	return sharedDiscoveryStatus;
}

function resolveDiscoveryCacheDir(): string {
	return path.join(path.dirname(resolvePaths().pid), "kosha-cache");
}

async function loadDiscoveryPackage(): Promise<DiscoveryPackage | null> {
	if (!sharedDiscoveryPackagePromise) {
		sharedDiscoveryPackagePromise = import("kosha-discovery")
			.then((mod) => mod as DiscoveryPackage)
			.catch((error) => {
				updateDiscoveryError(error, { packageAvailable: false });
				log.warn("kosha-discovery unavailable", {
					error: asErrorMessage(error),
				});
				return null;
			});
	}
	return sharedDiscoveryPackagePromise;
}

async function ensureDiscoveryRegistry(): Promise<ModelRegistry> {
	if (sharedDiscoveryRegistry) return sharedDiscoveryRegistry;
	if (!sharedDiscoveryRegistryPromise) {
		sharedDiscoveryRegistryPromise = (async () => {
			const pkg = await loadDiscoveryPackage();
			if (!pkg) {
				throw new Error("kosha-discovery package is not available.");
			}
			const config = await pkg.ModelRegistry.loadConfigFile({
				cacheDir: resolveDiscoveryCacheDir(),
			});
			const registry = new pkg.ModelRegistry(config);
			sharedDiscoveryRegistry = registry;
			sharedDiscoveryStatus = {
				...sharedDiscoveryStatus,
				packageAvailable: true,
				error: null,
			};
			return registry;
		})().catch((error) => {
			sharedDiscoveryRegistryPromise = null;
			updateDiscoveryError(error, { packageAvailable: true });
			throw error;
		});
	}
	return sharedDiscoveryRegistryPromise;
}

function asDiscoveryRegistry(registry: ModelRegistry): DiscoveryRegistry {
	return registry as unknown as DiscoveryRegistry;
}

function providerHealthRows(registry: ModelRegistry): DiscoveryProviderHealth[] {
	const discoveryRegistry = asDiscoveryRegistry(registry) as Partial<DiscoveryRegistry>;
	if (typeof discoveryRegistry.providerHealth === "function") {
		return discoveryRegistry.providerHealth();
	}
	return registry.providers_list().map((provider) => ({
		providerId: String((provider as { id?: unknown }).id ?? ""),
		state: "unknown",
		failureCount: 0,
		lastError: null,
	}));
}

function providerHealthSummary(rows: DiscoveryProviderHealth[]): Pick<DiscoveryStatus, "healthyProviderCount" | "degradedProviderCount" | "openProviderCount"> {
	let healthyProviderCount = 0;
	let degradedProviderCount = 0;
	let openProviderCount = 0;
	for (const row of rows) {
		if (row.state === "closed" && row.failureCount === 0) {
			healthyProviderCount += 1;
			continue;
		}
		if (row.state === "open") {
			openProviderCount += 1;
			continue;
		}
		degradedProviderCount += 1;
	}
	return { healthyProviderCount, degradedProviderCount, openProviderCount };
}

function updateDiscoveryStatus(registry: ModelRegistry): DiscoveryStatus {
	const providers = registry.providers_list();
	const models = registry.models();
	const capabilityCount = asDiscoveryRegistry(registry).capabilities().length;
	const missingCredentialCount = registry.missingCredentialPrompts().length;
	const health = providerHealthSummary(providerHealthRows(registry));
	const discoveredAt = registry.toJSON().discoveredAt || Date.now();
	sharedDiscoverySnapshotCachedAt = Date.now();
	sharedDiscoveryStatus = {
		packageAvailable: true,
		discovered: true,
		lastDiscoveredAt: discoveredAt,
		providerCount: providers.length,
		modelCount: models.length,
		capabilityCount,
		missingCredentialCount,
		healthyProviderCount: health.healthyProviderCount,
		degradedProviderCount: health.degradedProviderCount,
		openProviderCount: health.openProviderCount,
		error: null,
	};
	return sharedDiscoveryStatus;
}

async function ensureDiscoverySnapshot(force = false): Promise<{ registry: ModelRegistry; status: DiscoveryStatus }> {
	const registry = await ensureDiscoveryRegistry();
	if (
		!force
		&& sharedDiscoveryStatus.discovered
		&& sharedDiscoverySnapshotCachedAt
		&& Date.now() - sharedDiscoverySnapshotCachedAt < DISCOVERY_SNAPSHOT_TTL_MS
	) {
		return {
			registry,
			status: {
				...sharedDiscoveryStatus,
				packageAvailable: true,
			},
		};
	}
	if (!sharedDiscoverySnapshotPromise || force) {
		sharedDiscoverySnapshotPromise = (async () => {
			try {
				await registry.discover({
					force,
					includeLocal: true,
					enrichWithPricing: true,
					timeout: DISCOVERY_TIMEOUT_MS,
				});
			} catch (error) {
				updateDiscoveryError(error, { packageAvailable: true });
				throw error;
			}
			return {
				registry,
				status: updateDiscoveryStatus(registry),
			};
		})().finally(() => {
			sharedDiscoverySnapshotPromise = null;
		});
	}
	return await sharedDiscoverySnapshotPromise;
}

export async function getDiscoveryStatus(): Promise<DiscoveryStatus> {
	const pkg = await loadDiscoveryPackage();
	if (!pkg) return sharedDiscoveryStatus;
	return {
		...sharedDiscoveryStatus,
		packageAvailable: true,
	};
}

export async function getDiscoveryModelInventory(): Promise<DiscoveryModelInventory | null> {
	const pkg = await loadDiscoveryPackage();
	if (!pkg) return null;
		try {
			const { registry, status } = await ensureDiscoverySnapshot();
			return {
				status,
				models: registry.models(),
				providerHealth: providerHealthRows(registry),
			};
	} catch (error) {
		updateDiscoveryError(error, { packageAvailable: true });
		return null;
	}
}

export async function getDiscoveryRouteHints(
	capability: string,
	limit = 3,
	queryOverride?: DiscoveryRouteQuery | null,
): Promise<DiscoveryRouteHints | null> {
	const normalized = capability.trim();
	if (!normalized) return null;
	const query = queryOverride ?? resolveDiscoveryRouteQuery(normalized);
	if (!query) return null;
	const pkg = await loadDiscoveryPackage();
	if (!pkg) return null;
	try {
			const { registry, status } = await ensureDiscoverySnapshot();
			const models = registry.models(normalizeModelQueryOptions(query));
		const cheapest = registry.cheapestModels({
			capability: query.capability,
			role: query.role,
			mode: query.mode as ModelCard["mode"],
			limit: Math.max(1, Math.floor(limit)),
			includeUnpriced: true,
		});
		return {
			capability: normalized,
			query,
			status,
				capabilities: query.capability ? asDiscoveryRegistry(registry).capabilities({ capability: query.capability }) : [],
				models,
				providerHealth: providerHealthRows(registry),
			cheapest: {
				...(typeof cheapest === "object" && cheapest !== null ? cheapest : {}),
				preferredModelIds: extractPreferredModelIds(cheapest),
			},
		};
	} catch (error) {
		return {
			capability: normalized,
			query,
			status: updateDiscoveryError(error, { packageAvailable: true }),
			capabilities: [],
			models: [],
			providerHealth: [],
			cheapest: null,
		};
	}
}

export function registerDiscoveryMethods(router: RpcRouter): void {
	router.register("discovery.info", async () => {
		return {
			schemaVersion: 1,
			engineOwned: true,
			authority: "discovery-only",
			routingAuthority: "chitragupta",
			snapshotTtlMs: DISCOVERY_SNAPSHOT_TTL_MS,
			cacheAgeMs: sharedDiscoverySnapshotCachedAt ? Math.max(0, Date.now() - sharedDiscoverySnapshotCachedAt) : null,
			status: await getDiscoveryStatus(),
		};
	}, "Describe kosha-discovery integration status inside the engine control plane");

	router.register("discovery.providers", async (params) => {
		assertRefreshNotRequested(params);
		const { registry, status } = await ensureDiscoverySnapshot();
		return {
			status,
			providers: summarizeProviders(registry.providers_list()),
			missingCredentials: registry.missingCredentialPrompts(),
		};
	}, "Discover providers and summarize authenticated inventory from kosha-discovery");

	router.register("discovery.models", async (params) => {
		assertRefreshNotRequested(params);
		const { registry, status } = await ensureDiscoverySnapshot();
		return {
			status,
			models: summarizeModels(registry.models(normalizeModelQueryOptions(params))),
		};
	}, "Discover models and filter them by provider, origin, mode, or capability");

	router.register("discovery.roles", async (params) => {
		assertRefreshNotRequested(params);
		const { registry, status } = await ensureDiscoverySnapshot();
		return {
			status,
			providers: summarizeRoles(registry.providerRoles(normalizeRoleQueryOptions(params))),
		};
	}, "Discover role/capability matrices from kosha-discovery");

	router.register("discovery.cheapest", async (params) => {
		assertRefreshNotRequested(params);
		const { registry, status } = await ensureDiscoverySnapshot();
		return {
			status,
			result: registry.cheapestModels(normalizeCheapestOptions(params)),
		};
	}, "Rank the cheapest discovered models for a role, mode, or capability");

	router.register("discovery.routes", async (params) => {
		const modelId = String(params.modelId ?? params.id ?? "").trim();
		if (!modelId) throw new Error("Missing modelId");
		assertRefreshNotRequested(params);
		const { registry, status } = await ensureDiscoverySnapshot();
		return {
			status,
			modelId,
			routes: registry.modelRouteInfo(modelId),
		};
	}, "List discovered serving routes for a model across providers");

	router.register("discovery.capabilities", async (params) => {
		assertRefreshNotRequested(params);
			const { registry, status } = await ensureDiscoverySnapshot();
			const filter = typeof params.capability === "string" ? params.capability : undefined;
			const capabilities = asDiscoveryRegistry(registry).capabilities(filter ? { capability: filter } : undefined);
		return {
			status,
			capabilities,
		};
	}, "Summarize discovered provider/model capabilities from kosha-discovery");

	router.register("discovery.health", async (params) => {
		assertRefreshNotRequested(params);
			const { registry, status } = await ensureDiscoverySnapshot();
			return {
				status,
				health: providerHealthRows(registry),
			};
	}, "Report provider discovery health and circuit-breaker states from kosha-discovery");

	router.register("discovery.refresh", async (params) => {
		const providerId = typeof params.providerId === "string" ? params.providerId.trim() : "";
		const registry = await ensureDiscoveryRegistry();
		try {
			if (providerId) {
				await registry.refresh(providerId);
			} else {
				await registry.refresh();
			}
		} catch (error) {
			updateDiscoveryError(error, { packageAvailable: true });
			throw error;
		}
		return {
			status: updateDiscoveryStatus(registry),
			refreshed: providerId || "all",
		};
	}, "Force-refresh kosha-discovery inventory for one provider or all providers");
}

export function _resetDiscoveryStateForTests(): void {
	sharedDiscoveryPackagePromise = null;
	sharedDiscoveryRegistryPromise = null;
	sharedDiscoveryRegistry = null;
	sharedDiscoverySnapshotCachedAt = null;
	sharedDiscoverySnapshotPromise = null;
	sharedDiscoveryStatus = {
		packageAvailable: false,
		discovered: false,
		lastDiscoveredAt: null,
		providerCount: 0,
		modelCount: 0,
		capabilityCount: 0,
		missingCredentialCount: 0,
		healthyProviderCount: 0,
		degradedProviderCount: 0,
		openProviderCount: 0,
		error: null,
	};
}
