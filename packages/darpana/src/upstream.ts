/**
 * Darpana upstream client — HTTP(S) with keep-alive pools and retry.
 */
import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { ProviderConfig } from "./types.js";

/** Keep-alive agents per scheme, reused across requests. */
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 10 });

export interface UpstreamRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: Buffer;
	timeout?: number;
}

export interface UpstreamResponse {
	statusCode: number;
	headers: Record<string, string | string[] | undefined>;
	body: IncomingMessage;
}

/** Transient HTTP status codes that are safe to retry. */
const RETRYABLE_CODES = new Set([408, 429, 500, 502, 503]);

/**
 * Send a request upstream and return the raw response stream.
 * Retries once on transient failures with exponential backoff.
 */
export async function sendUpstream(
	req: UpstreamRequest,
	provider: ProviderConfig,
): Promise<UpstreamResponse> {
	const maxRetries = provider.maxRetries ?? 1;
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const res = await doRequest(req);

			if (attempt < maxRetries && RETRYABLE_CODES.has(res.statusCode)) {
				// Drain the response body before retrying
				res.body.resume();
				const delay = backoffWithJitter(attempt);
				await sleep(delay);
				continue;
			}

			return res;
		} catch (err) {
			lastError = err as Error;
			if (attempt < maxRetries) {
				const delay = backoffWithJitter(attempt);
				await sleep(delay);
				continue;
			}
		}
	}

	throw lastError ?? new Error("Upstream request failed");
}

function doRequest(req: UpstreamRequest): Promise<UpstreamResponse> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(req.url);
		const isHttps = parsed.protocol === "https:";
		const lib = isHttps ? https : http;
		const agent = isHttps ? httpsAgent : httpAgent;

		const options: http.RequestOptions = {
			method: req.method,
			hostname: parsed.hostname,
			port: parsed.port || (isHttps ? 443 : 80),
			path: parsed.pathname + parsed.search,
			headers: req.headers,
			agent,
			timeout: req.timeout ?? 120_000,
		};

		const outgoing = lib.request(options, (res) => {
			resolve({
				statusCode: res.statusCode ?? 500,
				headers: res.headers as Record<string, string | string[] | undefined>,
				body: res,
			});
		});

		outgoing.on("error", reject);
		outgoing.on("timeout", () => {
			outgoing.destroy(new Error("Upstream request timed out"));
		});

		outgoing.end(req.body);
	});
}

/** Exponential backoff with ±25% jitter. */
function backoffWithJitter(attempt: number): number {
	const base = Math.min(1000 * 2 ** attempt, 4000);
	const jitter = base * 0.25 * (2 * Math.random() - 1); // ±25%
	return Math.max(100, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build the full upstream URL for a provider.
 */
export function buildUpstreamUrl(provider: ProviderConfig, path: string): string {
	if (provider.type === "google") {
		// Gemini API: https://generativelanguage.googleapis.com/v1beta/models/{model}:{method}?key={key}
		return path; // Caller builds the full URL for Gemini
	}

	if (provider.type === "passthrough") {
		const base = provider.endpoint ?? "https://api.anthropic.com";
		return `${base.replace(/\/$/, "")}${path}`;
	}

	// openai-compat
	const base = provider.endpoint ?? "https://api.openai.com/v1";
	return `${base.replace(/\/$/, "")}/chat/completions`;
}

/** Headers safe to forward from client to upstream in passthrough mode. */
const PASSTHROUGH_HEADER_PREFIXES = ["anthropic-", "x-stainless-"];
const PASSTHROUGH_HEADER_EXACT = new Set(["x-request-id"]);

/**
 * Build headers for upstream request.
 */
export function buildUpstreamHeaders(
	provider: ProviderConfig,
	contentLength: number,
	isStream: boolean,
	clientHeaders?: Record<string, string | string[] | undefined>,
	requestId?: string,
): Record<string, string> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
		"content-length": String(contentLength),
		accept: isStream ? "text/event-stream" : "application/json",
		"user-agent": "darpana/0.1.0",
	};

	if (requestId) {
		headers["x-request-id"] = requestId;
	}

	if (provider.type === "passthrough") {
		if (provider.apiKey) headers["x-api-key"] = provider.apiKey;
		headers["anthropic-version"] = "2023-06-01";

		// Forward safe client headers (anthropic-beta, etc.)
		if (clientHeaders) {
			for (const [key, val] of Object.entries(clientHeaders)) {
				const lower = key.toLowerCase();
				const shouldForward = PASSTHROUGH_HEADER_EXACT.has(lower)
					|| PASSTHROUGH_HEADER_PREFIXES.some((p) => lower.startsWith(p));
				if (shouldForward && val) {
					headers[lower] = Array.isArray(val) ? val[0] : val;
				}
			}
		}
	} else if (provider.type === "openai-compat") {
		if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
	}
	// Google uses ?key= query param, not a header

	// Merge any custom headers (highest priority — overrides everything)
	if (provider.headers) {
		Object.assign(headers, provider.headers);
	}

	return headers;
}
