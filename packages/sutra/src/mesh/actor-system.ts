import { randomUUID } from "node:crypto";
import { Actor } from "./actor.js";
import { GossipProtocol } from "./gossip-protocol.js";
import { MeshRouter } from "./mesh-router.js";
import {
	isCapableBehavior,
	type ActorBehavior,
	type ActorSystemConfig,
	type AskOptions,
	type CapableActorBehavior,
	type MCPToolDescriptor,
	type MeshEnvelope,
	type MeshPriority,
	type PeerView,
	type SendOptions,
} from "./types.js";
import type { PeerNetworkConfig } from "./peer-types.js";
import type { PeerConnectionManager } from "./peer-connection.js";
import type { NetworkGossip } from "./network-gossip.js";
import type { PeerAddrDb } from "./peer-addr-db.js";
import type { CapabilityRouter } from "./capability-router.js";
import { CapabilityLearner } from "./capability-learner.js";
const DEFAULTS: Required<ActorSystemConfig> = {
	maxMailboxSize: 10_000,
	defaultTTL: 30_000,
	gossipIntervalMs: 1_000,
	gossipFanout: 3,
	suspectTimeoutMs: 5_000,
	deadTimeoutMs: 15_000,
	defaultAskTimeout: 10_000,
};
type SystemEvent =
	| { type: "actor:spawned"; actorId: string }
	| { type: "actor:stopped"; actorId: string }
	| { type: "message:delivered"; envelope: MeshEnvelope }
	| { type: "message:undeliverable"; envelope: MeshEnvelope; reason: string }
	| { type: "peer:discovered"; peer: PeerView }
	| { type: "peer:suspect"; peer: PeerView }
	| { type: "peer:dead"; peer: PeerView };
type SystemEventHandler = (event: SystemEvent) => void;
export interface SpawnOptions {
	/** Plain behavior function or self-declaring CapableActorBehavior. */
	behavior: ActorBehavior | CapableActorBehavior;
	expertise?: string[];
	capabilities?: string[];
	mailboxSize?: number;
}
export class ActorRef {
	readonly actorId: string;
	private readonly router: MeshRouter;
	constructor(actorId: string, router: MeshRouter) {
		this.actorId = actorId;
		this.router = router;
	}
		tell(from: string, payload: unknown, opts?: SendOptions): void {
		const envelope: MeshEnvelope = {
			id: randomUUID(),
			from,
			to: this.actorId,
			type: "tell",
			topic: opts?.topic,
			payload,
			priority: opts?.priority ?? 1,
			timestamp: Date.now(),
			ttl: opts?.ttl ?? 30_000,
			hops: [from],
		};
		this.router.route(envelope);
	}
		ask(from: string, payload: unknown, opts?: AskOptions): Promise<MeshEnvelope> {
		return this.router.ask(from, this.actorId, payload, opts);
	}
		equals(other: ActorRef): boolean {
		return this.actorId === other.actorId;
	}
	toString(): string {
		return `ActorRef(${this.actorId})`;
	}
}
export class ActorSystem {
	private readonly config: Required<ActorSystemConfig>;
	private readonly router: MeshRouter;
	private readonly gossip: GossipProtocol;
	private readonly capabilityLearner: CapabilityLearner;
	private readonly actors = new Map<string, Actor>();
	private readonly eventHandlers: SystemEventHandler[] = [];
	private running = false;
	constructor(config?: ActorSystemConfig) {
		this.config = { ...DEFAULTS, ...config };
		this.router = new MeshRouter(this.config.defaultTTL, this.config.defaultAskTimeout);
		this.gossip = new GossipProtocol(this.config);
		this.capabilityLearner = new CapabilityLearner(this.gossip);
		// Wire router events to system events
		this.router.on((event) => {
			if (event.type === "delivered") {
				this.emit({ type: "message:delivered", envelope: event.envelope });
			} else if (event.type === "undeliverable") {
				this.emit({
					type: "message:undeliverable",
					envelope: event.envelope,
					reason: event.reason,
				});
			}
		});
		// Wire gossip events to system events
		this.gossip.on((event) => {
			this.emit(event);
		});
	}
	on(handler: SystemEventHandler): () => void {
		this.eventHandlers.push(handler);
		return () => {
			const idx = this.eventHandlers.indexOf(handler);
			if (idx >= 0) this.eventHandlers.splice(idx, 1);
		};
	}
	private emit(event: SystemEvent): void {
		for (const h of this.eventHandlers) {
			try { h(event); } catch { /* observer failures are non-fatal */ }
		}
	}
	/** Spawn a new actor. Auto-extracts capabilities from CapableActorBehavior. */
	spawn(id: string, options: SpawnOptions): ActorRef {
		if (this.actors.has(id)) {
			throw new Error(`Actor "${id}" already exists in this system.`);
		}
		// Auto-extract from CapableActorBehavior if provided
		let handlerFn: ActorBehavior;
		let capabilities = options.capabilities;
		let expertise = options.expertise;
		if (isCapableBehavior(options.behavior)) {
			handlerFn = options.behavior.handle;
			capabilities = [...(capabilities ?? []), ...options.behavior.capabilities];
			expertise = [...(expertise ?? []), ...(options.behavior.expertise ?? [])];
		} else {
			handlerFn = options.behavior;
		}
		const mailboxSize = options.mailboxSize ?? this.config.maxMailboxSize;
		const actor = new Actor(id, handlerFn, this.router, mailboxSize, this.capabilityLearner);
		this.actors.set(id, actor);
		this.router.addActor(actor);
		this.gossip.register(id, expertise, capabilities);
		this.capabilityRouter?.updateLoad(this.connectionManager?.nodeId ?? "local", this.actors.size);
		this.emit({ type: "actor:spawned", actorId: id });
		return new ActorRef(id, this.router);
	}
	stop(actorId: string): boolean {
		const actor = this.actors.get(actorId);
		if (!actor) return false;
		actor.kill();
		this.actors.delete(actorId);
		this.router.removeActor(actorId);
		this.gossip.unregister(actorId);
		this.capabilityLearner.forgetActor(actorId);
		this.capabilityRouter?.updateLoad(this.connectionManager?.nodeId ?? "local", this.actors.size);
		this.emit({ type: "actor:stopped", actorId });
		return true;
	}
		ref(actorId: string): ActorRef | undefined {
		if (!this.actors.has(actorId)) return undefined;
		return new ActorRef(actorId, this.router);
	}
	/** Spawn an actor from MCP tool descriptors. Tool names become capabilities. */
	spawnFromMCP(
		id: string,
		tools: MCPToolDescriptor[],
		onToolCall: (toolName: string, args: unknown) => Promise<unknown>,
		opts?: { mailboxSize?: number },
	): ActorRef {
		const capabilities = tools.map((t) => t.name.replace(/_/g, "-"));
		const behavior: ActorBehavior = async (envelope, ctx) => {
			const payload = envelope.payload as Record<string, unknown> | undefined;
			const toolName = (payload?.tool as string) ?? capabilities[0];
			const result = await onToolCall(toolName, payload?.args ?? payload);
			if (envelope.type === "ask") ctx.reply(result);
		};
		return this.spawn(id, { behavior, capabilities, mailboxSize: opts?.mailboxSize });
	}
		tell(from: string, to: string, payload: unknown, opts?: SendOptions): void {
		const envelope: MeshEnvelope = {
			id: randomUUID(),
			from,
			to,
			type: "tell",
			topic: opts?.topic,
			payload,
			priority: opts?.priority ?? 1,
			timestamp: Date.now(),
			ttl: opts?.ttl ?? this.config.defaultTTL,
			hops: [from],
			requiredCapabilities: opts?.requiredCapabilities,
		};
		this.router.route(envelope);
	}
		ask(
		from: string,
		to: string,
		payload: unknown,
		opts?: AskOptions,
	): Promise<MeshEnvelope> {
		return this.router.ask(from, to, payload, opts);
	}
		broadcast(from: string, payload: unknown, opts?: SendOptions): void {
		const envelope: MeshEnvelope = {
			id: randomUUID(),
			from,
			to: "*",
			type: "tell",
			topic: opts?.topic,
			payload,
			priority: opts?.priority ?? 1,
			timestamp: Date.now(),
			ttl: opts?.ttl ?? this.config.defaultTTL,
			hops: [from],
		};
		this.router.route(envelope);
	}
	subscribe(actorId: string, topic: string): void {
		this.router.subscribe(actorId, topic);
	}
	unsubscribe(actorId: string, topic: string): void {
		this.router.unsubscribe(actorId, topic);
	}
		findByExpertise(expertise: string): PeerView[] {
		return this.gossip.findByExpertise(expertise);
	}
		findAlive(): PeerView[] {
		return this.gossip.findAlive();
	}
	/** Find alive peers declaring the given capability. */
	findByCapability(capability: string): PeerView[] {
		return this.gossip.findByCapability(capability);
	}
	/** Get the capability router (null if P2P not bootstrapped). */
	getCapabilityRouter(): CapabilityRouter | null { return this.capabilityRouter; }
	private connectionManager: PeerConnectionManager | null = null;
	private networkGossip: NetworkGossip | null = null;
	private peerAddrDb: PeerAddrDb | null = null;
	private peerAddrDbPath: string | null = null;
	private peerAddrDbUnsub: (() => void) | null = null;
	private peerAddrDbSaveTimer: ReturnType<typeof setInterval> | null = null;
	private capabilityRouter: CapabilityRouter | null = null;
		async bootstrapP2P(networkConfig: PeerNetworkConfig): Promise<number> {
		const { PeerConnectionManager: ConnMgr } = await import("./peer-connection.js");
		const { NetworkGossip: NetGossip } = await import("./network-gossip.js");
		const { PeerAddrDb: AddrDb } = await import("./peer-addr-db.js");
		const staticPeers = [...new Set(networkConfig.staticPeers ?? [])];
		const peerAddrDbPath = networkConfig.peerAddrDbPath?.trim() || "";
		if (peerAddrDbPath) {
			this.peerAddrDb = new AddrDb();
			this.peerAddrDbPath = peerAddrDbPath;
			await this.peerAddrDb.load(peerAddrDbPath);
			for (const endpoint of staticPeers) {
				this.peerAddrDb.add(
					{ nodeId: this.peerIdFromEndpoint(endpoint), endpoint, joinedAt: Date.now() },
					"static",
				);
			}
			const bootLimit = networkConfig.peerAddrDbBootstrapCount ?? 20;
			const fromDb = this.peerAddrDb.getBootstrapPeers(bootLimit).map((peer) => peer.endpoint);
			staticPeers.push(...fromDb);
		}
		this.connectionManager = new ConnMgr({
			...networkConfig,
			staticPeers: [...new Set(staticPeers)],
		});
		this.connectionManager.setRouter(this.router);
		if (this.peerAddrDb) {
			this.peerAddrDbUnsub = this.peerAddrDb.attachTo(this.connectionManager);
		}
		this.networkGossip = new NetGossip(
			this.connectionManager.nodeId,
			this.gossip,
			this.connectionManager,
			{ exchangeIntervalMs: networkConfig.gossipIntervalMs },
		);
		// P2P mesh resolver: actorId → gossip location → peer channel
		this.router.setPeerChannelResolver((actorId) => {
			const nodeId = this.networkGossip?.findNode(actorId);
			if (!nodeId) return undefined;
			const channels = this.connectionManager!.getConnectedChannels();
			return channels.find((ch) =>
				ch.peerId === nodeId || ch.remoteNodeInfo?.nodeId === nodeId,
			);
		});
		// Wire capability-based routing (dynamic import to avoid circular deps)
		const { CapabilityRouter: CapRouter } = await import("./capability-router.js");
		const guard = this.connectionManager.guard;
		this.capabilityRouter = new CapRouter(this.gossip, guard);
		this.router.setCapabilityResolver((caps) => {
			const peer = this.capabilityRouter!.resolve({ capabilities: caps });
			if (!peer?.originNodeId) return undefined;
			return this.connectionManager!.getConnectedChannels()
				.find((ch) => ch.peerId === peer.originNodeId || ch.remoteNodeInfo?.nodeId === peer.originNodeId);
		});
		// Start gossip before connections so handler is wired for first connect
		this.networkGossip.start();
		const port = await this.connectionManager.start();
		this.connectionManager.on((event) => {
			if (event.type === "peer:connected") {
				// Register channel with router for broadcast support
				const ch = this.connectionManager!.getConnectedChannels()
					.find((c) => c.peerId === event.peerId);
				if (ch) this.router.addChannel(ch);
				this.emit({ type: "peer:discovered", peer: {
					actorId: event.peerId,
					status: "alive",
					generation: 0,
					lastSeen: Date.now(),
				}});
			}
			if (event.type === "peer:disconnected" || event.type === "peer:dead") {
				this.router.removeChannel(event.peerId);
			}
			});
		if (this.peerAddrDbPath && this.peerAddrDb) {
			await this.savePeerAddrDb();
			const saveEveryMs = Math.max(5_000, networkConfig.peerAddrDbSaveIntervalMs ?? 30_000);
			this.peerAddrDbSaveTimer = setInterval(() => {
				void this.savePeerAddrDb();
			}, saveEveryMs);
		}
		return port;
	}
		getNetworkGossip(): NetworkGossip | null { return this.networkGossip; }
		getConnectionManager(): PeerConnectionManager | null { return this.connectionManager; }
		getRouter(): MeshRouter { return this.router; }
		getGossipProtocol(): GossipProtocol { return this.gossip; }
		start(): void {
		if (this.running) return;
		this.running = true;
		this.gossip.start();
		this.capabilityLearner.start();
	}
	async shutdown(): Promise<void> {
		if (!this.running) return;
		this.running = false;
		if (this.networkGossip) {
			this.networkGossip.destroy();
			this.networkGossip = null;
		}
		if (this.peerAddrDbSaveTimer) {
			clearInterval(this.peerAddrDbSaveTimer);
			this.peerAddrDbSaveTimer = null;
		}
		this.peerAddrDbUnsub?.();
		this.peerAddrDbUnsub = null;
		for (const [id, actor] of this.actors) {
			actor.kill();
			this.capabilityLearner.forgetActor(id);
			this.emit({ type: "actor:stopped", actorId: id });
		}
		this.actors.clear();
		this.capabilityLearner.destroy();
		this.gossip.stop();
		this.eventHandlers.length = 0;
		await this.savePeerAddrDb();
		this.peerAddrDb = null;
		this.peerAddrDbPath = null;
		if (this.connectionManager) {
			await this.connectionManager.stop();
			this.connectionManager = null;
		}
		this.router.destroy();
	}
		get isRunning(): boolean {
		return this.running;
	}
		get actorCount(): number {
		return this.actors.size;
	}
	private peerIdFromEndpoint(endpoint: string): string {
		try {
			const url = new URL(endpoint);
			return `${url.hostname}:${url.port}`;
		} catch {
			return endpoint;
		}
	}
	private async savePeerAddrDb(): Promise<void> {
		if (!this.peerAddrDb || !this.peerAddrDbPath) return;
		try {
			this.peerAddrDb.prune();
			await this.peerAddrDb.save(this.peerAddrDbPath);
		} catch {
			// Non-fatal: mesh must continue even if persistence fails.
		}
	}
}
