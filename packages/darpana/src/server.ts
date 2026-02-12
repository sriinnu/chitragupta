/**
 * Darpana HTTP server — raw node:http, <5ms proxy overhead.
 *
 * Routes:
 *   POST /v1/messages            — main proxy endpoint (streaming + non-streaming)
 *   POST /v1/messages/count_tokens — token counting (passthrough only)
 *   GET  /                        — health check
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DarpanaConfig, AnthropicRequest, AnthropicResponse } from "./types.js";
import { resolveRoute } from "./router.js";
import { toOpenAI, fromOpenAI } from "./converters/openai.js";
import { toGemini, fromGemini, buildGeminiUrl } from "./converters/google.js";
import { toPassthrough, fromPassthrough } from "./converters/passthrough.js";
import { sendUpstream, buildUpstreamUrl, buildUpstreamHeaders } from "./upstream.js";
import { pipeStream } from "./stream.js";

export interface DarpanaServer {
	listen(): Promise<void>;
	close(): Promise<void>;
	readonly address: { host: string; port: number } | null;
}

export function createServer(config: DarpanaConfig): DarpanaServer {
	let server: http.Server | null = null;
	let addr: { host: string; port: number } | null = null;

	const httpServer = http.createServer(async (req, res) => {
		// CORS
		if (config.cors !== false) {
			res.setHeader("access-control-allow-origin", "*");
			res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
			res.setHeader("access-control-allow-headers", "content-type, x-api-key, authorization, anthropic-version, anthropic-beta");
		}

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		try {
			const url = req.url ?? "/";

			if (req.method === "GET" && url === "/") {
				handleHealthCheck(res, config);
				return;
			}

			// Auth check
			if (config.auth?.apiKey) {
				const provided = req.headers["x-api-key"] as string
					?? (req.headers.authorization as string)?.replace(/^Bearer\s+/i, "");
				if (provided !== config.auth.apiKey) {
					sendError(res, 401, "authentication_error", "Invalid API key");
					return;
				}
			}

			if (req.method === "POST" && (url === "/v1/messages" || url === "/v1/messages/count_tokens")) {
				await handleMessages(req, res, config, url);
				return;
			}

			sendError(res, 404, "not_found", `Route not found: ${req.method} ${url}`);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Internal server error";
			sendError(res, 500, "internal_error", message);
		}
	});

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
					server!.close(() => {
						addr = null;
						server = null;
						resolve();
					});
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
): Promise<void> {
	// Read request body
	const body = await readBody(req);
	const anthropicReq = JSON.parse(body.toString()) as AnthropicRequest;
	const isStream = anthropicReq.stream === true;

	// Resolve route
	const route = resolveRoute(anthropicReq.model, config);
	const { provider, upstreamModel, providerName } = route;
	const overrides = provider.models?.[upstreamModel];

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

	const headers = buildUpstreamHeaders(provider, upstreamBody.length, isStream);
	const upstreamRes = await sendUpstream(
		{ url: upstreamUrl, method: "POST", headers, body: upstreamBody, timeout: provider.timeout },
		provider,
	);

	// Check for upstream errors
	if (upstreamRes.statusCode >= 400) {
		const errBody = await readBody(upstreamRes.body);
		const statusCode = upstreamRes.statusCode;
		res.writeHead(statusCode, { "content-type": "application/json" });
		res.end(JSON.stringify({
			type: "error",
			error: {
				type: "upstream_error",
				message: `${providerName} returned ${statusCode}: ${errBody.toString().slice(0, 500)}`,
			},
		}));
		return;
	}

	// Stream or non-stream response
	if (isStream) {
		pipeStream(upstreamRes.body, res, provider.type, anthropicReq.model);
	} else {
		const resBody = await readBody(upstreamRes.body);
		const parsed = JSON.parse(resBody.toString());

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
				sendError(res, 500, "config_error", `Unknown provider type`);
				return;
		}

		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(anthropicRes));
	}
}

// ─── Helpers ───────────────────────────────────────────────────────

function readBody(stream: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		stream.on("data", (c: Buffer) => chunks.push(c));
		stream.on("end", () => resolve(Buffer.concat(chunks)));
		stream.on("error", reject);
	});
}

function sendError(res: ServerResponse, status: number, type: string, message: string): void {
	if (!res.headersSent) {
		res.writeHead(status, { "content-type": "application/json" });
	}
	res.end(JSON.stringify({ type: "error", error: { type, message } }));
}
