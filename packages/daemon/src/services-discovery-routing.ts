import type {
	CapabilityDescriptor,
	CapabilityHealthState,
	ConsumerConstraint,
	CostClass,
	RoutingRequest,
	TrustLevel,
} from "./services-contract-catalog-types.js";
import { extractPreferredModelIds } from "./services-discovery-helpers.js";

export interface DiscoveryRouteQuery {
	capability?: string;
	role?: string;
	mode?: string;
}

export interface DiscoveryModelLike {
	id: string;
	name: string;
	provider: string;
	originProvider?: string | null;
	mode?: string;
	capabilities: string[];
	contextWindow?: number;
	maxOutputTokens?: number;
	pricing?: {
		inputPerMillion?: number;
		outputPerMillion?: number;
	} | null;
	aliases?: string[];
	source?: string;
}

export interface DiscoveryProviderHealthLike {
	providerId: string;
	state: string;
	failureCount: number;
	lastError?: string | null;
}

const LOCAL_PROVIDER_IDS = new Set([
	"ollama",
	"llamacpp",
	"llama.cpp",
	"llama-cpp",
]);

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

function sanitizeIdPart(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function totalPricePerMillion(model: DiscoveryModelLike): number | null {
	const pricing = model.pricing;
	if (!pricing) return null;
	const input = typeof pricing.inputPerMillion === "number" ? pricing.inputPerMillion : 0;
	const output = typeof pricing.outputPerMillion === "number" ? pricing.outputPerMillion : 0;
	const total = input + output;
	return Number.isFinite(total) ? total : null;
}

function isLocalModel(model: DiscoveryModelLike): boolean {
	const providerIds = [
		model.provider,
		model.originProvider ?? "",
		model.source ?? "",
	].map((value) => value.trim().toLowerCase());
	return providerIds.some((value) => value && LOCAL_PROVIDER_IDS.has(value));
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

function discoveryCandidateCapabilityIds(
	capabilities: CapabilityDescriptor[],
	engineCapability: string,
): string[] {
	return capabilities
		.filter((capability) =>
			capability.routable !== false
			&& capability.health !== "down"
			&& capability.capabilities.includes(engineCapability)
			&& capability.metadata?.discovered === true,
		)
		.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
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

export function mapDiscoveryModelCapabilities(model: DiscoveryModelLike): string[] {
	const mapped = new Set<string>();
	const raw = [...new Set(model.capabilities.map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
	if (raw.includes("chat")) mapped.add("model.chat");
	if (raw.includes("function_calling") || raw.includes("tool_use") || raw.includes("tool-use")) {
		mapped.add("model.tool-use");
	}
	if (raw.includes("embeddings") || raw.includes("embedding")) mapped.add("model.embedding");
	if (raw.includes("vision") || raw.includes("image")) mapped.add("model.vision");
	return [...mapped];
}

export function inferDiscoveryTrust(model: DiscoveryModelLike): TrustLevel {
	return isLocalModel(model) ? "local" : "cloud";
}

export function inferDiscoveryCostClass(model: DiscoveryModelLike): CostClass {
	if (isLocalModel(model)) return "free";
	const total = totalPricePerMillion(model);
	if (total == null) return "medium";
	if (total <= 2) return "low";
	if (total <= 20) return "medium";
	return "high";
}

export function inferDiscoveryHealth(
	providerHealthRows: DiscoveryProviderHealthLike[],
	providerId: string,
): CapabilityHealthState {
	const row = providerHealthRows.find((entry) => entry.providerId === providerId);
	if (!row) return "unknown";
	if (row.state === "open") return "down";
	if (row.failureCount > 0) return "degraded";
	return "healthy";
}

export function discoveryModelCapabilityId(model: DiscoveryModelLike): string {
	return `discovery.model.${sanitizeIdPart(model.provider)}.${sanitizeIdPart(model.id)}`;
}

export function buildDiscoveredModelCapability(
	model: DiscoveryModelLike,
	providerHealthRows: DiscoveryProviderHealthLike[],
): CapabilityDescriptor | null {
	const capabilities = mapDiscoveryModelCapabilities(model);
	if (capabilities.length === 0) return null;
	const trust = inferDiscoveryTrust(model);
	return {
		id: discoveryModelCapabilityId(model),
		kind: "llm",
		label: `Discovered ${model.name}`,
		capabilities,
		costClass: inferDiscoveryCostClass(model),
		trust,
		health: inferDiscoveryHealth(providerHealthRows, model.provider),
		invocation: {
			id: `discovery:${model.provider}:${model.id}`,
			transport: trust === "local" ? "http" : "http",
			entrypoint: `${model.provider}/${model.id}`,
			requestShape: "provider/model specific request via discovered control-plane route",
			responseShape: "provider/model response",
			timeoutMs: 60_000,
			streaming: true,
		},
		tags: [
			"discovery",
			"kosha",
			model.provider,
			model.mode ?? "unknown",
			trust === "local" ? "local" : "cloud",
		],
		priority: trust === "local" ? 84 : 62,
		metadata: {
			discovered: true,
			discoveredProviderId: model.provider,
			discoveredModelId: model.id,
			discoveredOriginProvider: model.originProvider ?? null,
			discoveredMode: model.mode ?? null,
			discoveredAliases: model.aliases ?? [],
			discoveredSource: model.source ?? null,
			contextWindow: model.contextWindow ?? null,
			maxOutputTokens: model.maxOutputTokens ?? null,
		},
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
