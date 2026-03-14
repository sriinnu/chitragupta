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

import { execSync } from "node:child_process";
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
				res.setHeader("Cache-Control", "max-age=2, stale-while-revalidate=5");
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

/** Provider name cache — keyed by PID, avoids repeated `ps` calls. */
const providerCache = new Map<number, { provider: string; ts: number }>();
const PROVIDER_CACHE_TTL_MS = 60_000;

/**
 * Resolve "unknown" provider by inspecting the process tree.
 *
 * When the heartbeat reports "unknown" (MCP server started before the
 * detection fix, or client doesn't set env vars), fall back to checking
 * the parent process command name via `ps`. Results are cached for 60s
 * to avoid repeated shell-outs on every /status poll.
 */
function resolveProvider(reported: string, pid: number | null): string {
	if (reported !== "unknown" || pid === null) return reported;

	const now = Date.now();
	const cached = providerCache.get(pid);
	if (cached && now - cached.ts < PROVIDER_CACHE_TTL_MS) return cached.provider;

	let resolved = "unknown";
	try {
		const ppidStr = execSync(`ps -p ${pid} -o ppid=`, { timeout: 500 }).toString().trim();
		const ppid = parseInt(ppidStr, 10);
		if (!isNaN(ppid) && ppid > 1) {
			const parentCmd = execSync(`ps -p ${ppid} -o command=`, { timeout: 500 }).toString().trim().toLowerCase();
			if (parentCmd.includes("claude")) resolved = "claude";
			else if (parentCmd.includes("codex")) resolved = "codex";
			else if (parentCmd.includes("gemini")) resolved = "gemini";
			else if (parentCmd.includes("copilot")) resolved = "copilot";
		}
	} catch {
		// Process may have exited — return "unknown"
	}

	providerCache.set(pid, { provider: resolved, ts: now });
	return resolved;
}

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
	const activeWindowMs = Number(process.env.CHITRAGUPTA_ACTIVE_WINDOW_MS) || 2 * 60 * 1000;
	const busyStaleMs = Number(process.env.CHITRAGUPTA_BUSY_THRESHOLD_MS) || 5 * 60 * 1000;

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
			provider: resolveProvider(
			typeof raw.provider === "string" ? raw.provider : "unknown",
			typeof raw.pid === "number" ? raw.pid : null,
		),
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
		router.has("health.status")
			? router.handle("health.status", {}, { transport: "http", kind: "request" })
			: router.handle("daemon.health", {}, { transport: "http", kind: "request" }),
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
			alive: (health?.daemon as Record<string, unknown> | undefined)?.alive ?? true,
			pid: (health?.daemon as Record<string, unknown> | undefined)?.pid ?? health?.pid ?? process.pid,
			uptime: (health?.daemon as Record<string, unknown> | undefined)?.uptime ?? health?.uptime ?? null,
			memory: (health?.daemon as Record<string, unknown> | undefined)?.memory ?? health?.memory ?? null,
			connections: (health?.daemon as Record<string, unknown> | undefined)?.connections ?? health?.connections ?? null,
			methods: health?.methods ?? null,
			serverPush: (health?.daemon as Record<string, unknown> | undefined)?.serverPush ?? null,
		},
		runtime: enrichRuntimeWithTelemetry(health?.clients, instances),
		integrity: health?.live ?? null,
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

/**
 * Enrich runtime socket items with workspace/provider from heartbeat telemetry.
 *
 * Socket tracking (RpcClientSnapshot) doesn't carry workspace/provider — those
 * come from heartbeat files written by MCP clients. This function performs a
 * strict PID-based cross-reference only — no guessing. If a socket's preferences
 * contain a `pid` that matches a heartbeat instance, it inherits that instance's
 * workspace and provider. Unmatched sockets are left unenriched.
 *
 * No single-instance fallback: when multiple providers (Claude, Codex, Gemini)
 * share the daemon, blindly assigning all sockets to one instance is wrong.
 */
function enrichRuntimeWithTelemetry(
	clients: unknown,
	telemetryInstances: Array<Record<string, unknown>>,
): unknown {
	if (!clients || typeof clients !== "object") return clients;
	const c = clients as Record<string, unknown>;
	const items = c.items;
	if (!Array.isArray(items) || items.length === 0) return clients;

	// Build PID → { workspace, provider } lookup from heartbeat instances
	const pidMap = new Map<number, { workspace: string | null; provider: string | null }>();
	for (const inst of telemetryInstances) {
		if (typeof inst.pid === "number") {
			pidMap.set(inst.pid, {
				workspace: typeof inst.workspace === "string" ? inst.workspace : null,
				provider: resolveProvider(
					typeof inst.provider === "string" ? inst.provider : "unknown",
					typeof inst.pid === "number" ? inst.pid : null,
				),
			});
		}
	}

	// Build unique-provider set to detect multi-provider scenarios
	const uniqueProviders = new Set(
		Array.from(pidMap.values()).map((v) => v.provider).filter((p) => p && p !== "unknown"),
	);

	const enrichedItems = items.map((item: unknown) => {
		if (!item || typeof item !== "object") return item;
		const it = item as Record<string, unknown>;

		// 1. Try matching via preferences.pid (client called client.identify)
		const prefs = it.preferences as Record<string, unknown> | undefined;
		const prefPid = typeof prefs?.pid === "number" ? prefs.pid : null;
		if (prefPid !== null) {
			const match = pidMap.get(prefPid);
			if (match) {
				return { ...it, workspace: match.workspace, provider: match.provider };
			}
		}

		// 2. If preferences have provider/workspace (from client.identify), use them directly
		if (typeof prefs?.provider === "string" && prefs.provider !== "unknown") {
			return {
				...it,
				workspace: typeof prefs.workspace === "string" ? prefs.workspace : null,
				provider: prefs.provider as string,
			};
		}

		// 3. Single-provider fallback: if ALL heartbeat instances report the same
		//    provider (not "unknown"), it's safe to attribute all sockets to it.
		//    In multi-provider setups this fallback is skipped — unmatched sockets
		//    stay unenriched rather than being mislabeled.
		if (uniqueProviders.size === 1) {
			const soleEntry = Array.from(pidMap.values())[0];
			if (soleEntry) {
				return { ...it, workspace: soleEntry.workspace, provider: soleEntry.provider };
			}
		}

		return it;
	});

	return { ...c, items: enrichedItems };
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
