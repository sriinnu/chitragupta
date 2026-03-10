import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcRouter } from "../src/rpc-router.js";
import { _resetDiscoveryStateForTests, registerDiscoveryMethods } from "../src/services-discovery.js";

const discover = vi.fn(async () => []);
const refresh = vi.fn(async () => undefined);
const providers_list = vi.fn(() => [
	{
		id: "openai",
		name: "OpenAI",
		authenticated: true,
		credentialSource: "env",
		models: [{ id: "gpt-4.1" }],
		lastRefreshed: 100,
		baseUrl: "https://api.openai.com/v1",
	},
]);
const models = vi.fn(() => [
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
]);
const providerRoles = vi.fn(() => [
	{
		id: "openai",
		name: "OpenAI",
		authenticated: true,
		credentialSource: "env",
		models: [{ id: "gpt-4.1", roles: ["chat", "function_calling"] }],
	},
]);
const capabilities = vi.fn(() => [
	{ capability: "chat", modelCount: 1, providerCount: 1, providers: ["openai"], modes: ["chat"] },
]);
const cheapestModels = vi.fn(() => ({ matches: [], candidates: 1, pricedCandidates: 1, skippedNoPricing: 0, priceMetric: "blended", missingCredentials: [] }));
const modelRouteInfo = vi.fn(() => [
	{ provider: "openai", originProvider: "openai", isDirect: true, isPreferred: true },
]);
const providerHealth = vi.fn(() => [
	{ providerId: "openai", state: "closed", failureCount: 0, lastError: null },
]);
const missingCredentialPrompts = vi.fn(() => []);
const toJSON = vi.fn(() => ({ discoveredAt: 1_763_000_000_000 }));

vi.mock("kosha-discovery", () => ({
	ModelRegistry: class FakeModelRegistry {
		constructor(_config?: Record<string, unknown>) {}
		static async loadConfigFile(overrides?: Record<string, unknown>) {
			return overrides ?? {};
		}
		discover = discover;
		refresh = refresh;
		providers_list = providers_list;
		models = models;
		providerRoles = providerRoles;
		capabilities = capabilities;
		cheapestModels = cheapestModels;
		modelRouteInfo = modelRouteInfo;
		providerHealth = providerHealth;
		missingCredentialPrompts = missingCredentialPrompts;
		toJSON = toJSON;
	},
}));

describe("services-discovery", () => {
	const ctx = {
		clientId: "test-client",
		transport: "socket" as const,
		kind: "request" as const,
		auth: {
			keyId: "key-1",
			tenantId: "tenant-1",
			scopes: ["read", "sessions", "memory", "tools"],
		},
	};
	let router: RpcRouter;

	beforeEach(() => {
		router = new RpcRouter();
		registerDiscoveryMethods(router);
	});

	afterEach(() => {
		_resetDiscoveryStateForTests();
		vi.clearAllMocks();
	});

	it("reports discovery info and exposes provider/model inventory", async () => {
		const info = await router.handle("discovery.info", {}, ctx) as {
			status: { packageAvailable: boolean; discovered: boolean };
		};
		expect(info.status.packageAvailable).toBe(true);
		expect(info.status.discovered).toBe(false);

		const providers = await router.handle("discovery.providers", {}, ctx) as {
			status: { discovered: boolean; providerCount: number };
			providers: Array<{ id: string; modelCount: number }>;
		};
		expect(providers.status.discovered).toBe(true);
		expect(providers.status.providerCount).toBe(1);
		expect(providers.providers).toEqual([
			expect.objectContaining({ id: "openai", modelCount: 1 }),
		]);

		const listedModels = await router.handle("discovery.models", { mode: "chat" }, ctx) as {
			models: Array<{ id: string; mode: string }>;
		};
		expect(listedModels.models[0]).toEqual(expect.objectContaining({ id: "gpt-4.1", mode: "chat" }));
		expect(discover).toHaveBeenCalledTimes(1);
	});

	it("supports role, cheapest, route, capability, health, and refresh queries", async () => {
		const roles = await router.handle("discovery.roles", { role: "function_calling" }, ctx) as {
			providers: Array<{ id: string }>;
		};
		expect(roles.providers[0]?.id).toBe("openai");

		const cheapest = await router.handle("discovery.cheapest", { role: "chat" }, ctx) as {
			result: { candidates: number };
		};
		expect(cheapest.result.candidates).toBe(1);

		const routes = await router.handle("discovery.routes", { modelId: "gpt-4.1" }, ctx) as {
			routes: Array<{ provider: string; isPreferred: boolean }>;
		};
		expect(routes.routes).toEqual([expect.objectContaining({ provider: "openai", isPreferred: true })]);

		const caps = await router.handle("discovery.capabilities", {}, ctx) as {
			capabilities: Array<{ capability: string }>;
		};
		expect(caps.capabilities).toEqual([expect.objectContaining({ capability: "chat" })]);

		const health = await router.handle("discovery.health", {}, ctx) as {
			health: Array<{ providerId: string }>;
		};
		expect(health.health).toEqual([expect.objectContaining({ providerId: "openai" })]);

		const refreshed = await router.handle("discovery.refresh", { providerId: "openai" }, ctx) as {
			refreshed: string;
			status: { discovered: boolean };
		};
		expect(refreshed.refreshed).toBe("openai");
		expect(refreshed.status.discovered).toBe(true);
		expect(refresh).toHaveBeenCalledWith("openai");
	});

	it("rejects refresh=true on read-only discovery methods", async () => {
		await expect(router.handle("discovery.providers", { refresh: true }, ctx)).rejects.toThrow(
			"Use discovery.refresh instead",
		);
		expect(discover).not.toHaveBeenCalled();
	});

	it("dedupes concurrent discovery snapshot refreshes", async () => {
		let release: (() => void) | null = null;
		discover.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);

		const first = router.handle("discovery.providers", {}, ctx);
		const second = router.handle("discovery.models", {}, ctx);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(discover).toHaveBeenCalledTimes(1);

		release?.();
		await Promise.all([first, second]);
	});
});
