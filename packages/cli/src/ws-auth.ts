/**
 * @chitragupta/cli — WebSocket authentication and subscription helpers.
 *
 * Handles upgrade authentication (query params, protocol header, bearer token)
 * and event subscription matching (glob patterns).
 * Extracted from ws-handler.ts to keep file sizes under 450 LOC.
 */

import http from "node:http";
import type { WebSocketClient } from "./ws-types.js";

/**
 * Authenticate the upgrade request using legacy token/API key auth.
 *
 * Checks in this order:
 * 1. Query parameter `?token=xxx`
 * 2. Sec-WebSocket-Protocol header (subprotocol containing the token)
 * 3. Authorization header (Bearer token)
 *
 * @param req - The HTTP upgrade request.
 * @param authToken - Optional auth token.
 * @param apiKeys - Optional array of valid API keys.
 * @returns True if auth is disabled or the token matches.
 */
export function authenticateUpgrade(
	req: http.IncomingMessage,
	authToken?: string,
	apiKeys?: string[],
): boolean {
	const authEnabled = Boolean(authToken) || Boolean(apiKeys?.length);
	if (!authEnabled) return true;

	// 1. Query parameter ?token=xxx
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
	const queryToken = url.searchParams.get("token");

	// 2. Sec-WebSocket-Protocol header
	const protocol = req.headers["sec-websocket-protocol"];
	const protocolToken = typeof protocol === "string" ? protocol.trim() : "";

	// 3. Authorization header
	const authHeader = req.headers["authorization"] ?? "";
	const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

	// Collect all candidate tokens
	const candidates = [queryToken, protocolToken, bearer].filter(Boolean) as string[];

	for (const candidate of candidates) {
		if (authToken && candidate === authToken) return true;
		if (apiKeys?.includes(candidate)) return true;
	}

	return false;
}

/**
 * Check whether a client is subscribed to a given event type.
 *
 * If the client has no subscriptions, they receive all events.
 * Supports wildcard patterns like "agent:*" or "*".
 *
 * @param client - The WebSocket client.
 * @param event - The event type string.
 * @returns True if the client should receive this event.
 */
export function clientSubscribedTo(client: WebSocketClient, event: string): boolean {
	if (client.subscriptions.length === 0) return true;

	for (const pattern of client.subscriptions) {
		if (pattern === "*") return true;
		if (pattern === event) return true;
		if (pattern.endsWith("*")) {
			const prefix = pattern.slice(0, -1);
			if (event.startsWith(prefix)) return true;
		}
	}

	return false;
}
