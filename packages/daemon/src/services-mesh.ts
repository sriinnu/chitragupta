import type {
	ActorSystem,
	CapableActorBehavior,
	MeshPriority,
} from "@chitragupta/sutra";
import type { CapabilityStrategy } from "@chitragupta/sutra/mesh/capability-router";
import type { RpcRouter } from "./rpc-router.js";
import {
	ensureCollaborationMeshReady,
	getCollaborationMeshPort,
} from "./services-collaboration-mesh.js";

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

interface MeshStatusSnapshot {
	runtimeSource: "daemon";
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

interface MeshResolvedPeer {
	actorId: string;
	status: string;
	capabilities?: string[];
	originNodeId?: string;
}

function createGenericMeshActorBehavior(
	actorId: string,
	capabilities: string[] | undefined,
	expertise: string[] | undefined,
): CapableActorBehavior {
	return {
		capabilities: capabilities ?? [],
		expertise,
		handle: async (envelope, ctx) => {
			if (envelope.type === "ask") {
				ctx.reply({
					actorId,
					status: "ok",
					capabilities: capabilities ?? [],
					expertise: expertise ?? [],
					received: envelope.payload,
				});
			}
		},
	};
}

function buildMeshStatusSnapshot(mesh: ActorSystem): MeshStatusSnapshot {
	const connMgr = mesh.getConnectionManager();
	const gossip = mesh.getGossipProtocol();
	const netGossip = mesh.getNetworkGossip();
	const capRouter = mesh.getCapabilityRouter();
	const allPeers = gossip?.getView() ?? [];
	const localActors = allPeers.filter((peer) => !peer.originNodeId);
	const remoteGossipPeers = allPeers.filter((peer) => !!peer.originNodeId);

	return {
		runtimeSource: "daemon",
		running: mesh.isRunning,
		actorCount: mesh.actorCount,
		localActorsAlive: localActors.filter((peer) => peer.status === "alive").length,
		localActors,
		p2pBootstrapped: connMgr !== null,
		nodeId: connMgr?.nodeId ?? null,
		meshPort: getCollaborationMeshPort(),
		peers: connMgr?.getPeers() ?? [],
		connectedCount: connMgr?.connectedCount ?? 0,
		totalPeers: connMgr?.peerCount ?? 0,
		actorLocations: netGossip?.locationCount ?? 0,
		gossipRunning: gossip !== null,
		gossipPeers: remoteGossipPeers.filter((peer) => peer.status === "alive").length,
		remoteGossipPeers,
		capabilityRouterActive: capRouter !== null,
	};
}

function buildMeshTopology(mesh: ActorSystem): Record<string, unknown> {
	const connMgr = mesh.getConnectionManager();
	const gossip = mesh.getGossipProtocol();
	const netGossip = mesh.getNetworkGossip();
	const capMap = new Map<string, string[]>();

	if (gossip) {
		for (const peer of gossip.findAlive()) {
			for (const capability of peer.capabilities ?? []) {
				const actors = capMap.get(capability) ?? [];
				actors.push(peer.actorId);
				capMap.set(capability, actors);
			}
		}
	}

	const actorLocations: Record<string, string> = {};
	if (netGossip) {
		for (const [actorId, nodeId] of netGossip.getLocations()) {
			actorLocations[actorId] = nodeId;
		}
	}

	return {
		runtimeSource: "daemon",
		localNode: connMgr?.nodeId ?? "local-only",
		actorCount: mesh.actorCount,
		p2pBootstrapped: connMgr !== null,
		meshPort: getCollaborationMeshPort(),
		connections: connMgr?.getPeers().map((peer) => ({
			peerId: peer.peerId,
			state: peer.state,
			direction: peer.outbound ? "outbound" : "inbound",
			endpoint: peer.endpoint,
		})) ?? [],
		actorLocations,
		capabilityIndex: Object.fromEntries(capMap),
		gossipStats: gossip
			? {
				alive: gossip.findAlive().length,
				total: gossip.getView().length,
			}
			: null,
	};
}

function buildMeshGossip(mesh: ActorSystem): Record<string, unknown> {
	const gossip = mesh.getGossipProtocol();
	if (!gossip) {
		return {
			runtimeSource: "daemon",
			total: 0,
			alive: 0,
			suspect: 0,
			dead: 0,
			peers: [],
		};
	}

	const view = gossip.getView();
	return {
		runtimeSource: "daemon",
		total: view.length,
		alive: view.filter((peer) => peer.status === "alive").length,
		suspect: view.filter((peer) => peer.status === "suspect").length,
		dead: view.filter((peer) => peer.status === "dead").length,
		peers: view.map((peer) => ({
			actorId: peer.actorId,
			status: peer.status,
			generation: peer.generation,
			capabilities: peer.capabilities ?? [],
			expertise: peer.expertise ?? [],
			originNodeId: peer.originNodeId ?? null,
			lastSeen: new Date(peer.lastSeen).toISOString(),
		})),
	};
}

function formatResolvedPeer(peer: MeshResolvedPeer) {
	return {
		actorId: peer.actorId,
		status: peer.status,
		capabilities: peer.capabilities ?? [],
		originNodeId: peer.originNodeId ?? null,
	};
}

export function registerMeshMethods(router: RpcRouter): void {
	router.register("mesh.status", async () => {
		const mesh = await ensureCollaborationMeshReady();
		return buildMeshStatusSnapshot(mesh);
	}, "Report daemon-owned mesh runtime status for built-in Sabha consultation actors and remote peers");

	router.register("mesh.peers", async () => {
		const mesh = await ensureCollaborationMeshReady();
		return buildMeshStatusSnapshot(mesh);
	}, "Report daemon-owned mesh peers and local actor liveness");

	router.register("mesh.topology", async () => {
		const mesh = await ensureCollaborationMeshReady();
		return buildMeshTopology(mesh);
	}, "Report daemon-owned mesh topology, actor locations, and capability index");

	router.register("mesh.gossip", async () => {
		const mesh = await ensureCollaborationMeshReady();
		return buildMeshGossip(mesh);
	}, "Report daemon-owned gossip state for the collaboration mesh");

	router.register("mesh.connect", async (params) => {
		const endpoint = String(params.endpoint ?? "").trim();
		if (!endpoint) throw new Error("Missing endpoint");
		const mesh = await ensureCollaborationMeshReady();
		const connMgr = mesh.getConnectionManager();
		if (!connMgr) {
			return { connected: false, endpoint, reason: "P2P mesh not bootstrapped" };
		}
		const channel = await connMgr.connectToPeer(endpoint);
		return { connected: channel !== null, endpoint };
	}, "Connect the daemon-owned mesh runtime to a remote peer endpoint");

	router.register("mesh.spawn", async (params) => {
		const actorId = String(params.actorId ?? "").trim();
		if (!actorId) throw new Error("Missing actorId");
		const capabilities = Array.isArray(params.capabilities)
			? params.capabilities.map(String)
			: undefined;
		const expertise = Array.isArray(params.expertise)
			? params.expertise.map(String)
			: undefined;
		const mesh = await ensureCollaborationMeshReady();
		mesh.spawn(actorId, {
			behavior: createGenericMeshActorBehavior(actorId, capabilities, expertise),
			capabilities,
			expertise,
		});
		return { actorId, capabilities: capabilities ?? [], expertise: expertise ?? [] };
	}, "Spawn a daemon-owned actor in the collaboration mesh");

	router.register("mesh.send", async (params) => {
		const from = String(params.from ?? "").trim();
		const to = String(params.to ?? "").trim();
		if (!from || !to) throw new Error("Missing from or to");
		const mesh = await ensureCollaborationMeshReady();
		const priority = params.priority == null ? undefined : Number(params.priority) as MeshPriority;
		mesh.tell(from, to, params.payload, priority == null ? undefined : { priority });
		return { delivered: true, from, to };
	}, "Send a fire-and-forget message through the daemon-owned collaboration mesh");

	router.register("mesh.ask", async (params) => {
		const from = String(params.from ?? "").trim();
		const to = String(params.to ?? "").trim();
		if (!from || !to) throw new Error("Missing from or to");
		const mesh = await ensureCollaborationMeshReady();
		const timeout = params.timeout == null ? undefined : Number(params.timeout);
		const reply = await mesh.ask(from, to, params.payload, timeout == null ? undefined : { timeout });
		return reply;
	}, "Send a request-reply message through the daemon-owned collaboration mesh");

	router.register("mesh.find_capability", async (params) => {
		const capabilities = Array.isArray(params.capabilities)
			? params.capabilities.map(String).filter(Boolean)
			: [];
		if (capabilities.length === 0) throw new Error("Missing capabilities");
		const strategy = String(params.strategy ?? "best");
		const listAll = params.listAll === true;
		const mesh = await ensureCollaborationMeshReady();
		const capRouter = mesh.getCapabilityRouter();
		if (!capRouter) {
			const gossip = mesh.getGossipProtocol();
			const peers = (gossip?.findByCapability(capabilities[0]) ?? [])
				.filter((peer) => capabilities.every((cap) => peer.capabilities?.includes(cap)));
			return {
				capabilities,
				peers: peers.map(formatResolvedPeer),
				selected: listAll || peers.length === 0 ? null : formatResolvedPeer(peers[0]),
				strategy: "gossip-fallback",
			};
		}
		const resolvedStrategy = strategy as CapabilityStrategy;
		const peers = capRouter.findMatchingAll(capabilities).map(formatResolvedPeer);
		const selected = listAll ? null : capRouter.resolve({ capabilities, strategy: resolvedStrategy });
		return {
			capabilities,
			peers,
			selected: selected ? formatResolvedPeer(selected) : null,
			strategy: resolvedStrategy,
		};
	}, "Resolve collaboration-mesh peers by capability using the daemon-owned router");
}
