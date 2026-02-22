/**
 * Peer Connection Manager — Orchestrates P2P mesh connections.
 * Manages outbound/inbound WebSocket lifecycle, TLS, reconnect,
 * authentication, and peer discovery exchange.
 * @module
 */

import { createServer, type Server, type IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { randomUUID } from "node:crypto";
import type { MessageSender, PeerView } from "./types.js";
import type {
	PeerNetworkConfig,
	PeerNodeInfo,
	PeerNetworkEvent,
	PeerNetworkEventHandler,
} from "./peer-types.js";
import { PEER_NETWORK_DEFAULTS, MESH_PROTOCOL_VERSION } from "./peer-types.js";
import { WsPeerChannel, type WsLike } from "./ws-peer-channel.js";
import { verifySignature } from "./peer-envelope.js";
import { PeerGuard, type PeerGuardConfig } from "./peer-guard.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ManagedPeer {
	channel: WsPeerChannel;
	endpoint: string;
	reconnectTimer: ReturnType<typeof setTimeout> | null;
	reconnectAttempts: number;
	outbound: boolean;
}

// ─── PeerConnectionManager ──────────────────────────────────────────────────

/** Manages all P2P mesh connections, discovery, TLS, and reconnect. */
export class PeerConnectionManager {
	readonly nodeId: string;
	readonly nodeInfo: PeerNodeInfo;

	private config: Required<
		Pick<PeerNetworkConfig, "listenPort" | "listenHost" | "pingIntervalMs" |
			"maxMissedPings" | "reconnectBaseMs" | "reconnectMaxMs" | "maxPeers" | "gossipIntervalMs">
	> & PeerNetworkConfig;

	private peers = new Map<string, ManagedPeer>();
	private localRouter: MessageSender | null = null;
	private listener: Server | null = null;
	/** `ws` WebSocketServer instance — loaded dynamically. */
	private wss: { close(): void; handleUpgrade: Function } | null = null;
	private eventHandlers: PeerNetworkEventHandler[] = [];
	private gossipHandler: ((fromNodeId: string, views: PeerView[]) => void) | null = null;
	private running = false;
	/** Tracks all known peer endpoints to prevent redundant connect attempts. */
	private readonly knownEndpoints = new Set<string>();
	private peerExchangeTimer: ReturnType<typeof setInterval> | null = null;
	/** Anti-eclipse connection guard. */
	readonly guard: PeerGuard;

	constructor(config: PeerNetworkConfig = {}) {
		this.nodeId = config.nodeId ?? randomUUID();
		this.config = {
			...config,
			listenPort: config.listenPort ?? PEER_NETWORK_DEFAULTS.listenPort,
			listenHost: config.listenHost ?? PEER_NETWORK_DEFAULTS.listenHost,
			pingIntervalMs: config.pingIntervalMs ?? PEER_NETWORK_DEFAULTS.pingIntervalMs,
			maxMissedPings: config.maxMissedPings ?? PEER_NETWORK_DEFAULTS.maxMissedPings,
			reconnectBaseMs: config.reconnectBaseMs ?? PEER_NETWORK_DEFAULTS.reconnectBaseMs,
			reconnectMaxMs: config.reconnectMaxMs ?? PEER_NETWORK_DEFAULTS.reconnectMaxMs,
			maxPeers: config.maxPeers ?? PEER_NETWORK_DEFAULTS.maxPeers,
			gossipIntervalMs: config.gossipIntervalMs ?? PEER_NETWORK_DEFAULTS.gossipIntervalMs,
		};
		this.guard = new PeerGuard(config.guard);
		const scheme = config.tls ? "wss" : "ws";
		this.nodeInfo = {
			nodeId: this.nodeId,
			endpoint: `${scheme}://${this.config.listenHost}:${this.config.listenPort}/mesh`,
			label: config.label,
			capabilities: config.capabilities,
			joinedAt: Date.now(),
		};
	}

	// ─── Public API ─────────────────────────────────────────────────

	/** Subscribe to network events. */
	on(handler: PeerNetworkEventHandler): () => void {
		this.eventHandlers.push(handler);
		return () => {
			const idx = this.eventHandlers.indexOf(handler);
			if (idx >= 0) this.eventHandlers.splice(idx, 1);
		};
	}

	/** Set the local MeshRouter for incoming message dispatch. */
	setRouter(router: MessageSender): void {
		this.localRouter = router;
		for (const [, peer] of this.peers) {
			peer.channel.setRouter(router);
		}
	}

	/** Set a handler for incoming gossip views (propagated to all channels). */
	setGossipHandler(handler: (fromNodeId: string, views: PeerView[]) => void): void {
		this.gossipHandler = handler;
		for (const [, peer] of this.peers) {
			peer.channel.setGossipHandler(handler);
		}
	}

	/** Get all connected peer channels (for router registration). */
	getConnectedChannels(): WsPeerChannel[] {
		const result: WsPeerChannel[] = [];
		for (const [, peer] of this.peers) {
			if (peer.channel.state === "connected") result.push(peer.channel);
		}
		return result;
	}

	/** Get info about all known peers. */
	getPeers(): Array<{ peerId: string; endpoint: string; state: string; outbound: boolean }> {
		return [...this.peers].map(([id, p]) => ({
			peerId: id, endpoint: p.endpoint, state: p.channel.state, outbound: p.outbound,
		}));
	}
	get peerCount(): number { return this.peers.size; }
	get connectedCount(): number {
		let n = 0;
		for (const [, p] of this.peers) if (p.channel.state === "connected") n++;
		return n;
	}

	// ─── Lifecycle ──────────────────────────────────────────────────

	/**
	 * Start the mesh listener and connect to static peers.
	 * Returns the actual port the listener bound to.
	 */
	async start(): Promise<number> {
		if (this.running) return this.config.listenPort;
		this.running = true;

		const port = await this.startListener();
		const scheme = this.config.tls ? "wss" : "ws";
		this.nodeInfo.endpoint = `${scheme}://${this.config.listenHost}:${port}/mesh`;
		this.knownEndpoints.add(this.nodeInfo.endpoint);

		if (this.config.staticPeers) {
			for (const endpoint of this.config.staticPeers) {
				this.knownEndpoints.add(endpoint);
				void this.connectToPeer(endpoint);
			}
		}

		if (this.config.enablePeerExchange !== false) {
			this.startPeerExchange();
		}

		return port;
	}

	/** Gracefully shut down all connections and the listener. */
	async stop(): Promise<void> {
		this.running = false;
		if (this.peerExchangeTimer) {
			clearInterval(this.peerExchangeTimer);
			this.peerExchangeTimer = null;
		}
		for (const [, peer] of this.peers) {
			if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);
			peer.channel.destroy();
		}
		this.peers.clear();

		if (this.wss) { this.wss.close(); this.wss = null; }
		if (this.listener) {
			await new Promise<void>((resolve) => {
				this.listener!.close(() => resolve());
			});
			this.listener = null;
		}
	}

	// ─── Outbound Connections ───────────────────────────────────────

	/** Connect to a remote peer endpoint (outbound). */
	async connectToPeer(endpoint: string): Promise<WsPeerChannel | null> {
		const peerId = this.peerIdFromEndpoint(endpoint);
		if (this.peers.has(peerId)) return this.peers.get(peerId)!.channel;
		if (this.peers.size >= this.config.maxPeers) return null;

		const channel = this.createChannel(peerId, endpoint, true);
		try {
			const start = Date.now();
			await channel.connect(endpoint);
			this.guard.recordOutbound(endpoint);
			this.guard.recordSuccess(channel.remoteNodeInfo?.nodeId ?? peerId, endpoint, Date.now() - start);
			return channel;
		} catch {
			this.guard.recordFailure(peerId, endpoint);
			this.scheduleReconnect(peerId);
			return null;
		}
	}

	private createChannel(peerId: string, endpoint: string, outbound: boolean): WsPeerChannel {
		const channel = new WsPeerChannel({
			peerId,
			localNodeId: this.nodeId,
			meshSecret: this.config.meshSecret,
			pingIntervalMs: this.config.pingIntervalMs,
			maxMissedPings: this.config.maxMissedPings,
			tlsCa: this.config.tlsCa,
			tlsAllowSelfSigned: this.config.tlsAllowSelfSigned,
		});

		if (this.localRouter) channel.setRouter(this.localRouter);
		if (this.gossipHandler) channel.setGossipHandler(this.gossipHandler);
		channel.on((event) => this.handlePeerEvent(peerId, event));

		this.peers.set(peerId, {
			channel,
			endpoint,
			reconnectTimer: null,
			reconnectAttempts: 0,
			outbound,
		});

		return channel;
	}

	// ─── Reconnection ───────────────────────────────────────────────

	private scheduleReconnect(peerId: string): void {
		const peer = this.peers.get(peerId);
		if (!peer?.outbound || !this.running) return;
		peer.reconnectAttempts++;
		const delay = Math.min(this.config.reconnectBaseMs * 2 ** (peer.reconnectAttempts - 1), this.config.reconnectMaxMs);
		peer.reconnectTimer = setTimeout(async () => {
			if (!this.running) return;
			peer.channel.destroy();
			const ch = this.createChannel(peerId, peer.endpoint, true);
			this.peers.get(peerId)!.channel = ch;
			try { await ch.connect(peer.endpoint); peer.reconnectAttempts = 0; }
			catch { this.scheduleReconnect(peerId); }
		}, delay);
	}

	// ─── Inbound Listener ───────────────────────────────────────────

	private startListener(): Promise<number> {
		return new Promise(async (resolve, reject) => {
			if (this.config.tls && this.config.tlsCert && this.config.tlsKey) {
				this.listener = createHttpsServer({
					cert: this.config.tlsCert,
					key: this.config.tlsKey,
					ca: this.config.tlsCa,
					requestCert: false,
				});
			} else {
				this.listener = createServer();
			}
			const { WebSocketServer: WsServer } = await import("ws");
			this.wss = new WsServer({ noServer: true });

			this.listener.on("upgrade", (req: IncomingMessage, socket, head) => {
				const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
				if (url.pathname !== "/mesh") { socket.destroy(); return; }
				this.wss!.handleUpgrade(req, socket, head, (ws: WsLike & { once: Function }) => {
					this.handleInboundConnection(ws, req);
				});
			});
			this.listener.listen(this.config.listenPort, this.config.listenHost, () => {
				const addr = this.listener!.address();
				resolve(typeof addr === "object" && addr ? addr.port : this.config.listenPort);
			});
			this.listener.on("error", reject);
		});
	}

	private handleInboundConnection(ws: WsLike & { once: Function }, req: IncomingMessage): void {
		const remoteIp = req.socket.remoteAddress ?? "unknown";
		const guardReject = this.guard.shouldAcceptInbound(remoteIp);
		if (guardReject) {
			ws.close(1013, guardReject);
			this.emit({ type: "error", error: `guard rejected: ${guardReject}` });
			return;
		}
		if (this.peers.size >= this.config.maxPeers) {
			ws.close(1013, "max peers reached");
			return;
		}

		const tempId = `inbound-${randomUUID().slice(0, 8)}`;
		let resolvedPeerId = tempId;

		ws.once("message", (raw: Buffer | string) => {
			const data = typeof raw === "string" ? raw : raw.toString("utf-8");
			try {
				const parsed = JSON.parse(data) as { type: string; nodeId?: string; info?: PeerNodeInfo };
				if (parsed.type === "auth" && parsed.nodeId) {
					resolvedPeerId = parsed.nodeId;
					const authOk = !this.config.meshSecret || this.verifyAuth(data);
					if (!authOk) {
						ws.send(JSON.stringify({ type: "auth:fail", reason: "invalid secret" }));
						ws.close(1008, "auth failed");
						return;
					}

					ws.send(JSON.stringify({
						type: "auth:ok",
						nodeId: this.nodeId,
						info: this.nodeInfo,
						version: { protocol: MESH_PROTOCOL_VERSION, timestamp: Date.now(), userAgent: "chitragupta-sutra" },
					}));

					if (this.peers.has(resolvedPeerId)) {
						this.peers.get(resolvedPeerId)!.channel.destroy();
						this.peers.delete(resolvedPeerId);
					}
					const channel = this.createChannel(resolvedPeerId, "", false);
					channel.attachSocket(ws, parsed.info);
					this.guard.recordInbound(remoteIp);
					this.emit({ type: "peer:connected", peerId: resolvedPeerId, info: parsed.info ?? this.nodeInfo });
					setTimeout(() => this.sendPeerExchangeTo(resolvedPeerId), 50);
				}
			} catch {
				ws.close(1002, "invalid auth frame");
			}
		});
	}

	/** Verify inbound auth HMAC-SHA256 (constant-time comparison). */
	private verifyAuth(raw: string): boolean {
		if (!this.config.meshSecret) return true;
		try {
			const parsed = JSON.parse(raw) as { nonce?: string; hmac?: string };
			if (!parsed.nonce || !parsed.hmac) return false;
			return verifySignature(parsed.nonce, parsed.hmac, this.config.meshSecret);
		} catch { return false; }
	}

	// ─── Event Routing ──────────────────────────────────────────────

	private handlePeerEvent(peerId: string, event: PeerNetworkEvent): void {
		if (event.type === "peer:connected") {
			this.sendPeerExchangeTo(peerId);
		}
		if (event.type === "peer:disconnected") {
			const peer = this.peers.get(peerId);
			if (peer) {
				this.guard.removeConnection(peer.endpoint, peer.outbound);
				if (peer.outbound && this.running) this.scheduleReconnect(peerId);
			}
		}
		if (event.type === "peer:dead") {
			const peer = this.peers.get(peerId);
			if (peer) {
				this.guard.removeConnection(peer.endpoint, peer.outbound);
				peer.channel.destroy();
				if (!peer.outbound) this.peers.delete(peerId);
			}
		}
		if (event.type === "peer:discovered") {
			this.handleDiscoveredPeer(event.info);
		}
		this.emit(event);
	}

	private emit(event: PeerNetworkEvent): void {
		for (const handler of this.eventHandlers) {
			try { handler(event); } catch { /* non-fatal */ }
		}
	}

	// ─── Peer Discovery ─────────────────────────────────────────────

	/** Send our known peers to a newly connected peer. */
	private sendPeerExchangeTo(peerId: string): void {
		if (this.config.enablePeerExchange === false) return;
		const peer = this.peers.get(peerId);
		if (!peer || peer.channel.state !== "connected") return;

		const knownPeers: PeerNodeInfo[] = [];
		for (const [id, p] of this.peers) {
			if (id === peerId) continue;
			if (p.channel.state !== "connected") continue;
			const info = p.channel.remoteNodeInfo;
			if (info?.endpoint) knownPeers.push(info);
		}
		if (this.nodeInfo.endpoint) knownPeers.push(this.nodeInfo);
		if (knownPeers.length > 0) peer.channel.sendDiscovery(knownPeers);
	}

	/**
	 * Handle a discovered peer (Bitcoin-style addr relay).
	 * Auto-connects if unknown, then relays to all other connected
	 * peers so the address propagates transitively through the mesh.
	 */
	private handleDiscoveredPeer(info: PeerNodeInfo): void {
		if (!info.endpoint || !this.running) return;
		if (info.nodeId === this.nodeId) return;
		if (this.knownEndpoints.has(info.endpoint)) return;

		// Deduplicate by nodeId (endpoint strings may vary for same node)
		for (const [, peer] of this.peers) {
			if (peer.channel.remoteNodeInfo?.nodeId === info.nodeId) return;
		}

		const maxDiscovered = this.config.maxDiscoveredPeers ?? 10;
		if (this.peers.size >= maxDiscovered || this.peers.size >= this.config.maxPeers) return;

		this.knownEndpoints.add(info.endpoint);

		// Bitcoin-style: relay newly discovered peer to all connected peers
		this.relayPeerAddr(info);

		void this.connectToPeer(info.endpoint);
	}

	/** Relay a peer address to all connected peers (transitive propagation). */
	private relayPeerAddr(info: PeerNodeInfo): void {
		for (const [, peer] of this.peers) {
			if (peer.channel.state !== "connected") continue;
			if (peer.channel.remoteNodeInfo?.nodeId === info.nodeId) continue;
			peer.channel.sendDiscovery([info]);
		}
	}

	/** Start periodic peer exchange with all connected peers. */
	private startPeerExchange(): void {
		const interval = this.config.peerExchangeIntervalMs ?? 30_000;
		this.peerExchangeTimer = setInterval(() => {
			if (!this.running) return;
			for (const [peerId] of this.peers) {
				this.sendPeerExchangeTo(peerId);
			}
		}, interval);
	}

	// ─── Helpers ────────────────────────────────────────────────────

	private peerIdFromEndpoint(ep: string): string {
		try { const u = new URL(ep); return `${u.hostname}:${u.port}`; } catch { return ep; }
	}
}
