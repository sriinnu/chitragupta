import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActorSystem } from "@chitragupta/sutra";

const { getActorSystemMock, soulStore } = vi.hoisted(() => ({
	getActorSystemMock: vi.fn(),
	soulStore: [] as Array<Record<string, unknown>>,
}));

vi.mock("../src/modes/mcp-subsystems.js", () => {
	return {
		getActorSystem: (...args: unknown[]) => getActorSystemMock(...args),
	};
});

vi.mock("@chitragupta/anina", () => ({
	SoulManager: class {
		constructor(_opts?: Record<string, unknown>) {}

		getAll(): Array<Record<string, unknown>> {
			return soulStore;
		}

		create(soul: Record<string, unknown>): Record<string, unknown> {
			soulStore.push(soul);
			return soul;
		}
	},
}));

import { bootstrapMeshAndSoul } from "../src/modes/mesh-bootstrap.js";

describe("bootstrapMeshAndSoul", () => {
	let system: ActorSystem;

	beforeEach(() => {
		soulStore.length = 0;
		system = new ActorSystem({
			gossipIntervalMs: 50,
			suspectTimeoutMs: 200,
			deadTimeoutMs: 400,
		});
		system.start();
		getActorSystemMock.mockResolvedValue(system);
	});

	afterEach(async () => {
		await system.shutdown();
		vi.clearAllMocks();
	});

	it("spawns functional built-in actors and keeps them alive", async () => {
		await bootstrapMeshAndSoul({} as never);

		const actorIds = system.findAlive().map((peer) => peer.actorId);
		expect(actorIds).toContain("sys:memory");
		expect(actorIds).toContain("sys:skills");
		expect(actorIds).toContain("sys:session");

		const statusReply = await system.ask("tester", "sys:memory", { type: "status" });
		expect(statusReply.payload).toMatchObject({
			type: "status",
			actor: "sys:memory",
			alive: true,
		});
	});
});
