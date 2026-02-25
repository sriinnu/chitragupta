/**
 * @chitragupta/cli — HTTP Server mode.
 *
 * REST API server for consuming Chitragupta over HTTP.
 * Uses Node's built-in http module — zero external dependencies.
 *
 * Route handlers are in `server-routes.ts`.
 *
 * Endpoints:
 *   POST /chat            — Send a message, get full JSON response
 *   POST /chat/stream     — Send a message, stream response as SSE
 *   GET  /tools           — List available tools
 *   POST /tools/:name     — Execute a tool directly
 *   GET  /memory/search   — Search memory (?q=...&limit=N)
 *   GET  /sessions        — List sessions
 *   GET  /sessions/:id    — Get session details
 *   GET  /health          — Health check
 *   POST /abort           — Abort the current request
 *   POST /v1/marga/decide — Stateless LLM routing decision
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

import {
	configureCorsOrigins,
	errorResponse,
	handleAbort,
	handleChat,
	handleChatStream,
	handleCors,
	handleHealth,
	handleMargaDecide,
	handleMemorySearch,
	handleSessionGet,
	handleSessionsList,
	handleToolExecute,
	handleToolsList,
	parsePath,
} from "./server-routes.js";

// Re-export for backward compatibility
export type { ServerModeOptions } from "./server-routes.js";
import type { ServerModeOptions } from "./server-routes.js";

// ─── Server ─────────────────────────────────────────────────────────────────

/**
 * Start the Chitragupta HTTP server.
 *
 * Routes all requests to the appropriate handler based on method + path.
 * Returns the http.Server instance for programmatic control.
 *
 * @param options - Server configuration including the agent, port, and host.
 * @returns An object with the server and a shutdown function.
 */
export function startServer(options: ServerModeOptions): {
	server: Server;
	shutdown: () => Promise<void>;
} {
	const { agent, port = 3000, host = "127.0.0.1", projectPath } = options;

	// Configure CORS allowlist (uses dev defaults if not specified)
	configureCorsOrigins(options.corsOrigins);

	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		// Handle CORS preflight
		if (req.method === "OPTIONS") {
			handleCors(res, req.headers.origin);
			return;
		}

		const { pathname, params } = parsePath(req.url ?? "/");

		try {
			// ─── Route matching ─────────────────────────────────────────
			if (req.method === "POST" && pathname === "/chat") {
				await handleChat(agent, req, res);
				return;
			}

			if (req.method === "POST" && pathname === "/chat/stream") {
				await handleChatStream(agent, req, res);
				return;
			}

			if (req.method === "GET" && pathname === "/tools") {
				handleToolsList(agent, res);
				return;
			}

			// POST /tools/:name
			if (req.method === "POST" && pathname.startsWith("/tools/")) {
				const toolName = pathname.slice("/tools/".length);
				if (!toolName) {
					errorResponse(res, 400, "Missing tool name in path");
					return;
				}
				await handleToolExecute(agent, toolName, req, res);
				return;
			}

			if (req.method === "GET" && pathname === "/memory/search") {
				handleMemorySearch(params, res);
				return;
			}

			if (req.method === "GET" && pathname === "/sessions") {
				handleSessionsList(projectPath, res);
				return;
			}

			// GET /sessions/:id
			if (req.method === "GET" && pathname.startsWith("/sessions/")) {
				const sessionId = pathname.slice("/sessions/".length);
				if (!sessionId) {
					errorResponse(res, 400, "Missing session ID in path");
					return;
				}
				handleSessionGet(sessionId, projectPath, res);
				return;
			}

			if (req.method === "GET" && pathname === "/health") {
				handleHealth(agent, res);
				return;
			}

			if (req.method === "POST" && pathname === "/abort") {
				handleAbort(agent, res);
				return;
			}

			// POST /v1/marga/decide — Stateless routing decision API
			if (req.method === "POST" && pathname === "/v1/marga/decide") {
				await handleMargaDecide(req, res);
				return;
			}

			// ─── 404 ───────────────────────────────────────────────────
			errorResponse(res, 404, `Not found: ${req.method} ${pathname}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errorResponse(res, 500, `Internal server error: ${msg}`);
		}
	});

	// Track active connections for graceful shutdown
	const connections = new Set<import("node:net").Socket>();
	server.on("connection", (socket) => {
		connections.add(socket);
		socket.on("close", () => connections.delete(socket));
	});

	server.listen(port, host, () => {
		const banner = [
			"",
			"  \u091A\u093F\u0924\u094D\u0930\u0917\u0941\u092A\u094D\u0924   S E R V E R",
			"",
			`  Listening on http://${host}:${port}`,
			"",
			"  Endpoints:",
			"    POST /chat            — Send message, get response",
			"    POST /chat/stream     — Send message, stream SSE",
			"    GET  /tools           — List available tools",
			"    POST /tools/:name     — Execute a tool",
			"    GET  /memory/search   — Search memory (?q=...&limit=N)",
			"    GET  /sessions        — List sessions",
			"    GET  /sessions/:id    — Get session details",
			"    GET  /health          — Health check",
			"    POST /abort           — Abort current request",
			"    POST /v1/marga/decide — Stateless LLM routing",
			"",
			"  Press Ctrl+C to stop.",
			"",
		].join("\n");

		process.stderr.write(banner);
	});

	const shutdown = (): Promise<void> => {
		return new Promise((resolve, reject) => {
			agent.abort();
			for (const socket of connections) {
				socket.destroy();
			}
			server.close((err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	};

	return { server, shutdown };
}

/**
 * Run server mode — starts the HTTP server and blocks until SIGINT.
 *
 * This is the function called from the CLI `chitragupta serve` command.
 */
export async function runServerMode(options: ServerModeOptions): Promise<void> {
	const { shutdown } = startServer(options);

	const onSignal = () => {
		process.stderr.write("\n  Shutting down server...\n");
		shutdown()
			.then(() => {
				process.stderr.write("  Server stopped.\n\n");
				process.exit(0);
			})
			.catch((err) => {
				process.stderr.write(`  Shutdown error: ${(err as Error).message}\n`);
				process.exit(1);
			});
	};

	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	// Keep the process alive — the server event loop handles the rest
	await new Promise<void>(() => {
		// Intentionally never resolves — server runs until signal
	});
}
