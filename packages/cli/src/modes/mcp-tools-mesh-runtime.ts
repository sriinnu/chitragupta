import { getActorSystem } from "./mcp-subsystems.js";
import { getMeshRuntimeSnapshot } from "../mesh-observability.js";
import {
	askMeshViaDaemon,
	findMeshCapabilityViaDaemon,
	getMeshGossipViaDaemon,
	getMeshPeersViaDaemon,
	getMeshStatusViaDaemon,
	getMeshTopologyViaDaemon,
	sendMeshMessageViaDaemon,
	spawnMeshActorViaDaemon,
} from "./daemon-bridge-collective.js";
import { allowLocalCollectiveFallback } from "../runtime-daemon-proxies.js";

async function getLocalMeshStatus() {
	const sys = await getActorSystem();
	return getMeshRuntimeSnapshot(sys);
}

export async function getMeshStatusWithFallback() {
	try {
		return await getMeshStatusViaDaemon();
	} catch {
			if (!allowLocalCollectiveFallback()) throw new Error("Daemon mesh runtime unavailable and local collective fallback disabled.");
		const status = await getLocalMeshStatus();
		if (!status) throw new Error("Mesh runtime unavailable.");
		return status;
	}
}

export async function getMeshPeersWithFallback() {
	try {
		return await getMeshPeersViaDaemon();
	} catch {
			if (!allowLocalCollectiveFallback()) throw new Error("Daemon mesh runtime unavailable and local collective fallback disabled.");
		const status = await getLocalMeshStatus();
		if (!status) throw new Error("Mesh runtime unavailable.");
		return status;
	}
}

export async function getMeshTopologyWithFallback() {
	try {
		return await getMeshTopologyViaDaemon();
	} catch {
			if (!allowLocalCollectiveFallback()) throw new Error("Daemon mesh runtime unavailable and local collective fallback disabled.");
		const sys = await getActorSystem();
		const gossip = sys.getGossipProtocol();
		const connMgr = sys.getConnectionManager();
		const netGossip = sys.getNetworkGossip();
		const capMap = new Map<string, string[]>();

		if (gossip) {
			for (const peer of gossip.findAlive()) {
				for (const cap of peer.capabilities ?? []) {
					const actors = capMap.get(cap) ?? [];
					actors.push(peer.actorId);
					capMap.set(cap, actors);
				}
			}
		}

		const locations: Record<string, string> = {};
		if (netGossip) {
			for (const [actorId, nodeId] of netGossip.getLocations()) {
				locations[actorId] = nodeId;
			}
		}

		return {
			runtimeSource: "local-fallback",
			localNode: connMgr?.nodeId ?? "local-only",
			actorCount: sys.actorCount,
			p2pBootstrapped: connMgr !== null,
			connections: connMgr?.getPeers().map((c) => ({
				peerId: c.peerId, state: c.state, direction: c.outbound ? "outbound" : "inbound", endpoint: c.endpoint,
			})) ?? [],
			actorLocations: locations,
			capabilityIndex: Object.fromEntries(capMap),
			gossipStats: gossip ? {
				alive: gossip.findAlive().length,
				total: gossip.getView().length,
			} : null,
		};
	}
}

export async function getMeshGossipWithFallback() {
	try {
		return await getMeshGossipViaDaemon();
	} catch {
			if (!allowLocalCollectiveFallback()) throw new Error("Daemon mesh runtime unavailable and local collective fallback disabled.");
		const sys = await getActorSystem();
		const gossip = sys.getGossipProtocol();
		if (!gossip) {
			return {
				runtimeSource: "local-fallback",
				total: 0,
				alive: 0,
				suspect: 0,
				dead: 0,
				peers: [],
			};
		}
		const view = gossip.getView();
		return {
			runtimeSource: "local-fallback",
			total: view.length,
			alive: view.filter((p) => p.status === "alive").length,
			suspect: view.filter((p) => p.status === "suspect").length,
			dead: view.filter((p) => p.status === "dead").length,
			peers: view.map((p) => ({
				actorId: p.actorId,
				status: p.status,
				generation: p.generation,
				capabilities: p.capabilities ?? [],
				expertise: p.expertise ?? [],
				originNodeId: p.originNodeId ?? null,
				lastSeen: new Date(p.lastSeen).toISOString(),
			})),
		};
	}
}

export async function spawnMeshActorWithFallback(params: {
	actorId: string;
	capabilities?: string[];
	expertise?: string[];
}) {
	try {
		return await spawnMeshActorViaDaemon(params);
	} catch {
			if (!allowLocalCollectiveFallback()) throw new Error("Daemon mesh runtime unavailable and local collective fallback disabled.");
		const sys = await getActorSystem();
		const behavior = params.capabilities?.length
			? {
				capabilities: params.capabilities,
				expertise: params.expertise,
				handle: (_envelope: unknown, _ctx: unknown) => { /* no-op */ },
			}
			: () => { /* no-op */ };
		sys.spawn(params.actorId, {
			behavior,
			capabilities: params.capabilities,
			expertise: params.expertise,
		});
		return { actorId: params.actorId, capabilities: params.capabilities ?? [], expertise: params.expertise ?? [] };
	}
}

export async function sendMeshMessageWithFallback(params: {
	from: string;
	to: string;
	payload: unknown;
	priority?: number;
}) {
	try {
		return await sendMeshMessageViaDaemon(params);
	} catch {
			if (!allowLocalCollectiveFallback()) throw new Error("Daemon mesh runtime unavailable and local collective fallback disabled.");
		const sys = await getActorSystem();
		const opts = params.priority == null ? undefined : { priority: params.priority };
		sys.tell(params.from, params.to, params.payload, opts);
		return { delivered: true, from: params.from, to: params.to };
	}
}

export async function askMeshWithFallback(params: {
	from: string;
	to: string;
	payload: unknown;
	timeout?: number;
}) {
	try {
		return await askMeshViaDaemon(params);
	} catch {
			if (!allowLocalCollectiveFallback()) throw new Error("Daemon mesh runtime unavailable and local collective fallback disabled.");
		const sys = await getActorSystem();
		const opts = params.timeout == null ? undefined : { timeout: params.timeout };
		return sys.ask(params.from, params.to, params.payload, opts);
	}
}

export async function findMeshCapabilityWithFallback(params: {
	capabilities: string[];
	strategy?: string;
	listAll?: boolean;
}) {
	try {
		return await findMeshCapabilityViaDaemon(params);
	} catch {
			if (!allowLocalCollectiveFallback()) throw new Error("Daemon mesh runtime unavailable and local collective fallback disabled.");
		const sys = await getActorSystem();
		const capRouter = sys.getCapabilityRouter();
		if (!capRouter) {
			const gossip = sys.getGossipProtocol();
			const peers = (gossip?.findByCapability(params.capabilities[0]) ?? [])
				.filter((peer) => params.capabilities.every((cap) => peer.capabilities?.includes(cap)));
			return {
				capabilities: params.capabilities,
				peers,
				selected: params.listAll || peers.length === 0 ? null : peers[0],
				strategy: "gossip-fallback",
			};
		}
		return {
			capabilities: params.capabilities,
			peers: capRouter.findMatchingAll(params.capabilities),
			selected: params.listAll ? null : capRouter.resolve({
				capabilities: params.capabilities,
				strategy: params.strategy ?? "best",
			}),
			strategy: params.strategy ?? "best",
		};
	}
}
