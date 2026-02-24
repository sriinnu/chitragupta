/**
 * P2P Network Types for Distributed Actor Mesh.
 *
 * Defines the wire protocol, connection state, peer identity,
 * and configuration for real WebSocket-based P2P communication
 * between Chitragupta nodes.
 *
 * @module
 */

import type { MeshEnvelope, PeerView } from "./types.js";

// ─── Node Identity ──────────────────────────────────────────────────────────

/** Unique identity of a Chitragupta node in the mesh. */
export interface PeerNodeInfo {
	/** Unique node ID (UUID or hostname:port). */
	nodeId: string;
	/** WebSocket endpoint for this node (e.g. ws://192.168.1.10:3142/mesh). */
	endpoint: string;
	/** Human-readable label (optional). */
	label?: string;
	/** Node capabilities (e.g. ["agent", "memory", "coding"]). */
	capabilities?: string[];
	/** Unix epoch ms when this node first joined the mesh. */
	joinedAt: number;
}

// ─── Connection State ───────────────────────────────────────────────────────

/** Lifecycle states for a peer connection. */
export type PeerConnectionState =
	| "connecting"
	| "authenticating"
	| "connected"
	| "disconnected"
	| "reconnecting"
	| "dead";

/** Connection statistics and health tracking for a single peer. */
export interface PeerConnectionStats {
	state: PeerConnectionState;
	connectedAt?: number;
	disconnectedAt?: number;
	reconnectAttempts: number;
	messagesSent: number;
	messagesReceived: number;
	bytesIn: number;
	bytesOut: number;
	/** Round-trip latency of the last successful ping/pong (ms). */
	lastPingMs?: number;
	lastActivity: number;
	/** When we last sent a ping frame. */
	lastPingSent?: number;
	/** When we last received a pong reply. */
	lastPongReceived?: number;
	/** Current count of consecutive missed pings (resets on pong). */
	missedPings?: number;
	/** Whether the peer was declared dead. */
	declaredDeadAt?: number;
	/** Reason the connection was closed or killed. */
	deathReason?: string;
}

// ─── Version Handshake ───────────────────────────────────────────────────────

/** Protocol version info exchanged during handshake (Bitcoin version message). */
export interface VersionInfo {
	/** Wire protocol identifier (e.g. "mesh/1.0"). */
	protocol: string;
	/** User agent string (e.g. "chitragupta-sutra/0.1.0"). */
	userAgent?: string;
	/** Advertised services (e.g. ["actor", "gossip", "discovery", "samiti"]). */
	services?: string[];
	/** Minimum protocol version this node will accept. */
	minProtocol?: string;
	/** Unix epoch ms — used for time offset calculation between peers. */
	timestamp?: number;
}

/** Current mesh protocol version. */
export const MESH_PROTOCOL_VERSION = "mesh/1.0";

// ─── Wire Protocol ──────────────────────────────────────────────────────────

/**
 * Messages exchanged over the WebSocket wire between mesh peers.
 *
 * Every message is a JSON object with a `type` discriminator.
 * Envelopes carry MeshEnvelope payloads (actor messages).
 * Gossip carries PeerView arrays for failure detection.
 * Auth handles mutual authentication + version handshake on connect.
 */
export type PeerMessage =
	| { type: "envelope"; data: MeshEnvelope }
	| { type: "gossip"; data: PeerView[] }
	| { type: "discovery"; data: PeerNodeInfo[] }
	| { type: "samiti"; channel: string; data: unknown }
	| { type: "ping"; ts: number }
	| { type: "pong"; ts: number }
	| { type: "auth"; token: string; nodeId: string; info: PeerNodeInfo; nonce?: string; hmac?: string; version?: VersionInfo }
	| { type: "auth:ok"; nodeId: string; info: PeerNodeInfo; version?: VersionInfo }
	| { type: "auth:fail"; reason: string };

// ─── Network Configuration ──────────────────────────────────────────────────

/** Configuration for the P2P mesh network layer. */
export interface PeerNetworkConfig {
	/** This node's unique ID. Auto-generated if omitted. */
	nodeId?: string;
	/** Port to listen for incoming peer connections. Default: 3142 */
	listenPort?: number;
	/** Host to bind the mesh listener. Default: "0.0.0.0" */
	listenHost?: string;
	/** Static list of peer endpoints to connect to on startup. */
	staticPeers?: string[];
	/** Shared secret for peer authentication (HMAC-SHA256). */
	meshSecret?: string;
	/** Max nonce age and replay window for auth verification (ms). Default: 120_000 */
	authNonceWindowMs?: number;
	/** Max size of the seen-auth-nonces map. Default: 10_000 */
	maxSeenAuthNonces?: number;
	/** Interval between ping frames (ms). Default: 10_000 */
	pingIntervalMs?: number;
	/** Mark peer dead after this many missed pings. Default: 3 */
	maxMissedPings?: number;
	/** Reconnect backoff base (ms). Default: 1_000 */
	reconnectBaseMs?: number;
	/** Reconnect backoff max (ms). Default: 60_000 */
	reconnectMaxMs?: number;
	/** Max reconnect attempts before giving up on a peer. Default: 20 */
	maxReconnectAttempts?: number;
	/** Max number of peer connections. Default: 50 */
	maxPeers?: number;
	/** Enable mDNS discovery on local network. Default: false */
	enableMdns?: boolean;
	/** Enable seed-node discovery. Default: false */
	enableSeedDiscovery?: boolean;
	/** Seed node endpoint for bootstrap. */
	seedEndpoint?: string;
	/** Gossip exchange interval over network (ms). Default: 5_000 */
	gossipIntervalMs?: number;
	/** Node capabilities to advertise. */
	capabilities?: string[];
	/** Human-readable label for this node. */
	label?: string;

	// ─── TLS Configuration ───────────────────────────────────────
	/** Enable TLS (wss://) for the mesh listener. Default: false */
	tls?: boolean;
	/** PEM-encoded TLS certificate (or path). Required when tls=true. */
	tlsCert?: string | Buffer;
	/** PEM-encoded TLS private key (or path). Required when tls=true. */
	tlsKey?: string | Buffer;
	/** PEM-encoded CA certificate(s) for verifying peer certs. */
	tlsCa?: string | Buffer | Array<string | Buffer>;
	/** Allow self-signed certificates from peers. Default: false */
	tlsAllowSelfSigned?: boolean;

	// ─── Peer Discovery ──────────────────────────────────────────
	/** Enable peer-exchange discovery (share peers on connect). Default: true */
	enablePeerExchange?: boolean;
	/** Max discovered peers to auto-connect. Default: 10 */
	maxDiscoveredPeers?: number;
	/** Max known endpoints tracked for peer exchange. Default: 1_000 */
	maxKnownEndpoints?: number;
	/** Interval between peer exchange rounds (ms). Default: 30_000 */
	peerExchangeIntervalMs?: number;

	// ─── Peer Address DB Persistence ──────────────────────────────
	/** Path to persisted PeerAddrDb JSON file. When set, bootstrap peers are loaded from disk. */
	peerAddrDbPath?: string;
	/** Number of bootstrap peers to load from PeerAddrDb. Default: 20 */
	peerAddrDbBootstrapCount?: number;
	/** Periodic save interval for PeerAddrDb (ms). Default: 30_000 */
	peerAddrDbSaveIntervalMs?: number;

	// ─── Security ────────────────────────────────────────────────
	/** Anti-eclipse connection guard configuration. */
	guard?: import("./peer-guard.js").PeerGuardConfig;
}

/** Defaults for PeerNetworkConfig. */
export const PEER_NETWORK_DEFAULTS = {
	listenPort: 3142,
	listenHost: "0.0.0.0",
	pingIntervalMs: 10_000,
	maxMissedPings: 3,
	reconnectBaseMs: 1_000,
	reconnectMaxMs: 60_000,
	maxReconnectAttempts: 20,
	maxPeers: 50,
	gossipIntervalMs: 5_000,
	maxSeenAuthNonces: 10_000,
	maxKnownEndpoints: 1_000,
} as const;

// ─── Events ─────────────────────────────────────────────────────────────────

/** Events emitted by the P2P network layer. */
export type PeerNetworkEvent =
	| { type: "peer:connected"; peerId: string; info: PeerNodeInfo }
	| { type: "peer:disconnected"; peerId: string; reason: string }
	| { type: "peer:authenticated"; peerId: string }
	| { type: "peer:auth_failed"; peerId: string; reason: string }
	| { type: "peer:dead"; peerId: string }
	| { type: "peer:discovered"; info: PeerNodeInfo }
	| { type: "message:received"; from: string; messageType: PeerMessage["type"] }
	| { type: "message:sent"; to: string; messageType: PeerMessage["type"] }
	| { type: "error"; peerId?: string; error: string };

/** Handler for P2P network events. */
export type PeerNetworkEventHandler = (event: PeerNetworkEvent) => void;
