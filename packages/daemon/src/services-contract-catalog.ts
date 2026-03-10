import { getCompressionPolicyStatus } from "./services-compression.js";
import { getDiscoveryModelInventory, getDiscoveryStatus } from "./services-discovery.js";
import { buildDiscoveredModelCapability } from "./services-discovery-routing.js";
import { capabilitySurface } from "./services-contract-catalog-surface.js";
import type {
	CapabilityDescriptor,
	ConsumerConstraint,
	CostClass,
	RoutingRequest,
	TrustLevel,
} from "./services-contract-catalog-types.js";
import { getLocalRuntimePolicyStatus } from "./services-local-runtime.js";

const COST_ORDER: Record<CostClass, number> = {
	free: 0,
	low: 1,
	medium: 2,
	high: 3,
};

const TRUST_ORDER: Record<TrustLevel, number> = {
	local: 0,
	sandboxed: 1,
	cloud: 2,
	privileged: 3,
};

export type {
	CapabilityDescriptor,
	ConsumerConstraint,
	RouteClassDescriptor,
	RoutingRequest,
} from "./services-contract-catalog-types.js";

export interface ResolveCapabilitySurfaceOptions {
	includeDiscoveredModels?: boolean;
}

export function filterCapabilities(
	capabilities: CapabilityDescriptor[],
	query: Record<string, unknown>,
): CapabilityDescriptor[] {
	const capability = typeof query.capability === "string" ? query.capability : "";
	const kinds = Array.isArray(query.kinds) ? query.kinds.map(String) : [];
	const tags = Array.isArray(query.tags) ? query.tags.map(String) : [];
	const includeDegraded = query.includeDegraded === true;
	const includeDown = query.includeDown === true;
	const limit = typeof query.limit === "number" ? Math.max(1, Math.floor(query.limit)) : undefined;

	const filtered = capabilities.filter((candidate) => {
		if (capability && !candidate.capabilities.includes(capability)) return false;
		if (kinds.length > 0 && !kinds.includes(candidate.kind)) return false;
		if (tags.length > 0 && !tags.every((tag) => candidate.tags.includes(tag))) return false;
		if (!includeDegraded && candidate.health === "degraded") return false;
		if (!includeDown && candidate.health === "down") return false;
		return true;
	});

	return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
}

function supportsConstraints(capability: CapabilityDescriptor, constraints?: ConsumerConstraint): boolean {
	if (!constraints) return capability.health !== "down";
	if (capability.health === "down") return false;
	if (constraints.hardCapabilityId && capability.id !== constraints.hardCapabilityId) return false;
	if (constraints.excludedCapabilityIds?.includes(capability.id)) return false;
	if (constraints.allowCloud === false && capability.trust === "cloud") return false;
	if (constraints.requireStreaming && !capability.invocation.streaming) return false;
	if (constraints.requireApproval && !capability.invocation.requiresApproval) return false;
	if (constraints.maxCostClass && COST_ORDER[capability.costClass] > COST_ORDER[constraints.maxCostClass]) return false;
	if (constraints.trustFloor && TRUST_ORDER[capability.trust] < TRUST_ORDER[constraints.trustFloor]) return false;
	return true;
}

function compareCapabilities(
	left: CapabilityDescriptor,
	right: CapabilityDescriptor,
	constraints?: ConsumerConstraint,
): number {
	const preferredIds = constraints?.preferredCapabilityIds ?? [];
	const leftPreferredIndex = preferredIds.indexOf(left.id);
	const rightPreferredIndex = preferredIds.indexOf(right.id);
	const leftPreferred = leftPreferredIndex === -1 ? Number.POSITIVE_INFINITY : leftPreferredIndex;
	const rightPreferred = rightPreferredIndex === -1 ? Number.POSITIVE_INFINITY : rightPreferredIndex;
	if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
	if (constraints?.preferLocal) {
		const trustDelta = TRUST_ORDER[left.trust] - TRUST_ORDER[right.trust];
		if (trustDelta !== 0) return trustDelta;
	}
	const leftHealth = left.health === "healthy" ? 2 : left.health === "degraded" ? 1 : 0;
	const rightHealth = right.health === "healthy" ? 2 : right.health === "degraded" ? 1 : 0;
	if (leftHealth !== rightHealth) return rightHealth - leftHealth;
	const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
	if (priorityDelta !== 0) return priorityDelta;
	const costDelta = COST_ORDER[left.costClass] - COST_ORDER[right.costClass];
	if (costDelta !== 0) return costDelta;
	return left.id.localeCompare(right.id);
}

export function routeCapability(request: RoutingRequest, capabilities: CapabilityDescriptor[]) {
	const discoverable = capabilities.filter((candidate) => candidate.capabilities.includes(request.capability));
	const compatible = capabilities
		.filter((candidate) => candidate.capabilities.includes(request.capability))
		.filter((candidate) => candidate.routable !== false)
		.filter((candidate) => supportsConstraints(candidate, request.constraints))
		.sort((left, right) => compareCapabilities(left, right, request.constraints));
	const selected = compatible[0] ?? null;
	const onlyDiscoverable = selected === null
		&& discoverable.length > 0
		&& discoverable.every((candidate) => candidate.routable === false);
	return {
		request,
		selected,
		reason: selected
			? `Selected ${selected.id} for ${request.capability}`
			: onlyDiscoverable
				? `Capability ${request.capability} is discoverable but not directly routable`
			: `No engine capability matched ${request.capability}`,
		fallbackChain: compatible.slice(1).map((candidate) => candidate.id),
		policyTrace: [
			`consumer:${request.consumer}`,
			`capability:${request.capability}`,
			request.routeClass ? `route-class:${request.routeClass}` : "route-class:none",
			request.constraints?.preferLocal ? "prefer-local" : "default-routing",
			selected ? `selected:${selected.id}` : "selected:none",
		],
		degraded: selected?.health === "degraded",
		discoverableOnly: onlyDiscoverable,
	};
}

export async function resolveCapabilitySurface(
	options: ResolveCapabilitySurfaceOptions = {},
): Promise<CapabilityDescriptor[]> {
	const capabilities = capabilitySurface();
	const localRuntimePolicy = await getLocalRuntimePolicyStatus();
	const compression = await getCompressionPolicyStatus();
	for (const runtime of localRuntimePolicy.statuses) {
		const capability = capabilities.find((candidate) =>
			candidate.id === (runtime.runtime === "llamacpp" ? "engine.local.llamacpp" : "engine.local.ollama"),
		);
		if (!capability) continue;
		capability.health = runtime.available ? "healthy" : "down";
		capability.metadata = {
			...(capability.metadata ?? {}),
			configured: runtime.configured,
			available: runtime.available,
			endpoint: runtime.endpoint,
			source: runtime.source,
			lastError: runtime.lastError ?? null,
			preferred: runtime.preferred,
		};
	}
	const paktCapability = capabilities.find((capability) => capability.id === "adapter.pakt.compression");
	if (paktCapability) {
		paktCapability.health = compression.status.available ? "healthy" : "down";
		paktCapability.metadata = {
			...(paktCapability.metadata ?? {}),
			available: compression.status.available,
			supports: compression.supports,
			preferredRuntime: compression.preferredRuntime,
			defaultRuntime: compression.defaultRuntime,
			command: compression.status.command,
			args: compression.status.args,
			transport: compression.status.transport,
			requiredTools: compression.requiredTools,
			discoveredTools: compression.status.tools,
			missingTools: compression.status.missingTools ?? [],
			lastError: compression.status.error ?? null,
			runtimes: compression.runtimes,
		};
	}
	const discoveryCapability = capabilities.find((capability) => capability.id === "engine.discovery.kosha");
	if (discoveryCapability) {
		const discovery = await getDiscoveryStatus();
		discoveryCapability.health = discovery.packageAvailable
			? discovery.discovered
				? "healthy"
				: "unknown"
			: "down";
		discoveryCapability.metadata = {
			...(discoveryCapability.metadata ?? {}),
			packageAvailable: discovery.packageAvailable,
			discovered: discovery.discovered,
			lastDiscoveredAt: discovery.lastDiscoveredAt,
			providerCount: discovery.providerCount,
			modelCount: discovery.modelCount,
			capabilityCount: discovery.capabilityCount,
			missingCredentialCount: discovery.missingCredentialCount,
			healthyProviderCount: discovery.healthyProviderCount,
			degradedProviderCount: discovery.degradedProviderCount,
			openProviderCount: discovery.openProviderCount,
			lastError: discovery.error ?? null,
		};
	}
	if (options.includeDiscoveredModels) {
		const discoveryInventory = await getDiscoveryModelInventory();
		if (discoveryInventory) {
			const knownIds = new Set(capabilities.map((capability) => capability.id));
			for (const model of discoveryInventory.models) {
				const discovered = buildDiscoveredModelCapability(model, discoveryInventory.providerHealth);
				if (!discovered || knownIds.has(discovered.id)) continue;
				knownIds.add(discovered.id);
				capabilities.push(discovered);
			}
		}
	}
	return capabilities;
}
