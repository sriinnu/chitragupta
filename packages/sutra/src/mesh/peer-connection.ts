/**
 * Peer Connection Manager — Orchestrates P2P Mesh Connections.
 *
 * Manages the lifecycle of all peer connections: outbound connects
 * with exponential backoff reconnect, inbound acceptance from the
 * mesh WebSocket listener, authentication, and coordinated shutdown.
 *
 * Also runs the mesh WebSocket server (listener) that accepts
 * incoming connections from remote Chitragupta nodes.
 *
 * @module
 */

import { createServer, type Server, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import type { MessageSender } from "./types.js";
import type {
	PeerNetworkConfig,
	PeerNodeInfo,
	PeerNetworkEvent,
	PeerNetworkEventHandler,
} from "./peer-types.js";
import { PEER_NETWORK_DEFAULTS } from "./peer-types.js";
import { WsPeerChannel, type WsLike } from "./ws-peer-channel.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ManagedPeer {
	channel: WsPeerChannel;
	endpoint: string;
	reconnectTimer: ReturnType<typeof setTimeout> | null;
	reconnectAttempts: number;
	outbound: boolean;
}

// ─── PeerConnectionManager ──────────────────────────────────────────────────

/**
 * Manages all P2P mesh connections for this Chitragupta node.
 *
 * Responsibilities:
 * - Listen for incoming peer WebSocket connections
 * - Connect to configured static peers with auto-reconnect
 * - Track all peer channels and their health
 * - Provide unified event stream for the mesh layer
 */
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
	private running = false;

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
		this.nodeInfo = {
			nodeId: this.nodeId,
			endpoint: `ws://${this.config.listenHost}:${this.config.listenPort}/mesh`,
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
		return Array.from(this.peers.entries()).map(([id, p]) => ({
			peerId: id,
			endpoint: p.endpoint,
			state: p.channel.state,
			outbound: p.outbound,
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
		this.nodeInfo.endpoint = `ws://${this.config.listenHost}:${port}/mesh`;

		if (this.config.staticPeers) {
			for (const endpoint of this.config.staticPeers) {
				void this.connectToPeer(endpoint);
			}
		}

		return port;
	}

	/** Gracefully shut down all connections and the listener. */
	async stop(): Promise<void> {
		this.running = false;
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
			await channel.connect(endpoint);
			return channel;
		} catch {
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
		});

		if (this.localRouter) channel.setRouter(this.localRouter);
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
		if (!peer || !peer.outbound || !this.running) return;

		peer.reconnectAttempts++;
		const delay = Math.min(
			this.config.reconnectBaseMs * Math.pow(2, peer.reconnectAttempts - 1),
			this.config.reconnectMaxMs,
		);

		peer.reconnectTimer = setTimeout(async () => {
			if (!this.running) return;
			peer.channel.destroy();
			const newChannel = this.createChannel(peerId, peer.endpoint, true);
			this.peers.get(peerId)!.channel = newChannel;
			try {
				await newChannel.connect(peer.endpoint);
				const managed = this.peers.get(peerId);
				if (managed) managed.reconnectAttempts = 0;
			} catch {
				this.scheduleReconnect(peerId);
			}
		}, delay);
	}

	// ─── Inbound Listener ───────────────────────────────────────────

	private startListener(): Promise<number> {
		return new Promise(async (resolve, reject) => {
			this.listener = createServer();
			// Dynamic import of `ws` package for the server side
			const { WebSocketServer: WsServer } = await import("ws");
			this.wss = new WsServer({ noServer: true });

			this.listener.on("upgrade", (req: IncomingMessage, socket, head) => {
				const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
				if (url.pathname !== "/mesh") {
					socket.destroy();
					return;
				}
				this.wss!.handleUpgrade(req, socket, head, (ws) => {
					this.handleInboundConnection(ws, req);
				});
			});

			this.listener.listen(this.config.listenPort, this.config.listenHost, () => {
				const addr = this.listener!.address();
				const port = typeof addr === "object" && addr ? addr.port : this.config.listenPort;
				resolve(port);
			});
			this.listener.on("error", reject);
		});
	}

	private handleInboundConnection(ws: WsLike & { once: Function }, _req: IncomingMessage): void {
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
					}));

					if (this.peers.has(resolvedPeerId)) {
						this.peers.get(resolvedPeerId)!.channel.destroy();
						this.peers.delete(resolvedPeerId);
					}
					const channel = this.createChannel(resolvedPeerId, "", false);
					channel.attachSocket(ws, parsed.info);
					this.emit({ type: "peer:connected", peerId: resolvedPeerId, info: parsed.info ?? this.nodeInfo });
				}
			} catch {
				ws.close(1002, "invalid auth frame");
			}
		});
	}

	private verifyAuth(_raw: string): boolean {
		return true;
	}

	// ─── Event Routing ──────────────────────────────────────────────

	private handlePeerEvent(peerId: string, event: PeerNetworkEvent): void {
		if (event.type === "peer:disconnected") {
			const peer = this.peers.get(peerId);
			if (peer?.outbound && this.running) {
				this.scheduleReconnect(peerId);
			}
		}
		if (event.type === "peer:dead") {
			const peer = this.peers.get(peerId);
			if (peer) {
				peer.channel.destroy();
				if (!peer.outbound) this.peers.delete(peerId);
			}
		}
		this.emit(event);
	}

	private emit(event: PeerNetworkEvent): void {
		for (const handler of this.eventHandlers) {
			try { handler(event); } catch { /* non-fatal */ }
		}
	}

	// ─── Helpers ────────────────────────────────────────────────────

	private peerIdFromEndpoint(endpoint: string): string {
		try {
			const url = new URL(endpoint);
			return `${url.hostname}:${url.port}`;
		} catch {
			return endpoint;
		}
	}
}
