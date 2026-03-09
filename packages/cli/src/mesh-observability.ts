import type { ActorSystemLike } from "./modes/mcp-subsystems-types.js";

interface MeshGossipPeer {
	actorId: string;
	status: string;
	generation: number;
	lastSeen: number;
	capabilities?: string[];
	expertise?: string[];
	originNodeId?: string;
}

interface MeshConnectionPeer {
	peerId: string;
	endpoint: string;
	state: string;
	outbound: boolean;
}

export interface MeshStatusSnapshot {
	runtimeSource: "local-fallback";
	running: boolean;
	actorCount: number;
	localActorsAlive: number;
	localActors: MeshGossipPeer[];
	p2pBootstrapped: boolean;
	nodeId: string | null;
	meshPort: number;
	peers: MeshConnectionPeer[];
	connectedCount: number;
	totalPeers: number;
	actorLocations: number;
	gossipRunning: boolean;
	gossipPeers: number;
	remoteGossipPeers: MeshGossipPeer[];
	capabilityRouterActive: boolean;
}

export function getMeshRuntimeSnapshot(
	actorSystem: unknown,
	meshPort = 0,
): MeshStatusSnapshot | undefined {
	try {
		const sys = actorSystem as ActorSystemLike | undefined;
		if (!sys) return undefined;
		const connMgr = sys.getConnectionManager();
		const gossip = sys.getGossipProtocol();
		const netGossip = sys.getNetworkGossip();
		const capRouter = sys.getCapabilityRouter();
		const allPeers = gossip?.getView() ?? [];
		const localActors = allPeers.filter((peer) => !peer.originNodeId);
		const remoteGossipPeers = allPeers.filter((peer) => !!peer.originNodeId);

		return {
			runtimeSource: "local-fallback",
			running: sys.isRunning,
			actorCount: sys.actorCount,
			localActorsAlive: localActors.filter((peer) => peer.status === "alive").length,
			localActors,
			p2pBootstrapped: connMgr !== null,
			nodeId: connMgr?.nodeId ?? null,
			meshPort,
			peers: connMgr?.getPeers() ?? [],
			connectedCount: connMgr?.connectedCount ?? 0,
			totalPeers: connMgr?.peerCount ?? 0,
			actorLocations: netGossip?.locationCount ?? 0,
			gossipRunning: gossip !== null,
			gossipPeers: remoteGossipPeers.filter((peer) => peer.status === "alive").length,
			remoteGossipPeers,
			capabilityRouterActive: capRouter !== null,
		};
	} catch {
		return undefined;
	}
}

export function formatMeshPeersSnapshot(
	status: MeshStatusSnapshot,
	statusFilter = "all",
): string {
	const filterMatches = (peer: MeshGossipPeer): boolean =>
		statusFilter === "all" || peer.status === statusFilter;

	const sections: string[] = [];
	const localActors = status.localActors.filter(filterMatches);
	const remotePeers = status.remoteGossipPeers.filter(filterMatches);

	if (localActors.length > 0) {
		const lines = localActors.map((peer) =>
			`  ${peer.actorId} | ${peer.status} | gen=${peer.generation} | caps=[${(peer.capabilities ?? []).join(",")}] | node=local`,
		);
		sections.push(`Local Actors (${localActors.length}):\n${lines.join("\n")}`);
	} else {
		sections.push("Local Actors: none");
	}

	if (remotePeers.length > 0) {
		const lines = remotePeers.map((peer) =>
			`  ${peer.actorId} | ${peer.status} | gen=${peer.generation} | caps=[${(peer.capabilities ?? []).join(",")}] | node=${peer.originNodeId}`,
		);
		sections.push(`Remote Gossip Peers (${remotePeers.length}):\n${lines.join("\n")}`);
	} else {
		sections.push("Remote Gossip Peers: none");
	}

	if (status.peers.length > 0) {
		const lines = status.peers.map((peer) =>
			`  ${peer.peerId} | ${peer.state} | ${peer.outbound ? "out" : "in"} | ${peer.endpoint}`,
		);
		sections.push(`P2P Connections (${status.peers.length}):\n${lines.join("\n")}`);
	} else if (status.p2pBootstrapped) {
		sections.push("P2P Connections: none");
	} else {
		sections.push("P2P: not bootstrapped");
	}

	return sections.join("\n\n");
}
