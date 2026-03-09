/**
 * Core HTTP route handlers: health, metrics, sessions, chat, providers, tools, agent status, and auth.
 * @module http-routes-core
 */

import type { ChitraguptaServer } from "./http-server.js";
import type { ApiDeps, ServerConfig } from "./http-server-types.js";
import { okResponse, errorResponse } from "./server-response.js";
import { mountProviderRoutes } from "./http-routes-providers.js";
import {
	HealthChecker,
	MetricsRegistry,
	registerDefaultMetrics,
	MemoryHealthCheck,
	EventLoopHealthCheck,
	DiskHealthCheck,
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

function parseSessionReusePolicy(value: unknown): "isolated" | "same_day" | undefined {
	return value === "isolated" || value === "same_day" ? value : undefined;
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
		body: okResponse({
			status: "ok",
			version,
			uptime: server.uptime,
			timestamp: new Date().toISOString(),
		}),
	}));

	server.route("GET", "/api/health/deep", async () => {
		try {
			const report = await healthChecker.getStatus();
			const httpStatus = report.status === "DOWN" ? 503 : 200;
			return { status: httpStatus, body: okResponse(report) };
		} catch (err) {
			return {
				status: 500,
				body: errorResponse(`Health check failed: ${(err as Error).message}`),
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
			const sessions = await Promise.resolve(deps.listSessions());
			return {
				status: 200,
				body: okResponse({ sessions }, { count: sessions.length }),
			};
		} catch (err) {
			return { status: 500, body: errorResponse(`Failed to list sessions: ${(err as Error).message}`) };
		}
	});

	server.route("GET", "/api/sessions/:id", async (req) => {
		try {
			const session = deps.loadSession
				? await Promise.resolve(deps.loadSession(req.params.id))
				: deps.getSession();
			if (!session) return { status: 404, body: errorResponse(`Session not found: ${req.params.id}`) };
			return { status: 200, body: okResponse({ session }) };
		} catch (err) {
			return { status: 500, body: errorResponse(`Failed to get session: ${(err as Error).message}`) };
		}
	});

	server.route("GET", "/api/sessions/lineage/policy", async () => ({
		status: 200,
		body: okResponse({
			defaultReusePolicy: "isolated",
			explicitReusePolicy: "same_day",
			headers: {
				lineage: "x-chitragupta-lineage",
				client: "x-chitragupta-client",
			},
			bodyFields: [
				"sessionLineageKey",
				"lineageKey",
				"sessionReusePolicy",
				"consumer",
				"surface",
				"channel",
				"actorId",
			],
			guidance: "Use isolated sessions by default. Reuse a lineage key only for intentional same-thread collaboration across tabs, agents, or surfaces.",
		}),
	}));

	server.route("POST", "/api/sessions", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (!deps.openSession) {
				return { status: 501, body: { error: "Session creation is not available on this runtime surface" } };
			}
			const opened = await deps.openSession({
				sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
				title: typeof body.title === "string" ? body.title : "API Session",
				clientKey:
					typeof body.clientKey === "string"
						? body.clientKey
						: req.headers["x-chitragupta-client"],
				sessionLineageKey:
					typeof body.sessionLineageKey === "string"
						? body.sessionLineageKey
						: typeof body.lineageKey === "string"
							? body.lineageKey
							: req.headers["x-chitragupta-lineage"],
				sessionReusePolicy: parseSessionReusePolicy(body.sessionReusePolicy),
				consumer: typeof body.consumer === "string" ? body.consumer : undefined,
				surface: typeof body.surface === "string" ? body.surface : undefined,
				channel: typeof body.channel === "string" ? body.channel : undefined,
				actorId: typeof body.actorId === "string" ? body.actorId : undefined,
			});
			return {
				status: 201,
				body: {
					sessionId: opened.id,
					created: opened.created,
					requestId: req.requestId,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed to create session: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/sessions/collaborate", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const lineageKey =
				typeof body.sessionLineageKey === "string"
					? body.sessionLineageKey
					: typeof body.lineageKey === "string"
						? body.lineageKey
						: req.headers["x-chitragupta-lineage"];
			if (typeof lineageKey !== "string" || lineageKey.trim().length === 0) {
				return {
					status: 400,
					body: { error: "Missing sessionLineageKey/lineageKey or x-chitragupta-lineage header" },
				};
			}
			if (!deps.openSession) {
				return { status: 501, body: { error: "Shared collaboration sessions are not available on this runtime surface" } };
			}
			const collaborator =
				deps.openSharedSession
					? await deps.openSharedSession({
						sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
						title: typeof body.title === "string" ? body.title : "Shared Collaboration Session",
						clientKey:
							typeof body.clientKey === "string"
								? body.clientKey
								: req.headers["x-chitragupta-client"],
						sessionLineageKey: lineageKey,
						consumer: typeof body.consumer === "string" ? body.consumer : undefined,
						surface: typeof body.surface === "string" ? body.surface : "collaboration",
						channel: typeof body.channel === "string" ? body.channel : "shared",
						actorId: typeof body.actorId === "string" ? body.actorId : undefined,
					})
					: await deps.openSession({
						sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
						title: typeof body.title === "string" ? body.title : "Shared Collaboration Session",
						clientKey:
							typeof body.clientKey === "string"
								? body.clientKey
								: req.headers["x-chitragupta-client"],
						sessionLineageKey: lineageKey,
						sessionReusePolicy: "same_day",
						consumer: typeof body.consumer === "string" ? body.consumer : undefined,
						surface: typeof body.surface === "string" ? body.surface : "collaboration",
						channel: typeof body.channel === "string" ? body.channel : "shared",
						actorId: typeof body.actorId === "string" ? body.actorId : undefined,
					});
			const collaboratorSessionId =
				"session" in collaborator
					&& typeof collaborator.session === "object"
					&& collaborator.session !== null
					&& "meta" in collaborator.session
					&& typeof collaborator.session.meta === "object"
					&& collaborator.session.meta !== null
					&& "id" in collaborator.session.meta
					&& typeof collaborator.session.meta.id === "string"
						? collaborator.session.meta.id
						: collaborator.id;
			return {
				status: 201,
				body: {
					sessionId: collaboratorSessionId,
					created: collaborator.created,
					lineageKey,
					sessionReusePolicy: "same_day",
					requestId: req.requestId,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed to open collaboration session: ${(err as Error).message}` } };
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
			if (deps.prompt) {
				const sessionOptions = {
					sessionId:
						typeof body.sessionId === "string"
							? body.sessionId
							: req.headers["x-session-id"],
					title: typeof body.title === "string" ? body.title : "Serve Session",
					clientKey:
						typeof body.clientKey === "string"
							? body.clientKey
							: req.headers["x-chitragupta-client"],
					sessionLineageKey:
						typeof body.sessionLineageKey === "string"
							? body.sessionLineageKey
							: typeof body.lineageKey === "string"
								? body.lineageKey
								: req.headers["x-chitragupta-lineage"],
					sessionReusePolicy: parseSessionReusePolicy(body.sessionReusePolicy),
					consumer: typeof body.consumer === "string" ? body.consumer : undefined,
					surface: typeof body.surface === "string" ? body.surface : undefined,
					channel: typeof body.channel === "string" ? body.channel : undefined,
					actorId: typeof body.actorId === "string" ? body.actorId : undefined,
				};
				let sessionId = sessionOptions.sessionId;
				let createdSession = false;
				if (deps.openSession) {
					const opened = await deps.openSession(sessionOptions);
					sessionId = opened.id;
					createdSession = opened.created;
				}
				const response = await deps.prompt(message.trim(), { sessionId });
				return {
					status: 200,
					body: { response, sessionId, createdSession, requestId: req.requestId },
				};
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
	mountProviderRoutes(server, deps);

	server.route("GET", "/api/tools", async () => {
		try {
			const tools = deps.listTools?.() ?? [];
			return {
				status: 200,
				body: okResponse({ tools }, { count: tools.length }),
			};
		} catch (err) {
			return { status: 500, body: errorResponse(`Failed to list tools: ${(err as Error).message}`) };
		}
	});

	// ── Agent Status ──────────────────────────────────────────────────
	server.route("GET", "/api/agent/status", async () => {
		try {
			const agent = deps.getAgent() as Record<string, unknown> | null;
			if (!agent) {
				return { status: 503, body: errorResponse("Agent not initialized") };
			}
			return {
				status: 200,
				body: okResponse({
					initialized: true,
					model: agent.model ?? null,
					providerId: agent.providerId ?? null,
					tokenUsage: agent.tokenUsage ?? null,
				}),
			};
		} catch (err) {
			return { status: 500, body: errorResponse(`Failed to get agent status: ${(err as Error).message}`) };
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
