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
	const discoveryRegistry = asDiscoveryRegistry(registry);
	const providers = registry.providers_list();
	const models = registry.models();
	const capabilityCount = discoveryRegistry.capabilities().length;
	const missingCredentialCount = registry.missingCredentialPrompts().length;
	const health = providerHealthSummary(discoveryRegistry.providerHealth());
	const discoveredAt = registry.toJSON().discoveredAt || Date.now();
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
	if (!force && sharedDiscoveryStatus.discovered) {
		return {
			registry,
			status: {
				...sharedDiscoveryStatus,
				packageAvailable: true,
			},
		};
	}
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
		const discoveryRegistry = asDiscoveryRegistry(registry);
		return {
			status,
			models: registry.models(),
			providerHealth: discoveryRegistry.providerHealth(),
		};
	} catch (error) {
		updateDiscoveryError(error, { packageAvailable: true });
		return null;
	}
}

export async function getDiscoveryRouteHints(
	capability: string,
	limit = 3,
): Promise<DiscoveryRouteHints | null> {
	const normalized = capability.trim();
	if (!normalized) return null;
	const query = resolveDiscoveryRouteQuery(normalized);
	if (!query) return null;
	const pkg = await loadDiscoveryPackage();
	if (!pkg) return null;
	try {
		const { registry, status } = await ensureDiscoverySnapshot();
		const discoveryRegistry = asDiscoveryRegistry(registry);
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
			capabilities: query.capability ? discoveryRegistry.capabilities({ capability: query.capability }) : [],
			models,
			providerHealth: discoveryRegistry.providerHealth(),
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
			engineOwned: true,
			authority: "discovery-only",
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
		const discoveryRegistry = asDiscoveryRegistry(registry);
		const filter = typeof params.capability === "string" ? params.capability : undefined;
		const capabilities = discoveryRegistry.capabilities(filter ? { capability: filter } : undefined);
		return {
			status,
			capabilities,
		};
	}, "Summarize discovered provider/model capabilities from kosha-discovery");

	router.register("discovery.health", async (params) => {
		assertRefreshNotRequested(params);
		const { registry, status } = await ensureDiscoverySnapshot();
		const discoveryRegistry = asDiscoveryRegistry(registry);
		return {
			status,
			health: discoveryRegistry.providerHealth(),
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
