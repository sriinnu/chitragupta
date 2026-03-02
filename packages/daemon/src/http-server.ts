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
import fs from "node:fs";
import path from "node:path";
import { createLogger, getChitraguptaHome } from "@chitragupta/core";
import type { RpcRouter } from "./rpc-router.js";

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
 */
export async function startHttpServer(config: DaemonHttpConfig): Promise<DaemonHttpServer> {
	const { router, port = DEFAULT_HTTP_PORT, host = "127.0.0.1" } = config;

	const server = http.createServer(async (req, res) => {
		res.setHeader("Content-Type", "application/json");
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
			const url = req.url ?? "/";

			if (req.method === "GET" && url === "/ping") {
				jsonResponse(res, 200, { pong: true, ts: Date.now() });
				return;
			}

			if (req.method === "GET" && url === "/status") {
				await handleStatus(router, res);
				return;
			}

			if (req.method === "POST" && url === "/consolidate") {
				const result = await router.handle("nidra.consolidate", {});
				jsonResponse(res, 200, { ok: true, data: result });
				return;
			}

			if (req.method === "POST" && url === "/shutdown") {
				const result = await router.handle("daemon.shutdown", {});
				jsonResponse(res, 200, { ok: true, data: result });
				return;
			}

			if (req.method === "GET" && url === "/telemetry/instances") {
				handleTelemetryInstances(res);
				return;
			}

			if (req.method === "GET" && url.startsWith("/telemetry/watch")) {
				handleTelemetryWatch(url, res);
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
async function handleStatus(router: RpcRouter, res: http.ServerResponse): Promise<void> {
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

	jsonResponse(res, 200, {
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
		timestamp: Date.now(),
	});
}

// ─── Telemetry Handlers ─────────────────────────────────────────────────────

/** Get the telemetry instances directory path. */
function getTelemetryDir(): string {
	return path.join(getChitraguptaHome(), "telemetry", "instances");
}

/**
 * Scan heartbeat files from the telemetry directory.
 * Inline implementation — avoids circular dependency on @chitragupta/cli.
 *
 * @param dir - Directory to scan.
 * @param staleMs - Max age in ms to consider alive. Default: 10000.
 * @returns Array of parsed heartbeat records.
 */
function scanHeartbeatFiles(dir: string, staleMs = 10_000): Record<string, unknown>[] {
	if (!fs.existsSync(dir)) return [];
	const now = Date.now();
	const results: Record<string, unknown>[] = [];
	try {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".tmp-")) continue;
			try {
				const fp = path.join(dir, entry.name);
				const stat = fs.statSync(fp);
				if (now - stat.mtimeMs > staleMs) continue;
				results.push(JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, unknown>);
			} catch { /* skip corrupt */ }
		}
	} catch { /* dir unreadable */ }
	return results;
}

/**
 * Compute FNV-1a 32-bit fingerprint of heartbeat state.
 * Used for long-polling: only return data when state changes.
 *
 * @param instances - Array of heartbeat records.
 * @returns 8-character hex hash.
 */
function computeHeartbeatFingerprint(instances: Record<string, unknown>[]): string {
	const parts = instances.map(i => `${i.pid}:${i.heartbeatSeq}:${i.state}`).join("|");
	let hash = 0x811c9dc5;
	for (let i = 0; i < parts.length; i++) {
		hash ^= parts.charCodeAt(i);
		hash = (Math.imul(hash, 0x01000193)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

/**
 * Return all live MCP instances from heartbeat files.
 * Reads ~/.chitragupta/telemetry/instances/ and filters stale entries.
 */
function handleTelemetryInstances(res: http.ServerResponse): void {
	try {
		const dir = getTelemetryDir();
		const instances = scanHeartbeatFiles(dir);
		const fingerprint = computeHeartbeatFingerprint(instances);
		jsonResponse(res, 200, { instances, fingerprint, count: instances.length, timestamp: Date.now() });
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
		const dir = getTelemetryDir();
		const deadline = Date.now() + maxWaitMs;
		const pollIntervalMs = 1000;

		const poll = (): void => {
			const instances = scanHeartbeatFiles(dir);
			const fingerprint = computeHeartbeatFingerprint(instances);

			if (fingerprint !== clientFingerprint || Date.now() >= deadline) {
				jsonResponse(res, 200, {
					instances,
					fingerprint,
					count: instances.length,
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

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Write a JSON response. */
function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
	res.writeHead(status);
	res.end(JSON.stringify(body));
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
