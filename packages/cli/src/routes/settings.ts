/**
 * Settings API Routes -- REST endpoints for reading and updating global settings.
 *
 * Settings are persisted at `~/.chitragupta/config/settings.json`.
 * Reads use `loadGlobalSettings()` which merges with defaults.
 * Writes perform a deep partial merge then persist via `saveGlobalSettings()`.
 *
 * Secrets and API keys are never exposed in responses.
 *
 * @module routes/settings
 */

import {
	loadGlobalSettings,
	saveGlobalSettings,
	type ChitraguptaSettings,
} from "@chitragupta/core";

// ── Duck-Typed Server Interface ────────────────────────────────────────────

/** Duck-typed server for route registration. */
interface ServerLike {
	route(
		method: string,
		path: string,
		handler: (req: {
			params: Record<string, string>;
			query: Record<string, string>;
			body: unknown;
			headers: Record<string, string>;
			requestId: string;
		}) => Promise<{ status: number; body: unknown }>,
	): void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Keys that must never appear in settings API responses. */
const REDACTED_KEYS = new Set(["apiKey", "apiKeys", "authToken", "secret", "password", "token"]);

/**
 * Deep-merge `source` into `target`. Arrays are replaced, not merged.
 * Returns a new object without mutating either input.
 */
function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		const srcVal = source[key];
		const tgtVal = target[key];
		if (
			srcVal !== null &&
			typeof srcVal === "object" &&
			!Array.isArray(srcVal) &&
			tgtVal !== null &&
			typeof tgtVal === "object" &&
			!Array.isArray(tgtVal)
		) {
			result[key] = deepMerge(
				tgtVal as Record<string, unknown>,
				srcVal as Record<string, unknown>,
			);
		} else {
			result[key] = srcVal;
		}
	}
	return result;
}

/**
 * Recursively strip secret keys from a settings object.
 * Returns a shallow-safe copy.
 */
function redactSecrets(obj: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (REDACTED_KEYS.has(key)) continue;
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			result[key] = redactSecrets(value as Record<string, unknown>);
		} else {
			result[key] = value;
		}
	}
	return result;
}

// ── Route Mounter ──────────────────────────────────────────────────────────

/**
 * Mount settings-related API routes onto the server.
 *
 * @param server - ChitraguptaServer instance (duck-typed)
 */
export function mountSettingsRoutes(server: ServerLike): void {
	// ── GET /api/settings ──────────────────────────────────────────
	server.route("GET", "/api/settings", async () => {
		try {
			const settings = loadGlobalSettings();
			const safe = redactSecrets(settings as unknown as Record<string, unknown>);
			return { status: 200, body: { settings: safe } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to load settings: ${(err as Error).message}` } };
		}
	});

	// ── PUT /api/settings ──────────────────────────────────────────
	server.route("PUT", "/api/settings", async (req) => {
		try {
			const body = req.body;
			if (body === null || typeof body !== "object" || Array.isArray(body)) {
				return { status: 400, body: { error: "Request body must be a JSON object" } };
			}

			const current = loadGlobalSettings();
			const merged = deepMerge(
				current as unknown as Record<string, unknown>,
				body as Record<string, unknown>,
			) as unknown as ChitraguptaSettings;

			saveGlobalSettings(merged);

			const safe = redactSecrets(merged as unknown as Record<string, unknown>);
			return { status: 200, body: { settings: safe, updated: true } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to save settings: ${(err as Error).message}` } };
		}
	});
}
