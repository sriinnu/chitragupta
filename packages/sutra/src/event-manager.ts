/**
 * Vaarta — Event streaming and webhook manager.
 * Sanskrit: Vaarta (वार्ता) = news, report, communication.
 *
 * SSE streams for real-time event delivery and webhook dispatch
 * with retry for event-driven integrations.
 *
 * Types and defaults live in `event-manager-types.ts`.
 * Uses shared `RingBuffer<T>` from `ring-buffer.ts`.
 */

import { randomUUID, createHmac } from "node:crypto";
import { RingBuffer } from "./ring-buffer.js";
import {
	DEFAULT_EVENT_MANAGER_CONFIG,
	type SSEClient,
	type SSEClientInternal,
	type WebhookConfig,
	type WebhookDelivery,
	type EventManagerConfig,
} from "./event-manager-types.js";

// Re-export public types for backward compatibility
export type { SSEClient, WebhookConfig, WebhookDelivery, EventManagerConfig };

/**
 * Event streaming and webhook manager for external integrations.
 *
 * @example
 * ```ts
 * const manager = new EventManager();
 * const client = manager.addSSEClient(
 *   (data) => response.write(data),
 *   () => response.end(),
 * );
 * manager.broadcastSSE("status", { running: true });
 * await manager.dispatchWebhook("agent:complete", { result: "ok" });
 * ```
 */
export class EventManager {
	private readonly config: Required<EventManagerConfig>;
	private readonly sseClients = new Map<string, SSEClientInternal>();
	private readonly webhooks = new Map<string, WebhookConfig>();
	private readonly deliveries = new Map<string, RingBuffer<WebhookDelivery>>();
	private destroyed = false;

	constructor(config?: EventManagerConfig) {
		this.config = { ...DEFAULT_EVENT_MANAGER_CONFIG, ...config };
	}

	// ═══════════════════════════════════════════════════════════════
	// SSE CLIENTS
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Register an SSE client.
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
		this.deliveries.set(
			id,
			new RingBuffer<WebhookDelivery>(this.config.maxDeliveriesPerWebhook),
		);

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

		return Promise.all(
			matching.map((wh) => this.deliverToWebhook(wh, event, payload)),
		);
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

	/** Get all registered webhooks. */
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
		for (const client of this.sseClients.values()) {
			if (client.connected) {
				client.connected = false;
				try { client.closeFn(); } catch (_err) { /* swallow */ }
			}
		}
		this.sseClients.clear();

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

	/** Format a Server-Sent Event string per the SSE specification. */
	private formatSSE(event: string, data: unknown, eventId: string): string {
		return `event: ${event}\ndata: ${JSON.stringify(data)}\nid: ${eventId}\n\n`;
	}

	/** Build the public SSEClient interface from an internal record. */
	private buildSSEClient(internal: SSEClientInternal): SSEClient {
		const manager = this;
		return {
			id: internal.id,
			get isConnected(): boolean { return internal.connected; },
			send(event: string, data: unknown, eventId?: string): void {
				if (!internal.connected) return;
				const formatted = manager.formatSSE(event, data, eventId ?? randomUUID());
				try { internal.writeFn(formatted); } catch (_err) { internal.connected = false; }
			},
			close(): void { manager.removeSSEClient(internal.id); },
		};
	}

	/** Deliver a payload to a single webhook with exponential-backoff retry. */
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
				const headers: Record<string, string> = { "Content-Type": "application/json" };

				if (webhook.secret) {
					const signature = createHmac("sha256", webhook.secret)
						.update(body).digest("hex");
					headers[this.config.signatureHeader] = `sha256=${signature}`;
				}

				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), timeout);

				try {
					const response = await fetch(webhook.url, {
						method: "POST", headers, body, signal: controller.signal,
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
				delivery.response = {
					status: 0,
					body: _err instanceof Error ? _err.message : "Unknown error",
				};
			}

			if (attempt < maxAttempts - 1) {
				await this.sleep(1000 * Math.pow(2, attempt));
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
