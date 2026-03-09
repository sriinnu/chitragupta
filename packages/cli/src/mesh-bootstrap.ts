/**
 * P2P Mesh Bootstrap — Wires real distributed networking into the ActorSystem.
 *
 * When `chitragupta serve` starts, the existing {@link createMeshInfrastructure}
 * creates a local-only ActorSystem. This module extends it with actual
 * P2P networking: WebSocket transport, network gossip, and peer discovery.
 *
 * The bootstrap is optional — if `meshNetwork` config is absent or the
 * sutra mesh package isn't installed, serve mode falls back to local-only.
 *
 * @module mesh-bootstrap
 */

import { createLogger } from "@chitragupta/core";
import { getMeshRuntimeSnapshot, type MeshStatusSnapshot } from "./mesh-observability.js";
import {
	connectMeshPeerViaDaemon,
	getMeshStatusViaDaemon,
} from "./modes/daemon-bridge-collective.js";
import { allowLocalRuntimeFallback } from "./runtime-daemon-proxies.js";

const log = createLogger("cli:mesh-bootstrap");

// ─── Types ──────────────────────────────────────────────────────────────────

/** User-facing mesh network configuration (subset of PeerNetworkConfig). */
export interface MeshNetworkConfig {
	/** Port for the mesh WebSocket listener. Default: 3142. */
	listenPort?: number;
	/** Host to bind the mesh listener. Default: "127.0.0.1". */
	listenHost?: string;
	/** Static peer endpoints to connect to on startup. */
	staticPeers?: string[];
	/** Shared HMAC secret for peer authentication. */
	meshSecret?: string;
	/** Ping interval in ms. Default: 10_000. */
	pingIntervalMs?: number;
	/** Max concurrent peer connections. Default: 50. */
	maxPeers?: number;
	/** Gossip exchange interval in ms. Default: 5_000. */
	gossipIntervalMs?: number;
	/** Human-readable label for this node. */
	label?: string;
	/** Capabilities advertised to peers. */
	capabilities?: string[];
	/** Path to PeerAddrDb JSON persistence file. */
	peerAddrDbPath?: string;
	/** Number of bootstrap peers loaded from PeerAddrDb. */
	peerAddrDbBootstrapCount?: number;
	/** Save interval for PeerAddrDb persistence (ms). */
	peerAddrDbSaveIntervalMs?: number;
}

/** Result of a successful mesh bootstrap. */
export interface MeshBootstrapResult {
	/** Actual port the mesh listener bound to. */
	meshPort: number;
	/** The node ID assigned to this instance. */
	nodeId: string;
	/** Cleanup function — call on server shutdown. */
	shutdown: () => Promise<void>;
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

/**
 * Bootstrap P2P mesh networking on an existing ActorSystem.
 *
 * Dynamically imports `@chitragupta/sutra` mesh modules and calls
 * `actorSystem.bootstrapP2P()` with the provided network config.
 *
 * @param actorSystem - The ActorSystem created by `createMeshInfrastructure()`.
 * @param config - User-facing mesh network config.
 * @returns Bootstrap result with port, nodeId, and shutdown handle.
 * @throws If the sutra mesh module is unavailable or bootstrap fails.
 */
export async function bootstrapMeshNetwork(
	actorSystem: unknown,
	config: MeshNetworkConfig,
): Promise<MeshBootstrapResult> {
	// Duck-type check — actorSystem must have bootstrapP2P method
	const sys = actorSystem as {
		bootstrapP2P(config: Record<string, unknown>): Promise<number>;
		getConnectionManager(): { nodeId: string } | null;
	};

	if (typeof sys.bootstrapP2P !== "function") {
		throw new Error("Invalid actorSystem — expected ActorSystem with bootstrapP2P()");
	}

	const networkConfig = {
		listenPort: config.listenPort ?? 3142,
		listenHost: config.listenHost ?? "127.0.0.1",
		staticPeers: config.staticPeers,
		meshSecret: config.meshSecret,
		pingIntervalMs: config.pingIntervalMs,
		maxPeers: config.maxPeers,
			gossipIntervalMs: config.gossipIntervalMs,
			label: config.label,
			capabilities: config.capabilities,
			peerAddrDbPath: config.peerAddrDbPath,
			peerAddrDbBootstrapCount: config.peerAddrDbBootstrapCount,
			peerAddrDbSaveIntervalMs: config.peerAddrDbSaveIntervalMs,
		};

	const meshPort = await sys.bootstrapP2P(networkConfig);
	const connMgr = sys.getConnectionManager();
	const nodeId = connMgr?.nodeId ?? "unknown";

	log.info("P2P mesh bootstrapped", {
		nodeId,
		meshPort,
		staticPeers: config.staticPeers?.length ?? 0,
		maxPeers: networkConfig.maxPeers ?? 50,
	});

	return {
		meshPort,
		nodeId,
		shutdown: async () => {
			try {
				await (actorSystem as { shutdown(): Promise<void> }).shutdown();
				log.info("P2P mesh shut down", { nodeId });
			} catch (err) {
				log.warn("Mesh shutdown error", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		},
	};
}

// ─── Config Resolution ──────────────────────────────────────────────────────

/**
 * Resolve mesh network config from settings and environment variables.
 *
 * Environment variables override settings values:
 * - `CHITRAGUPTA_MESH_PORT` — listener port
 * - `CHITRAGUPTA_MESH_HOST` — listener host
	 * - `CHITRAGUPTA_MESH_PEERS` — comma-separated peer endpoints
	 * - `CHITRAGUPTA_MESH_SECRET` — shared HMAC secret
	 * - `CHITRAGUPTA_MESH_LABEL` — node label
	 * - `CHITRAGUPTA_MESH_ADDR_DB_PATH` — PeerAddrDb persistence file
 *
 * @param settings - Settings object (may contain `mesh` or `meshNetwork` key).
 * @returns Resolved config, or `undefined` if mesh is not enabled.
 */
export function resolveMeshConfig(
	settings: Record<string, unknown>,
): MeshNetworkConfig | undefined {
	const meshSettings = (settings.mesh ?? settings.meshNetwork) as
		| MeshNetworkConfig
		| undefined;

	const envPort = process.env.CHITRAGUPTA_MESH_PORT;
	const envHost = process.env.CHITRAGUPTA_MESH_HOST;
	const envPeers = process.env.CHITRAGUPTA_MESH_PEERS;
	const envSecret = process.env.CHITRAGUPTA_MESH_SECRET;
	const envLabel = process.env.CHITRAGUPTA_MESH_LABEL;
	const envAddrDbPath = process.env.CHITRAGUPTA_MESH_ADDR_DB_PATH;

	const hasEnv = envPort || envHost || envPeers || envSecret || envLabel || envAddrDbPath;
	if (!meshSettings && !hasEnv) return undefined;

	return {
		listenPort: envPort ? parseInt(envPort, 10) : meshSettings?.listenPort,
		listenHost: envHost ?? meshSettings?.listenHost,
		staticPeers: envPeers
			? envPeers.split(",").map((s) => s.trim()).filter(Boolean)
			: meshSettings?.staticPeers,
			meshSecret: envSecret ?? meshSettings?.meshSecret,
			label: envLabel ?? meshSettings?.label,
			pingIntervalMs: meshSettings?.pingIntervalMs,
			maxPeers: meshSettings?.maxPeers,
			gossipIntervalMs: meshSettings?.gossipIntervalMs,
			capabilities: meshSettings?.capabilities,
			peerAddrDbPath: envAddrDbPath ?? meshSettings?.peerAddrDbPath,
			peerAddrDbBootstrapCount: meshSettings?.peerAddrDbBootstrapCount,
			peerAddrDbSaveIntervalMs: meshSettings?.peerAddrDbSaveIntervalMs,
		};
}

// ─── Status ─────────────────────────────────────────────────────────────────

/**
 * Build the mesh-related API handler fields for `createChitraguptaAPI`.
 *
 * Returns an object with `getWebhookSecret`, `getMeshRouter`, `getMeshStatus`,
 * and `connectToPeer` — ready to spread into the ApiDeps map.
 */
export function buildMeshApiHandlers(
	actorSystem: unknown,
	getBootstrapResult: () => MeshBootstrapResult | undefined,
): Record<string, unknown> {
	return {
		getWebhookSecret: () => process.env.CHITRAGUPTA_WEBHOOK_SECRET,
		getMeshRouter: () => {
			try {
				return (actorSystem as { getRouter(): unknown } | undefined)?.getRouter();
			} catch { return undefined; }
		},
		getMeshStatus: async (): Promise<MeshStatusSnapshot | undefined> => {
			try {
				return await getMeshStatusViaDaemon();
			} catch {
				if (!allowLocalRuntimeFallback()) return undefined;
			}
			const br = getBootstrapResult();
			if (!actorSystem) return undefined;
			return getMeshRuntimeSnapshot(actorSystem, br?.meshPort ?? 0);
		},
		connectToPeer: async (endpoint: string): Promise<boolean> => {
			try {
				return await connectMeshPeerViaDaemon(endpoint);
			} catch {
				if (!allowLocalRuntimeFallback()) return false;
			}
			try {
				const connMgr = (actorSystem as {
					getConnectionManager(): { connectToPeer(e: string): Promise<unknown> } | null;
				} | undefined)?.getConnectionManager();
				if (!connMgr) return false;
				const ch = await connMgr.connectToPeer(endpoint);
				return ch !== null;
			} catch { return false; }
		},
	};
}

/**
 * Collect a status snapshot from a bootstrapped ActorSystem.
 *
 * @param actorSystem - The ActorSystem with P2P bootstrapped.
 * @returns Status snapshot, or `undefined` if P2P is not bootstrapped.
 */
export function getMeshStatus(actorSystem: unknown): MeshStatusSnapshot | undefined {
	return getMeshRuntimeSnapshot(actorSystem, 0);
}
