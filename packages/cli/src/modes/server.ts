/**
 * @chitragupta/cli — HTTP Server mode.
 *
 * REST API server for consuming Chitragupta over HTTP.
 * Uses Node's built-in http module — zero external dependencies.
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

import type { Agent, AgentEventType, AgentMessage, ToolHandler } from "@chitragupta/anina";
import { listSessions, loadSession } from "@chitragupta/smriti/session-store";
import { searchMemory } from "@chitragupta/smriti/search";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ServerModeOptions {
	agent: Agent;
	port?: number;
	host?: string;
	/** Project path for session/memory scoping */
	projectPath?: string;
}

interface JsonBody {
	[key: string]: unknown;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse JSON from an IncomingMessage body. */
function parseBody(req: IncomingMessage): Promise<JsonBody> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const MAX_BODY = 10 * 1024 * 1024; // 10 MB limit

		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY) {
				req.destroy();
				reject(new Error("Request body too large"));
				return;
			}
			chunks.push(chunk);
		});

		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf-8");
			if (!raw || raw.trim().length === 0) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(raw) as JsonBody);
			} catch {
				reject(new Error("Invalid JSON body"));
			}
		});

		req.on("error", reject);
	});
}

/** Write a JSON response. */
function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
	const body = JSON.stringify(data);
	res.writeHead(statusCode, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(body),
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
	});
	res.end(body);
}

/** Write a JSON error response. */
function errorResponse(res: ServerResponse, statusCode: number, message: string): void {
	jsonResponse(res, statusCode, { error: message, code: statusCode });
}

/** Set CORS headers for preflight requests. */
function handleCors(res: ServerResponse): void {
	res.writeHead(204, {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Max-Age": "86400",
	});
	res.end();
}

/** Extract path segments from a URL. */
function parsePath(url: string): { pathname: string; params: URLSearchParams } {
	// Use URL constructor with a dummy base for relative paths
	const parsed = new URL(url, "http://localhost");
	return { pathname: parsed.pathname, params: parsed.searchParams };
}

/** Extract text from an AgentMessage. */
function extractText(message: AgentMessage): string {
	return message.content
		.filter((p) => p.type === "text")
		.map((p) => (p as { type: "text"; text: string }).text)
		.join("");
}

// ─── Route Handlers ─────────────────────────────────────────────────────────

/**
 * POST /chat — Send a message and get a full JSON response.
 *
 * Body: { "message": "..." }
 * Response: { "response": "...", "cost": {...}, "model": "..." }
 */
async function handleChat(
	agent: Agent,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const body = await parseBody(req);
	const message = body.message as string | undefined;

	if (!message || typeof message !== "string") {
		errorResponse(res, 400, "Missing required field: message");
		return;
	}

	try {
		const response = await agent.prompt(message);
		const text = extractText(response);

		jsonResponse(res, 200, {
			response: text,
			model: response.model,
			cost: response.cost ?? null,
			messageId: response.id,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		errorResponse(res, 500, `Agent error: ${msg}`);
	}
}

/**
 * POST /chat/stream — Send a message and stream as SSE.
 *
 * Body: { "message": "..." }
 * Response: text/event-stream with data: {...} chunks
 */
async function handleChatStream(
	agent: Agent,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const body = await parseBody(req);
	const message = body.message as string | undefined;

	if (!message || typeof message !== "string") {
		errorResponse(res, 400, "Missing required field: message");
		return;
	}

	// Set SSE headers
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		"Connection": "keep-alive",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
	});

	// Helper to write an SSE event
	const sendEvent = (eventType: string, data: unknown) => {
		if (res.destroyed) return;
		const payload = JSON.stringify({ type: eventType, data });
		res.write(`data: ${payload}\n\n`);
	};

	// Wire up agent event handler for streaming
	const previousOnEvent = agent.getConfig().onEvent;

	agent.setOnEvent((event: AgentEventType, data: unknown) => {
		const eventData = data as Record<string, unknown>;

		switch (event) {
			case "stream:text":
				sendEvent("text", { text: eventData.text });
				break;
			case "stream:thinking":
				sendEvent("thinking", { text: eventData.text });
				break;
			case "tool:start":
				sendEvent("tool_start", { name: eventData.name, id: eventData.id });
				break;
			case "tool:done":
				sendEvent("tool_done", { name: eventData.name, id: eventData.id });
				break;
			case "tool:error":
				sendEvent("tool_error", { name: eventData.name, error: eventData.error });
				break;
			case "stream:usage":
				sendEvent("usage", eventData.usage);
				break;
			case "stream:done":
				sendEvent("done", {
					stopReason: eventData.stopReason,
					cost: eventData.cost,
				});
				break;
		}

		// Forward to any previous handler
		previousOnEvent?.(event, data);
	});

	try {
		const response = await agent.prompt(message);
		const text = extractText(response);

		// Final summary event
		sendEvent("complete", {
			response: text,
			model: response.model,
			cost: response.cost ?? null,
			messageId: response.id,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		sendEvent("error", { error: msg });
	} finally {
		// Restore previous event handler
		if (previousOnEvent) {
			agent.setOnEvent(previousOnEvent);
		}
		res.end();
	}
}

/**
 * GET /tools — List available tools.
 */
function handleToolsList(agent: Agent, res: ServerResponse): void {
	const state = agent.getState();
	const tools = state.tools.map((t: ToolHandler) => ({
		name: t.definition.name,
		description: t.definition.description,
		inputSchema: t.definition.inputSchema,
	}));

	jsonResponse(res, 200, { tools, count: tools.length });
}

/**
 * POST /tools/:name — Execute a tool directly.
 *
 * Body: { "args": { ... } }
 */
async function handleToolExecute(
	agent: Agent,
	toolName: string,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const state = agent.getState();
	const tool = state.tools.find((t: ToolHandler) => t.definition.name === toolName);

	if (!tool) {
		errorResponse(res, 404, `Tool not found: ${toolName}`);
		return;
	}

	const body = await parseBody(req);
	const args = (body.args as Record<string, unknown>) ?? {};

	try {
		const result = await tool.execute(args, {
			sessionId: agent.getSessionId(),
			workingDirectory: agent.getConfig().workingDirectory ?? process.cwd(),
		});

		jsonResponse(res, 200, {
			result: result.content,
			isError: result.isError ?? false,
			metadata: result.metadata ?? null,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		errorResponse(res, 500, `Tool execution error: ${msg}`);
	}
}

/**
 * GET /memory/search?q=...&limit=N — Search memory.
 */
function handleMemorySearch(params: URLSearchParams, res: ServerResponse): void {
	const query = params.get("q");
	const limitStr = params.get("limit");

	if (!query) {
		errorResponse(res, 400, "Missing required query parameter: q");
		return;
	}

	const results = searchMemory(query);
	const limit = limitStr ? parseInt(limitStr, 10) : 20;
	const limited = results.slice(0, limit);

	jsonResponse(res, 200, {
		results: limited.map((r) => ({
			content: r.content,
			relevance: r.relevance ?? 0,
			scope: r.scope,
		})),
		count: limited.length,
		total: results.length,
	});
}

/**
 * GET /sessions — List sessions.
 */
function handleSessionsList(projectPath: string | undefined, res: ServerResponse): void {
	const sessions = listSessions(projectPath);
	jsonResponse(res, 200, {
		sessions: sessions.map((s) => ({
			id: s.id,
			title: s.title,
			created: s.created,
			updated: s.updated,
			agent: s.agent,
			model: s.model,
			totalCost: s.totalCost,
			tags: s.tags,
		})),
		count: sessions.length,
	});
}

/**
 * GET /sessions/:id — Get session details.
 */
function handleSessionGet(
	sessionId: string,
	projectPath: string | undefined,
	res: ServerResponse,
): void {
	try {
		const session = loadSession(sessionId, projectPath ?? process.cwd());
		jsonResponse(res, 200, {
			meta: session.meta,
			turns: session.turns,
			turnCount: session.turns.length,
		});
	} catch {
		errorResponse(res, 404, `Session not found: ${sessionId}`);
	}
}

/**
 * GET /health — Health check.
 */
function handleHealth(agent: Agent, res: ServerResponse): void {
	const state = agent.getState();
	jsonResponse(res, 200, {
		status: "ok",
		provider: state.providerId,
		model: state.model,
		toolCount: state.tools.length,
		messageCount: state.messages.length,
		agentId: agent.id,
		timestamp: Date.now(),
	});
}

/**
 * POST /abort — Abort current agent operation.
 */
function handleAbort(agent: Agent, res: ServerResponse): void {
	agent.abort();
	jsonResponse(res, 200, { aborted: true });
}

/**
 * POST /v1/marga/decide — Stateless LLM routing decision.
 *
 * Stable contract for Vaayu (and any external consumer).
 * Returns a MargaDecision payload with provider, model, task type,
 * complexity, skipLLM flag, escalation chain, and rationale.
 *
 * Hard timeout: 150ms. Typical: <5ms (pure CPU, no I/O).
 */
async function handleMargaDecide(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await parseBody(req);
	if (!body || typeof body.message !== "string" || !body.message) {
		errorResponse(res, 400, "Request body must include a non-empty 'message' string.");
		return;
	}

	const validStrategies = ["local", "cloud", "hybrid"] as const;
	const strategy = typeof body.bindingStrategy === "string" && validStrategies.includes(body.bindingStrategy as any)
		? (body.bindingStrategy as "local" | "cloud" | "hybrid")
		: "hybrid";

	try {
		const { margaDecide } = await import("@chitragupta/swara");
		const decision = margaDecide({
			message: body.message as string,
			hasTools: Boolean(body.hasTools),
			hasImages: Boolean(body.hasImages),
			bindingStrategy: strategy,
		});
		jsonResponse(res, 200, decision);
	} catch (err) {
		errorResponse(res, 500, `Marga decision failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

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
	const { agent, port = 3000, host = "localhost", projectPath } = options;

	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		// Handle CORS preflight
		if (req.method === "OPTIONS") {
			handleCors(res);
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
			// Abort any running agent operation
			agent.abort();

			// Destroy all active connections
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

	// Graceful shutdown on SIGINT
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
