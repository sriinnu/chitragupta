/**
 * @chitragupta/daemon — Bridge authentication helpers.
 *
 * Generates and validates a local daemon bridge API key that downstream
 * consumers (CLI, Vaayu, Takumi) use to authenticate over the daemon socket.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import {
	BridgeAuthError,
	parseBridgeKey,
	parseBridgeKeyFromEnv,
	parseBridgeScopes,
	createLogger,
} from "@chitragupta/core";
import { ApiKeyStore, type AuthResult, type AuthScope } from "@chitragupta/dharma";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { resolvePaths, type DaemonPaths } from "./paths.js";

const log = createLogger("daemon:auth");

const DEFAULT_TENANT_ID = "local-engine";
const DEFAULT_BRIDGE_NAME = "local-daemon-bridge";
const DEFAULT_SCOPES: AuthScope[] = ["read", "write", "admin", "tools", "sessions", "memory"];
const DEFAULT_RATE_LIMIT_EXEMPT_METHODS = ["auth.handshake", "daemon.ping"];

export interface DaemonRateLimitConfig {
	maxRequests: number;
	windowMs: number;
	exemptMethods: string[];
}

export interface DaemonAuthContext {
	keyId?: string;
	tenantId?: string;
	scopes: AuthScope[];
}

export interface DaemonServerAuthConfig {
	required: boolean;
	validateToken(token: string): AuthResult;
	requestRateLimit?: DaemonRateLimitConfig;
}

function daemonTokenPath(paths: DaemonPaths): string {
	return path.join(path.dirname(paths.pid), "daemon.api-key");
}

function readTokenFile(tokenPath: string): string | undefined {
	try {
		const token = fs.readFileSync(tokenPath, "utf-8").trim();
		return token.length > 0 ? parseBridgeKey(token) : undefined;
	} catch (err) {
		if (err instanceof BridgeAuthError) throw err;
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		return undefined;
	}
}

function writeTokenFile(tokenPath: string, token: string): void {
	fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
	fs.writeFileSync(tokenPath, token + "\n", { encoding: "utf-8", mode: 0o600 });
}

export function resolveDaemonClientToken(paths = resolvePaths()): string | undefined {
	const envToken = parseBridgeKeyFromEnv(process.env, [
		"CHITRAGUPTA_MCP_BRIDGE_API_KEY",
		"CHITRAGUPTA_DAEMON_API_KEY",
		"CHITRAGUPTA_API_KEY",
		"CHITRAGUPTA_BRIDGE_API_KEY",
	]);
	if (envToken) return envToken;
	return readTokenFile(daemonTokenPath(paths));
}

/**
 * Ensure the daemon has a reusable local bridge token backed by the API-key
 * store. If the raw token file exists but no longer validates, a fresh key is
 * created and the file is replaced.
 */
export function ensureDaemonBridgeToken(paths = resolvePaths()): {
	key: string;
	tokenPath: string;
	created: boolean;
} {
	const tokenPath = daemonTokenPath(paths);
	const db = DatabaseManager.instance().get("agent");
	const store = new ApiKeyStore(db);

	const existing = readTokenFile(tokenPath);
	if (existing) {
		const result = store.validateKey(existing);
		if (result.authenticated) {
			return { key: existing, tokenPath, created: false };
		}
	}

	const created = store.createKey(DEFAULT_TENANT_ID, DEFAULT_BRIDGE_NAME, DEFAULT_SCOPES, {
		rateLimit: 600,
	});
	writeTokenFile(tokenPath, created.key);
	log.info("Generated daemon bridge token", { tokenPath });
	return { key: created.key, tokenPath, created: true };
}

export function createDaemonServerAuth(paths = resolvePaths()): DaemonServerAuthConfig {
	ensureDaemonBridgeToken(paths);
	const db = DatabaseManager.instance().get("agent");
	const store = new ApiKeyStore(db);
	const requestRateLimit = resolveRequestRateLimitConfig();
	return {
		required: true,
		requestRateLimit,
		validateToken(token: string): AuthResult {
			let trimmed = "";
			try {
				trimmed = parseBridgeKey(token);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return { authenticated: false, error: message };
			}
			if (!trimmed) return { authenticated: false, error: "Missing bridge token" };
			return store.validateKey(trimmed);
		},
	};
}

function hasScope(scopes: readonly AuthScope[], scope: AuthScope): boolean {
	return scopes.includes("admin") || scopes.includes(scope);
}

/**
 * Prefix-based authorization policy for daemon RPC methods. This keeps bridge
 * scopes useful before the daemon adopts per-method registration metadata.
 */
export function authorizeDaemonMethod(
	method: string,
	scopes: readonly AuthScope[],
): { allowed: boolean; required?: AuthScope } {
	if (scopes.includes("admin")) return { allowed: true };
	if (method === "auth.handshake") return { allowed: true };
	if (method.startsWith("daemon.")) {
		return hasScope(scopes, "read") ? { allowed: true } : { allowed: false, required: "read" };
	}
	if (method.startsWith("memory.") || method.startsWith("context.") || method.startsWith("day.") || method === "lucy.live_context") {
		return hasScope(scopes, "memory") || hasScope(scopes, "read")
			? { allowed: true }
			: { allowed: false, required: "memory" };
	}
	if (method === "semantic.sync_status") {
		return hasScope(scopes, "read") || hasScope(scopes, "memory")
			? { allowed: true }
			: { allowed: false, required: "read" };
	}
	if (method === "research.experiments.list") {
		return hasScope(scopes, "read") || hasScope(scopes, "memory")
			? { allowed: true }
			: { allowed: false, required: "read" };
	}
	if (method.startsWith("bridge.")) {
		return hasScope(scopes, "read") ? { allowed: true } : { allowed: false, required: "read" };
	}
	if (method === "discovery.refresh") {
		return hasScope(scopes, "write") ? { allowed: true } : { allowed: false, required: "write" };
	}
	if (method.startsWith("discovery.")) {
		return hasScope(scopes, "read") ? { allowed: true } : { allowed: false, required: "read" };
	}
	if (method.startsWith("session.") || method.startsWith("turn.")) {
		return hasScope(scopes, "sessions") || hasScope(scopes, "write")
			? { allowed: true }
			: { allowed: false, required: "sessions" };
	}
	if (
		method.startsWith("observe.")
		|| method.startsWith("heal.")
		|| method.startsWith("preference.")
		|| method.startsWith("nidra.")
		|| method.startsWith("consolidation.")
		|| method === "semantic.sync_curated"
		|| method === "research.experiments.record"
		|| method.startsWith("fact.")
		|| method.startsWith("akasha.")
		|| method === "memory.write"
		|| method === "memory.append"
		|| method === "memory.delete"
	) {
		return hasScope(scopes, "write")
			? { allowed: true }
			: { allowed: false, required: "write" };
	}
	if (
		method.startsWith("mesh.")
		|| method.startsWith("sabha.")
		|| method.startsWith("samiti.")
		|| method.startsWith("skills.")
		|| method.startsWith("compression.")
	) {
		return hasScope(scopes, "tools") || hasScope(scopes, "write")
			? { allowed: true }
			: { allowed: false, required: "tools" };
	}
	return hasScope(scopes, "read") ? { allowed: true } : { allowed: false, required: "read" };
}

function resolveRequestRateLimitConfig(): DaemonRateLimitConfig | undefined {
	const maxRequests = parsePositiveIntEnv("CHITRAGUPTA_BRIDGE_RATE_LIMIT_MAX_REQUESTS");
	const windowMs = parsePositiveIntEnv("CHITRAGUPTA_BRIDGE_RATE_LIMIT_WINDOW_MS");

	if (maxRequests == null && windowMs == null) return undefined;
	if (maxRequests == null || windowMs == null) {
		throw new BridgeAuthError(
			"Both CHITRAGUPTA_BRIDGE_RATE_LIMIT_MAX_REQUESTS and CHITRAGUPTA_BRIDGE_RATE_LIMIT_WINDOW_MS must be set together",
		);
	}

	return {
		maxRequests,
		windowMs,
		exemptMethods: parseBridgeScopes(
			process.env.CHITRAGUPTA_BRIDGE_RATE_LIMIT_EXEMPT_METHODS,
			DEFAULT_RATE_LIMIT_EXEMPT_METHODS,
		),
	};
}

function parsePositiveIntEnv(name: string): number | null {
	const raw = process.env[name];
	if (typeof raw !== "string" || !raw.trim()) return null;

	const parsed = Number.parseInt(raw.trim(), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new BridgeAuthError(`${name} must be a positive integer`);
	}

	return parsed;
}
