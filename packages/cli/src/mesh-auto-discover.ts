/**
 * P2P Mesh Auto-Discovery — Zero-config local peer discovery via heartbeat files.
 *
 * When multiple MCP sessions run on the same machine, each writes a heartbeat
 * file with its mesh port. This module scans those heartbeats and auto-connects
 * to other sessions without any manual configuration.
 *
 * Flow:
 *   1. Session starts → writes heartbeat with `meshPort` field
 *   2. Auto-discover scans `~/.chitragupta/telemetry/instances/*.json`
 *   3. Finds other live sessions with meshPort != own meshPort
 *   4. Connects to them as peers via `ws://127.0.0.1:<meshPort>/mesh`
 *   5. Repeats every `scanIntervalMs` to pick up new sessions
 *
 * This replaces the need for `CHITRAGUPTA_MESH_PEERS` or `meshNetwork.staticPeers`
 * in single-machine scenarios (the most common case).
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger, getChitraguptaHome } from "@chitragupta/core";

const log = createLogger("cli:mesh-auto-discover");

/** Auto-discovery configuration. */
export interface AutoDiscoverConfig {
	/** Own mesh port (to exclude self). */
	ownMeshPort: number;
	/** Own PID (to exclude self). */
	ownPid: number;
	/** Scan interval in ms. Default: 10_000. */
	scanIntervalMs?: number;
	/** Max age in ms to consider a heartbeat alive. Default: 10_000. */
	staleMs?: number;
	/** Callback to connect to a discovered peer. */
	connectToPeer: (endpoint: string) => Promise<boolean>;
}

/** Running auto-discovery handle. */
export interface AutoDiscoverHandle {
	/** Stop scanning. */
	stop(): void;
	/** Get list of currently known peer endpoints. */
	knownPeers(): string[];
	/** Trigger an immediate scan. */
	scanNow(): Promise<number>;
}

/** Parsed peer info from a heartbeat file. */
interface PeerInfo {
	pid: number;
	meshPort: number;
	endpoint: string;
}

/**
 * Start auto-discovering local mesh peers from heartbeat files.
 *
 * Scans `~/.chitragupta/telemetry/instances/` for heartbeat JSON files,
 * extracts `meshPort` from each, and connects to peers that aren't self.
 */
export function startAutoDiscovery(config: AutoDiscoverConfig): AutoDiscoverHandle {
	const {
		ownMeshPort,
		ownPid,
		scanIntervalMs = 10_000,
		staleMs = 10_000,
		connectToPeer,
	} = config;

	const telemetryDir = path.join(getChitraguptaHome(), "telemetry", "instances");
	const connectedPeers = new Set<string>();
	let timer: ReturnType<typeof setInterval> | null = null;

	/** Scan heartbeat files and return discovered peers. */
	function scanPeers(): PeerInfo[] {
		if (!fs.existsSync(telemetryDir)) return [];

		const now = Date.now();
		const peers: PeerInfo[] = [];

		try {
			for (const entry of fs.readdirSync(telemetryDir, { withFileTypes: true })) {
				if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".tmp-")) {
					continue;
				}
				try {
					const fp = path.join(telemetryDir, entry.name);
					const stat = fs.statSync(fp);
					if (now - stat.mtimeMs > staleMs) continue;

					const data = JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, unknown>;
					const pid = Number(data.pid);
					const meshPort = Number(data.meshPort);

					if (!meshPort || pid === ownPid || meshPort === ownMeshPort) continue;

					peers.push({
						pid,
						meshPort,
						endpoint: `ws://127.0.0.1:${meshPort}/mesh`,
					});
				} catch { /* skip corrupt files */ }
			}
		} catch { /* dir unreadable */ }

		return peers;
	}

	/** Run a discovery scan and connect to new peers. */
	async function scan(): Promise<number> {
		const peers = scanPeers();
		let newConnections = 0;

		for (const peer of peers) {
			if (connectedPeers.has(peer.endpoint)) continue;

			try {
				const ok = await connectToPeer(peer.endpoint);
				if (ok) {
					connectedPeers.add(peer.endpoint);
					newConnections++;
					log.info("Auto-discovered local peer", {
						pid: peer.pid,
						port: peer.meshPort,
					});
				}
			} catch {
				// Peer may have shut down between scan and connect
			}
		}

		// Prune stale connections (peers that no longer have heartbeats)
		const activeEndpoints = new Set(peers.map(p => p.endpoint));
		for (const ep of connectedPeers) {
			if (!activeEndpoints.has(ep)) {
				connectedPeers.delete(ep);
			}
		}

		return newConnections;
	}

	// Initial scan
	scan().catch(() => {});

	// Periodic scanning
	timer = setInterval(() => {
		scan().catch(() => {});
	}, scanIntervalMs);

	return {
		stop() {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
		},
		knownPeers() {
			return [...connectedPeers];
		},
		async scanNow() {
			return scan();
		},
	};
}
