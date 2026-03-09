/**
 * Bridge auth helpers for daemon / MCP transport keys.
 *
 * These helpers intentionally stay transport-agnostic:
 * - parse and validate opaque bridge API keys
 * - parse scope lists and env values
 */

export const BRIDGE_KEY_PREFIX = "chg_";
export const BRIDGE_KEY_PATTERN = /^chg_[0-9a-f]{32}$/;
export const DEFAULT_BRIDGE_REQUIRED_SCOPE = "read";

export class BridgeAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BridgeAuthError";
	}
}

export function parseBridgeKey(key: string): string {
	if (typeof key !== "string") {
		throw new BridgeAuthError("Bridge key must be a string");
	}

	const trimmed = key.trim();
	if (!trimmed) {
		throw new BridgeAuthError("Bridge key must not be empty");
	}
	if (!BRIDGE_KEY_PATTERN.test(trimmed)) {
		throw new BridgeAuthError("Bridge key must match chg_<32 hex chars>");
	}

	return trimmed;
}

export function parseBridgeScopes(
	value: string | undefined,
	fallback: readonly string[] = [],
): string[] {
	if (typeof value !== "string" || !value.trim()) {
		return [...fallback];
	}

	return Array.from(
		new Set(
			value
				.split(",")
				.map((scope) => scope.trim())
				.filter((scope) => scope.length > 0),
		),
	);
}

export function readBridgeAuthEnv(
	env: Record<string, string | undefined>,
	keys: readonly string[],
): string | null {
	for (const key of keys) {
		const value = env[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return null;
}

export function parseBridgeKeyFromEnv(
	env: Record<string, string | undefined>,
	keys: readonly string[],
): string | null {
	const key = readBridgeAuthEnv(env, keys);
	return key === null ? null : parseBridgeKey(key);
}
