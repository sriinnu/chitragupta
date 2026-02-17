/**
 * Tests for Agent ↔ ActorSystem ↔ Samiti mesh integration.
 *
 * Verifies that Agent correctly:
 * 1. Auto-registers as an actor when actorSystem is provided
 * 2. Inherits mesh config to children
 * 3. Broadcasts events to Samiti channels
 * 4. Cleans up mesh registration on dispose
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../src/agent.js";
import type { AgentConfig, MeshActorSystem, MeshActorRef, MeshSamiti } from "../src/types.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

function createMockActorSystem(): MeshActorSystem & {
	spawned: Array<{ id: string; options: unknown }>;
	stopped: string[];
} {
	const spawned: Array<{ id: string; options: unknown }> = [];
	const stopped: string[] = [];

	const mockRef: MeshActorRef = {
		actorId: "mock-actor",
		tell: vi.fn(),
		ask: vi.fn().mockResolvedValue({ payload: { type: "pong" } }),
	};

	return {
		spawned,
		stopped,
		spawn: vi.fn((id: string, options: unknown) => {
			spawned.push({ id, options });
			return { ...mockRef, actorId: id };
		}),
		stop: vi.fn((actorId: string) => {
			stopped.push(actorId);
			return true;
		}),
		tell: vi.fn(),
		ask: vi.fn().mockResolvedValue({ payload: { type: "pong" } }),
	};
}

function createMockSamiti(): MeshSamiti & { broadcasts: Array<{ channel: string; message: unknown }> } {
	const broadcasts: Array<{ channel: string; message: unknown }> = [];
	return {
		broadcasts,
		broadcast: vi.fn((channel: string, message: unknown) => {
			broadcasts.push({ channel, message });
			return { id: "msg-1", channel, timestamp: Date.now() };
		}),
	};
}

function createBaseConfig(overrides?: Partial<AgentConfig>): AgentConfig {
	return {
		profile: {
			id: "test-profile",
			name: "Test Agent",
			personality: "helpful",
			expertise: ["testing"],
			voice: "professional" as const,
			preferredThinking: "medium" as const,
		},
		providerId: "test-provider",
		model: "test-model",
		enableChetana: false, // disable for simpler testing
		enableMemory: false,
		enableLearning: false,
		enableAutonomy: false,
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Agent mesh integration", () => {
	let actorSystem: ReturnType<typeof createMockActorSystem>;
	let samiti: ReturnType<typeof createMockSamiti>;

	beforeEach(() => {
		actorSystem = createMockActorSystem();
		samiti = createMockSamiti();
	});

	describe("constructor — auto-register as actor", () => {
		it("should register as an actor when actorSystem is provided", () => {
			const agent = new Agent(createBaseConfig({ actorSystem }));

			expect(actorSystem.spawn).toHaveBeenCalledOnce();
			const call = actorSystem.spawned[0];
			expect(call.id).toBe(`agent:${agent.id}`);
			expect(agent.getActorRef()).toBeTruthy();
			expect(agent.getActorRef()!.actorId).toBe(`agent:${agent.id}`);
		});

		it("should NOT register when enableMesh is false", () => {
			const agent = new Agent(createBaseConfig({ actorSystem, enableMesh: false }));

			expect(actorSystem.spawn).not.toHaveBeenCalled();
			expect(agent.getActorRef()).toBeNull();
		});

		it("should NOT register when no actorSystem is provided", () => {
			const agent = new Agent(createBaseConfig());

			expect(agent.getActorRef()).toBeNull();
			expect(agent.getActorSystem()).toBeNull();
		});

		it("should store samiti reference even without actorSystem", () => {
			const agent = new Agent(createBaseConfig({ samiti }));

			expect(agent.getSamiti()).toBe(samiti);
			expect(agent.getActorRef()).toBeNull();
		});

		it("should register with expertise from profile and purpose", () => {
			new Agent(createBaseConfig({ actorSystem }));

			const options = actorSystem.spawned[0].options as { expertise: string[] };
			expect(options.expertise).toContain("test-profile");
		});

		it("should register with tool capabilities", () => {
			const agent = new Agent(createBaseConfig({
				actorSystem,
				tools: [
					{
						definition: { name: "read", description: "Read files", parameters: {} },
						handler: vi.fn(),
					},
					{
						definition: { name: "write", description: "Write files", parameters: {} },
						handler: vi.fn(),
					},
				],
			}));

			const options = actorSystem.spawned[0].options as { capabilities: string[] };
			expect(options.capabilities).toEqual(["read", "write"]);
		});

		it("should handle actorSystem.spawn failure gracefully", () => {
			const failingSystem = {
				...actorSystem,
				spawn: vi.fn(() => { throw new Error("spawn failed"); }),
				stop: actorSystem.stop,
				tell: actorSystem.tell,
				ask: actorSystem.ask,
			};

			// Should not throw
			const agent = new Agent(createBaseConfig({ actorSystem: failingSystem }));
			expect(agent.getActorRef()).toBeNull();
		});
	});

	describe("spawn — mesh inheritance", () => {
		it("should pass actorSystem and samiti to child agents", () => {
			const parent = new Agent(createBaseConfig({ actorSystem, samiti }));
			const child = parent.spawn({ purpose: "test-child" });

			// Child should also be registered in the actor system
			expect(actorSystem.spawned.length).toBe(2); // parent + child
			expect(child.getActorRef()).toBeTruthy();
			expect(child.getSamiti()).toBe(samiti);
		});

		it("should NOT pass mesh to child when enableMesh is false", () => {
			const parent = new Agent(createBaseConfig({ actorSystem, enableMesh: false }));
			const child = parent.spawn({ purpose: "test-child" });

			expect(child.getActorRef()).toBeNull();
		});
	});

	describe("broadcastToChannel", () => {
		it("should broadcast to samiti channels", () => {
			const agent = new Agent(createBaseConfig({ samiti }));
			agent.broadcastToChannel("#security", "Found a vulnerability", "critical", "vuln-scan");

			expect(samiti.broadcasts.length).toBe(1);
			expect(samiti.broadcasts[0].channel).toBe("#security");
			const msg = samiti.broadcasts[0].message as { sender: string; severity: string; content: string; category: string };
			expect(msg.severity).toBe("critical");
			expect(msg.content).toBe("Found a vulnerability");
			expect(msg.category).toBe("vuln-scan");
			expect(msg.sender).toBe(agent.id);
		});

		it("should silently skip when no samiti", () => {
			const agent = new Agent(createBaseConfig());
			// Should not throw
			agent.broadcastToChannel("#test", "test message");
		});

		it("should handle samiti broadcast errors gracefully", () => {
			const failingSamiti: MeshSamiti = {
				broadcast: vi.fn(() => { throw new Error("channel full"); }),
			};
			const agent = new Agent(createBaseConfig({ samiti: failingSamiti }));

			// Should not throw
			agent.broadcastToChannel("#test", "test");
		});
	});

	describe("sendToAgent / askAgent", () => {
		it("should throw when mesh is not enabled (sendToAgent)", () => {
			const agent = new Agent(createBaseConfig());
			expect(() => agent.sendToAgent("target", { type: "ping" })).toThrow("Mesh integration not enabled");
		});

		it("should throw when mesh is not enabled (askAgent)", async () => {
			const agent = new Agent(createBaseConfig());
			await expect(agent.askAgent("target", { type: "ping" })).rejects.toThrow("Mesh integration not enabled");
		});

		it("should use actorSystem.tell for sendToAgent", () => {
			const agent = new Agent(createBaseConfig({ actorSystem }));
			agent.sendToAgent("other-agent-id", { type: "ping" });

			expect(actorSystem.tell).toHaveBeenCalledOnce();
		});

		it("should use actorSystem.ask for askAgent", async () => {
			const agent = new Agent(createBaseConfig({ actorSystem }));
			const result = await agent.askAgent("other-agent-id", { type: "status" });

			expect(actorSystem.ask).toHaveBeenCalledOnce();
			expect(result).toEqual({ type: "pong" });
		});
	});

	describe("dispose — mesh cleanup", () => {
		it("should stop actor in system on dispose", () => {
			const agent = new Agent(createBaseConfig({ actorSystem, samiti }));
			const actorId = `agent:${agent.id}`;
			agent.dispose();

			expect(actorSystem.stopped).toContain(actorId);
			expect(agent.getActorRef()).toBeNull();
			expect(agent.getActorSystem()).toBeNull();
			expect(agent.getSamiti()).toBeNull();
		});

		it("should handle stop failure gracefully", () => {
			const failStopSystem = {
				...actorSystem,
				spawn: actorSystem.spawn,
				stop: vi.fn(() => { throw new Error("already stopped"); }),
				tell: actorSystem.tell,
				ask: actorSystem.ask,
			};
			const agent = new Agent(createBaseConfig({ actorSystem: failStopSystem }));

			// Should not throw
			agent.dispose();
			expect(agent.getActorRef()).toBeNull();
		});
	});

	describe("emit → Samiti broadcast", () => {
		it("should broadcast subagent:spawn to #alerts via spawn()", () => {
			const onEvent = vi.fn();
			const agent = new Agent(createBaseConfig({ samiti, actorSystem, onEvent }));

			// spawn() triggers subagent:spawn event which goes to #alerts
			agent.spawn({ purpose: "child-task" });

			const alertBroadcasts = samiti.broadcasts.filter((b) => b.channel === "#alerts");
			expect(alertBroadcasts.length).toBeGreaterThanOrEqual(1);
			const msg = alertBroadcasts[0].message as { category: string; content: string };
			expect(msg.category).toBe("agent-spawn");
			expect(msg.content).toContain("child-task");
		});
	});
});
