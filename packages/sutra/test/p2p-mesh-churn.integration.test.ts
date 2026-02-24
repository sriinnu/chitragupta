import { afterEach, describe, expect, it } from "vitest";
import { ActorSystem } from "../src/mesh/actor-system.js";
import type { ActorBehavior } from "../src/mesh/types.js";

type NodeRuntime = {
	system: ActorSystem;
	port: number;
	label: string;
};

const ECHO_BEHAVIOR: ActorBehavior = (envelope, ctx) => {
	if (envelope.type === "ask") {
		ctx.reply({ ok: true, payload: envelope.payload });
	}
};

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeoutMs = 10_000,
	intervalMs = 100,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await condition()) return;
		await sleep(intervalMs);
	}
	throw new Error(`waitFor timeout ${timeoutMs}ms`);
}

async function createNode(label: string, staticPeers?: string[]): Promise<NodeRuntime> {
	const system = new ActorSystem({
		maxMailboxSize: 5_000,
		gossipIntervalMs: 500,
		gossipFanout: 3,
		suspectTimeoutMs: 2_000,
		deadTimeoutMs: 5_000,
		defaultAskTimeout: 4_000,
	});
	system.start();
	const port = await system.bootstrapP2P({
		listenPort: 0,
		listenHost: "127.0.0.1",
		staticPeers,
		pingIntervalMs: 1_500,
		maxMissedPings: 2,
		gossipIntervalMs: 700,
		peerExchangeIntervalMs: 1_500,
		label,
	});
	return { system, port, label };
}

async function expectAskSuccessWithin(
	source: ActorSystem,
	targetActorId: string,
	timeoutMs: number,
): Promise<void> {
	await waitFor(async () => {
		try {
			const reply = await source.ask("churn-test-caller", targetActorId, { ping: true }, { timeout: 1_200 });
			return Boolean(reply.payload);
		} catch {
			return false;
		}
	}, timeoutMs, 150);
}

describe("P2P mesh churn recovery", () => {
	const nodes: NodeRuntime[] = [];

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

	it("recovers cross-node routing after repeated worker restarts", async () => {
		const targetActorId = "echo-churn";
		const seed = await createNode("seed");
		nodes.push(seed);

		let worker = await createNode("worker-a", [`ws://127.0.0.1:${seed.port}/mesh`]);
		nodes.push(worker);
		worker.system.spawn(targetActorId, { behavior: ECHO_BEHAVIOR });

		await waitFor(() => (seed.system.getConnectionManager()?.connectedCount ?? 0) >= 1, 6_000);
		await waitFor(
			() => seed.system.getNetworkGossip()?.findNode(targetActorId) !== undefined,
			12_000,
		);
		await expectAskSuccessWithin(seed.system, targetActorId, 8_000);

		for (let cycle = 0; cycle < 2; cycle += 1) {
			await worker.system.shutdown();
			const oldIndex = nodes.indexOf(worker);
			if (oldIndex >= 0) nodes.splice(oldIndex, 1);

			await sleep(400);

			worker = await createNode(`worker-restart-${cycle + 1}`, [`ws://127.0.0.1:${seed.port}/mesh`]);
			worker.system.spawn(targetActorId, { behavior: ECHO_BEHAVIOR });
			nodes.push(worker);
			const expectedNodeId = worker.system.getConnectionManager()?.nodeId;

			await waitFor(
				() => (seed.system.getConnectionManager()?.connectedCount ?? 0) >= 1,
				8_000,
			);
			await waitFor(
				() => seed.system.getNetworkGossip()?.findNode(targetActorId) === expectedNodeId,
				15_000,
			);
			await expectAskSuccessWithin(seed.system, targetActorId, 15_000);
		}

		expect(seed.system.getConnectionManager()?.connectedCount).toBeGreaterThanOrEqual(1);
	}, 45_000);
});
