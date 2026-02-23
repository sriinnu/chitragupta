/**
 * Type definitions and constants for the EventManager (Vaarta) module.
 *
 * @module event-manager-types
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export interface SSEClient {
	/** Unique client identifier. */
	id: string;
	/** Write an SSE event to this client. */
	send(event: string, data: unknown, eventId?: string): void;
	/** Close this client's connection. */
	close(): void;
	/** Whether this client is still connected. */
	isConnected: boolean;
}

export interface WebhookConfig {
	/** Unique webhook identifier. */
	id: string;
	/** Target URL to POST events to. */
	url: string;
	/** Event topics this webhook subscribes to. */
	events: string[];
	/** Optional HMAC-SHA256 signing secret. */
	secret?: string;
	/** Number of retry attempts on failure. Default: 3 */
	retries?: number;
	/** Request timeout in ms. Default: 10000 */
	timeout?: number;
	/** Whether this webhook is active. */
	active: boolean;
}

export interface WebhookDelivery {
	/** Unique delivery identifier. */
	id: string;
	/** The webhook this delivery belongs to. */
	webhookId: string;
	/** The event topic that triggered the delivery. */
	event: string;
	/** The payload delivered. */
	payload: unknown;
	/** Current delivery status. */
	status: "pending" | "success" | "failed";
	/** Number of attempts made. */
	attempts: number;
	/** Timestamp of the last attempt. */
	lastAttempt?: number;
	/** Response from the last attempt. */
	response?: { status: number; body: string };
}

export interface EventManagerConfig {
	/** Maximum number of SSE clients. Default: 100 */
	maxSSEClients?: number;
	/** Maximum number of webhooks. Default: 50 */
	maxWebhooks?: number;
	/** Maximum delivery history per webhook (ring buffer). Default: 100 */
	maxDeliveriesPerWebhook?: number;
	/** Default retry count for webhooks. Default: 3 */
	defaultRetries?: number;
	/** Default timeout in ms for webhook requests. Default: 10000 */
	defaultTimeout?: number;
	/** HMAC signing header name. Default: "x-chitragupta-signature" */
	signatureHeader?: string;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

export interface SSEClientInternal {
	id: string;
	writeFn: (data: string) => void;
	closeFn: () => void;
	connected: boolean;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_EVENT_MANAGER_CONFIG: Required<EventManagerConfig> = {
	maxSSEClients: 100,
	maxWebhooks: 50,
	maxDeliveriesPerWebhook: 100,
	defaultRetries: 3,
	defaultTimeout: 10_000,
	signatureHeader: "x-chitragupta-signature",
};
