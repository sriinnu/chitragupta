import type { RpcInvocationContext, RpcRouter } from "./rpc-router.js";
import { getCompressionPolicyStatus } from "./services-compression.js";
import { getDiscoveryRouteHints, getDiscoveryStatus } from "./services-discovery.js";
import {
	applyDiscoveryRoutePreference,
	resolveDiscoveryRouteQuery,
} from "./services-discovery-routing.js";
import { getLocalRuntimePolicyStatus } from "./services-local-runtime.js";
import {
	filterCapabilities,
	resolveCapabilitySurface,
	routeCapability,
	type ConsumerConstraint,
	type RoutingRequest,
} from "./services-contract-catalog.js";
import {
	listRouteClasses,
	mergeRouteClassConstraints,
	resolveRouteClass,
} from "./services-contract-route-classes.js";

function authSnapshot(context?: RpcInvocationContext): Record<string, unknown> {
	return {
		authenticated: Boolean(context?.auth),
		keyId: context?.auth?.keyId ?? null,
		tenantId: context?.auth?.tenantId ?? null,
		scopes: context?.auth?.scopes ?? [],
	};
}

export function registerContractMethods(router: RpcRouter): void {
	router.register("bridge.info", async (_params, context) => {
		const localRuntimePolicy = await getLocalRuntimePolicyStatus();
		const compression = await getCompressionPolicyStatus();
		return {
			contractVersion: 2,
			engine: "chitragupta",
			authority: {
				durableMemory: true,
				canonicalSessions: true,
				routingPolicy: true,
				bridgeAuth: true,
				runtimeIntegrity: true,
			},
			auth: authSnapshot(context),
			sessionModel: {
				canonicalLedger: true,
				sessionScopedMemoryViaSessionApi: true,
				childLineageSupported: true,
			},
			runtime: {
				daemonFirst: true,
				serverPush: router.hasNotifier(),
				lucy: true,
				scarlett: true,
				sabha: true,
				discovery: await getDiscoveryStatus(),
				localRuntimePolicy: {
					supports: localRuntimePolicy.supports,
					default: localRuntimePolicy.defaultRuntime,
					fallback: localRuntimePolicy.fallbackRuntime,
					statuses: localRuntimePolicy.statuses,
					engineOwned: true,
				},
				compressionPolicy: {
					supports: compression.supports,
					preferred: compression.preferredRuntime,
					default: compression.defaultRuntime,
					available: compression.status.available,
					requiredTools: compression.requiredTools,
					lastError: compression.status.error ?? null,
					engineOwned: true,
				},
			},
			fallback: {
				writesFailClosed: true,
				localFallbackOptInEnv: "CHITRAGUPTA_ALLOW_LOCAL_RUNTIME_FALLBACK",
			},
		};
	}, "Describe the daemon bridge contract, authority boundaries, and runtime shape");

	router.register("bridge.capabilities", async () => {
		const methods = router.listMethods().map((meta) => meta.name).sort();
			return {
				contractVersion: 2,
				methods,
			groups: {
				bridge: methods.filter((name) => name.startsWith("bridge.")),
				session: methods.filter((name) => name.startsWith("session.") || name.startsWith("turn.")),
				memory: methods.filter((name) => name.startsWith("memory.") || name === "lucy.live_context"),
				compression: methods.filter((name) => name.startsWith("compression.")),
				knowledge: methods.filter((name) =>
					name.startsWith("akasha.")
					|| name.startsWith("buddhi.")
					|| name.startsWith("vidhi.")
					|| name.startsWith("consolidation."),
				),
				sabha: methods.filter((name) => name.startsWith("sabha.")),
				discovery: methods.filter((name) => name.startsWith("discovery.")),
				runtime: methods.filter((name) => name.startsWith("runtime.")),
				binding: methods.filter((name) =>
					name.startsWith("observe.")
					|| name.startsWith("pattern.")
					|| name.startsWith("predict.")
					|| name.startsWith("health.")
					|| name.startsWith("heal.")
					|| name.startsWith("preference."),
				),
				},
				routeClasses: listRouteClasses().map((descriptor) => ({
					id: descriptor.id,
					label: descriptor.label,
					capability: descriptor.capability,
					description: descriptor.description,
					tags: descriptor.tags,
				})),
				consumerModel: {
					vaayu: "primary-consumer",
					takumi: "consumer-and-executable-capability",
			},
			sabhaProtocol: {
				verbs: [
						"list_active",
						"get",
						"resume",
						"ask",
					"submit_perspective",
					"deliberate",
					"challenge",
					"respond",
					"vote",
					"gather",
					"events",
					"sync",
					"repl.pull",
					"repl.apply",
					"repl.merge",
					"record",
					"escalate",
				],
				},
				routingProtocol: {
					supportsRouteClasses: true,
					defaultOwner: "chitragupta",
				},
				runtime: {
					serverPush: router.hasNotifier(),
					liveLucyContext: methods.includes("lucy.live_context"),
				localRuntimePolicy: methods.includes("runtime.local_policy"),
				compressionPolicy: methods.includes("runtime.compression_policy"),
			},
		};
	}, "List bridge-facing methods and grouped capabilities for external consumers");

	router.register("runtime.local_policy", async () => {
		const localRuntimePolicy = await getLocalRuntimePolicyStatus();
		const capabilities = await resolveCapabilitySurface();
		return {
			contractVersion: 1,
			supports: localRuntimePolicy.supports,
			defaultRuntime: localRuntimePolicy.defaultRuntime,
			fallbackRuntime: localRuntimePolicy.fallbackRuntime,
			statuses: localRuntimePolicy.statuses,
			policy: {
				owner: "chitragupta",
				prefer: "performance-first",
				convenienceFallback: "ollama",
			},
			capabilities: capabilities.filter((capability) => capability.kind === "local-model"),
		};
	}, "Describe the engine-owned local runtime policy for llama.cpp and Ollama");

	router.register("runtime.local_status", async () => {
		const localRuntimePolicy = await getLocalRuntimePolicyStatus();
		return {
			contractVersion: 1,
			defaultRuntime: localRuntimePolicy.defaultRuntime,
			fallbackRuntime: localRuntimePolicy.fallbackRuntime,
			runtimes: localRuntimePolicy.statuses,
		};
	}, "Report current local runtime health and availability for llama.cpp and Ollama");

	router.register("runtime.compression_policy", async () => {
		const compression = await getCompressionPolicyStatus();
		const capabilities = await resolveCapabilitySurface();
		return {
			contractVersion: 1,
			supports: compression.supports,
			preferredRuntime: compression.preferredRuntime,
			defaultRuntime: compression.defaultRuntime,
			available: compression.status.available,
			requiredTools: compression.requiredTools,
			status: compression.status,
			policy: {
				owner: "chitragupta",
				prefer: "engine-managed compression",
				provenanceRequired: true,
			},
			capabilities: capabilities.filter((capability) =>
				capability.capabilities.some((entry) =>
					entry === "memory.compress"
					|| entry === "session.compact"
					|| entry === "context.pack"
					|| entry === "handover.compress",
				),
			),
		};
		}, "Describe the engine-owned compression policy for PAKT-backed compaction");

		router.register("route.classes", async () => ({
			contractVersion: 1,
			routeClasses: listRouteClasses(),
		}), "List engine-owned route classes for consumers such as Takumi and Vaayu");

	router.register("capabilities", async (params) => {
			return {
				capabilities: filterCapabilities(await resolveCapabilitySurface(), params),
		};
	}, "Query engine-owned capabilities for external consumers");

	router.register("route.resolve", async (params) => {
			const requestedRouteClass = typeof params.routeClass === "string" ? params.routeClass.trim() : "";
			const routeClass = requestedRouteClass ? resolveRouteClass(requestedRouteClass) : null;
			if (requestedRouteClass && !routeClass) {
				throw new Error(`Unknown routeClass '${requestedRouteClass}'.`);
			}
			const requestedCapability = String(params.capability ?? "").trim();
			if (routeClass && requestedCapability && requestedCapability !== routeClass.capability) {
				throw new Error(
					`routeClass '${routeClass.id}' resolves to capability '${routeClass.capability}', `
					+ `got incompatible capability '${requestedCapability}'.`,
				);
			}
			const rawConstraints = (typeof params.constraints === "object" && params.constraints !== null)
				? params.constraints as ConsumerConstraint
				: undefined;
			const request: RoutingRequest = {
				consumer: String(params.consumer ?? "consumer").trim(),
				sessionId: String(params.sessionId ?? "").trim(),
				capability: requestedCapability || routeClass?.capability || "",
				routeClass: routeClass?.id,
				constraints: mergeRouteClassConstraints(routeClass?.constraints, rawConstraints),
				context: (typeof params.context === "object" && params.context !== null)
					? params.context as Record<string, unknown>
					: undefined,
			};
			if (!request.sessionId || !request.capability) {
				throw new Error("Missing sessionId and capability/routeClass");
				}
				const includeDiscoveredModels = resolveDiscoveryRouteQuery(request.capability) !== null;
				const capabilities = await resolveCapabilitySurface({ includeDiscoveredModels });
				const discoveryHints = includeDiscoveredModels ? await getDiscoveryRouteHints(request.capability) : null;
				const discoveryPreference = applyDiscoveryRoutePreference(request, capabilities, discoveryHints);
				const routedRequest: RoutingRequest = discoveryPreference.constraints
					? {
						...request,
						constraints: discoveryPreference.constraints,
					}
					: request;
				const routed = routeCapability(routedRequest, capabilities);
				if (discoveryPreference.policyTrace.length > 0) {
					routed.policyTrace.push(...discoveryPreference.policyTrace);
				}
				if (routedRequest.constraints?.preferredCapabilityIds?.length) {
					routed.policyTrace.push(`preferred:${routedRequest.constraints.preferredCapabilityIds.join(",")}`);
				}
				if (routedRequest.constraints?.hardCapabilityId) {
					routed.policyTrace.push(`hard:${routedRequest.constraints.hardCapabilityId}`);
				}
				return {
					...routed,
				routeClass,
				discoveryHints,
			};
		}, "Resolve a semantic consumer request into an engine-owned capability");
}
