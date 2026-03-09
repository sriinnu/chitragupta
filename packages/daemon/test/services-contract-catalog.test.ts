import { describe, expect, it, vi } from "vitest";

vi.mock("../src/services-local-runtime.js", () => ({
	getLocalRuntimePolicyStatus: vi.fn(async () => ({
		defaultRuntime: "llamacpp",
		fallbackRuntime: "ollama",
		statuses: [
			{
				runtime: "llamacpp",
				available: true,
				configured: true,
				endpoint: "http://llama.local/v1",
				preferred: true,
			},
			{
				runtime: "ollama",
				available: false,
				configured: true,
				endpoint: "http://ollama.local",
				preferred: false,
				lastError: "HTTP 503",
			},
		],
	})),
}));

vi.mock("../src/services-compression.js", () => ({
	getCompressionPolicyStatus: vi.fn(async () => ({
		defaultRuntime: "pakt-core",
		preferredRuntime: "pakt-core",
		supports: { compress: true, auto: true, packContext: true },
		requiredTools: ["pakt"],
		status: {
			runtime: "pakt-core",
			available: true,
			mode: "inproc",
			tools: ["pakt"],
		},
		runtimes: [
			{
				runtime: "pakt-core",
				available: true,
				mode: "inproc",
			},
		],
	})),
}));

vi.mock("../src/services-discovery.js", () => ({
	getDiscoveryStatus: vi.fn(async () => ({
		packageAvailable: true,
		discovered: true,
		lastDiscoveredAt: 1_763_000_000_000,
		providerCount: 4,
		modelCount: 12,
		capabilityCount: 6,
		missingCredentialCount: 1,
		healthyProviderCount: 3,
		degradedProviderCount: 1,
		openProviderCount: 0,
		error: null,
	})),
	getDiscoveryModelInventory: vi.fn(async () => ({
		status: {
			packageAvailable: true,
			discovered: true,
			lastDiscoveredAt: 1_763_000_000_000,
			providerCount: 4,
			modelCount: 12,
			capabilityCount: 6,
			missingCredentialCount: 1,
			healthyProviderCount: 3,
			degradedProviderCount: 1,
			openProviderCount: 0,
			error: null,
		},
		models: [
			{
				id: "gpt-4.1",
				name: "GPT-4.1",
				provider: "openai",
				originProvider: "openai",
				mode: "chat",
				capabilities: ["chat", "function_calling"],
				contextWindow: 128_000,
				maxOutputTokens: 16_384,
				pricing: { inputPerMillion: 1, outputPerMillion: 2 },
				aliases: ["gpt4.1"],
				source: "api",
			},
		],
		providerHealth: [
			{ providerId: "openai", state: "closed", failureCount: 0, lastError: null },
		],
	})),
}));

describe("services-contract-catalog", () => {
	it("exposes ACP and autoresearch capabilities in the engine catalog", async () => {
		const { resolveCapabilitySurface } = await import("../src/services-contract-catalog.js");
		const surface = await resolveCapabilitySurface();

		expect(surface).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "engine.sutra.acp",
					capabilities: expect.arrayContaining([
						"agent.communication.peer",
						"agent.council.peer-consultation",
						"mesh.peer-routing",
						"mesh.capability-discovery",
					]),
				}),
				expect.objectContaining({
					id: "engine.research.autoresearch",
					capabilities: expect.arrayContaining([
						"research.autoresearch",
						"workflow.bounded-experiments",
						"memory.experiment-ledger",
						"research.metric-evaluate",
					]),
					metadata: expect.objectContaining({
						requiresPolicyApproval: true,
					}),
					invocation: expect.objectContaining({
						id: "prana-autoresearch",
						transport: "inproc",
						requiresApproval: true,
					}),
				}),
			]),
		);
	});

	it("makes autoresearch an engine-routable bounded workflow lane", async () => {
		const { resolveCapabilitySurface, routeCapability } = await import("../src/services-contract-catalog.js");
		const surface = await resolveCapabilitySurface();
		const routed = routeCapability({
			consumer: "takumi",
			sessionId: "sess-1",
			capability: "research.autoresearch",
		}, surface);
		expect(surface.some((capability) => capability.id === "engine.research.autoresearch")).toBe(true);
		expect(routed.selected).toEqual(expect.objectContaining({ id: "engine.research.autoresearch" }));
		expect(routed.discoverableOnly).toBe(false);
		expect(routed.reason).toContain("Selected engine.research.autoresearch");
	});

	it("advertises mesh-backed sabha replication in the catalog", async () => {
		const { resolveCapabilitySurface } = await import("../src/services-contract-catalog.js");
		const surface = await resolveCapabilitySurface();
		const sabha = surface.find((capability) => capability.id === "engine.sabha.mesh");
		const discovery = surface.find((capability) => capability.id === "engine.discovery.kosha");

		expect(sabha).toEqual(
			expect.objectContaining({
				capabilities: expect.arrayContaining([
					"sabha.consultation",
					"sabha.deliberation",
					"sabha.challenge-response",
					"sabha.events",
					"sabha.escalation",
					"sabha.state-sync",
					"sabha.record",
					"sabha.replication",
					"sabha.oplog-merge",
					"sabha.participant-perspective",
					"mesh.role-routing",
				]),
				invocation: expect.objectContaining({
					entrypoint:
						"sabha.list_active/sabha.get/sabha.resume/sabha.ask/sabha.submit_perspective/sabha.deliberate/sabha.challenge/sabha.respond/sabha.vote/sabha.gather/sabha.record/sabha.escalate/sabha.events/sabha.sync/sabha.repl.pull/sabha.repl.apply/sabha.repl.merge",
				}),
			}),
		);
		expect(discovery).toEqual(
			expect.objectContaining({
				id: "engine.discovery.kosha",
				capabilities: expect.arrayContaining([
					"provider.discovery",
					"model.discovery",
					"model.route-discovery",
					"model.cheapest-discovery",
					"provider.health-discovery",
				]),
				metadata: expect.objectContaining({
					packageAvailable: true,
					discovered: true,
					providerCount: 4,
					modelCount: 12,
				}),
			}),
		);
	});

	it("defines engine-owned route classes for consumers and merges their defaults into routing", async () => {
		const {
			resolveCapabilitySurface,
			routeCapability,
		} = await import("../src/services-contract-catalog.js");
		const {
			listRouteClasses,
			resolveRouteClass,
			mergeRouteClassConstraints,
		} = await import("../src/services-contract-route-classes.js");
		const surface = await resolveCapabilitySurface();
		const strictReview = resolveRouteClass("coding.review.strict");
		const localFast = resolveRouteClass("chat.local-fast");

		expect(listRouteClasses()).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: "coding.fast-local", capability: "coding.patch-and-validate" }),
			expect.objectContaining({ id: "coding.review.strict", capability: "coding.review" }),
			expect.objectContaining({ id: "chat.local-fast", capability: "model.local.chat" }),
			expect.objectContaining({ id: "chat.flex", capability: "model.chat" }),
			expect.objectContaining({ id: "tool.use.flex", capability: "model.tool-use" }),
		]));
		expect(strictReview).toEqual(expect.objectContaining({
			id: "coding.review.strict",
			capability: "coding.review",
		}));
		expect(localFast).toEqual(expect.objectContaining({
			id: "chat.local-fast",
			capability: "model.local.chat",
		}));

		const strictReviewRoute = routeCapability({
			consumer: "takumi",
			sessionId: "sess-strict",
			capability: strictReview?.capability ?? "coding.review",
			routeClass: strictReview?.id,
			constraints: mergeRouteClassConstraints(strictReview?.constraints, undefined),
		}, surface);
		expect(strictReviewRoute.selected?.id).toBe("adapter.takumi.executor");
		expect(strictReviewRoute.policyTrace).toContain("route-class:coding.review.strict");

		const localFastRoute = routeCapability({
			consumer: "vaayu",
			sessionId: "sess-local-fast",
			capability: localFast?.capability ?? "model.local.chat",
			routeClass: localFast?.id,
			constraints: mergeRouteClassConstraints(localFast?.constraints, undefined),
		}, surface);
		expect(localFastRoute.selected?.id).toBe("engine.local.llamacpp");
		expect(localFastRoute.policyTrace).toContain("route-class:chat.local-fast");
	});

	it("adds discovery-backed model capabilities when requested and routes generic chat through them", async () => {
		const { resolveCapabilitySurface, routeCapability } = await import("../src/services-contract-catalog.js");
		const { resolveRouteClass, mergeRouteClassConstraints } = await import("../src/services-contract-route-classes.js");
		const surface = await resolveCapabilitySurface({ includeDiscoveredModels: true });
		const discovered = surface.find((capability) => capability.id === "discovery.model.openai.gpt-4-1");
		const flex = resolveRouteClass("chat.flex");

		expect(discovered).toEqual(expect.objectContaining({
			capabilities: expect.arrayContaining(["model.chat", "model.tool-use"]),
			trust: "cloud",
			health: "healthy",
			metadata: expect.objectContaining({
				discovered: true,
				discoveredProviderId: "openai",
				discoveredModelId: "gpt-4.1",
			}),
		}));

		const routed = routeCapability({
			consumer: "vaayu",
			sessionId: "sess-chat-flex",
			capability: flex?.capability ?? "model.chat",
			routeClass: flex?.id,
			constraints: mergeRouteClassConstraints(flex?.constraints, undefined),
		}, surface);

		expect(routed.selected?.id).toBe("discovery.model.openai.gpt-4-1");
		expect(routed.policyTrace).toContain("route-class:chat.flex");
	});
});
