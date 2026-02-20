/**
 * HTTP fetch wrapper and WebSocket helper for the Hub SPA.
 *
 * All API calls go through {@link apiFetch} which automatically
 * attaches the auth Bearer header and handles 401 responses by
 * clearing the auth token and redirecting to the pairing screen.
 * @module api
 */

import { route } from "preact-router";
import { token, clearToken, getAuthHeaders } from "./signals/auth.js";

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Derive the base URL for all API calls.
 * In production the SPA is served from the same origin as the API,
 * so `window.location.origin` is the correct base.
 */
export function getBaseUrl(): string {
	return window.location.origin;
}

/** Error class for API responses with a non-2xx status. */
export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: unknown,
	) {
		super(`API error ${status}`);
		this.name = "ApiError";
	}
}

// ── Core fetch ─────────────────────────────────────────────────────

/**
 * Send an authenticated fetch request to the API server.
 *
 * Prepends the base URL, attaches the Bearer token header, and
 * parses the JSON response body. On a 401 response the auth token
 * is cleared and the page is redirected to the pairing route.
 *
 * @typeParam T - Expected shape of the parsed response body.
 * @param path    - API path starting with `/` (e.g. `/api/sessions`).
 * @param options - Standard `RequestInit` overrides.
 * @returns Parsed JSON response body.
 * @throws {ApiError} When the server returns a non-2xx status (except 401 which triggers redirect).
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
	const url = `${getBaseUrl()}${path}`;

	const headers = new Headers(options.headers);
	const authHeaders = getAuthHeaders();
	for (const [key, value] of Object.entries(authHeaders)) {
		if (!headers.has(key)) {
			headers.set(key, value);
		}
	}
	if (!headers.has("Content-Type") && options.body) {
		headers.set("Content-Type", "application/json");
	}

	const response = await fetch(url, { ...options, headers });

	if (response.status === 401) {
		clearToken();
		route("/pair");
		throw new ApiError(401, { error: "Unauthorized" });
	}

	if (!response.ok) {
		const body: unknown = await response.json().catch(() => null);
		throw new ApiError(response.status, body);
	}

	return (await response.json()) as T;
}

// ── Convenience methods ────────────────────────────────────────────

/**
 * Send a GET request.
 * @typeParam T - Expected response body type.
 * @param path - API path (e.g. `/api/sessions`).
 */
export async function apiGet<T>(path: string): Promise<T> {
	return apiFetch<T>(path, { method: "GET" });
}

/**
 * Send a POST request with an optional JSON body.
 * @typeParam T - Expected response body type.
 * @param path - API path.
 * @param body - Request payload (will be JSON-stringified).
 */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
	return apiFetch<T>(path, {
		method: "POST",
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
}

/**
 * Send a PUT request with an optional JSON body.
 * @typeParam T - Expected response body type.
 * @param path - API path.
 * @param body - Request payload (will be JSON-stringified).
 */
export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
	return apiFetch<T>(path, {
		method: "PUT",
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
}

/**
 * Send a DELETE request.
 * @typeParam T - Expected response body type.
 * @param path - API path.
 */
export async function apiDelete<T>(path: string): Promise<T> {
	return apiFetch<T>(path, { method: "DELETE" });
}

// ── WebSocket helper ───────────────────────────────────────────────

/**
 * Create a WebSocket connection to the server with the auth token
 * passed as a query parameter.
 *
 * @param path - WebSocket path (e.g. `/ws/events`).
 * @returns A new WebSocket instance connected to the server.
 */
export function createWS(path: string): WebSocket {
	const base = getBaseUrl().replace(/^http/, "ws");
	const authParam = token.value ? `?token=${encodeURIComponent(token.value)}` : "";
	return new WebSocket(`${base}${path}${authParam}`);
}
