/**
 * Tests for the Hub API client module.
 *
 * Validates URL construction, header attachment, error handling,
 * and the convenience HTTP method wrappers (GET, POST, PUT, DELETE).
 * Uses a mocked `fetch` to avoid real network calls.
 * @module test/api
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetStorage } from "./setup.js";

// ── Dynamic imports (after mocks are in place) ──────────────────

/** Lazily import the API and auth modules so mocks are ready first. */
async function loadModules() {
	const api = await import("../src/api.js");
	const auth = await import("../src/signals/auth.js");
	return { api, auth };
}

// ── Helpers ─────────────────────────────────────────────────────

/** Build a minimal mock Response for fetch. */
function mockResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
		headers: new Headers(),
		redirected: false,
		statusText: "OK",
		type: "basic" as ResponseType,
		url: "",
		clone: () => mockResponse(body, status),
		body: null,
		bodyUsed: false,
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
		blob: () => Promise.resolve(new Blob()),
		formData: () => Promise.resolve(new FormData()),
		text: () => Promise.resolve(JSON.stringify(body)),
		bytes: () => Promise.resolve(new Uint8Array()),
	} as Response;
}

// ── Tests ───────────────────────────────────────────────────────

describe("api client", () => {
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		resetStorage();
		fetchSpy = vi.fn().mockResolvedValue(mockResponse({ ok: true }));
		globalThis.fetch = fetchSpy;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("apiFetch builds the correct URL from path", async () => {
		const { api } = await loadModules();
		fetchSpy.mockResolvedValue(mockResponse({ items: [] }));

		await api.apiFetch("/api/sessions");

		expect(fetchSpy).toHaveBeenCalledOnce();
		const calledUrl = fetchSpy.mock.calls[0][0] as string;
		expect(calledUrl).toBe("http://localhost:3141/api/sessions");
	});

	it("apiFetch attaches Authorization header when token is set", async () => {
		const { api, auth } = await loadModules();
		auth.setToken("test-jwt-123");
		fetchSpy.mockResolvedValue(mockResponse({ data: "ok" }));

		await api.apiFetch("/api/health");

		const calledInit = fetchSpy.mock.calls[0][1] as RequestInit;
		const headers = calledInit.headers as Headers;
		expect(headers.get("authorization")).toBe("Bearer test-jwt-123");

		// Clean up
		auth.clearToken();
	});

	it("apiFetch does not attach Authorization when no token", async () => {
		const { api, auth } = await loadModules();
		auth.clearToken();
		fetchSpy.mockResolvedValue(mockResponse({ data: "ok" }));

		await api.apiFetch("/api/health");

		const calledInit = fetchSpy.mock.calls[0][1] as RequestInit;
		const headers = calledInit.headers as Headers;
		expect(headers.has("authorization")).toBe(false);
	});

	it("apiFetch throws ApiError on non-2xx response", async () => {
		const { api } = await loadModules();
		fetchSpy.mockResolvedValue(mockResponse({ error: "Not Found" }, 404));

		await expect(api.apiFetch("/api/missing")).rejects.toThrow(api.ApiError);
		await expect(api.apiFetch("/api/missing")).rejects.toThrow("API error 404");
	});

	it("ApiError exposes status and body", async () => {
		const { api } = await loadModules();
		const errorBody = { error: "Bad Request", details: "missing field" };
		fetchSpy.mockResolvedValue(mockResponse(errorBody, 400));

		try {
			await api.apiFetch("/api/bad");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(api.ApiError);
			const apiErr = err as InstanceType<typeof api.ApiError>;
			expect(apiErr.status).toBe(400);
			expect(apiErr.body).toEqual(errorBody);
		}
	});

	it("apiGet sends a GET request", async () => {
		const { api } = await loadModules();
		fetchSpy.mockResolvedValue(mockResponse({ sessions: [] }));

		const result = await api.apiGet<{ sessions: unknown[] }>("/api/sessions");

		expect(result).toEqual({ sessions: [] });
		const calledInit = fetchSpy.mock.calls[0][1] as RequestInit;
		expect(calledInit.method).toBe("GET");
	});

	it("apiPost sends a POST with JSON body", async () => {
		const { api } = await loadModules();
		const payload = { name: "test" };
		fetchSpy.mockResolvedValue(mockResponse({ id: "123" }));

		await api.apiPost("/api/items", payload);

		const calledInit = fetchSpy.mock.calls[0][1] as RequestInit;
		expect(calledInit.method).toBe("POST");
		expect(calledInit.body).toBe(JSON.stringify(payload));
	});

	it("apiPut sends a PUT with JSON body", async () => {
		const { api } = await loadModules();
		fetchSpy.mockResolvedValue(mockResponse({ updated: true }));

		await api.apiPut("/api/items/1", { name: "updated" });

		const calledInit = fetchSpy.mock.calls[0][1] as RequestInit;
		expect(calledInit.method).toBe("PUT");
	});

	it("apiDelete sends a DELETE request", async () => {
		const { api } = await loadModules();
		fetchSpy.mockResolvedValue(mockResponse({ deleted: true }));

		await api.apiDelete("/api/items/1");

		const calledInit = fetchSpy.mock.calls[0][1] as RequestInit;
		expect(calledInit.method).toBe("DELETE");
	});

	it("getBaseUrl returns window.location.origin", async () => {
		const { api } = await loadModules();

		const baseUrl = api.getBaseUrl();
		expect(baseUrl).toBe("http://localhost:3141");
	});
});
