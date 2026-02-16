/**
 * Darpana HTTP server — raw node:http, <5ms proxy overhead.
 *
 * Routes:
 *   POST /v1/messages            — main proxy endpoint (streaming + non-streaming)
 *   POST /v1/messages/count_tokens — token counting (passthrough)
 *   GET  /                        — health check
 */
import http from "node:http";
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DarpanaConfig, AnthropicRequest, AnthropicResponse } from "./types.js";
import { resolveRoute } from "./router.js";
import { toOpenAI, fromOpenAI } from "./converters/openai.js";
import { toGemini, fromGemini, buildGeminiUrl } from "./converters/google.js";
import { toPassthrough, fromPassthrough } from "./converters/passthrough.js";
import { sendUpstream, buildUpstreamUrl, buildUpstreamHeaders } from "./upstream.js";
import { pipeStream } from "./stream.js";

const MAX_REQUEST_BODY = 10 * 1024 * 1024; // 10MB
const GRACEFUL_SHUTDOWN_TIMEOUT = 30_000; // 30s

export interface DarpanaServer {
	listen(): Promise<void>;
	close(): Promise<void>;
	readonly address: { host: string; port: number } | null;
}

export function createServer(config: DarpanaConfig): DarpanaServer {
	let server: http.Server | null = null;
	let addr: { host: string; port: number } | null = null;

	let activeRequests = 0;

	const httpServer = http.createServer(async (req, res) => {
		activeRequests++;

		// Generate or propagate request ID
		const requestId = (req.headers["x-request-id"] as string) ?? crypto.randomUUID();
		res.setHeader("x-request-id", requestId);

		// CORS
		if (config.cors !== false) {
			res.setHeader("access-control-allow-origin", "*");
			res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
			res.setHeader("access-control-allow-headers", "content-type, x-api-key, authorization, anthropic-version, anthropic-beta, x-request-id");
		}

		try {
			if (req.method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}

			const url = req.url ?? "/";

			if (req.method === "GET" && url === "/") {
				handleHealthCheck(res, config);
				return;
			}

			// Auth check
			if (config.auth?.apiKey) {
				const provided = req.headers["x-api-key"] as string
					?? (req.headers.authorization as string)?.replace(/^Bearer\s+/i, "");
				if (!provided || !timingSafeEqual(provided, config.auth.apiKey)) {
					sendError(res, 401, "authentication_error", "Invalid API key");
					return;
				}
			}

			if (req.method === "POST" && (url === "/v1/messages" || url === "/v1/messages/count_tokens")) {
				await handleMessages(req, res, config, url, requestId);
				return;
			}

			sendError(res, 404, "not_found", `Route not found: ${req.method} ${url}`);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Internal server error";
			sendError(res, 500, "internal_error", sanitizeError(message));
		} finally {
			activeRequests--;
		}
	});

	// Server-level timeouts
	httpServer.headersTimeout = 30_000;
	httpServer.requestTimeout = 300_000; // 5min for long-running LLM requests

	return {
		async listen() {
			return new Promise<void>((resolve, reject) => {
				httpServer.on("error", reject);
				httpServer.listen(config.port, config.host, () => {
					addr = { host: config.host, port: config.port };
					server = httpServer;
					resolve();
				});
			});
		},
		async close() {
			if (server) {
				return new Promise<void>((resolve) => {
					// Stop accepting new connections
					server!.close(() => {
						addr = null;
						server = null;
						resolve();
					});

					// Wait for in-flight requests to drain (up to timeout)
					if (activeRequests > 0) {
						const check = setInterval(() => {
							if (activeRequests <= 0) {
								clearInterval(check);
							}
						}, 100);
						setTimeout(() => {
							clearInterval(check);
							server?.closeAllConnections?.();
						}, GRACEFUL_SHUTDOWN_TIMEOUT);
					}
				});
			}
		},
		get address() { return addr; },
	};
}

// ─── Route Handlers ────────────────────────────────────────────────

function handleHealthCheck(res: ServerResponse, config: DarpanaConfig): void {
	const providers = Object.entries(config.providers).map(([name, p]) => ({
		name,
		type: p.type,
		models: p.models ? Object.keys(p.models) : ["*"],
	}));

	res.writeHead(200, { "content-type": "application/json" });
	res.end(JSON.stringify({
		status: "ok",
		service: "darpana",
		version: "0.1.0",
		providers,
		aliases: config.aliases,
	}));
}

async function handleMessages(
	req: IncomingMessage,
	res: ServerResponse,
	config: DarpanaConfig,
	url: string,
	requestId: string,
): Promise<void> {
	// Read + validate request body
	const body = await readBody(req, MAX_REQUEST_BODY);
	if (!body) {
		sendError(res, 413, "request_too_large", "Request body exceeds 10MB limit");
		return;
	}

	let anthropicReq: AnthropicRequest;
	try {
		anthropicReq = JSON.parse(body.toString()) as AnthropicRequest;
	} catch {
		sendError(res, 400, "invalid_request_body", "Request body must be valid JSON");
		return;
	}

	// Validate required fields
	if (!anthropicReq.model || typeof anthropicReq.model !== "string") {
		sendError(res, 400, "invalid_request", "model field is required and must be a string");
		return;
	}
	if (!anthropicReq.messages || !Array.isArray(anthropicReq.messages) || anthropicReq.messages.length === 0) {
		sendError(res, 400, "invalid_request", "messages array is required and must not be empty");
		return;
	}
	if (url === "/v1/messages" && (typeof anthropicReq.max_tokens !== "number" || anthropicReq.max_tokens < 1)) {
		sendError(res, 400, "invalid_request", "max_tokens is required and must be a positive number");
		return;
	}

	const isStream = anthropicReq.stream === true;

	// Resolve route
	let route;
	try {
		route = resolveRoute(anthropicReq.model, config);
	} catch (err) {
		sendError(res, 400, "invalid_request", (err as Error).message);
		return;
	}

	const { provider, upstreamModel, providerName } = route;
	const overrides = provider.models?.[upstreamModel];

	// Log request
	logRequest(req.method ?? "POST", url, anthropicReq.model, `${providerName}/${upstreamModel}`, anthropicReq.messages.length, anthropicReq.tools?.length ?? 0);

	// Convert request based on provider type
	let upstreamBody: Buffer;
	let upstreamUrl: string;

	switch (provider.type) {
		case "openai-compat": {
			const openaiReq = toOpenAI(anthropicReq, upstreamModel, overrides);
			upstreamBody = Buffer.from(JSON.stringify(openaiReq));
			upstreamUrl = buildUpstreamUrl(provider, url);
			break;
		}
		case "google": {
			const geminiReq = toGemini(anthropicReq, upstreamModel, overrides);
			upstreamBody = Buffer.from(JSON.stringify(geminiReq));
			upstreamUrl = buildGeminiUrl(upstreamModel, isStream, provider.apiKey ?? "");
			break;
		}
		case "passthrough": {
			const passthroughReq = toPassthrough(anthropicReq, upstreamModel);
			upstreamBody = Buffer.from(JSON.stringify(passthroughReq));
			upstreamUrl = buildUpstreamUrl(provider, url);
			break;
		}
		default:
			sendError(res, 500, "config_error", `Unknown provider type: ${provider.type}`);
			return;
	}

	const headers = buildUpstreamHeaders(provider, upstreamBody.length, isStream, req.headers, requestId);

	let upstreamRes;
	try {
		upstreamRes = await sendUpstream(
			{ url: upstreamUrl, method: "POST", headers, body: upstreamBody, timeout: provider.timeout },
			provider,
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Upstream connection failed";
		sendError(res, 502, "upstream_connection_error", `Failed to connect to ${providerName}: ${sanitizeError(msg)}`);
		return;
	}

	// Check for upstream errors
	if (upstreamRes.statusCode >= 400) {
		const errBody = await readBody(upstreamRes.body);
		const statusCode = upstreamRes.statusCode;

		// Pass through rate limit headers
		const retryAfter = upstreamRes.headers["retry-after"];
		const rateHeaders: Record<string, string> = { "content-type": "application/json" };
		if (retryAfter) rateHeaders["retry-after"] = String(retryAfter);

		res.writeHead(statusCode, rateHeaders);
		res.end(JSON.stringify({
			type: "error",
			error: {
				type: statusCode === 429 ? "rate_limit_error" : "upstream_error",
				message: `${providerName} returned ${statusCode}: ${errBody ? errBody.toString().slice(0, 500) : "empty response"}`,
			},
		}));
		return;
	}

	// Stream or non-stream response
	if (isStream) {
		pipeStream(upstreamRes.body, res, provider.type, anthropicReq.model);
	} else {
		const resBody = await readBody(upstreamRes.body);
		if (!resBody || resBody.length === 0) {
			sendError(res, 502, "upstream_error", `${providerName} returned empty response`);
			return;
		}

		let parsed: any;
		try {
			parsed = JSON.parse(resBody.toString());
		} catch {
			sendError(res, 502, "upstream_error", `${providerName} returned invalid JSON`);
			return;
		}

		let anthropicRes: AnthropicResponse;
		switch (provider.type) {
			case "openai-compat":
				anthropicRes = fromOpenAI(parsed, anthropicReq.model);
				break;
			case "google":
				anthropicRes = fromGemini(parsed, anthropicReq.model);
				break;
			case "passthrough":
				anthropicRes = fromPassthrough(parsed);
				break;
			default:
				sendError(res, 500, "config_error", "Unknown provider type");
				return;
		}

		// Ensure content is never empty (like Python version)
		if (anthropicRes.content.length === 0) {
			anthropicRes.content = [{ type: "text", text: "" }];
		}

		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(anthropicRes));
	}
}

// ─── Helpers ───────────────────────────────────────────────────────

function readBody(stream: IncomingMessage, maxSize?: number): Promise<Buffer | null> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let totalSize = 0;
		let settled = false;

		stream.on("data", (c: Buffer) => {
			totalSize += c.length;
			if (maxSize && totalSize > maxSize) {
				stream.destroy();
				if (!settled) {
					settled = true;
					resolve(null);
				}
				return;
			}
			chunks.push(c);
		});
		stream.on("end", () => {
			if (!settled) {
				settled = true;
				resolve(Buffer.concat(chunks));
			}
		});
		stream.on("error", (err) => {
			if (!settled) {
				settled = true;
				reject(err);
			}
		});
	});
}

function sendError(res: ServerResponse, status: number, type: string, message: string): void {
	if (!res.headersSent) {
		res.writeHead(status, { "content-type": "application/json" });
	}
	res.end(JSON.stringify({ type: "error", error: { type, message } }));
}

/**
 * Constant-time string comparison to prevent timing attacks on auth tokens.
 * Hashes both inputs to a fixed 32-byte SHA-256 digest before comparison,
 * eliminating length leakage entirely.
 */
function timingSafeEqual(a: string, b: string): boolean {
	const hashA = crypto.createHash("sha256").update(a).digest();
	const hashB = crypto.createHash("sha256").update(b).digest();
	return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Sanitize error messages to prevent credential leakage.
 * Redacts common API key patterns.
 */
function sanitizeError(message: string): string {
	return message
		.replace(/sk-[a-zA-Z0-9_-]{20,}/g, "sk-***")
		.replace(/AIza[a-zA-Z0-9_-]{30,}/g, "AIza***")
		.replace(/gsk_[a-zA-Z0-9_-]{20,}/g, "gsk_***")
		.replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/gi, "Bearer ***")
		.replace(/key=[a-zA-Z0-9_-]{20,}/g, "key=***");
}

/**
 * Log request in a concise colorized format (like Python version's log_request_beautifully).
 */
function logRequest(
	method: string,
	path: string,
	clientModel: string,
	upstreamModel: string,
	messageCount: number,
	toolCount: number,
): void {
	// Strip provider prefix from client model for display
	const clientDisplay = clientModel.replace(/^anthropic\//, "");
	const upstream = `\x1b[32m${upstreamModel}\x1b[0m`;
	const client = `\x1b[36m${clientDisplay}\x1b[0m`;
	const tools = toolCount > 0 ? ` \x1b[35m${toolCount} tools\x1b[0m` : "";
	const msgs = `\x1b[34m${messageCount} msgs\x1b[0m`;

	process.stdout.write(`  ${method} ${path} ${client} \x1b[2m→\x1b[0m ${upstream} ${msgs}${tools}\n`);
}
