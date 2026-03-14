import net from "node:net";
import type { NotificationHandler } from "./client-shared.js";
import { serialize, type RpcNotification } from "./protocol.js";

/**
 * Tracks daemon-push notification subscribers and keeps notification delivery
 * out of the main socket client so connection/retry logic stays readable.
 */
export class NotificationRegistry {
	private readonly handlers = new Map<string, Set<NotificationHandler>>();
	private readonly wildcardHandlers = new Set<NotificationHandler>();

	/** Register a notification handler. `*` subscribes to every method. */
	on(method: string, handler: NotificationHandler): () => void {
		if (method === "*") {
			this.wildcardHandlers.add(handler);
			return () => { this.wildcardHandlers.delete(handler); };
		}
		const handlers = this.handlers.get(method) ?? new Set<NotificationHandler>();
		handlers.add(handler);
		this.handlers.set(method, handlers);
		return () => {
			const current = this.handlers.get(method);
			current?.delete(handler);
			if (current && current.size === 0) {
				this.handlers.delete(method);
			}
		};
	}

	/** Deliver a parsed daemon notification to targeted and wildcard listeners. */
	dispatch(msg: RpcNotification): void {
		const params = (msg.params ?? {}) as Record<string, unknown>;
		const handlers = this.handlers.get(msg.method);
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(params, msg.method);
				} catch {
					// Best-effort — notification consumers must not break the client.
				}
			}
		}
		for (const handler of this.wildcardHandlers) {
			try {
				handler(params, msg.method);
			} catch {
				// Best-effort — notification consumers must not break the client.
			}
		}
	}

	/** Send a fire-and-forget notification over the daemon socket. */
	notify(socket: net.Socket | null, method: string, params?: Record<string, unknown>): void {
		if (!socket) return;
		const msg = { jsonrpc: "2.0" as const, method, params };
		try {
			socket.write(serialize(msg));
		} catch {
			// Best-effort — notifications are fire-and-forget.
		}
	}
}
