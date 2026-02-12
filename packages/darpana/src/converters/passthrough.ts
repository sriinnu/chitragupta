/**
 * Passthrough converter — Anthropic → Anthropic.
 *
 * Minimal transformation: just forwards the request body.
 * Useful as a logging/auth wrapper around the real Anthropic API.
 */
import type { AnthropicRequest, AnthropicResponse, AnthropicSSEEvent } from "../types.js";

/**
 * Pass through request unchanged. Only overrides the model if an alias was used.
 */
export function toPassthrough(req: AnthropicRequest, upstreamModel: string): AnthropicRequest {
	if (upstreamModel !== req.model) {
		return { ...req, model: upstreamModel };
	}
	return req;
}

/**
 * Pass through response unchanged.
 */
export function fromPassthrough(res: AnthropicResponse): AnthropicResponse {
	return res;
}

/**
 * Parse an Anthropic SSE line into an event object.
 * Returns null for non-data lines.
 */
export function parseAnthropicSSELine(line: string): AnthropicSSEEvent | null {
	if (!line.startsWith("data: ")) return null;
	const data = line.slice(6).trim();
	if (!data || data === "[DONE]") return null;
	try {
		return JSON.parse(data) as AnthropicSSEEvent;
	} catch {
		return null;
	}
}
