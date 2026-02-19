/**
 * Core HTTP route handlers: health, metrics, sessions, chat, providers, tools, agent status, and auth.
 * @module http-routes-core
 */

import fs from "node:fs";
import path from "node:path";
import type { ChitraguptaServer } from "./http-server.js";
import type { ApiDeps, ServerConfig } from "./http-server-types.js";
import {
	HealthChecker,
	MetricsRegistry,
	registerDefaultMetrics,
	MemoryHealthCheck,
	EventLoopHealthCheck,
	DiskHealthCheck,
	getChitraguptaHome,
} from "@chitragupta/core";
import {
	handleTokenExchange,
	handleTokenRefresh,
	handleAuthMe,
} from "@chitragupta/core";

const metricsRegistry = new MetricsRegistry();
registerDefaultMetrics(metricsRegistry);
const healthChecker = new HealthChecker();
healthChecker.register(new MemoryHealthCheck());
healthChecker.register(new EventLoopHealthCheck());
healthChecker.register(new DiskHealthCheck());

/** Shape of a persisted provider configuration entry. */
interface ProviderConfig {
	id: string;
	type: string;
	apiKey?: string;
	endpoint?: string;
	models?: string[];
}

/** Path to the persisted provider configurations file. */
function getProvidersConfigPath(): string {
	return path.join(getChitraguptaHome(), "config", "providers.json");
}

/** Read all provider configs from disk. Returns empty array on any error. */
function readProviderConfigs(): ProviderConfig[] {
	try {
		const filePath = getProvidersConfigPath();
		if (!fs.existsSync(filePath)) return [];
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed as ProviderConfig[] : [];
	} catch {
		return [];
	}
}

/** Write provider configs to disk. Creates the config directory if needed. */
function writeProviderConfigs(configs: ProviderConfig[]): void {
	const filePath = getProvidersConfigPath();
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(configs, null, "\t"), "utf-8");
}

/**
 * Mount core routes: health, metrics, sessions, chat, providers, tools, agent status/reset, and auth.
 */
export function mountCoreRoutes(
	server: ChitraguptaServer,
	deps: ApiDeps,
	config?: ServerConfig,
): void {
	const version = "0.1.0";

	server.route("GET", "/api/health", async () => ({
		status: 200,
		body: {
			status: "ok",
			version,
			uptime: server.uptime,
			timestamp: new Date().toISOString(),
		},
	}));

	server.route("GET", "/api/health/deep", async () => {
		try {
			const report = await healthChecker.getStatus();
			const httpStatus = report.status === "DOWN" ? 503 : 200;
			return { status: httpStatus, body: report };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Health check failed: ${(err as Error).message}` },
			};
		}
	});

	server.route("GET", "/api/metrics", async () => ({
		status: 200,
		body: metricsRegistry.collect(),
		headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
	}));

	// ── Sessions ──────────────────────────────────────────────────────
	server.route("GET", "/api/sessions", async () => {
		try {
			const sessions = deps.listSessions();
			return { status: 200, body: { sessions } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to list sessions: ${(err as Error).message}` } };
		}
	});

	server.route("GET", "/api/sessions/:id", async (req) => {
		try {
			const session = deps.getSession();
			if (!session || (session as Record<string, unknown>).id !== req.params.id) {
				return { status: 404, body: { error: `Session not found: ${req.params.id}` } };
			}
			return { status: 200, body: { session } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to get session: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/sessions", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const title = typeof body.title === "string" ? body.title : "API Session";
			return {
				status: 201,
				body: { message: "Session creation requested", title, requestId: req.requestId },
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed to create session: ${(err as Error).message}` } };
		}
	});

	// ── Chat ──────────────────────────────────────────────────────────
	server.route("POST", "/api/chat", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const message = body.message;
			if (typeof message !== "string" || message.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'message' field in request body" } };
			}
			const agent = deps.getAgent() as Record<string, unknown> | null;
			if (!agent) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}
			if (typeof agent.run === "function") {
				const result = await (agent.run as (msg: string) => Promise<unknown>)(message.trim());
				return { status: 200, body: { response: result, requestId: req.requestId } };
			}
			return { status: 501, body: { error: "Agent does not support run()" } };
		} catch (err) {
			return { status: 500, body: { error: `Chat error: ${(err as Error).message}` } };
		}
	});

	// ── Providers & Tools ─────────────────────────────────────────────
	server.route("GET", "/api/providers", async () => {
		try {
			const providers = deps.listProviders?.() ?? [];
			return { status: 200, body: { providers } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to list providers: ${(err as Error).message}` } };
		}
	});

	// ── Provider CRUD (persisted config) ─────────────────────────────
	server.route("POST", "/api/providers", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (typeof body.id !== "string" || body.id.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'id' field" } };
			}
			if (typeof body.type !== "string" || body.type.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'type' field" } };
			}

			const entry: ProviderConfig = {
				id: body.id.trim(),
				type: body.type.trim(),
				apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
				endpoint: typeof body.endpoint === "string" ? body.endpoint : undefined,
				models: Array.isArray(body.models)
					? (body.models as unknown[]).filter((m): m is string => typeof m === "string")
					: undefined,
			};

			const configs = readProviderConfigs();
			if (configs.some((c) => c.id === entry.id)) {
				return { status: 409, body: { error: `Provider already exists: ${entry.id}` } };
			}
			configs.push(entry);
			writeProviderConfigs(configs);
			return { status: 201, body: { provider: entry } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to create provider: ${(err as Error).message}` } };
		}
	});

	server.route("PUT", "/api/providers/:id", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (body === null || typeof body !== "object" || Array.isArray(body)) {
				return { status: 400, body: { error: "Request body must be a JSON object" } };
			}

			const configs = readProviderConfigs();
			const idx = configs.findIndex((c) => c.id === req.params.id);
			if (idx === -1) {
				return { status: 404, body: { error: `Provider not found: ${req.params.id}` } };
			}

			const existing = configs[idx];
			const updated: ProviderConfig = {
				...existing,
				type: typeof body.type === "string" ? body.type : existing.type,
				apiKey: typeof body.apiKey === "string" ? body.apiKey : existing.apiKey,
				endpoint: typeof body.endpoint === "string" ? body.endpoint : existing.endpoint,
				models: Array.isArray(body.models)
					? (body.models as unknown[]).filter((m): m is string => typeof m === "string")
					: existing.models,
			};

			configs[idx] = updated;
			writeProviderConfigs(configs);
			return { status: 200, body: { provider: updated } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to update provider: ${(err as Error).message}` } };
		}
	});

	server.route("DELETE", "/api/providers/:id", async (req) => {
		try {
			const configs = readProviderConfigs();
			const idx = configs.findIndex((c) => c.id === req.params.id);
			if (idx === -1) {
				return { status: 404, body: { error: `Provider not found: ${req.params.id}` } };
			}
			const removed = configs.splice(idx, 1)[0];
			writeProviderConfigs(configs);
			return { status: 200, body: { removed } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to delete provider: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/providers/:id/test", async (req) => {
		try {
			const configs = readProviderConfigs();
			const config = configs.find((c) => c.id === req.params.id);
			if (!config) {
				return { status: 404, body: { error: `Provider not found: ${req.params.id}` } };
			}
			// Mock connection test -- real implementation would ping the provider
			return {
				status: 200,
				body: {
					success: true,
					providerId: config.id,
					latencyMs: 42,
					modelsAvailable: config.models?.length ?? 0,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Provider test failed: ${(err as Error).message}` } };
		}
	});

	server.route("GET", "/api/tools", async () => {
		try {
			const tools = deps.listTools?.() ?? [];
			return { status: 200, body: { tools } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to list tools: ${(err as Error).message}` } };
		}
	});

	// ── Agent Status ──────────────────────────────────────────────────
	server.route("GET", "/api/agent/status", async () => {
		try {
			const agent = deps.getAgent() as Record<string, unknown> | null;
			if (!agent) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}
			return {
				status: 200,
				body: {
					initialized: true,
					model: agent.model ?? null,
					providerId: agent.providerId ?? null,
					tokenUsage: agent.tokenUsage ?? null,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed to get agent status: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/agent/reset", async (req) => {
		try {
			const agent = deps.getAgent() as Record<string, unknown> | null;
			if (!agent) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}
			if (typeof agent.reset === "function") {
				(agent.reset as () => void)();
				return { status: 200, body: { message: "Agent state reset", requestId: req.requestId } };
			}
			return { status: 501, body: { error: "Agent does not support reset()" } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to reset agent: ${(err as Error).message}` } };
		}
	});

	// ── Auth (Dvarpalaka) ─────────────────────────────────────────────
	server.route("POST", "/api/auth/token", async (req) => {
		if (!config?.tokenExchange) {
			return { status: 501, body: { error: "Token exchange not configured" } };
		}
		try {
			return await handleTokenExchange(req.body, config.tokenExchange);
		} catch (err) {
			return { status: 500, body: { error: `Token exchange failed: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/auth/refresh", async (req) => {
		if (!config?.tokenExchange) {
			return { status: 501, body: { error: "Token exchange not configured" } };
		}
		try {
			return handleTokenRefresh(req.body, config.tokenExchange);
		} catch (err) {
			return { status: 500, body: { error: `Token refresh failed: ${(err as Error).message}` } };
		}
	});

	server.route("GET", "/api/auth/me", async (req) => {
		try {
			return handleAuthMe(req.auth?.jwtPayload ?? null);
		} catch (err) {
			return { status: 500, body: { error: `Auth info failed: ${(err as Error).message}` } };
		}
	});
}
