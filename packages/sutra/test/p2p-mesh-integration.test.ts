/** P2P Mesh Integration — real multi-node tests with actual WebSocket connections. */

import { describe, it, expect, afterEach } from "vitest";
import { ActorSystem } from "../src/mesh/actor-system.js";
import type { MeshEnvelope, ActorBehavior } from "../src/mesh/types.js";
import type { PeerNetworkConfig } from "../src/mesh/peer-types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a mesh node with P2P networking on a random port. */
async function createNode(opts: {
	label: string; staticPeers?: string[]; meshSecret?: string;
}): Promise<{ system: ActorSystem; port: number; nodeId: string }> {
	const system = new ActorSystem({
		maxMailboxSize: 5_000, gossipIntervalMs: 500, gossipFanout: 3,
		suspectTimeoutMs: 2_000, deadTimeoutMs: 5_000, defaultAskTimeout: 5_000,
	});
	system.start();
	const port = await system.bootstrapP2P({
		listenPort: 0, listenHost: "127.0.0.1", staticPeers: opts.staticPeers,
		meshSecret: opts.meshSecret, pingIntervalMs: 2_000, maxMissedPings: 2,
		gossipIntervalMs: 1_000, peerExchangeIntervalMs: 2_000, label: opts.label,
	});
	return { system, port, nodeId: system.getConnectionManager()!.nodeId };
}

/** Wait for a condition with timeout. */
async function waitFor(
	condition: () => boolean,
	timeoutMs = 10_000,
	intervalMs = 100,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) return;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/** Simple echo behavior — replies with received payload. */
const echoBehavior: ActorBehavior = (envelope, ctx) => {
	if (envelope.type === "ask") {
		ctx.reply({ echo: envelope.payload, from: ctx.self });
	}
};

/** Collector behavior — stores all received messages. */
function collectorBehavior(): { behavior: ActorBehavior; messages: MeshEnvelope[] } {
	const messages: MeshEnvelope[] = [];
	const behavior: ActorBehavior = (envelope) => {
		messages.push(envelope);
	};
	return { behavior, messages };
}

/** Counter behavior — counts received messages, replies with count on ask. */
function counterBehavior(): { behavior: ActorBehavior; getCount: () => number } {
	let count = 0;
	const behavior: ActorBehavior = (envelope, ctx) => {
		count++;
		if (envelope.type === "ask") {
			ctx.reply({ count });
		}
	};
	return { behavior, getCount: () => count };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("P2P Mesh Integration (real multi-node)", () => {
	const nodes: Array<{ system: ActorSystem; port: number; nodeId: string }> = [];

	afterEach(async () => {
		// Shut down all nodes after each test
		for (const node of nodes) {
			try { await node.system.shutdown(); } catch { /* best-effort */ }
		}
		nodes.length = 0;
	});

	it("two nodes connect and exchange gossip", async () => {
		const nodeA = await createNode({ label: "alpha" });
		nodes.push(nodeA);
		const nodeB = await createNode({ label: "beta", staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`] });
		nodes.push(nodeB);
		await waitFor(() => nodeB.system.getConnectionManager()!.connectedCount > 0, 5_000);
		expect(nodeB.system.getConnectionManager()!.connectedCount).toBeGreaterThanOrEqual(1);
		expect(nodeA.system.getConnectionManager()!.connectedCount).toBeGreaterThanOrEqual(1);
	});

	it("cross-node ask/reply between actors", async () => {
		const nodeA = await createNode({ label: "alpha" });
		nodes.push(nodeA);
		const nodeB = await createNode({ label: "beta", staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`] });
		nodes.push(nodeB);
		nodeB.system.spawn("echo-b", { behavior: echoBehavior });
		await waitFor(() => nodeA.system.getConnectionManager()!.connectedCount > 0, 5_000);
		await waitFor(() => nodeA.system.getNetworkGossip()?.findNode("echo-b") !== undefined, 8_000);
		const reply = await nodeA.system.ask("caller-a", "echo-b", { msg: "hello from A" });
		expect(reply.payload).toEqual({ echo: { msg: "hello from A" }, from: "echo-b" });
	});

	it("cross-node tell delivers message", async () => {
		const nodeA = await createNode({ label: "alpha" });
		nodes.push(nodeA);

		const nodeB = await createNode({
			label: "beta",
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`],
		});
		nodes.push(nodeB);

		// Spawn collector on Node B
		const collector = collectorBehavior();
		nodeB.system.spawn("inbox-b", { behavior: collector.behavior });

		await waitFor(() => nodeA.system.getConnectionManager()!.connectedCount > 0, 5_000);
		await waitFor(() => {
			const g = nodeA.system.getNetworkGossip();
			return g !== null && g.findNode("inbox-b") !== undefined;
		}, 8_000);

		// Node A tells inbox-b
		nodeA.system.tell("sender-a", "inbox-b", { data: "cross-node tell" });

		// Wait for delivery
		await waitFor(() => collector.messages.length > 0, 5_000);
		expect(collector.messages[0].payload).toEqual({ data: "cross-node tell" });
	});

	// ── 3-Node Mesh ─────────────────────────────────────────────────

	it("three nodes form a mesh and route messages", async () => {
		const nodeA = await createNode({ label: "alpha" });
		nodes.push(nodeA);

		const nodeB = await createNode({
			label: "beta",
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`],
		});
		nodes.push(nodeB);

		const nodeC = await createNode({
			label: "gamma",
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`, `ws://127.0.0.1:${nodeB.port}/mesh`],
		});
		nodes.push(nodeC);

		// Spawn actors on each node
		nodeA.system.spawn("actor-a", { behavior: echoBehavior });
		nodeB.system.spawn("actor-b", { behavior: echoBehavior });
		nodeC.system.spawn("actor-c", { behavior: echoBehavior });

		// Wait for full mesh connectivity
		await waitFor(() => {
			const cA = nodeA.system.getConnectionManager()!.connectedCount;
			const cB = nodeB.system.getConnectionManager()!.connectedCount;
			const cC = nodeC.system.getConnectionManager()!.connectedCount;
			return cA >= 1 && cB >= 1 && cC >= 2;
		}, 8_000);

		// Wait for gossip to propagate all actor locations
		await waitFor(() => {
			const gA = nodeA.system.getNetworkGossip()!;
			const gC = nodeC.system.getNetworkGossip()!;
			return gA.findNode("actor-c") !== undefined && gC.findNode("actor-a") !== undefined;
		}, 10_000);

		// Node C asks actor-a on Node A
		const replyFromA = await nodeC.system.ask("caller-c", "actor-a", "ping-from-c");
		expect(replyFromA.payload).toEqual({ echo: "ping-from-c", from: "actor-a" });

		// Node A asks actor-c on Node C
		const replyFromC = await nodeA.system.ask("caller-a", "actor-c", "ping-from-a");
		expect(replyFromC.payload).toEqual({ echo: "ping-from-a", from: "actor-c" });
	});

	// ── Gossip Convergence ──────────────────────────────────────────

	it("gossip converges: all nodes know all actors", async () => {
		const nodeA = await createNode({ label: "alpha" });
		nodes.push(nodeA);

		const nodeB = await createNode({
			label: "beta",
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`],
		});
		nodes.push(nodeB);

		const nodeC = await createNode({
			label: "gamma",
			staticPeers: [`ws://127.0.0.1:${nodeB.port}/mesh`],
		});
		nodes.push(nodeC);

		// Spawn actors spread across nodes
		nodeA.system.spawn("worker-1", { behavior: echoBehavior, expertise: ["coding"] });
		nodeA.system.spawn("worker-2", { behavior: echoBehavior, expertise: ["research"] });
		nodeB.system.spawn("worker-3", { behavior: echoBehavior, expertise: ["testing"] });
		nodeC.system.spawn("worker-4", { behavior: echoBehavior, expertise: ["review"] });

		// Wait for gossip convergence — all nodes should know about all actors
		await waitFor(() => {
			const gA = nodeA.system.getNetworkGossip();
			const gB = nodeB.system.getNetworkGossip();
			const gC = nodeC.system.getNetworkGossip();
			if (!gA || !gB || !gC) return false;

			// Each node should know remote actors (not their own local ones)
			const aKnowsRemote = gA.findNode("worker-3") !== undefined && gA.findNode("worker-4") !== undefined;
			const bKnowsRemote = gB.findNode("worker-1") !== undefined && gB.findNode("worker-4") !== undefined;
			const cKnowsRemote = gC.findNode("worker-1") !== undefined && gC.findNode("worker-3") !== undefined;
			return aKnowsRemote && bKnowsRemote && cKnowsRemote;
		}, 15_000);

		// Verify convergence
		const locationsA = nodeA.system.getNetworkGossip()!.getLocations();
		const locationsC = nodeC.system.getNetworkGossip()!.getLocations();
		expect(locationsA.size).toBeGreaterThanOrEqual(2); // at least remote actors
		expect(locationsC.size).toBeGreaterThanOrEqual(2);
	});

	// ── Node Failure Detection ──────────────────────────────────────

	it("detects dead peer when node shuts down", async () => {
		const nodeA = await createNode({ label: "alpha" });
		nodes.push(nodeA);

		const nodeB = await createNode({
			label: "beta",
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`],
		});
		nodes.push(nodeB);

		// Wait for connection
		await waitFor(() => nodeA.system.getConnectionManager()!.connectedCount > 0, 5_000);

		// Track dead events on Node A
		const deadEvents: string[] = [];
		nodeA.system.on((event) => {
			if (event.type === "peer:dead") deadEvents.push(event.peer.actorId);
		});

		// Kill Node B abruptly
		await nodeB.system.shutdown();

		// Node A should detect Node B is gone (within ping timeout)
		await waitFor(() => {
			return nodeA.system.getConnectionManager()!.connectedCount === 0;
		}, 15_000);

		// Connection to B should be gone
		expect(nodeA.system.getConnectionManager()!.connectedCount).toBe(0);
	});

	// ── HMAC Authentication ─────────────────────────────────────────

	it("rejects unauthenticated peer when meshSecret is set", async () => {
		const nodeA = await createNode({
			label: "alpha",
			meshSecret: "shared-secret-123",
		});
		nodes.push(nodeA);

		const nodeB = await createNode({
			label: "beta",
			meshSecret: "wrong-secret",
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`],
		});
		nodes.push(nodeB);

		// Wait a bit for connection attempt
		await new Promise((r) => setTimeout(r, 3_000));

		// Node B should NOT be connected (wrong secret)
		const connCountA = nodeA.system.getConnectionManager()!.connectedCount;
		expect(connCountA).toBe(0);
	});

	it("connects with matching meshSecret", async () => {
		const secret = "correct-mesh-secret";
		const nodeA = await createNode({ label: "alpha", meshSecret: secret });
		nodes.push(nodeA);

		const nodeB = await createNode({
			label: "beta",
			meshSecret: secret,
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`],
		});
		nodes.push(nodeB);

		await waitFor(() => nodeA.system.getConnectionManager()!.connectedCount > 0, 5_000);
		expect(nodeA.system.getConnectionManager()!.connectedCount).toBe(1);
	});

	// ── Broadcast ───────────────────────────────────────────────────

	it("broadcast reaches actors on multiple nodes", async () => {
		const nodeA = await createNode({ label: "alpha" });
		nodes.push(nodeA);

		const nodeB = await createNode({
			label: "beta",
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`],
		});
		nodes.push(nodeB);

		const collA = collectorBehavior();
		const collB = collectorBehavior();
		nodeA.system.spawn("listener-a", { behavior: collA.behavior });
		nodeB.system.spawn("listener-b", { behavior: collB.behavior });

		await waitFor(() => nodeA.system.getConnectionManager()!.connectedCount > 0, 5_000);

		// Broadcast from Node A
		nodeA.system.broadcast("announcer", { announcement: "mesh-wide alert" });

		// Local actor should get it immediately
		await waitFor(() => collA.messages.length > 0, 3_000);
		expect(collA.messages[0].payload).toEqual({ announcement: "mesh-wide alert" });

		// Remote actor on Node B should also get it via peer channel
		// (broadcast forwards to peer channels)
		await waitFor(() => collB.messages.length > 0, 5_000);
	});

	it("handles 100 rapid cross-node messages", async () => {
		const nodeA = await createNode({ label: "alpha" });
		nodes.push(nodeA);
		const nodeB = await createNode({ label: "beta", staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`] });
		nodes.push(nodeB);
		const counter = counterBehavior();
		nodeB.system.spawn("counter-b", { behavior: counter.behavior });
		await waitFor(() => nodeA.system.getConnectionManager()!.connectedCount > 0, 5_000);
		await waitFor(() => nodeA.system.getNetworkGossip()?.findNode("counter-b") !== undefined, 8_000);
		for (let i = 0; i < 100; i++) nodeA.system.tell("sender-a", "counter-b", { seq: i });
		await waitFor(() => counter.getCount() >= 100, 10_000);
		expect(counter.getCount()).toBe(100);
	});

	it("handles 50 concurrent ask/reply across nodes", async () => {
		const nodeA = await createNode({ label: "alpha" });
		nodes.push(nodeA);
		const nodeB = await createNode({ label: "beta", staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`] });
		nodes.push(nodeB);
		nodeB.system.spawn("echo-b", { behavior: echoBehavior });
		await waitFor(() => nodeA.system.getConnectionManager()!.connectedCount > 0, 5_000);
		await waitFor(() => nodeA.system.getNetworkGossip()?.findNode("echo-b") !== undefined, 8_000);
		const replies = await Promise.all(
			Array.from({ length: 50 }, (_, i) => nodeA.system.ask("caller-a", "echo-b", { seq: i })),
		);
		expect(replies).toHaveLength(50);
		for (let i = 0; i < 50; i++) {
			expect(replies[i].payload).toEqual({ echo: { seq: i }, from: "echo-b" });
		}
	});

	// ── 5-Node Cluster ──────────────────────────────────────────────

	it("5-node cluster: full mesh convergence and cross-cluster routing", async () => {
		const nodeA = await createNode({ label: "node-1" });
		nodes.push(nodeA);
		const otherNodes = await Promise.all(
			["node-2", "node-3", "node-4", "node-5"].map((label) =>
				createNode({ label, staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`] }),
			),
		);
		nodes.push(...otherNodes);

		const allNodes = [nodeA, ...otherNodes];
		for (let i = 0; i < allNodes.length; i++) {
			allNodes[i].system.spawn(`echo-${i + 1}`, { behavior: echoBehavior });
		}

		await waitFor(() => allNodes.every((n) => n.system.getConnectionManager()!.connectedCount >= 1), 10_000);
		await waitFor(() => allNodes.every((n) => {
			const g = n.system.getNetworkGossip();
			return g ? g.getLocations().size >= 3 : false;
		}), 20_000);

		const reply = await otherNodes[3].system.ask("caller-5", "echo-1", "hello from 5");
		expect(reply.payload).toEqual({ echo: "hello from 5", from: "echo-1" });
		const reply2 = await nodeA.system.ask("caller-1", "echo-5", "hello from 1");
		expect(reply2.payload).toEqual({ echo: "hello from 1", from: "echo-5" });
	});

	// ── Peer Discovery ──────────────────────────────────────────────

	it("peer discovery: C discovers A through B without static config", async () => {
		// A is the seed, B connects to A, C connects to B.
		// Through peer exchange, C should discover A and vice-versa.
		const nodeA = await createNode({ label: "seed" });
		nodes.push(nodeA);

		const nodeB = await createNode({
			label: "bridge",
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`],
		});
		nodes.push(nodeB);

		// Wait for A-B connection
		await waitFor(() => nodeA.system.getConnectionManager()!.connectedCount > 0, 5_000);

		// C only knows B — should discover A via peer exchange
		const nodeC = await createNode({
			label: "latecomer",
			staticPeers: [`ws://127.0.0.1:${nodeB.port}/mesh`],
		});
		nodes.push(nodeC);

		// Wait for C to have 2 connections (B + discovered A via peer exchange)
		await waitFor(() => nodeC.system.getConnectionManager()!.connectedCount >= 2, 15_000);
		expect(nodeC.system.getConnectionManager()!.connectedCount).toBeGreaterThanOrEqual(2);

		// Verify routing: spawn on A, ask from C
		nodeA.system.spawn("seed-echo", { behavior: echoBehavior });
		await waitFor(() => {
			const g = nodeC.system.getNetworkGossip();
			return g ? g.getLocations().size >= 1 : false;
		}, 10_000);

		const reply = await nodeC.system.ask("caller-c", "seed-echo", "via discovery");
		expect(reply.payload).toEqual({ echo: "via discovery", from: "seed-echo" });
	});

	it("version handshake: peers exchange protocol version on connect", async () => {
		const nodeA = await createNode({ label: "v-a" });
		nodes.push(nodeA);
		const nodeB = await createNode({ label: "v-b", staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`] });
		nodes.push(nodeB);
		await waitFor(() => nodeA.system.getConnectionManager()!.connectedCount > 0, 5_000);
		const channels = nodeB.system.getConnectionManager()!.getConnectedChannels();
		expect(channels.length).toBeGreaterThanOrEqual(1);
		const ver = channels[0].remoteVersionInfo;
		expect(ver).not.toBeNull();
		expect(ver!.protocol).toBe("mesh/1.0");
		expect(ver!.userAgent).toBe("chitragupta-sutra");
	});
});
