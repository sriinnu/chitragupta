/**
 * @chitragupta/cli — HTTP Server route handlers.
 *
 * Extracted from server.ts to stay within the 450 LOC limit.
 * Contains all individual route handler functions for the REST API.
 *
 * @packageDocumentation
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Agent, AgentEventType, AgentMessage, ToolHandler } from "@chitragupta/anina";
import { listSessions, loadSession } from "@chitragupta/smriti/session-store";
import { searchMemory } from "@chitragupta/smriti/search";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Default CORS origins allowed in development.
 * Production deployments must supply an explicit allowlist via `corsOrigins`.
 */
const DEFAULT_CORS_ORIGINS: readonly string[] = [
	"http://localhost:3000",
	"http://localhost:5173",
];

/** Resolved CORS origin allowlist. Set via {@link configureCorsOrigins}. */
let allowedCorsOrigins: readonly string[] = DEFAULT_CORS_ORIGINS;

/**
 * Configure the CORS origin allowlist used by route helpers.
 *
 * Call this once at startup before any requests are handled.
 * Passing `undefined` resets to the dev defaults.
 */
export function configureCorsOrigins(origins?: readonly string[]): void {
	allowedCorsOrigins = origins ?? DEFAULT_CORS_ORIGINS;
}

/**
 * Resolve the CORS origin header value for the given request origin.
 * Returns the origin if it appears in the allowlist, or an empty string
 * (meaning "do not set the header") if it is not allowed.
 */
function resolveCorsOrigin(requestOrigin: string | undefined): string {
	if (!requestOrigin) return "";
	if (allowedCorsOrigins.some((allowed) => requestOrigin.startsWith(allowed))) {
		return requestOrigin;
	}
	return "";
}

export interface ServerModeOptions {
	agent: Agent;
	port?: number;
	host?: string;
	/** Project path for session/memory scoping */
	projectPath?: string;
	/** Explicit CORS origin allowlist. Defaults to localhost dev origins. */
	corsOrigins?: string[];
}

interface JsonBody {
	[key: string]: unknown;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse JSON from an IncomingMessage body. */
export function parseBody(req: IncomingMessage): Promise<JsonBody> {
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

/** Write a JSON response with origin-validated CORS headers. */
export function jsonResponse(
	res: ServerResponse,
	statusCode: number,
	data: unknown,
	requestOrigin?: string,
): void {
	const body = JSON.stringify(data);
	const corsOrigin = resolveCorsOrigin(requestOrigin);
	const headers: Record<string, string | number> = {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(body),
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
	};
	if (corsOrigin) {
		headers["Access-Control-Allow-Origin"] = corsOrigin;
		headers["Vary"] = "Origin";
	}
	res.writeHead(statusCode, headers);
	res.end(body);
}

/** Write a JSON error response. */
export function errorResponse(res: ServerResponse, statusCode: number, message: string): void {
	jsonResponse(res, statusCode, { error: message, code: statusCode });
}

/** Set CORS headers for preflight requests with origin validation. */
export function handleCors(res: ServerResponse, requestOrigin?: string): void {
	const corsOrigin = resolveCorsOrigin(requestOrigin);
	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Max-Age": "86400",
	};
	if (corsOrigin) {
		headers["Access-Control-Allow-Origin"] = corsOrigin;
		headers["Vary"] = "Origin";
	}
	res.writeHead(204, headers);
	res.end();
}

/** Extract path segments from a URL. */
export function parsePath(url: string): { pathname: string; params: URLSearchParams } {
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
export async function handleChat(
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
export async function handleChatStream(
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

	const corsOrigin = resolveCorsOrigin(req.headers.origin);
	const sseHeaders: Record<string, string> = {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		"Connection": "keep-alive",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
	};
	if (corsOrigin) {
		sseHeaders["Access-Control-Allow-Origin"] = corsOrigin;
		sseHeaders["Vary"] = "Origin";
	}
	res.writeHead(200, sseHeaders);

	const sendEvent = (eventType: string, data: unknown) => {
		if (res.destroyed) return;
		const payload = JSON.stringify({ type: eventType, data });
		res.write(`data: ${payload}\n\n`);
	};

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
				sendEvent("done", { stopReason: eventData.stopReason, cost: eventData.cost });
				break;
		}

		previousOnEvent?.(event, data);
	});

	try {
		const response = await agent.prompt(message);
		const text = extractText(response);
		sendEvent("complete", {
			response: text, model: response.model,
			cost: response.cost ?? null, messageId: response.id,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		sendEvent("error", { error: msg });
	} finally {
		if (previousOnEvent) agent.setOnEvent(previousOnEvent);
		res.end();
	}
}

/** GET /tools — List available tools. */
export function handleToolsList(agent: Agent, res: ServerResponse): void {
	const state = agent.getState();
	const tools = state.tools.map((t: ToolHandler) => ({
		name: t.definition.name,
		description: t.definition.description,
		inputSchema: t.definition.inputSchema,
	}));
	jsonResponse(res, 200, { tools, count: tools.length });
}

/** POST /tools/:name — Execute a tool directly. */
export async function handleToolExecute(
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
			result: result.content, isError: result.isError ?? false,
			metadata: result.metadata ?? null,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		errorResponse(res, 500, `Tool execution error: ${msg}`);
	}
}

/** GET /memory/search?q=...&limit=N — Search memory. */
export function handleMemorySearch(params: URLSearchParams, res: ServerResponse): void {
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
			content: r.content, relevance: r.relevance ?? 0, scope: r.scope,
		})),
		count: limited.length,
		total: results.length,
	});
}

/** GET /sessions — List sessions. */
export function handleSessionsList(projectPath: string | undefined, res: ServerResponse): void {
	const sessions = listSessions(projectPath);
	jsonResponse(res, 200, {
		sessions: sessions.map((s) => ({
			id: s.id, title: s.title, created: s.created, updated: s.updated,
			agent: s.agent, model: s.model, totalCost: s.totalCost, tags: s.tags,
		})),
		count: sessions.length,
	});
}

/** GET /sessions/:id — Get session details. */
export function handleSessionGet(
	sessionId: string,
	projectPath: string | undefined,
	res: ServerResponse,
): void {
	try {
		const session = loadSession(sessionId, projectPath ?? process.cwd());
		jsonResponse(res, 200, {
			meta: session.meta, turns: session.turns, turnCount: session.turns.length,
		});
	} catch {
		errorResponse(res, 404, `Session not found: ${sessionId}`);
	}
}

/** GET /health — Health check. */
export function handleHealth(agent: Agent, res: ServerResponse): void {
	const state = agent.getState();
	jsonResponse(res, 200, {
		status: "ok", provider: state.providerId, model: state.model,
		toolCount: state.tools.length, messageCount: state.messages.length,
		agentId: agent.id, timestamp: Date.now(),
	});
}

/** POST /abort — Abort current agent operation. */
export function handleAbort(agent: Agent, res: ServerResponse): void {
	agent.abort();
	jsonResponse(res, 200, { aborted: true });
}

/**
 * POST /v1/marga/decide — Stateless LLM routing decision.
 *
 * Stable contract for Vaayu (and any external consumer).
 * Hard timeout: 150ms. Typical: <5ms (pure CPU, no I/O).
 */
export async function handleMargaDecide(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await parseBody(req);
	if (!body || typeof body.message !== "string" || !body.message) {
		errorResponse(res, 400, "Request body must include a non-empty 'message' string.");
		return;
	}

	const validStrategies = ["local", "cloud", "hybrid"] as const;
	const strategy = typeof body.bindingStrategy === "string" && validStrategies.includes(body.bindingStrategy as "local" | "cloud" | "hybrid")
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
