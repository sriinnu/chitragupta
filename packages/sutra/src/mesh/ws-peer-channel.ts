/**
 * WebSocket PeerChannel — Real network transport for actor mesh.
 * Implements PeerChannel over WebSocket (ws:// and wss://) with
 * HMAC auth, ping/pong liveness, and TLS support.
 * @module
 */

import type { MeshEnvelope, MessageSender, PeerChannel, PeerView } from "./types.js";
import type {
	PeerConnectionState,
	PeerConnectionStats,
	PeerMessage,
	PeerNodeInfo,
	PeerNetworkEventHandler,
	VersionInfo,
} from "./peer-types.js";
import { MESH_PROTOCOL_VERSION } from "./peer-types.js";
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
	private gossipHandler: ((fromNodeId: string, views: PeerView[]) => void) | null = null;

	/** TLS CA cert(s) for verifying wss:// peers. */
	private tlsCa: string | Buffer | Array<string | Buffer> | undefined;
	/** Allow self-signed peer certs (insecure — dev/test only). */
	private tlsAllowSelfSigned: boolean;
	/** Remote peer's protocol version info (set after handshake). */
	private remoteVersion: VersionInfo | null = null;

	constructor(opts: {
		peerId: string;
		localNodeId: string;
		meshSecret?: string;
		pingIntervalMs?: number;
		maxMissedPings?: number;
		tlsCa?: string | Buffer | Array<string | Buffer>;
		tlsAllowSelfSigned?: boolean;
	}) {
		this.peerId = opts.peerId;
		this.actorId = `peer:${opts.peerId}`;
		this.localNodeId = opts.localNodeId;
		this.meshSecret = opts.meshSecret;
		this.pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
		this.maxMissedPings = opts.maxMissedPings ?? DEFAULT_MAX_MISSED_PINGS;
		this.tlsCa = opts.tlsCa;
		this.tlsAllowSelfSigned = opts.tlsAllowSelfSigned ?? false;
	}

	// ─── Public API ─────────────────────────────────────────────────

	get state(): PeerConnectionState { return this._state; }
	get stats(): Readonly<PeerConnectionStats> { return this._stats; }
	get remoteNodeInfo(): PeerNodeInfo | null { return this.remoteInfo; }
	get remoteVersionInfo(): VersionInfo | null { return this.remoteVersion; }

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

	/** Set a handler for incoming gossip views from this peer. */
	setGossipHandler(handler: (fromNodeId: string, views: PeerView[]) => void): void {
		this.gossipHandler = handler;
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
	 *
	 * For wss:// endpoints, uses the `ws` package with TLS options
	 * (custom CA, rejectUnauthorized) since native WebSocket doesn't
	 * expose Node.js TLS agent configuration.
	 */
	async connect(endpoint: string): Promise<void> {
		if (this._state === "connected") return;
		this.setState("connecting");
		try {
			const isSecure = endpoint.startsWith("wss://");
			if (isSecure) {
				const { default: WsClient } = await import("ws");
				const tlsOpts: Record<string, unknown> = {};
				if (this.tlsCa) tlsOpts.ca = this.tlsCa;
				if (this.tlsAllowSelfSigned) tlsOpts.rejectUnauthorized = false;
				this.ws = new WsClient(endpoint, tlsOpts) as unknown as WsLike;
			} else {
				this.ws = new globalThis.WebSocket(endpoint) as unknown as WsLike;
			}
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
		if (this.ws) { try { this.ws.close(CLOSE_GOING_AWAY, reason); } catch {} this.ws = null; }
		this.setState("disconnected");
		this.emit({ type: "peer:disconnected", peerId: this.peerId, reason });
	}

	/** Clean up all resources. */
	destroy(): void { this.close("destroyed"); this.eventHandlers.length = 0; this.localRouter = null; }

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
						// Mark as network hop to prevent broadcast re-forwarding
						const networkHopEnvelope = msg.data as MeshEnvelope & { _networkHop?: boolean };
						networkHopEnvelope._networkHop = true;
						// Register reply route so cross-node ask replies find their way back
						if (msg.data.type === "ask") {
							this.localRouter.registerReplyRoute?.(msg.data.id, this);
						}
					this.localRouter.route(msg.data);
				}
				break;
			case "gossip":
				if (this.gossipHandler) {
					const fromId = this.remoteInfo?.nodeId ?? this.peerId;
					this.gossipHandler(fromId, msg.data);
				}
				break;
			case "discovery":
				for (const info of msg.data) {
					this.emit({ type: "peer:discovered", info });
				}
				break;
			case "ping":
				this.sendMessage({ type: "pong", ts: msg.ts });
				break;
			case "pong": {
				const now = Date.now();
				this.missedPings = 0;
				this._stats.missedPings = 0;
				this._stats.lastPingMs = now - msg.ts;
				this._stats.lastPongReceived = now;
				break;
			}
			case "auth:ok":
				this.remoteInfo = msg.info;
				this.remoteVersion = msg.version ?? null;
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

	/**
	 * Outbound HMAC-SHA256 challenge-response authentication.
	 *
	 * Sends auth frame directly (bypassing HMAC frame wrapping since
	 * the frame itself carries the HMAC signature). Waits for raw
	 * auth:ok/auth:fail response via a one-time WebSocket listener.
	 */
	private async authenticate(): Promise<void> {
		if (!this.ws) throw new Error("no socket");
		const nonce = `${this.localNodeId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
		const hmac = this.meshSecret ? signMessage(nonce, this.meshSecret) : undefined;
		const authMsg: PeerMessage = {
			type: "auth",
			token: "",
			nodeId: this.localNodeId,
			nonce,
			hmac,
			info: { nodeId: this.localNodeId, endpoint: "", joinedAt: Date.now() },
			version: { protocol: MESH_PROTOCOL_VERSION, timestamp: Date.now(), userAgent: "chitragupta-sutra" },
		};
		// Send auth directly — not through sendMessage (which wraps with HMAC frame)
		this.ws.send(serializePeerMessage(authMsg));

		// Wait for auth response via one-time WebSocket listener
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("auth timeout")), 10_000);
			this.ws!.addEventListener("message", (event) => {
				const data = typeof event.data === "string" ? event.data : String(event.data);
				try {
					const msg = JSON.parse(data) as {
						type: string; nodeId?: string;
						info?: PeerNodeInfo; reason?: string; version?: VersionInfo;
					};
					if (msg.type === "auth:ok") {
						clearTimeout(timeout);
						this.remoteInfo = msg.info ?? null;
						this.remoteVersion = msg.version ?? null;
						resolve();
					} else if (msg.type === "auth:fail") {
						clearTimeout(timeout);
						this.emit({ type: "peer:auth_failed", peerId: this.peerId, reason: msg.reason ?? "rejected" });
						reject(new Error(`auth rejected: ${msg.reason}`));
					}
				} catch { /* ignore non-JSON during auth handshake */ }
			}, { once: true });
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

	// ─── Ping/Pong (Heartbeat Liveness) ─────────────────────────────

	private startPingLoop(): void {
		this.stopPingLoop();
		this.missedPings = 0;
		this._stats.missedPings = 0;
		this.pingInterval = setInterval(() => {
			if (this._state !== "connected") return;
			this.missedPings++;
			this._stats.missedPings = this.missedPings;
			if (this.missedPings > this.maxMissedPings) {
				// Declare peer dead — kill connection, clean up, notify
				const reason = `no heartbeat for ${this.missedPings} pings (${this.missedPings * this.pingIntervalMs}ms)`;
				this._stats.declaredDeadAt = Date.now();
				this._stats.deathReason = reason;
				this.setState("dead");
				this.emit({ type: "peer:dead", peerId: this.peerId });
				this.killConnection(reason);
				return;
			}
			const now = Date.now();
			this._stats.lastPingSent = now;
			this.sendMessage({ type: "ping", ts: now });
		}, this.pingIntervalMs);
	}

	private stopPingLoop(): void {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
	}

	/** Force-close and destroy the connection (dead peer or timeout). */
	private killConnection(reason: string): void {
		this.stopPingLoop();
		if (this.ws) {
			try { this.ws.close(1001, reason); } catch { /* socket may already be gone */ }
			this.ws = null;
		}
		if (this._state !== "dead") this.setState("disconnected");
		this.emit({ type: "peer:disconnected", peerId: this.peerId, reason });
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
