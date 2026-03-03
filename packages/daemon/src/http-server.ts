/**
 * @chitragupta/daemon — Lightweight HTTP health server.
 *
 * Runs alongside the Unix domain socket server. Provides a simple
 * HTTP interface on localhost for native clients (menubar, taskbar,
 * browsers) that cannot speak JSON-RPC over Unix sockets.
 *
 * Loopback-only (127.0.0.1). No auth needed — same trust boundary
 * as the Unix socket.
 *
 * @module
 */

import http from "node:http";
import { createLogger } from "@chitragupta/core";
import type { RpcRouter } from "./rpc-router.js";
import { renderStatusDashboard } from "./http-status-ui.js";
import {
	computeTelemetryFingerprint,
	readTelemetryTimeline,
	scanTelemetryInstances,
} from "./telemetry-files.js";

const log = createLogger("daemon:http");

/** Default HTTP port for the daemon health server. */
export const DEFAULT_HTTP_PORT = 3690;

/** Running HTTP server handle. */
export interface DaemonHttpServer {
	/** Stop the HTTP server. */
	stop(): Promise<void>;
	/** The port the server is listening on. */
	port(): number;
}

/** Configuration for the daemon HTTP server. */
export interface DaemonHttpConfig {
	/** RPC router to dispatch requests through. */
	router: RpcRouter;
	/** Port to bind to. Default: 7788. */
	port?: number;
	/** Host to bind to. Default: 127.0.0.1 (loopback only). */
	host?: string;
}

/**
 * Start the daemon HTTP health server.
 *
 * Routes:
 * - `GET  /status`               — aggregated daemon health, DB counts, nidra state
 * - `POST /consolidate`          — trigger Nidra consolidation
 * - `POST /shutdown`             — graceful daemon shutdown
 * - `GET  /ping`                 — simple liveness check
 * - `GET  /telemetry/instances`  — live MCP instances from heartbeat files
 * - `GET  /telemetry/watch`      — long-poll for state changes
 * - `GET  /telemetry/timeline`   — cleanup timeline for stale/corrupt MCP files
 */
export async function startHttpServer(config: DaemonHttpConfig): Promise<DaemonHttpServer> {
	const { router, port = DEFAULT_HTTP_PORT, host = "127.0.0.1" } = config;

	const server = http.createServer(async (req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");

		// CORS preflight
		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		try {
			const rawUrl = req.url ?? "/";
			const url = new URL(rawUrl, "http://localhost");
			const pathname = url.pathname;
			const format = (url.searchParams.get("format") ?? "").toLowerCase();
			const accept = (req.headers.accept ?? "").toLowerCase();

			if (req.method === "GET" && pathname === "/ping") {
				jsonResponse(res, 200, { pong: true, ts: Date.now() });
				return;
			}

			if (req.method === "GET" && (pathname === "/status" || pathname === "/status/ui")) {
				const payload = await buildStatusPayload(router);
				const wantsHtml =
					format === "html" ||
					pathname === "/status/ui" ||
					(pathname === "/status" && format !== "json" && accept.includes("text/html"));
				if (wantsHtml) {
					htmlResponse(res, 200, renderStatusDashboard(payload));
				} else {
					jsonResponse(res, 200, payload);
				}
				return;
			}

			if (req.method === "POST" && pathname === "/consolidate") {
				const result = await router.handle("nidra.consolidate", {});
				jsonResponse(res, 200, { ok: true, data: result });
				return;
			}

			if (req.method === "POST" && pathname === "/shutdown") {
				const result = await router.handle("daemon.shutdown", {});
				jsonResponse(res, 200, { ok: true, data: result });
				return;
			}

			if (req.method === "GET" && pathname === "/telemetry/instances") {
				handleTelemetryInstances(res);
				return;
			}

			if (req.method === "GET" && pathname === "/telemetry/watch") {
				handleTelemetryWatch(rawUrl, res);
				return;
			}

			if (req.method === "GET" && pathname === "/telemetry/timeline") {
				handleTelemetryTimeline(rawUrl, res);
				return;
			}

			jsonResponse(res, 404, { error: "Not found" });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn("HTTP request error", { url: req.url, error: message });
			jsonResponse(res, 500, { error: message });
		}
	});

	const actualPort = await listen(server, host, port);
	log.info("HTTP health server listening", { host, port: actualPort });

	return {
		stop: () => new Promise<void>((resolve) => {
			server.close(() => resolve());
		}),
		port: () => actualPort,
	};
}

// ─── Status Handler ─────────────────────────────────────────────────────────

/**
 * Aggregate status from multiple RPC methods.
 *
 * Calls daemon.health, daemon.status, and nidra.status in parallel.
 * Each call is independent — partial failures still return what succeeded.
 */
async function buildStatusPayload(router: RpcRouter): Promise<Record<string, unknown>> {
	const telemetry = scanTelemetryInstances({
		staleMs: 15_000,
		cleanupStale: true,
		cleanupCorrupt: true,
		cleanupOrphan: true,
	});
	const rawInstances = telemetry.instances;
	const fingerprint = computeTelemetryFingerprint(rawInstances);
	const now = Date.now();
	const activeWindowMs = 2 * 60 * 1000;
	const busyStaleMs = 5 * 60 * 1000;

	const instances = rawInstances.map((raw) => {
		const instance = {
			pid: typeof raw.pid === "number" ? raw.pid : null,
			state: typeof raw.state === "string" ? raw.state : null,
			sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
			workspace: typeof raw.workspace === "string" ? raw.workspace : null,
			username: typeof raw.username === "string" ? raw.username : null,
			hostname: typeof raw.hostname === "string" ? raw.hostname : null,
			transport: typeof raw.transport === "string" ? raw.transport : null,
			model: typeof raw.model === "string" ? raw.model : null,
			startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
			uptime: typeof raw.uptime === "number" ? raw.uptime : null,
			toolCallCount: typeof raw.toolCallCount === "number" ? raw.toolCallCount : 0,
			turnCount: typeof raw.turnCount === "number" ? raw.turnCount : 0,
			lastToolCallAt: typeof raw.lastToolCallAt === "number" ? raw.lastToolCallAt : null,
			provider: typeof raw.provider === "string" ? raw.provider : "unknown",
			providerSessionId: typeof raw.providerSessionId === "string" ? raw.providerSessionId : null,
			clientKey: typeof raw.clientKey === "string" ? raw.clientKey : null,
			agentNickname: typeof raw.agentNickname === "string" ? raw.agentNickname : null,
			agentRole: typeof raw.agentRole === "string" ? raw.agentRole : null,
			parentThreadId: typeof raw.parentThreadId === "string" ? raw.parentThreadId : null,
			agent: "mcp",
		};

		const attentionReasons: string[] = [];
		const hasSession = instance.sessionId !== null || instance.providerSessionId !== null;
		if (!hasSession) attentionReasons.push("missing_session_identity");
		if (!instance.model) attentionReasons.push("missing_model");
		if (
			instance.state === "busy"
			&& typeof instance.lastToolCallAt === "number"
			&& now - instance.lastToolCallAt > busyStaleMs
		) {
			attentionReasons.push("busy_too_long");
		}
		const isActive = instance.state === "busy"
			|| (
				typeof instance.lastToolCallAt === "number"
				&& now - instance.lastToolCallAt <= activeWindowMs
			);

		return {
			...instance,
			isActive,
			needsAttention: attentionReasons.length > 0,
			attentionReasons,
		};
	});

	const openSessions = instances.filter((i) => i.sessionId !== null || i.providerSessionId !== null);
	const activeConversations = instances.filter((i) => i.isActive);
	const attentionInstances = instances.filter((i) => i.needsAttention);
	const byWorkspace = instances.reduce<Record<string, number>>((acc, inst) => {
		const key = inst.workspace ?? "(unknown)";
		acc[key] = (acc[key] ?? 0) + 1;
		return acc;
	}, {});
	const byProvider = instances.reduce<Record<string, number>>((acc, inst) => {
		const key = inst.provider ?? "unknown";
		acc[key] = (acc[key] ?? 0) + 1;
		return acc;
	}, {});
	const users = [...new Set(instances.map((i) => i.username).filter((v): v is string => !!v))];

	const [healthResult, dbResult, nidraResult] = await Promise.allSettled([
		router.handle("daemon.health", {}),
		router.handle("daemon.status", {}),
		router.has("nidra.status") ? router.handle("nidra.status", {}) : Promise.resolve(null),
	]);

	const health = healthResult.status === "fulfilled"
		? healthResult.value as Record<string, unknown>
		: null;

	const db = dbResult.status === "fulfilled"
		? dbResult.value as Record<string, unknown>
		: null;

	const nidra = nidraResult.status === "fulfilled"
		? nidraResult.value as Record<string, unknown>
		: null;

	return {
		daemon: {
			alive: true,
			pid: health?.pid ?? process.pid,
			uptime: health?.uptime ?? null,
			memory: health?.memory ?? null,
			connections: health?.connections ?? null,
			methods: health?.methods ?? null,
		},
		nidra,
		db: db ? (db as Record<string, unknown>).counts ?? db : null,
		links: {
			statusJson: "/status?format=json",
			statusUi: "/status/ui",
			telemetryInstances: "/telemetry/instances",
			telemetryWatch: "/telemetry/watch",
			telemetryTimeline: "/telemetry/timeline?limit=100",
		},
			active: {
				instanceCount: instances.length,
				openSessionCount: openSessions.length,
				activeConversationCount: activeConversations.length,
				activeNowCount: activeConversations.length,
				attentionCount: attentionInstances.length,
				fingerprint,
				cleanup: {
					removedStale: telemetry.removedStale,
					removedCorrupt: telemetry.removedCorrupt,
					removedOrphan: telemetry.removedOrphan,
				},
				attention: attentionInstances.map((inst) => ({
					pid: inst.pid,
					workspace: inst.workspace,
					provider: inst.provider,
					reasons: inst.attentionReasons,
				})),
				users,
				byWorkspace,
				byProvider,
				instances,
			},
			timestamp: Date.now(),
		};
}

// ─── Telemetry Handlers ─────────────────────────────────────────────────────

/**
 * Return all live MCP instances from heartbeat files.
 * Reads ~/.chitragupta/telemetry/instances/ and filters stale entries.
 */
function handleTelemetryInstances(res: http.ServerResponse): void {
	try {
		const telemetry = scanTelemetryInstances({
			staleMs: 15_000,
			cleanupStale: true,
			cleanupCorrupt: true,
			cleanupOrphan: true,
		});
		const instances = telemetry.instances;
		const fingerprint = computeTelemetryFingerprint(instances);
		jsonResponse(res, 200, {
			instances,
			fingerprint,
			count: instances.length,
			cleanup: {
				removedStale: telemetry.removedStale,
				removedCorrupt: telemetry.removedCorrupt,
				removedOrphan: telemetry.removedOrphan,
			},
			timestamp: Date.now(),
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		jsonResponse(res, 500, { error: `Telemetry scan failed: ${msg}` });
	}
}

/**
 * Long-poll telemetry endpoint. Returns only when state changes.
 * Client sends ?fingerprint=<hash> from previous response.
 * Polls every 1s for up to 30s, then returns current state regardless.
 */
function handleTelemetryWatch(url: string, res: http.ServerResponse): void {
	const params = new URL(url, "http://localhost").searchParams;
	const clientFingerprint = params.get("fingerprint") ?? "";
	const maxWaitMs = Math.min(30_000, parseInt(params.get("timeout") ?? "30000", 10) || 30_000);

	try {
		const deadline = Date.now() + maxWaitMs;
		const pollIntervalMs = 1000;

		const poll = (): void => {
			const telemetry = scanTelemetryInstances({
				staleMs: 15_000,
				cleanupStale: true,
				cleanupCorrupt: true,
				cleanupOrphan: true,
			});
			const instances = telemetry.instances;
			const fingerprint = computeTelemetryFingerprint(instances);

			if (fingerprint !== clientFingerprint || Date.now() >= deadline) {
				jsonResponse(res, 200, {
					instances,
					fingerprint,
					count: instances.length,
					cleanup: {
						removedStale: telemetry.removedStale,
						removedCorrupt: telemetry.removedCorrupt,
						removedOrphan: telemetry.removedOrphan,
					},
					timestamp: Date.now(),
					changed: fingerprint !== clientFingerprint,
				});
				return;
			}

			setTimeout(poll, pollIntervalMs);
		};

		poll();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		jsonResponse(res, 500, { error: `Telemetry watch failed: ${msg}` });
	}
}

/**
 * Return recent telemetry cleanup timeline events.
 * Query: ?limit=100 (1..1000)
 */
function handleTelemetryTimeline(url: string, res: http.ServerResponse): void {
	try {
		const params = new URL(url, "http://localhost").searchParams;
		const rawLimitParam = params.get("limit");
		const parsedLimit = Number(rawLimitParam ?? 100);
		let warning: string | null = null;
		let limit = 100;
		if (Number.isFinite(parsedLimit)) {
			limit = Math.max(1, Math.min(1000, Math.trunc(parsedLimit)));
			if (rawLimitParam !== null && String(limit) !== String(Math.trunc(parsedLimit))) {
				warning = "limit out of range; clamped to 1..1000";
			}
		} else if (rawLimitParam !== null && rawLimitParam.trim().length > 0) {
			warning = "invalid limit query param; defaulted to 100";
		}
		const events = readTelemetryTimeline(limit);
		jsonResponse(res, 200, {
			events,
			count: events.length,
			limit,
			param: {
				limit: rawLimitParam,
				warning,
			},
			timestamp: Date.now(),
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		jsonResponse(res, 500, { error: `Telemetry timeline failed: ${msg}` });
	}
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Write a JSON response. */
function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

/** Write an HTML response. */
function htmlResponse(res: http.ServerResponse, status: number, body: string): void {
	res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
	res.end(body);
}

/** Bind server and resolve with actual port. */
function listen(server: http.Server, host: string, port: number): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.off("error", reject);
			const addr = server.address();
			const actualPort = typeof addr === "object" && addr ? addr.port : port;
			resolve(actualPort);
		});
	});
}
