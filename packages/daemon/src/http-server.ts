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
 * - `GET  /status`      — aggregated daemon health, DB counts, nidra state
 * - `POST /consolidate` — trigger Nidra consolidation
 * - `POST /shutdown`    — graceful daemon shutdown
 * - `GET  /ping`        — simple liveness check
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
