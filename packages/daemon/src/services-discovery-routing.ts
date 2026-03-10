import type {
	CapabilityDescriptor,
	ConsumerConstraint,
	RouteClassDescriptor,
	RouteExecutionBinding,
	RoutingRequest,
} from "./services-contract-catalog-types.js";
import {
	extractPreferredModelIds,
	extractPreferredProviderIds,
} from "./services-discovery-helpers.js";

export interface DiscoveryRouteQuery {
	capability?: string;
	role?: string;
	mode?: string;
}

import {
	type DiscoveryModelLike,
	type DiscoveryProviderHealthLike,
	mapDiscoveryModelCapabilities,
	inferDiscoveryTrust,
	inferDiscoveryCostClass,
	inferDiscoveryHealth,
	discoveryModelCapabilityId,
	buildDiscoveredModelCapability,
} from "./services-discovery-model-capabilities.js";
export type { DiscoveryModelLike, DiscoveryProviderHealthLike };
export {
	mapDiscoveryModelCapabilities,
	inferDiscoveryTrust,
	inferDiscoveryCostClass,
	inferDiscoveryHealth,
	discoveryModelCapabilityId,
	buildDiscoveredModelCapability,
};

const DISCOVERY_FLEX_ROUTE_CLASSES = new Set([
	"chat.flex",
	"tool.use.flex",
]);

export interface DiscoveryRouteHintsLike {
	cheapest?: unknown;
}

export interface DiscoveryRoutePreference {
	constraints?: ConsumerConstraint;
	policyTrace: string[];
}


function mergeConstraintIds(base?: string[], extra?: string[]): string[] | undefined {
	if ((!base || base.length === 0) && (!extra || extra.length === 0)) return undefined;
	return [...new Set([...(base ?? []), ...(extra ?? [])])];
}

function normalizeContextModelIds(context?: Record<string, unknown>): string[] {
	if (!context) return [];
	const preferredModelIds = Array.isArray(context.preferredModelIds)
		? context.preferredModelIds
		: [];
	return [
		context.preferredModelId,
		context.modelId,
		context.selectedModelId,
		...preferredModelIds,
	]
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.trim())
		.filter(Boolean);
}

function capabilityIdsForModelIds(
	modelIds: string[],
	capabilities: CapabilityDescriptor[],
	engineCapability: string,
): string[] {
	if (modelIds.length === 0) return [];
	return capabilities
		.filter((capability) =>
			capability.routable !== false
			&& capability.health !== "down"
			&& capability.capabilities.includes(engineCapability)
			&& typeof capability.metadata?.discoveredModelId === "string"
			&& modelIds.includes(capability.metadata.discoveredModelId),
		)
			.map((capability) => capability.id);
}

function discoveredCapabilitiesForIds(
	capabilityIds: string[],
	capabilities: CapabilityDescriptor[],
): CapabilityDescriptor[] {
	if (capabilityIds.length === 0) return [];
	return capabilities.filter((capability) =>
		capabilityIds.includes(capability.id)
		&& capability.metadata?.discovered === true,
	);
}

function normalizeDiscoveredCapabilityMetadata(
	capability: CapabilityDescriptor | null | undefined,
): { modelId?: string; providerId?: string } {
	if (!capability) return {};
	const modelId = typeof capability.metadata?.discoveredModelId === "string"
		? capability.metadata.discoveredModelId
		: undefined;
	const providerId = typeof capability.metadata?.discoveredProviderId === "string"
		? capability.metadata.discoveredProviderId
		: undefined;
	return { modelId, providerId };
}

function discoveryCandidateCapabilityIds(
	capabilities: CapabilityDescriptor[],
	engineCapability: string,
): string[] {
	const healthRank = (capability: CapabilityDescriptor): number =>
		capability.health === "healthy" ? 2 : capability.health === "degraded" ? 1 : 0;
	return capabilities
		.filter((capability) =>
			capability.routable !== false
			&& capability.health !== "down"
			&& capability.capabilities.includes(engineCapability)
			&& capability.metadata?.discovered === true,
		)
		.sort((left, right) => {
			const healthDelta = healthRank(right) - healthRank(left);
			if (healthDelta !== 0) return healthDelta;
			return (right.priority ?? 0) - (left.priority ?? 0);
		})
		.map((capability) => capability.id);
}

export function resolveDiscoveryRouteQuery(engineCapability: string): DiscoveryRouteQuery | null {
	switch (engineCapability.trim()) {
		case "chat":
		case "model.chat":
		case "model.local.chat":
			return { capability: "chat", mode: "chat" };
		case "function_calling":
		case "model.tool-use":
		case "model.local.tool-use":
			return { capability: "function_calling", mode: "chat" };
		case "embeddings":
		case "model.embedding":
			return { capability: "embeddings", mode: "embeddings" };
		case "vision":
		case "model.vision":
			return { capability: "vision" };
		default:
			return null;
	}
}

export function normalizeEngineCapabilityForRouting(capability: string): string {
	switch (capability.trim()) {
		case "chat":
			return "model.chat";
		case "function_calling":
			return "model.tool-use";
		case "embeddings":
			return "model.embedding";
		case "vision":
			return "model.vision";
		default:
			return capability.trim();
	}
}

export function resolveDiscoveryRouteQueryForRequest(
	engineCapability: string,
	routeClass?: RouteClassDescriptor | null,
): DiscoveryRouteQuery | null {
	const direct = resolveDiscoveryRouteQuery(normalizeEngineCapabilityForRouting(engineCapability));
	if (direct) return direct;
	if (!routeClass?.discoveryBinding) return null;
	return {
		capability: routeClass.discoveryBinding.capability,
		mode: routeClass.discoveryBinding.mode,
		role: routeClass.discoveryBinding.role,
	};
}


export function applyDiscoveryRoutePreference(
	request: RoutingRequest,
	capabilities: CapabilityDescriptor[],
	discoveryHints: DiscoveryRouteHintsLike | null,
): DiscoveryRoutePreference {
	if (!discoveryHints) return { policyTrace: [] };

	const policyTrace: string[] = [];
	const explicitCapabilityIds = capabilityIdsForModelIds(
		normalizeContextModelIds(request.context),
		capabilities,
		request.capability,
	);
	const cheapestCapabilityIds = capabilityIdsForModelIds(
		extractPreferredModelIds(discoveryHints.cheapest),
		capabilities,
		request.capability,
	);
	const routePrefersDiscovery = request.routeClass
		? DISCOVERY_FLEX_ROUTE_CLASSES.has(request.routeClass)
		: false;
	const discoveryCapabilityIds = routePrefersDiscovery
		? discoveryCandidateCapabilityIds(capabilities, request.capability)
		: [];

	const preferredCapabilityIds = mergeConstraintIds(
		request.constraints?.preferredCapabilityIds,
		[
			...explicitCapabilityIds,
			...cheapestCapabilityIds,
			...discoveryCapabilityIds,
		],
	);
	const hardCapabilityId = explicitCapabilityIds.length === 1
		? explicitCapabilityIds[0]
		: routePrefersDiscovery && cheapestCapabilityIds.length === 1
			? cheapestCapabilityIds[0]
			: request.constraints?.hardCapabilityId;

	if (explicitCapabilityIds.length > 0) {
		policyTrace.push(`discovery-explicit:${explicitCapabilityIds.join(",")}`);
	}
	if (cheapestCapabilityIds.length > 0) {
		policyTrace.push(`discovery-cheapest:${cheapestCapabilityIds.join(",")}`);
	}
	if (routePrefersDiscovery && discoveryCapabilityIds.length > 0) {
		policyTrace.push(`discovery-flex:${discoveryCapabilityIds.join(",")}`);
	}
	if (hardCapabilityId && hardCapabilityId !== request.constraints?.hardCapabilityId) {
		policyTrace.push(`discovery-hard:${hardCapabilityId}`);
	}

	if (!preferredCapabilityIds && !hardCapabilityId) {
		return { policyTrace };
	}

	return {
		constraints: {
			...(request.constraints ?? {}),
			preferredCapabilityIds,
			hardCapabilityId,
		},
		policyTrace,
	};
}

export function buildDiscoveryExecutionBinding(
	routeClass: RouteClassDescriptor | null,
	discoveryHints: {
		query: DiscoveryRouteQuery;
		models: DiscoveryModelLike[];
		cheapest?: unknown;
	} | null,
	capabilities: CapabilityDescriptor[],
	selectedCapabilityId?: string | null,
	fallbackChain: string[] = [],
): RouteExecutionBinding | null {
	if (!routeClass?.discoveryBinding || !discoveryHints) return null;

	const selectedCapability = selectedCapabilityId
		? capabilities.find((capability) => capability.id === selectedCapabilityId)
		: null;
	const selectedMetadata = normalizeDiscoveredCapabilityMetadata(selectedCapability);
	const discoveredCandidates = discoveredCapabilitiesForIds(
		[selectedCapabilityId ?? "", ...fallbackChain].filter(Boolean),
		capabilities,
	);
	const discoveredModelIds = [...new Set(
		discoveryHints.models
			.map((model) => (typeof model.id === "string" ? model.id.trim() : ""))
			.filter(Boolean),
	)];
	const hintedDiscoveredCandidates = discoveredCapabilitiesForIds(
		capabilityIdsForModelIds(discoveredModelIds, capabilities, routeClass.capability),
		capabilities,
	);
	const allDiscoveredCandidates = [
		...new Map(
			[...discoveredCandidates, ...hintedDiscoveredCandidates].map((capability) => [capability.id, capability]),
		).values(),
	];
	const shouldBindDiscoveryLane =
		routeClass.capability.startsWith("model.")
		|| selectedCapabilityId === "adapter.takumi.executor"
		|| Boolean(selectedMetadata.modelId || selectedMetadata.providerId)
		|| allDiscoveredCandidates.length > 0;
	if (!shouldBindDiscoveryLane) return null;
	const candidateModelIds = [...new Set(
		allDiscoveredCandidates
			.map((capability) => normalizeDiscoveredCapabilityMetadata(capability).modelId)
			.filter((value): value is string => typeof value === "string" && value.trim().length > 0),
	)];
	const preferredModelIds = extractPreferredModelIds(discoveryHints.cheapest);
	const preferredProviderIds = [
		...new Set([
			...(selectedMetadata.providerId ? [selectedMetadata.providerId] : []),
			...extractPreferredProviderIds(discoveryHints.cheapest),
			...allDiscoveredCandidates
				.map((capability) => normalizeDiscoveredCapabilityMetadata(capability).providerId)
				.filter((value): value is string => typeof value === "string" && value.trim().length > 0),
		]),
	];
	const selectedModelId = selectedMetadata.modelId
		?? preferredModelIds[0]
		?? candidateModelIds[0];
	const selectedProviderId = selectedMetadata.providerId
		?? preferredProviderIds[0]
		?? hintedDiscoveredCandidates
			.map((capability) => normalizeDiscoveredCapabilityMetadata(capability).providerId)
			.find((value): value is string => typeof value === "string" && value.trim().length > 0)
		?? discoveryHints.models.find((model) => model.id === selectedModelId)?.provider;

	return {
		source: "kosha-discovery",
		kind: "executor",
		query: {
			capability: discoveryHints.query.capability ?? routeClass.discoveryBinding.capability,
			mode: discoveryHints.query.mode ?? routeClass.discoveryBinding.mode,
			role: discoveryHints.query.role ?? routeClass.discoveryBinding.role,
		},
		selectedModelId,
		selectedProviderId,
		candidateModelIds,
		preferredModelIds: [
			...new Set([
				...(selectedModelId ? [selectedModelId] : []),
				...preferredModelIds,
			]),
		],
		preferredProviderIds: [
			...new Set([
				...(selectedProviderId ? [selectedProviderId] : []),
				...preferredProviderIds,
			]),
		],
		preferLocalProviders: routeClass.discoveryBinding.preferLocalProviders ?? false,
		allowCrossProvider: routeClass.discoveryBinding.allowCrossProvider
			?? preferredProviderIds.length > 1,
	};
}
