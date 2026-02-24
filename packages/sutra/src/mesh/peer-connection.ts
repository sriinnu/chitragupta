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
import { PeerGuard } from "./peer-guard.js";
interface ManagedPeer {
	channel: WsPeerChannel;
	endpoint: string;
	guardEndpoint: string;
	connectedAt: number;
	reconnectTimer: ReturnType<typeof setTimeout> | null;
	reconnectAttempts: number;
	outbound: boolean;
}
export class PeerConnectionManager {
	readonly nodeId: string;
	readonly nodeInfo: PeerNodeInfo;
	private config: Required<
		Pick<PeerNetworkConfig, "listenPort" | "listenHost" | "pingIntervalMs" |
			"maxMissedPings" | "reconnectBaseMs" | "reconnectMaxMs" | "maxReconnectAttempts" |
			"maxPeers" | "gossipIntervalMs" | "maxSeenAuthNonces" | "maxKnownEndpoints">
	> & PeerNetworkConfig;
	private peers = new Map<string, ManagedPeer>();
	private localRouter: MessageSender | null = null;
	private listener: Server | null = null;
	private wss: { close(): void; handleUpgrade: Function } | null = null;
	private eventHandlers: PeerNetworkEventHandler[] = [];
	private gossipHandler: ((fromNodeId: string, views: PeerView[]) => void) | null = null;
	private running = false;
	/** endpoint -> lastSeen timestamp, capped at maxKnownEndpoints. */
	private readonly knownEndpoints = new Map<string, number>();
	private peerExchangeTimer: ReturnType<typeof setInterval> | null = null;
	readonly guard: PeerGuard;
	private readonly seenAuthNonces = new Map<string, number>();
	private readonly nonceWindowMs: number;
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
			maxReconnectAttempts: config.maxReconnectAttempts ?? PEER_NETWORK_DEFAULTS.maxReconnectAttempts,
			maxPeers: config.maxPeers ?? PEER_NETWORK_DEFAULTS.maxPeers,
			gossipIntervalMs: config.gossipIntervalMs ?? PEER_NETWORK_DEFAULTS.gossipIntervalMs,
			maxSeenAuthNonces: config.maxSeenAuthNonces ?? PEER_NETWORK_DEFAULTS.maxSeenAuthNonces,
			maxKnownEndpoints: config.maxKnownEndpoints ?? PEER_NETWORK_DEFAULTS.maxKnownEndpoints,
		};
		this.guard = new PeerGuard(config.guard);
		this.nonceWindowMs = config.authNonceWindowMs ?? 120_000;
		const scheme = config.tls ? "wss" : "ws";
		this.nodeInfo = {
			nodeId: this.nodeId,
			endpoint: `${scheme}://${this.config.listenHost}:${this.config.listenPort}/mesh`,
			label: config.label,
			capabilities: config.capabilities,
			joinedAt: Date.now(),
		};
	}
	on(handler: PeerNetworkEventHandler): () => void {
		this.eventHandlers.push(handler);
		return () => {
			const idx = this.eventHandlers.indexOf(handler);
			if (idx >= 0) this.eventHandlers.splice(idx, 1);
		};
	}
	setRouter(router: MessageSender): void {
		this.localRouter = router;
		for (const [, peer] of this.peers) {
			peer.channel.setRouter(router);
		}
	}
	setGossipHandler(handler: (fromNodeId: string, views: PeerView[]) => void): void {
		this.gossipHandler = handler;
		for (const [, peer] of this.peers) {
			peer.channel.setGossipHandler(handler);
		}
	}
	getConnectedChannels(): WsPeerChannel[] {
		const result: WsPeerChannel[] = [];
		for (const [, peer] of this.peers) {
			if (peer.channel.state === "connected") result.push(peer.channel);
		}
		return result;
	}
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
	async start(): Promise<number> {
		if (this.running) return this.config.listenPort;
		this.running = true;
		const port = await this.startListener();
		const scheme = this.config.tls ? "wss" : "ws";
		this.nodeInfo.endpoint = `${scheme}://${this.config.listenHost}:${port}/mesh`;
		this.trackKnownEndpoint(this.nodeInfo.endpoint);
		if (this.config.staticPeers) {
			for (const endpoint of this.config.staticPeers) {
				this.trackKnownEndpoint(endpoint);
				void this.connectToPeer(endpoint);
			}
		}
		if (this.config.enablePeerExchange !== false) {
			this.startPeerExchange();
		}
		return port;
	}
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
		this.seenAuthNonces.clear();
		if (this.wss) { this.wss.close(); this.wss = null; }
		if (this.listener) {
			await new Promise<void>((resolve) => {
				this.listener!.close(() => resolve());
			});
			this.listener = null;
		}
	}
	async connectToPeer(endpoint: string): Promise<WsPeerChannel | null> {
		if (!PeerConnectionManager.isValidPeerEndpoint(endpoint)) {
			this.emit({ type: "error", error: `invalid peer endpoint: ${endpoint}` });
			return null;
		}
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
		} catch (err: unknown) {
			this.emit({ type: "error", error: `connectToPeer failed for ${endpoint}: ${err instanceof Error ? err.message : String(err)}` });
			this.guard.recordFailure(peerId, endpoint);
			this.scheduleReconnect(peerId);
			return null;
		}
	}
	private createChannel(peerId: string, endpoint: string, outbound: boolean, guardEndpoint = endpoint): WsPeerChannel {
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
			guardEndpoint,
			connectedAt: Date.now(),
			reconnectTimer: null,
			reconnectAttempts: 0,
			outbound,
		});
		return channel;
	}
	private scheduleReconnect(peerId: string): void {
		const peer = this.peers.get(peerId);
		if (!peer?.outbound || !this.running) return;
		peer.reconnectAttempts++;
		if (peer.reconnectAttempts > this.config.maxReconnectAttempts) {
			this.emit({
				type: "error",
				peerId,
				error: `max reconnect attempts (${this.config.maxReconnectAttempts}) exceeded for ${peer.endpoint}`,
			});
			peer.channel.destroy();
			this.peers.delete(peerId);
			return;
		}
		const delay = Math.min(this.config.reconnectBaseMs * 2 ** (peer.reconnectAttempts - 1), this.config.reconnectMaxMs);
		peer.reconnectTimer = setTimeout(async () => {
			if (!this.running) return;
			peer.channel.destroy();
			const ch = this.createChannel(peerId, peer.endpoint, true);
			this.peers.get(peerId)!.channel = ch;
			try { await ch.connect(peer.endpoint); peer.reconnectAttempts = 0; }
			catch (err: unknown) { this.emit({ type: "error", error: `reconnect failed for ${peerId}: ${err instanceof Error ? err.message : String(err)}` }); this.scheduleReconnect(peerId); }
		}, delay);
	}
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
		let guardReject = this.guard.shouldAcceptInbound(remoteIp);
		if (guardReject?.startsWith("max inbound reached") && this.rotateOldestInboundIfStale()) {
			guardReject = null;
		}
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
		const authTimeout = setTimeout(() => {
			ws.close(1008, "auth timeout");
			this.emit({ type: "error", error: `inbound auth timeout for ${tempId}` });
		}, this.nonceWindowMs);
		ws.once("message", (raw: Buffer | string) => {
			clearTimeout(authTimeout);
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
						type: "auth:ok", nodeId: this.nodeId, info: this.nodeInfo,
						version: { protocol: MESH_PROTOCOL_VERSION, timestamp: Date.now(), userAgent: "chitragupta-sutra" },
					}));
					if (this.peers.has(resolvedPeerId)) {
						const existing = this.peers.get(resolvedPeerId)!;
						this.guard.removeConnection(existing.guardEndpoint, existing.outbound);
						existing.channel.destroy();
						this.peers.delete(resolvedPeerId);
					}
					const normalizedRemoteIp = this.normalizeRemoteIp(remoteIp);
					const channel = this.createChannel(
						resolvedPeerId, parsed.info?.endpoint ?? normalizedRemoteIp, false, normalizedRemoteIp,
					);
					channel.attachSocket(ws, parsed.info);
					this.guard.recordInbound(normalizedRemoteIp);
					this.emit({ type: "peer:connected", peerId: resolvedPeerId, info: parsed.info ?? this.nodeInfo });
					setTimeout(() => this.sendPeerExchangeTo(resolvedPeerId), 50);
				}
			} catch (err: unknown) {
				this.emit({ type: "error", error: `inbound auth parse failed: ${err instanceof Error ? err.message : String(err)}` });
				ws.close(1002, "invalid auth frame");
			}
		});
	}
	private verifyAuth(raw: string): boolean {
		if (!this.config.meshSecret) return true;
		try {
			const parsed = JSON.parse(raw) as { nonce?: string; hmac?: string };
			if (!parsed.nonce || !parsed.hmac) return false;
			const now = Date.now();
			this.pruneSeenAuthNonces(now);
			const nonceParts = parsed.nonce.split(":");
			const nonceTs = Number(nonceParts[1]);
			if (!Number.isFinite(nonceTs) || Math.abs(now - nonceTs) > this.nonceWindowMs) return false;
			if (this.seenAuthNonces.has(parsed.nonce)) return false;
			if (!verifySignature(parsed.nonce, parsed.hmac, this.config.meshSecret)) return false;
			this.seenAuthNonces.set(parsed.nonce, now);
			return true;
		} catch { /* intentional: malformed auth JSON is treated as invalid, not a crash */ return false; }
	}
	private handlePeerEvent(peerId: string, event: PeerNetworkEvent): void {
		if (event.type === "peer:connected") {
			this.sendPeerExchangeTo(peerId);
		} else if (event.type === "peer:disconnected") {
			const peer = this.peers.get(peerId);
			if (peer) {
				this.guard.removeConnection(peer.guardEndpoint, peer.outbound);
				if (peer.outbound && this.running) this.scheduleReconnect(peerId);
			}
		} else if (event.type === "peer:dead") {
			const peer = this.peers.get(peerId);
			if (peer) {
				this.guard.removeConnection(peer.guardEndpoint, peer.outbound);
				peer.channel.destroy();
				if (!peer.outbound) this.peers.delete(peerId);
			}
		} else if (event.type === "peer:discovered") {
			this.handleDiscoveredPeer(event.info);
		}
		this.emit(event);
	}
	private emit(event: PeerNetworkEvent): void {
		for (const handler of this.eventHandlers) {
			try { handler(event); } catch (err: unknown) { process.stderr.write(`[mesh:peer-connection] event handler error: ${err instanceof Error ? err.message : String(err)}\n`); }
		}
	}
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
		this.trackKnownEndpoint(info.endpoint);
		// Bitcoin-style: relay newly discovered peer to all connected peers
		this.relayPeerAddr(info);
		void this.connectToPeer(info.endpoint);
	}
	private relayPeerAddr(info: PeerNodeInfo): void {
		for (const [, peer] of this.peers) {
			if (peer.channel.state !== "connected") continue;
			if (peer.channel.remoteNodeInfo?.nodeId === info.nodeId) continue;
			peer.channel.sendDiscovery([info]);
		}
	}
	private startPeerExchange(): void {
		const interval = this.config.peerExchangeIntervalMs ?? 30_000;
		this.peerExchangeTimer = setInterval(() => {
			if (!this.running) return;
			for (const [peerId] of this.peers) {
				this.sendPeerExchangeTo(peerId);
			}
		}, interval);
	}
	private peerIdFromEndpoint(ep: string): string {
		try { const u = new URL(ep); return `${u.hostname}:${u.port}`; } catch { /* intentional: non-URL endpoints use raw string as peerId */ return ep; }
	}
	private rotateOldestInboundIfStale(): boolean {
		const maxInboundAgeMs = this.guard.getMaxInboundAgeMs();
		const now = Date.now();
		let oldestId: string | null = null;
		let oldestConnectedAt = Number.POSITIVE_INFINITY;
		for (const [peerId, peer] of this.peers) {
			if (peer.outbound) continue;
			if (peer.connectedAt < oldestConnectedAt) {
				oldestConnectedAt = peer.connectedAt;
				oldestId = peerId;
			}
		}
		if (!oldestId || now - oldestConnectedAt < maxInboundAgeMs) return false;
		const oldestPeer = this.peers.get(oldestId);
		if (!oldestPeer) return false;
		this.guard.removeConnection(oldestPeer.guardEndpoint, false);
		this.peers.delete(oldestId);
		oldestPeer.channel.destroy();
		return true;
	}
	/** Remove expired nonces and enforce maxSeenAuthNonces cap (evicts oldest first). */
	private pruneSeenAuthNonces(now: number): void {
		for (const [nonce, seenAt] of this.seenAuthNonces) {
			if (now - seenAt > this.nonceWindowMs) this.seenAuthNonces.delete(nonce);
		}
		let overflow = this.seenAuthNonces.size - this.config.maxSeenAuthNonces;
		if (overflow > 0) {
			for (const key of this.seenAuthNonces.keys()) {
				if (overflow-- <= 0) break;
				this.seenAuthNonces.delete(key);
			}
		}
	}
	private normalizeRemoteIp(remoteIp: string): string {
		return remoteIp.startsWith("::ffff:") ? remoteIp.slice(7) : remoteIp;
	}
	/** Track a known endpoint with LRU eviction when maxKnownEndpoints is exceeded. */
	private trackKnownEndpoint(endpoint: string): void {
		if (this.knownEndpoints.has(endpoint)) this.knownEndpoints.delete(endpoint);
		this.knownEndpoints.set(endpoint, Date.now());
		while (this.knownEndpoints.size > this.config.maxKnownEndpoints) {
			const oldest = this.knownEndpoints.keys().next().value;
			if (oldest !== undefined) this.knownEndpoints.delete(oldest);
			else break;
		}
	}
	/** Validate that a peer endpoint URL is well-formed and uses ws:// or wss://. */
	static isValidPeerEndpoint(endpoint: string): boolean {
		try { return ["ws:", "wss:"].includes(new URL(endpoint).protocol); }
		catch { return false; }
	}
}
