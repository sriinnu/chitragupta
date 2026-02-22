/**
 * WebSocket PeerChannel — Real Network Transport for Actor Mesh.
 *
 * Implements the {@link PeerChannel} interface over WebSocket,
 * enabling actual distributed actor communication between
 * Chitragupta nodes. Handles bidirectional messaging, ping/pong
 * liveness, and graceful disconnection.
 *
 * Two modes:
 *   - **Outbound**: This node initiates the connection (client).
 *   - **Inbound**: Remote node connected to us (server accepted).
 *
 * @module
 */

import type { MeshEnvelope, MessageSender, PeerChannel } from "./types.js";
import type {
	PeerConnectionState,
	PeerConnectionStats,
	PeerMessage,
	PeerNodeInfo,
	PeerNetworkEventHandler,
} from "./peer-types.js";
import {
	serializePeerMessage,
	deserializePeerMessage,
	validateEnvelope,
	stampOrigin,
	signMessage,
	verifySignature,
} from "./peer-envelope.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_PING_INTERVAL_MS = 10_000;
const DEFAULT_MAX_MISSED_PINGS = 3;
const CLOSE_GOING_AWAY = 1001;

/** Minimal WebSocket interface that works with both native and `ws`. */
export interface WsLike {
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(type: string, listener: (event: { data?: unknown }) => void, opts?: { once?: boolean }): void;
}

/** WebSocket readyState constant (same for native + ws). */
const WS_OPEN = 1;

// ─── WebSocket PeerChannel ──────────────────────────────────────────────────

/**
 * A single peer connection wrapping a WebSocket.
 *
 * When the local router calls `receive(envelope)`, the envelope is
 * serialized and sent over the wire to the remote peer. When the
 * remote peer sends an envelope, it's deserialized and routed into
 * the local mesh via `localRouter.route()`.
 */
export class WsPeerChannel implements PeerChannel {
	readonly peerId: string;
	readonly actorId: string;

	private ws: WsLike | null = null;
	private localRouter: MessageSender | null = null;
	private localNodeId: string;
	private meshSecret: string | undefined;
	private remoteInfo: PeerNodeInfo | null = null;

	private pingInterval: ReturnType<typeof setInterval> | null = null;
	private missedPings = 0;
	private pingIntervalMs: number;
	private maxMissedPings: number;

	private _state: PeerConnectionState = "disconnected";
	private _stats: PeerConnectionStats = {
		state: "disconnected",
		reconnectAttempts: 0,
		messagesSent: 0,
		messagesReceived: 0,
		bytesIn: 0,
		bytesOut: 0,
		lastActivity: Date.now(),
	};

	private eventHandlers: PeerNetworkEventHandler[] = [];

	constructor(opts: {
		peerId: string;
		localNodeId: string;
		meshSecret?: string;
		pingIntervalMs?: number;
		maxMissedPings?: number;
	}) {
		this.peerId = opts.peerId;
		this.actorId = `peer:${opts.peerId}`;
		this.localNodeId = opts.localNodeId;
		this.meshSecret = opts.meshSecret;
		this.pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
		this.maxMissedPings = opts.maxMissedPings ?? DEFAULT_MAX_MISSED_PINGS;
	}

	// ─── Public API ─────────────────────────────────────────────────

	get state(): PeerConnectionState { return this._state; }
	get stats(): Readonly<PeerConnectionStats> { return this._stats; }
	get remoteNodeInfo(): PeerNodeInfo | null { return this.remoteInfo; }

	/** Subscribe to peer events. Returns unsubscribe function. */
	on(handler: PeerNetworkEventHandler): () => void {
		this.eventHandlers.push(handler);
		return () => {
			const idx = this.eventHandlers.indexOf(handler);
			if (idx >= 0) this.eventHandlers.splice(idx, 1);
		};
	}

	/** Bind to local router for incoming message dispatch. */
	setRouter(router: MessageSender): void {
		this.localRouter = router;
	}

	/**
	 * Attach an already-established WebSocket (inbound connection).
	 * Used when a remote peer connects to our listener.
	 */
	attachSocket(ws: WsLike, remoteInfo?: PeerNodeInfo): void {
		this.ws = ws;
		this.remoteInfo = remoteInfo ?? null;
		this.setState("connected");
		this.wireSocketEvents();
		this.startPingLoop();
	}

	/**
	 * Initiate an outbound WebSocket connection to the remote peer.
	 */
	async connect(endpoint: string): Promise<void> {
		if (this._state === "connected") return;
		this.setState("connecting");
		try {
			// Use native Node.js 22+ WebSocket (global)
			this.ws = new globalThis.WebSocket(endpoint) as unknown as WsLike;
			await this.waitForOpen();
			this.setState("authenticating");
			await this.authenticate();
			this.setState("connected");
			this.wireSocketEvents();
			this.startPingLoop();
			this.emit({ type: "peer:connected", peerId: this.peerId, info: this.remoteInfo! });
		} catch (err) {
			this.setState("disconnected");
			const msg = err instanceof Error ? err.message : String(err);
			this.emit({ type: "error", peerId: this.peerId, error: `connect failed: ${msg}` });
			throw err;
		}
	}

	/**
	 * PeerChannel.receive() — called by the local MeshRouter to send
	 * an envelope TO this remote peer over the wire.
	 */
	receive(envelope: MeshEnvelope): void {
		if (this._state !== "connected" || !this.ws) return;
		const stamped = stampOrigin(envelope, this.localNodeId);
		this.sendMessage({ type: "envelope", data: stamped });
	}

	/** Send a gossip view exchange to this peer. */
	sendGossip(views: import("./types.js").PeerView[]): void {
		this.sendMessage({ type: "gossip", data: views });
	}

	/** Send a discovery payload (known peers) to this peer. */
	sendDiscovery(peers: PeerNodeInfo[]): void {
		this.sendMessage({ type: "discovery", data: peers });
	}

	/** Send a Samiti broadcast to this peer. */
	sendSamiti(channel: string, data: unknown): void {
		this.sendMessage({ type: "samiti", channel, data });
	}

	/** Gracefully close the connection. */
	close(reason = "local shutdown"): void {
		this.stopPingLoop();
		if (this.ws) {
			try { this.ws.close(CLOSE_GOING_AWAY, reason); } catch { /* best-effort */ }
			this.ws = null;
		}
		this.setState("disconnected");
		this.emit({ type: "peer:disconnected", peerId: this.peerId, reason });
	}

	/** Clean up all resources. */
	destroy(): void {
		this.close("destroyed");
		this.eventHandlers.length = 0;
		this.localRouter = null;
	}

	// ─── Wire Protocol ──────────────────────────────────────────────

	private sendMessage(msg: PeerMessage): void {
		if (!this.ws || this.ws.readyState !== WS_OPEN) return;
		const payload = serializePeerMessage(msg);
		const frame = this.meshSecret
			? JSON.stringify({ sig: signMessage(payload, this.meshSecret), body: payload })
			: payload;
		try {
			this.ws.send(frame);
			this._stats.messagesSent++;
			this._stats.bytesOut += frame.length;
			this._stats.lastActivity = Date.now();
			this.emit({ type: "message:sent", to: this.peerId, messageType: msg.type });
		} catch { /* connection might be closing */ }
	}

	private handleIncoming(raw: string): void {
		this._stats.bytesIn += raw.length;
		this._stats.lastActivity = Date.now();

		let payload: string;
		if (this.meshSecret) {
			try {
				const frame = JSON.parse(raw) as { sig: string; body: string };
				if (!verifySignature(frame.body, frame.sig, this.meshSecret)) {
					this.emit({ type: "peer:auth_failed", peerId: this.peerId, reason: "invalid signature" });
					return;
				}
				payload = frame.body;
			} catch {
				return;
			}
		} else {
			payload = raw;
		}

		const msg = deserializePeerMessage(payload);
		if (!msg) return;

		this._stats.messagesReceived++;
		this.emit({ type: "message:received", from: this.peerId, messageType: msg.type });
		this.dispatchMessage(msg);
	}

	private dispatchMessage(msg: PeerMessage): void {
		switch (msg.type) {
			case "envelope":
				if (validateEnvelope(msg.data) && this.localRouter) {
					this.localRouter.route(msg.data);
				}
				break;
			case "gossip":
				this.emit({ type: "message:received", from: this.peerId, messageType: "gossip" });
				break;
			case "discovery":
				for (const info of msg.data) {
					this.emit({ type: "peer:discovered", info });
				}
				break;
			case "ping":
				this.sendMessage({ type: "pong", ts: msg.ts });
				break;
			case "pong":
				this.missedPings = 0;
				this._stats.lastPingMs = Date.now() - msg.ts;
				break;
			case "auth:ok":
				this.remoteInfo = msg.info;
				break;
			case "auth:fail":
				this.emit({ type: "peer:auth_failed", peerId: this.peerId, reason: msg.reason });
				this.close(`auth failed: ${msg.reason}`);
				break;
			default:
				break;
		}
	}

	// ─── Authentication ─────────────────────────────────────────────

	private async authenticate(): Promise<void> {
		const authMsg: PeerMessage = {
			type: "auth",
			token: this.meshSecret ?? "",
			nodeId: this.localNodeId,
			info: {
				nodeId: this.localNodeId,
				endpoint: "",
				joinedAt: Date.now(),
			},
		};
		this.sendMessage(authMsg);

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("auth timeout")), 10_000);
			const unsub = this.on((event) => {
				if (event.type === "peer:auth_failed") {
					clearTimeout(timeout);
					unsub();
					reject(new Error(`auth rejected: ${event.reason}`));
				}
				if (event.type === "message:received" && event.messageType === "auth:ok" as string) {
					clearTimeout(timeout);
					unsub();
					resolve();
				}
			});
		});
	}

	// ─── Socket Lifecycle ───────────────────────────────────────────

	private wireSocketEvents(): void {
		if (!this.ws) return;
		this.ws.addEventListener("message", (event) => {
			const data = typeof event.data === "string" ? event.data : String(event.data);
			this.handleIncoming(data);
		});
		this.ws.addEventListener("close", () => {
			this.stopPingLoop();
			this.setState("disconnected");
			this.emit({ type: "peer:disconnected", peerId: this.peerId, reason: "socket closed" });
		});
		this.ws.addEventListener("error", () => {
			this.emit({ type: "error", peerId: this.peerId, error: "WebSocket error" });
		});
	}

	private waitForOpen(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.ws) return reject(new Error("no socket"));
			if (this.ws.readyState === WS_OPEN) return resolve();
			const timeout = setTimeout(() => reject(new Error("connect timeout")), 15_000);
			this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
			this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("connect error")); }, { once: true });
		});
	}

	// ─── Ping/Pong ──────────────────────────────────────────────────

	private startPingLoop(): void {
		this.stopPingLoop();
		this.missedPings = 0;
		this.pingInterval = setInterval(() => {
			if (this._state !== "connected") return;
			this.missedPings++;
			if (this.missedPings > this.maxMissedPings) {
				this.emit({ type: "peer:dead", peerId: this.peerId });
				this.close("ping timeout");
				return;
			}
			this.sendMessage({ type: "ping", ts: Date.now() });
		}, this.pingIntervalMs);
	}

	private stopPingLoop(): void {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
	}

	// ─── Helpers ────────────────────────────────────────────────────

	private setState(state: PeerConnectionState): void {
		this._state = state;
		this._stats.state = state;
		if (state === "connected") this._stats.connectedAt = Date.now();
		if (state === "disconnected") this._stats.disconnectedAt = Date.now();
	}

	private emit(event: import("./peer-types.js").PeerNetworkEvent): void {
		for (const handler of this.eventHandlers) {
			try { handler(event); } catch { /* non-fatal */ }
		}
	}
}
