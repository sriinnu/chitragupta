import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLocalRuntimePolicyStatusCacheForTests } from "../src/services-local-runtime.js";

const { loadGlobalSettings } = vi.hoisted(() => ({
	loadGlobalSettings: vi.fn(() => ({
		llamacppEndpoint: "http://llama.local/v1",
		ollamaEndpoint: "http://ollama.local",
	})),
}));

vi.mock("@chitragupta/core", () => ({
	loadGlobalSettings,
}));

describe("services-local-runtime", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		loadGlobalSettings.mockClear();
		vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url === "http://llama.local/v1/models") {
				return new Response(JSON.stringify({ data: [] }), { status: 200 });
			}
			if (url === "http://ollama.local/api/tags") {
				return new Response(JSON.stringify({ models: [] }), { status: 503 });
			}
			return new Response("missing", { status: 404 });
		}));
	});

	afterEach(() => {
		_resetLocalRuntimePolicyStatusCacheForTests();
		if (originalFetch) {
			vi.stubGlobal("fetch", originalFetch);
		} else {
			vi.unstubAllGlobals();
		}
	});

	it("reports local runtime status with llama.cpp preferred and Ollama fallback", async () => {
		const { getLocalRuntimePolicyStatus } = await import("../src/services-local-runtime.js");
		const status = await getLocalRuntimePolicyStatus();

		expect(status.defaultRuntime).toBe("llamacpp");
		expect(status.fallbackRuntime).toBe("ollama");
		expect(status.statuses).toEqual([
			expect.objectContaining({
				runtime: "llamacpp",
				available: true,
				configured: true,
				endpoint: "http://llama.local/v1",
				preferred: true,
			}),
			expect.objectContaining({
				runtime: "ollama",
				available: false,
				configured: true,
				endpoint: "http://ollama.local",
				preferred: false,
				lastError: "HTTP 503",
			}),
		]);
	});

	it("maps runtime status into the engine capability surface", async () => {
		const { resolveCapabilitySurface } = await import("../src/services-contract-catalog.js");
		const capabilities = await resolveCapabilitySurface();
		const llamacpp = capabilities.find((entry) => entry.id === "engine.local.llamacpp");
		const ollama = capabilities.find((entry) => entry.id === "engine.local.ollama");

		expect(llamacpp?.health).toBe("healthy");
		expect(llamacpp?.metadata).toEqual(expect.objectContaining({
			available: true,
			endpoint: "http://llama.local/v1",
		}));
		expect(ollama?.health).toBe("down");
		expect(ollama?.metadata).toEqual(expect.objectContaining({
			available: false,
			endpoint: "http://ollama.local",
			lastError: "HTTP 503",
		}));
	});

	it("caches runtime probes for a short TTL instead of probing on every call", async () => {
		const { getLocalRuntimePolicyStatus } = await import("../src/services-local-runtime.js");
		const fetchMock = vi.mocked(globalThis.fetch);

		await getLocalRuntimePolicyStatus();
		await getLocalRuntimePolicyStatus();

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
