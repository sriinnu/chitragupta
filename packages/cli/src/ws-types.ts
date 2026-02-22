/**
 * @chitragupta/cli — WebSocket public type definitions.
 *
 * Shared types for WebSocket client, message, server options, and events.
 * Extracted from ws-handler.ts to break circular imports.
 */

import type { AuthContext } from "@chitragupta/core";
import type { AuthMiddlewareConfig } from "@chitragupta/core";

// ─── Public Types ───────────────────────────────────────────────────────────

export interface WebSocketClient {
	/** Unique client identifier. */
	id: string;
	/** Send a structured message to this client. */
	send(data: unknown): void;
	/** Close the connection with an optional code and reason. */
	close(code?: number, reason?: string): void;
	/** Register a handler for incoming messages. */
	onMessage(handler: (msg: WebSocketMessage) => void): void;
	/** Register a handler for connection close. */
	onClose(handler: () => void): void;
	/** Whether the connection is still alive (responded to last ping). */
	isAlive: boolean;
	/** Event subscriptions for this client (glob patterns). */
	subscriptions: string[];
	/** Authenticated user context (set by Dvarpalaka auth). */
	authContext?: AuthContext;
}

export interface WebSocketMessage {
	/** Message type: "chat", "abort", "subscribe", "ping", etc. */
	type: string;
	/** Message payload. */
	data?: unknown;
	/** Client-provided request correlation ID. */
	requestId?: string;
}

export interface WebSocketServerOptions {
	/** Auth token required on upgrade. Omit to disable auth. */
	authToken?: string;
	/** Array of valid API keys. Checked alongside authToken. */
	apiKeys?: string[];
	/** Heartbeat ping interval in ms. Default: 30000. */
	pingInterval?: number;
	/** Maximum simultaneous connections. Default: 10. */
	maxConnections?: number;
	/** Enable logging to stdout. Default: false. */
	enableLogging?: boolean;
	/**
	 * Dvarpalaka auth middleware configuration.
	 * When set, uses JWT + RBAC auth for WebSocket upgrade.
	 * Falls back to legacy authToken/apiKeys when not set.
	 */
	auth?: AuthMiddlewareConfig;
}

export interface WebSocketServerEvents {
	/** Called when a new client connects. */
	onConnect?: (client: WebSocketClient) => void;
	/** Called when a client disconnects. */
	onDisconnect?: (clientId: string) => void;
	/** Called when a message is received from any client. */
	onMessage?: (client: WebSocketClient, msg: WebSocketMessage) => void;
}


