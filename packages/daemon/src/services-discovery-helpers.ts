import type {
	CheapestModelOptions,
	ModelCard,
	ProviderInfo,
	ProviderRoleInfo,
	RoleQueryOptions,
} from "kosha-discovery";
import { parseLimit } from "./services-helpers.js";

interface DiscoveryQueryLike {
	provider?: unknown;
	originProvider?: unknown;
	mode?: unknown;
	capability?: unknown;
	role?: unknown;
}

export function assertRefreshNotRequested(params: Record<string, unknown>): void {
	if (params.refresh === true) {
		throw new Error("Read-only discovery queries do not support refresh=true. Use discovery.refresh instead.");
	}
}

export function normalizeModelQueryOptions(params: DiscoveryQueryLike) {
	return {
		provider: typeof params.provider === "string" ? params.provider : undefined,
		originProvider: typeof params.originProvider === "string" ? params.originProvider : undefined,
		mode: typeof params.mode === "string" ? params.mode as RoleQueryOptions["mode"] : undefined,
		capability: typeof params.capability === "string" ? params.capability : undefined,
	};
}

export function normalizeRoleQueryOptions(params: DiscoveryQueryLike): RoleQueryOptions {
	return {
		...normalizeModelQueryOptions(params),
		role: typeof params.role === "string" ? params.role : undefined,
	};
}

export function normalizeCheapestOptions(params: DiscoveryQueryLike & {
	limit?: unknown;
	priceMetric?: unknown;
	inputWeight?: unknown;
	outputWeight?: unknown;
	includeUnpriced?: unknown;
}): CheapestModelOptions {
	return {
		...normalizeRoleQueryOptions(params),
		limit: parseLimit(params.limit, 5, 20),
		priceMetric: typeof params.priceMetric === "string"
			? params.priceMetric as CheapestModelOptions["priceMetric"]
			: undefined,
		inputWeight: typeof params.inputWeight === "number" ? params.inputWeight : undefined,
		outputWeight: typeof params.outputWeight === "number" ? params.outputWeight : undefined,
		includeUnpriced: params.includeUnpriced === true,
	};
}

export function summarizeProviders(providers: ProviderInfo[]) {
	return providers.map((provider) => ({
		id: provider.id,
		name: provider.name,
		authenticated: provider.authenticated,
		credentialSource: provider.credentialSource ?? "none",
		modelCount: provider.models.length,
		lastRefreshed: provider.lastRefreshed,
		baseUrl: provider.baseUrl,
	}));
}

export function summarizeModels(models: ModelCard[]) {
	return models.map((model) => ({
		id: model.id,
		name: model.name,
		provider: model.provider,
		originProvider: model.originProvider ?? null,
		mode: model.mode,
		capabilities: model.capabilities,
		contextWindow: model.contextWindow,
		maxOutputTokens: model.maxOutputTokens,
		pricing: model.pricing ?? null,
		aliases: model.aliases,
		source: model.source,
	}));
}

export function summarizeRoles(roles: ProviderRoleInfo[]) {
	return roles.map((provider) => ({
		id: provider.id,
		name: provider.name,
		authenticated: provider.authenticated,
		credentialSource: provider.credentialSource ?? "none",
		models: provider.models,
	}));
}

export function extractPreferredModelIds(cheapest: unknown): string[] {
	if (typeof cheapest !== "object" || cheapest === null || !("matches" in cheapest)) return [];
	const matches = (cheapest as { matches?: unknown }).matches;
	if (!Array.isArray(matches)) return [];
	return [...new Set(matches.flatMap((match) => {
		if (typeof match !== "object" || match === null) return [];
		const record = match as Record<string, unknown>;
		const modelId = record.modelId ?? record.id ?? record.model;
		return typeof modelId === "string" && modelId.trim() ? [modelId.trim()] : [];
	}))];
}

export function extractPreferredProviderIds(cheapest: unknown): string[] {
	if (typeof cheapest !== "object" || cheapest === null || !("matches" in cheapest)) return [];
	const matches = (cheapest as { matches?: unknown }).matches;
	if (!Array.isArray(matches)) return [];
	return [...new Set(matches.flatMap((match) => {
		if (typeof match !== "object" || match === null) return [];
		const record = match as Record<string, unknown>;
		const providerId = record.providerId ?? record.provider ?? record.originProvider;
		return typeof providerId === "string" && providerId.trim() ? [providerId.trim()] : [];
	}))];
}
