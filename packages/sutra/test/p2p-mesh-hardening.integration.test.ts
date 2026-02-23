import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActorSystem } from "../src/mesh/actor-system.js";
import type { PeerNetworkConfig } from "../src/mesh/peer-types.js";

async function createNode(opts: {
	label: string;
	staticPeers?: string[];
	guard?: PeerNetworkConfig["guard"];
	peerAddrDbPath?: string;
	peerAddrDbSaveIntervalMs?: number;
}): Promise<{ system: ActorSystem; port: number; nodeId: string }> {
	const system = new ActorSystem({
		maxMailboxSize: 5_000,
		gossipIntervalMs: 500,
		gossipFanout: 3,
		suspectTimeoutMs: 2_000,
		deadTimeoutMs: 5_000,
		defaultAskTimeout: 5_000,
	});
	system.start();
	const port = await system.bootstrapP2P({
		listenPort: 0,
		listenHost: "127.0.0.1",
		staticPeers: opts.staticPeers,
		pingIntervalMs: 2_000,
		maxMissedPings: 2,
		gossipIntervalMs: 1_000,
		peerExchangeIntervalMs: 2_000,
		label: opts.label,
		guard: opts.guard,
		peerAddrDbPath: opts.peerAddrDbPath,
		peerAddrDbSaveIntervalMs: opts.peerAddrDbSaveIntervalMs,
	});
	return { system, port, nodeId: system.getConnectionManager()!.nodeId };
}

async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeoutMs = 10_000,
	intervalMs = 100,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await condition()) return;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe("P2P hardening integration", () => {
	const nodes: Array<{ system: ActorSystem; port: number; nodeId: string }> = [];

	afterEach(async () => {
		for (const node of nodes) {
			try {
				await node.system.shutdown();
			} catch {
				// best effort
			}
		}
		nodes.length = 0;
	});

	it("rotates stale inbound peers when max inbound is reached", async () => {
		const nodeA = await createNode({
			label: "alpha",
			guard: {
				maxInbound: 1,
				maxInboundAgeMs: 150,
				maxAttemptsPerMinute: 100,
				enforceSubnetDiversity: false,
			},
		});
		nodes.push(nodeA);

		const nodeB = await createNode({
			label: "beta",
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`],
		});
		nodes.push(nodeB);

		await waitFor(() => nodeA.system.getConnectionManager()!.connectedCount >= 1, 5_000);
		await new Promise((r) => setTimeout(r, 300));

		const nodeC = await createNode({
			label: "gamma",
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`],
		});
		nodes.push(nodeC);

		await waitFor(() => nodeC.system.getConnectionManager()!.connectedCount >= 1, 8_000);
		expect(nodeC.system.getConnectionManager()!.connectedCount).toBeGreaterThanOrEqual(1);
	});

	it("persists PeerAddrDb when configured", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "cg-peerdb-"));
		const peerDbPath = join(tempDir, "peers.json");

		const nodeA = await createNode({
			label: "alpha",
			peerAddrDbPath: peerDbPath,
			peerAddrDbSaveIntervalMs: 100,
		});
		nodes.push(nodeA);

		const nodeB = await createNode({
			label: "beta",
			staticPeers: [`ws://127.0.0.1:${nodeA.port}/mesh`],
			peerAddrDbPath: peerDbPath,
			peerAddrDbSaveIntervalMs: 100,
		});
		nodes.push(nodeB);

		await waitFor(async () => {
			try {
				const raw = await readFile(peerDbPath, "utf-8");
				const parsed = JSON.parse(raw) as { version?: number; tried?: unknown[]; new?: unknown[] };
				return parsed.version === 1 && Array.isArray(parsed.tried) && Array.isArray(parsed.new);
			} catch {
				return false;
			}
		}, 8_000);

		const persisted = JSON.parse(await readFile(peerDbPath, "utf-8")) as {
			version: number;
			tried: unknown[];
			new: unknown[];
		};
		expect(persisted.version).toBe(1);
		expect(Array.isArray(persisted.tried)).toBe(true);
		expect(Array.isArray(persisted.new)).toBe(true);
	});
});

