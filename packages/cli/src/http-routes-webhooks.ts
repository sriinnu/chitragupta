/**
 * Inbound Webhook HTTP Routes — Accept external events via signed HTTP POST.
 *
 * Provides `/api/webhooks/:channel` for external systems to push events
 * into the Chitragupta mesh. Messages are broadcast to the Samiti channel
 * system and optionally forwarded to mesh actors via the router.
 *
 * Also provides `/api/mesh/status` for P2P mesh health monitoring and
 * `/api/mesh/peers` for peer management.
 *
 * Webhook authentication: HMAC-SHA256 signature in `X-Webhook-Signature`
 * header, verified against the server's webhook secret.
 *
 * @module http-routes-webhooks
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChitraguptaServer } from "./http-server.js";
import type { ParsedRequest } from "./http-server-types.js";
import type { MeshStatusSnapshot } from "./mesh-bootstrap.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Dependencies for webhook route handlers. */
export interface WebhookRouteDeps {
	/** Webhook HMAC secret for signature verification. Omit to disable auth. */
	webhookSecret?: string;
	/** Samiti broadcast function for channel messaging. */
	getSamiti?: () => {
		broadcast(channel: string, message: unknown): void;
	} | undefined;
	/** Mesh router for forwarding to specific actors. */
	getMeshRouter?: () => {
		route(envelope: unknown): void;
	} | undefined;
	/** P2P mesh status getter. */
	getMeshStatus?: () => MeshStatusSnapshot | undefined;
	/** P2P mesh peer connection function. */
	connectToPeer?: (endpoint: string) => Promise<boolean>;
}

/** Shape of an inbound webhook payload. */
interface WebhookPayload {
	/** Event type identifier (e.g., "github.push", "ci.complete"). */
	event: string;
	/** Event data — any JSON-serializable value. */
	data: unknown;
	/** Optional target actor ID for point-to-point delivery. */
	targetActor?: string;
	/** Optional sender identity for tracing. */
	source?: string;
}

// ─── Route Mounting ─────────────────────────────────────────────────────────

/**
 * Mount webhook and mesh management HTTP routes.
 *
 * Routes:
 * - `POST /api/webhooks/:channel` — Receive signed webhook events
 * - `GET  /api/mesh/status` — Mesh network status snapshot
 * - `GET  /api/mesh/peers` — List connected peers
 * - `POST /api/mesh/peers` — Connect to a new peer endpoint
 */
export function mountWebhookRoutes(
	server: ChitraguptaServer,
	deps: WebhookRouteDeps,
): void {
	// ── Inbound Webhook ───────────────────────────────────────────────
	server.route("POST", "/api/webhooks/:channel", async (req: ParsedRequest) => {
		const channel = req.params.channel;
		if (!channel) {
			return { status: 400, body: { error: "Missing channel parameter" } };
		}

		// Signature verification (if webhook secret is configured)
		if (deps.webhookSecret) {
			const signature = req.headers["x-webhook-signature"];
			if (!signature) {
				return { status: 401, body: { error: "Missing X-Webhook-Signature header" } };
			}
			const bodyStr = typeof req.body === "string"
				? req.body
				: JSON.stringify(req.body);
			if (!verifySignature(bodyStr, signature, deps.webhookSecret)) {
				return { status: 403, body: { error: "Invalid webhook signature" } };
			}
		}

		const payload = req.body as Partial<WebhookPayload>;
		if (!payload || typeof payload !== "object" || !payload.event) {
			return { status: 400, body: { error: "Payload must include 'event' field" } };
		}

		const message = {
			sender: payload.source ?? "webhook",
			event: payload.event,
			data: payload.data,
			channel: `#${channel}`,
			receivedAt: Date.now(),
			requestId: req.requestId,
		};

		// Broadcast to Samiti channel
		const samiti = deps.getSamiti?.();
		if (samiti) {
			try {
				samiti.broadcast(`#${channel}`, message);
			} catch {
				// Non-fatal — Samiti may not be ready
			}
		}

		// Point-to-point delivery if targetActor specified
		if (payload.targetActor) {
			const router = deps.getMeshRouter?.();
			if (router) {
				try {
					router.route({
						id: req.requestId,
						from: "webhook",
						to: payload.targetActor,
						type: "tell",
						topic: `webhook:${payload.event}`,
						payload: payload.data,
						priority: 1,
						timestamp: Date.now(),
						ttl: 30_000,
						hops: ["webhook"],
					});
				} catch {
					// Non-fatal — router may not have the target
				}
			}
		}

		return {
			status: 202,
			body: {
				accepted: true,
				channel: `#${channel}`,
				event: payload.event,
				requestId: req.requestId,
			},
		};
	});

	// ── Mesh Status ───────────────────────────────────────────────────
	server.route("GET", "/api/mesh/status", async () => {
		const status = deps.getMeshStatus?.();
		if (!status) {
			return { status: 200, body: { enabled: false, reason: "P2P mesh not bootstrapped" } };
		}
		return { status: 200, body: { enabled: true, ...status } };
	});

	// ── List Peers ────────────────────────────────────────────────────
	server.route("GET", "/api/mesh/peers", async () => {
		const status = deps.getMeshStatus?.();
		if (!status) {
			return { status: 200, body: { peers: [], connectedCount: 0 } };
		}
		return {
			status: 200,
			body: {
				peers: status.peers,
				connectedCount: status.connectedCount,
			},
		};
	});

	// ── Connect to Peer ───────────────────────────────────────────────
	server.route("POST", "/api/mesh/peers", async (req: ParsedRequest) => {
		const body = req.body as { endpoint?: string } | null;
		if (!body?.endpoint || typeof body.endpoint !== "string") {
			return { status: 400, body: { error: "Missing 'endpoint' field (e.g., ws://host:port/mesh)" } };
		}

		if (!deps.connectToPeer) {
			return { status: 503, body: { error: "P2P mesh not bootstrapped" } };
		}

		try {
			const connected = await deps.connectToPeer(body.endpoint);
			return {
				status: connected ? 200 : 502,
				body: { connected, endpoint: body.endpoint },
			};
		} catch (err) {
			return {
				status: 502,
				body: {
					connected: false,
					endpoint: body.endpoint,
					error: err instanceof Error ? err.message : String(err),
				},
			};
		}
	});
}

// ─── HMAC Signature Verification ────────────────────────────────────────────

/**
 * Verify HMAC-SHA256 signature with constant-time comparison.
 *
 * Expected signature format: `sha256=<hex>`.
 */
function verifySignature(body: string, signature: string, secret: string): boolean {
	const prefix = "sha256=";
	if (!signature.startsWith(prefix)) return false;

	const expected = createHmac("sha256", secret)
		.update(body, "utf-8")
		.digest("hex");

	const actual = signature.slice(prefix.length);
	if (expected.length !== actual.length) return false;

	try {
		return timingSafeEqual(
			Buffer.from(expected, "hex"),
			Buffer.from(actual, "hex"),
		);
	} catch {
		return false;
	}
}
