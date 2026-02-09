/**
 * Vaarta — Event streaming and webhook manager.
 * Sanskrit: Vaarta (वार्ता) = news, report, communication.
 *
 * Manages SSE streams for real-time event delivery to external clients
 * and webhook dispatch for event-driven integrations.
 *
 * Two complementary pathways:
 *   - SSE (Server-Sent Events): push-based streaming to connected clients,
 *     like a river (nadi) that flows continuously to all who listen.
 *   - Webhooks: fire-and-forget HTTP callbacks with retry, like a messenger
 *     (duta) dispatched to deliver a decree to a distant kingdom.
 */

import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Internal ────────────────────────────────────────────────────────────────

interface SSEClientInternal {
	id: string;
	writeFn: (data: string) => void;
	closeFn: () => void;
	connected: boolean;
}

/** Ring buffer for delivery history. */
class DeliveryRingBuffer {
	private readonly buffer: (WebhookDelivery | undefined)[];
	private head = 0;
	private count = 0;

	constructor(private readonly capacity: number) {
		this.buffer = new Array<WebhookDelivery | undefined>(capacity);
	}

	push(item: WebhookDelivery): void {
		this.buffer[this.head] = item;
		this.head = (this.head + 1) % this.capacity;
		if (this.count < this.capacity) this.count++;
	}

	toArray(limit?: number): WebhookDelivery[] {
		const total = limit !== undefined ? Math.min(limit, this.count) : this.count;
		const result: WebhookDelivery[] = [];
		const start = this.count < this.capacity ? 0 : this.head;
		const offset = this.count - total;
		for (let i = 0; i < total; i++) {
			const idx = (start + offset + i) % this.capacity;
			result.push(this.buffer[idx] as WebhookDelivery);
		}
		return result;
	}

	clear(): void {
		this.buffer.fill(undefined);
		this.head = 0;
		this.count = 0;
	}
}

// ─── EventManager ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<EventManagerConfig> = {
	maxSSEClients: 100,
	maxWebhooks: 50,
	maxDeliveriesPerWebhook: 100,
	defaultRetries: 3,
	defaultTimeout: 10_000,
	signatureHeader: "x-chitragupta-signature",
};

/**
 * Event streaming and webhook manager for external integrations.
 *
 * @example
 * ```ts
 * const manager = new EventManager();
 *
 * // SSE streaming
 * const client = manager.addSSEClient(
 *   (data) => response.write(data),
 *   () => response.end(),
 * );
 * manager.broadcastSSE("status", { running: true });
 *
 * // Webhooks
 * const whId = manager.addWebhook({
 *   url: "https://example.com/hook",
 *   events: ["agent:complete"],
 *   active: true,
 * });
 * await manager.dispatchWebhook("agent:complete", { result: "ok" });
 * ```
 */
export class EventManager {
	private readonly config: Required<EventManagerConfig>;
	private readonly sseClients = new Map<string, SSEClientInternal>();
	private readonly webhooks = new Map<string, WebhookConfig>();
	private readonly deliveries = new Map<string, DeliveryRingBuffer>();
	private destroyed = false;

	constructor(config?: EventManagerConfig) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// ═══════════════════════════════════════════════════════════════
	// SSE CLIENTS
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Register an SSE client.
	 *
	 * The `writeFn` is called with fully-formatted SSE strings. The `closeFn`
	 * is called when the client is removed or the manager is destroyed.
	 *
	 * @param writeFn - Function that writes raw SSE data to the HTTP response.
	 * @param closeFn - Function that closes the HTTP connection.
	 * @returns An SSEClient interface for interacting with this client.
	 * @throws If the maximum number of SSE clients has been reached.
	 */
	addSSEClient(writeFn: (data: string) => void, closeFn: () => void): SSEClient {
		this.assertAlive();

		if (this.sseClients.size >= this.config.maxSSEClients) {
			throw new Error(
				`Maximum SSE clients (${this.config.maxSSEClients}) reached. ` +
				`Remove a client before adding new ones.`,
			);
		}

		const id = randomUUID();
		const internal: SSEClientInternal = { id, writeFn, closeFn, connected: true };
		this.sseClients.set(id, internal);

		return this.buildSSEClient(internal);
	}

	/**
	 * Remove an SSE client by ID. Calls its close function.
	 *
	 * @param clientId - The SSE client to remove.
	 */
	removeSSEClient(clientId: string): void {
		const client = this.sseClients.get(clientId);
		if (!client) return;
		client.connected = false;
		try {
			client.closeFn();
		} catch (_err) {
			// Swallow close errors — connection may already be dead.
		}
		this.sseClients.delete(clientId);
	}

	/**
	 * Broadcast an SSE event to all connected clients.
	 *
	 * @param event - The SSE event name.
	 * @param data - The event data (JSON-serialized).
	 */
	broadcastSSE(event: string, data: unknown): void {
		this.assertAlive();

		const eventId = randomUUID();
		const formatted = this.formatSSE(event, data, eventId);
		const dead: string[] = [];

		for (const client of this.sseClients.values()) {
			if (!client.connected) {
				dead.push(client.id);
				continue;
			}
			try {
				client.writeFn(formatted);
			} catch (_err) {
				client.connected = false;
				dead.push(client.id);
			}
		}

		// Clean up dead clients
		for (const id of dead) {
			this.removeSSEClient(id);
		}
	}

	/**
	 * Get all connected SSE clients.
	 *
	 * @returns Array of SSEClient interfaces.
	 */
	getSSEClients(): SSEClient[] {
		const result: SSEClient[] = [];
		for (const internal of this.sseClients.values()) {
			if (internal.connected) {
				result.push(this.buildSSEClient(internal));
			}
		}
		return result;
	}

	// ═══════════════════════════════════════════════════════════════
	// WEBHOOKS
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Register a webhook.
	 *
	 * @param config - Webhook configuration (without auto-generated ID).
	 * @returns The generated webhook ID.
	 * @throws If the maximum number of webhooks has been reached.
	 */
	addWebhook(config: Omit<WebhookConfig, "id">): string {
		this.assertAlive();

		if (this.webhooks.size >= this.config.maxWebhooks) {
			throw new Error(
				`Maximum webhooks (${this.config.maxWebhooks}) reached. ` +
				`Remove a webhook before adding new ones.`,
			);
		}

		const id = randomUUID();
		this.webhooks.set(id, {
			...config,
			id,
			retries: config.retries ?? this.config.defaultRetries,
			timeout: config.timeout ?? this.config.defaultTimeout,
		});
		this.deliveries.set(id, new DeliveryRingBuffer(this.config.maxDeliveriesPerWebhook));

		return id;
	}

	/**
	 * Remove a webhook by ID.
	 *
	 * @param webhookId - The webhook to remove.
	 * @returns True if the webhook was found and removed.
	 */
	removeWebhook(webhookId: string): boolean {
		this.deliveries.get(webhookId)?.clear();
		this.deliveries.delete(webhookId);
		return this.webhooks.delete(webhookId);
	}

	/**
	 * Dispatch an event to all matching webhooks.
	 *
	 * Each webhook whose `events` array includes the given event topic
	 * will receive a POST request with the JSON payload. If a signing
	 * secret is configured, an HMAC-SHA256 signature is included in the
	 * headers for verification.
	 *
	 * Retries use exponential backoff: delay = 1000 * 2^(attempt-1) ms.
	 *
	 * @param event - The event topic being dispatched.
	 * @param payload - The event payload.
	 * @returns Array of delivery results.
	 */
	async dispatchWebhook(event: string, payload: unknown): Promise<WebhookDelivery[]> {
		this.assertAlive();

		const matching = [...this.webhooks.values()].filter(
			(wh) => wh.active && wh.events.includes(event),
		);

		const results = await Promise.all(
			matching.map((wh) => this.deliverToWebhook(wh, event, payload)),
		);

		return results;
	}

	/**
	 * Get delivery history for a webhook.
	 *
	 * @param webhookId - The webhook to query.
	 * @param limit - Maximum number of deliveries. Defaults to all stored.
	 * @returns Array of delivery records, oldest first.
	 */
	getDeliveries(webhookId: string, limit?: number): WebhookDelivery[] {
		const ring = this.deliveries.get(webhookId);
		if (!ring) return [];
		return ring.toArray(limit);
	}

	/**
	 * Get all registered webhooks.
	 *
	 * @returns Array of webhook configurations.
	 */
	getWebhooks(): WebhookConfig[] {
		return [...this.webhooks.values()];
	}

	// ═══════════════════════════════════════════════════════════════
	// LIFECYCLE
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Cleanup: close all SSE clients and clear webhook delivery history.
	 * The manager becomes inert — further calls will throw.
	 */
	destroy(): void {
		// Close all SSE clients
		for (const client of this.sseClients.values()) {
			if (client.connected) {
				client.connected = false;
				try {
					client.closeFn();
				} catch (_err) {
					// Swallow
				}
			}
		}
		this.sseClients.clear();

		// Clear webhook delivery history
		for (const ring of this.deliveries.values()) ring.clear();
		this.deliveries.clear();
		this.webhooks.clear();

		this.destroyed = true;
	}

	// ═══════════════════════════════════════════════════════════════
	// PRIVATE
	// ═══════════════════════════════════════════════════════════════

	private assertAlive(): void {
		if (this.destroyed) {
			throw new Error("EventManager has been destroyed. No further operations are allowed.");
		}
	}

	/**
	 * Format a Server-Sent Event string per the SSE specification.
	 *
	 * Format:
	 *   event: <event>\n
	 *   data: <json>\n
	 *   id: <eventId>\n
	 *   \n
	 */
	private formatSSE(event: string, data: unknown, eventId: string): string {
		const jsonData = JSON.stringify(data);
		return `event: ${event}\ndata: ${jsonData}\nid: ${eventId}\n\n`;
	}

	/**
	 * Build the public SSEClient interface from an internal record.
	 */
	private buildSSEClient(internal: SSEClientInternal): SSEClient {
		const manager = this;
		return {
			id: internal.id,
			get isConnected(): boolean {
				return internal.connected;
			},
			send(event: string, data: unknown, eventId?: string): void {
				if (!internal.connected) return;
				const formatted = manager.formatSSE(event, data, eventId ?? randomUUID());
				try {
					internal.writeFn(formatted);
				} catch (_err) {
					internal.connected = false;
				}
			},
			close(): void {
				manager.removeSSEClient(internal.id);
			},
		};
	}

	/**
	 * Deliver a payload to a single webhook with retry logic.
	 *
	 * Exponential backoff: 1s, 2s, 4s, 8s, ...
	 */
	private async deliverToWebhook(
		webhook: WebhookConfig,
		event: string,
		payload: unknown,
	): Promise<WebhookDelivery> {
		const delivery: WebhookDelivery = {
			id: randomUUID(),
			webhookId: webhook.id,
			event,
			payload,
			status: "pending",
			attempts: 0,
		};

		const maxAttempts = (webhook.retries ?? this.config.defaultRetries) + 1;
		const timeout = webhook.timeout ?? this.config.defaultTimeout;
		const body = JSON.stringify({ event, payload, timestamp: Date.now() });

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			delivery.attempts = attempt + 1;
			delivery.lastAttempt = Date.now();

			try {
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};

				// HMAC-SHA256 signature if secret is configured
				if (webhook.secret) {
					const signature = createHmac("sha256", webhook.secret)
						.update(body)
						.digest("hex");
					headers[this.config.signatureHeader] = `sha256=${signature}`;
				}

				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), timeout);

				try {
					const response = await fetch(webhook.url, {
						method: "POST",
						headers,
						body,
						signal: controller.signal,
					});

					const responseBody = await response.text();
					delivery.response = { status: response.status, body: responseBody };

					if (response.ok) {
						delivery.status = "success";
						this.recordDelivery(webhook.id, delivery);
						return delivery;
					}
				} finally {
					clearTimeout(timer);
				}
			} catch (_err) {
				// Network error or abort — will retry if attempts remain
				delivery.response = {
					status: 0,
					body: _err instanceof Error ? _err.message : "Unknown error",
				};
			}

			// Exponential backoff before next retry (skip if last attempt)
			if (attempt < maxAttempts - 1) {
				const delay = 1000 * Math.pow(2, attempt);
				await this.sleep(delay);
			}
		}

		delivery.status = "failed";
		this.recordDelivery(webhook.id, delivery);
		return delivery;
	}

	private recordDelivery(webhookId: string, delivery: WebhookDelivery): void {
		const ring = this.deliveries.get(webhookId);
		if (ring) ring.push(delivery);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
