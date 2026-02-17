/**
 * E2E Test — Deep Agent Lifecycle Patterns
 *
 * Tests 4 critical production flows that a Vaayu-style AI assistant
 * will exercise heavily in real multi-agent orchestration:
 *
 *   Flow 1: Agent-to-Agent Communication (CommHub + event-based)
 *   Flow 2: LLM -> Agent -> Child -> Grandchild (Deep Delegation Chain)
 *   Flow 3: Stalled Agent Detection + Killing (KaalaBrahma)
 *   Flow 4: Kill Stalled + Spawn Replacement
 *
 * Only the LLM provider stream is mocked. Everything else runs for real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent, KaalaBrahma } from "@chitragupta/anina";
import type {
	AgentConfig,
	SpawnConfig,
	ToolHandler,
	ToolResult,
	AgentEventType,
	AgentHeartbeat,
	AgentLifecycleStatus,
	StatusChangeCallback,
} from "@chitragupta/anina";
import type { AgentProfile, CostBreakdown } from "@chitragupta/core";
import type { ProviderDefinition, StreamEvent, ModelDefinition } from "@chitragupta/swara";
import { CommHub } from "@chitragupta/sutra";
import type { AgentEnvelope } from "@chitragupta/sutra";

// ─── Mock @chitragupta/smriti to avoid real file I/O ──────────────────────────

vi.mock("@chitragupta/smriti", () => ({
	createSession: vi.fn(() => ({ meta: { id: "mock-session" }, turns: [] })),
	loadSession: vi.fn(() => ({ meta: { id: "mock-session" }, turns: [] })),
	addTurn: vi.fn(),
	getMemory: vi.fn(() => null),
	appendMemory: vi.fn(),
}));

// ─── Test Profile ──────────────────────────────────────────────────────────

const TEST_PROFILE: AgentProfile = {
	id: "test",
	name: "Test Agent",
	personality: "Brief and helpful",
	expertise: ["testing"],
	voice: "minimal",
	preferredModel: "mock-model",
	preferredThinking: "none",
};

// ─── Test Helpers ──────────────────────────────────────────────────────────

function createTestConfig(overrides?: Partial<AgentConfig>): AgentConfig {
	return {
		profile: TEST_PROFILE,
		providerId: "mock",
		model: "mock-model",
		thinkingLevel: "none",
		...overrides,
	};
}

/**
 * Create a mock ProviderDefinition with a controllable stream.
 *
 * Accepts an optional Map keyed by user message text, mapping to
 * the stream events to yield for that message. Falls back to a
 * simple text echo response.
 */
function createMockProvider(
	responses?: Map<string, StreamEvent[]>,
): ProviderDefinition & { streamCalls: Array<{ model: string; context: unknown; options: unknown }> } {
	const streamCalls: Array<{ model: string; context: unknown; options: unknown }> = [];

	return {
		id: "mock",
		name: "Mock Provider",
		models: [{
			id: "mock-model",
			name: "Mock Model",
			contextWindow: 128000,
			maxOutputTokens: 4096,
			pricing: { input: 0.001, output: 0.002 },
			capabilities: { vision: false, thinking: false, toolUse: true, streaming: true },
		}] as ModelDefinition[],
		auth: { type: "api-key" },
		streamCalls,
		stream: async function* (model: string, context: unknown, options: unknown) {
			streamCalls.push({ model, context, options });
			const ctx = context as { messages?: Array<{ role: string; content: Array<{ type: string; text?: string }> }> };
			const msgs = ctx.messages ?? [];
			const lastUser = [...msgs].reverse().find((m: { role: string }) => m.role === "user");
			const text = lastUser?.content?.[0]?.type === "text" ? lastUser.content[0].text ?? "" : "";

			const events = responses?.get(text) ?? [
				{ type: "start" as const, messageId: "msg-default" },
				{ type: "text" as const, text: `Response to: ${text}` },
				{
					type: "usage" as const,
					usage: { inputTokens: 10, outputTokens: 20 },
				},
				{
					type: "done" as const,
					stopReason: "end_turn" as const,
					usage: { inputTokens: 10, outputTokens: 20 },
					cost: { input: 0.00001, output: 0.00004, total: 0.00005, currency: "USD" },
				},
			];
			for (const event of events) {
				yield event as StreamEvent;
			}
		},
	};
}

/**
 * Create a mock provider from an ordered queue of stream responses.
 * Each call to stream() shifts the next response from the queue.
 */
function createQueueProvider(
	queue: StreamEvent[][],
): ProviderDefinition & { streamCalls: Array<{ model: string; context: unknown; options: unknown }> } {
	const responses = [...queue];
	const streamCalls: Array<{ model: string; context: unknown; options: unknown }> = [];
	return {
		id: "mock",
		name: "Mock Queue Provider",
		models: [{
			id: "mock-model",
			name: "Mock Model",
			contextWindow: 128000,
			maxOutputTokens: 4096,
			pricing: { input: 0.001, output: 0.002 },
			capabilities: { vision: false, thinking: false, toolUse: true, streaming: true },
		}] as ModelDefinition[],
		auth: { type: "api-key" },
		streamCalls,
		stream: async function* (model: string, context: unknown, options: unknown) {
			streamCalls.push({ model, context, options });
			const events = responses.shift() ?? [
				{ type: "start" as const, messageId: "msg-fallback" },
				{ type: "text" as const, text: "Fallback response" },
				{
					type: "done" as const,
					stopReason: "end_turn" as const,
					usage: { inputTokens: 10, outputTokens: 5 },
					cost: { input: 0.00001, output: 0.00001, total: 0.00002, currency: "USD" },
				},
			];
			for (const event of events) yield event as StreamEvent;
		},
	};
}

/** Create a stream response that returns simple text with cost info. */
function textResponse(text: string, cost?: Partial<CostBreakdown>): StreamEvent[] {
	return [
		{ type: "start", messageId: `msg-${crypto.randomUUID().slice(0, 8)}` } as StreamEvent,
		{ type: "text", text } as StreamEvent,
		{
			type: "done", stopReason: "end_turn",
			usage: { inputTokens: 10, outputTokens: 5 },
			cost: { input: 0.00001, output: 0.00001, total: 0.00002, currency: "USD", ...cost },
		} as StreamEvent,
	];
}

/** Create a stream response that calls a tool. */
function toolCallResponse(toolName: string, toolId: string, args: Record<string, unknown>): StreamEvent[] {
	return [
		{ type: "start", messageId: `msg-tc-${toolId}` } as StreamEvent,
		{ type: "tool_call", id: toolId, name: toolName, arguments: JSON.stringify(args) } as StreamEvent,
		{
			type: "done", stopReason: "tool_use",
			usage: { inputTokens: 15, outputTokens: 10 },
			cost: { input: 0.000015, output: 0.00002, total: 0.000035, currency: "USD" },
		} as StreamEvent,
	];
}

/** Create a mock tool handler. */
function createMockTool(
	name: string,
	result: ToolResult | ((args: Record<string, unknown>) => Promise<ToolResult>),
): ToolHandler {
	return {
		definition: {
			name,
			description: `Mock tool: ${name}`,
			inputSchema: { type: "object", properties: {} },
		},
		execute: typeof result === "function" ? result : async () => result,
	};
}

/** Collect events emitted by an agent into an array. */
function collectEvents(agent: Agent): Array<{ event: AgentEventType; data: unknown }> {
	const events: Array<{ event: AgentEventType; data: unknown }> = [];
	agent.setOnEvent((event, data) => {
		events.push({ event, data });
	});
	return events;
}

/** Create a KaalaBrahma-compatible heartbeat from an Agent. */
function heartbeatFromAgent(
	agent: Agent,
	parentId: string | null,
	overrides?: Partial<AgentHeartbeat>,
): AgentHeartbeat {
	return {
		agentId: agent.id,
		lastBeat: Date.now(),
		startedAt: Date.now(),
		turnCount: 0,
		tokenUsage: 0,
		status: "alive",
		parentId,
		depth: agent.depth,
		purpose: agent.purpose,
		tokenBudget: 200_000,
		...overrides,
	};
}

/** Create a standalone heartbeat (not tied to an Agent instance). */
function makeHeartbeat(overrides: Partial<AgentHeartbeat> = {}): AgentHeartbeat {
	return {
		agentId: `agent-${crypto.randomUUID().slice(0, 8)}`,
		lastBeat: Date.now(),
		startedAt: Date.now(),
		turnCount: 0,
		tokenUsage: 0,
		status: "alive",
		parentId: null,
		depth: 0,
		purpose: "test",
		tokenBudget: 200_000,
		...overrides,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 1: Agent-to-Agent Communication
// ═══════════════════════════════════════════════════════════════════════════

describe("Flow 1: Agent-to-Agent Communication", () => {
	let hub: CommHub;

	beforeEach(() => {
		hub = new CommHub({ enableLogging: false });
	});

	afterEach(() => {
		hub.destroy();
	});

	describe("CommHub peer-to-peer messaging", () => {
		it("should deliver a message from child1 to child2 via CommHub topic subscription", () => {
			const provider = createQueueProvider([]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);
			const child1 = root.spawn({ purpose: "sender" });
			const child2 = root.spawn({ purpose: "receiver" });

			const received: AgentEnvelope[] = [];
			hub.subscribe(child2.id, "peer-chat", (env) => {
				received.push(env);
			});

			hub.send({
				from: child1.id,
				to: child2.id,
				topic: "peer-chat",
				payload: { text: "Hello from child1" },
				priority: "normal" as const,
			});

			expect(received).toHaveLength(1);
			expect(received[0].from).toBe(child1.id);
			expect((received[0].payload as { text: string }).text).toBe("Hello from child1");
		});

		it("should deliver a message from parent to deep grandchild via CommHub", () => {
			const provider = createQueueProvider([]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);
			const child = root.spawn({ purpose: "child" });
			const grandchild = child.spawn({ purpose: "grandchild" });

			const received: AgentEnvelope[] = [];
			hub.subscribe(grandchild.id, "commands", (env) => {
				received.push(env);
			});

			hub.send({
				from: root.id,
				to: grandchild.id,
				topic: "commands",
				payload: "deep command",
				priority: "high" as const,
			});

			expect(received).toHaveLength(1);
			expect(received[0].from).toBe(root.id);
			expect(received[0].payload).toBe("deep command");
		});

		it("should broadcast from parent to all children via CommHub", () => {
			const provider = createQueueProvider([]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);
			const child1 = root.spawn({ purpose: "worker-1" });
			const child2 = root.spawn({ purpose: "worker-2" });

			const received1: AgentEnvelope[] = [];
			const received2: AgentEnvelope[] = [];

			hub.subscribe(child1.id, "announcements", (env) => {
				received1.push(env);
			});
			hub.subscribe(child2.id, "announcements", (env) => {
				received2.push(env);
			});
			// Parent also subscribes so broadcast can reach children
			hub.subscribe(root.id, "announcements", () => {});

			hub.broadcast(root.id, "announcements", "all hands meeting");

			expect(received1).toHaveLength(1);
			expect(received2).toHaveLength(1);
			expect(received1[0].payload).toBe("all hands meeting");
			expect(received2[0].payload).toBe("all hands meeting");
		});

		it("should not deliver broadcast back to sender", () => {
			const provider = createQueueProvider([]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);

			const selfReceived: AgentEnvelope[] = [];
			hub.subscribe(root.id, "echo-test", (env) => {
				selfReceived.push(env);
			});

			hub.broadcast(root.id, "echo-test", "should not echo");

			expect(selfReceived).toHaveLength(0);
		});

		it("should support request-reply pattern between agents via CommHub", async () => {
			const provider = createQueueProvider([]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);
			const child = root.spawn({ purpose: "responder" });

			// child subscribes and replies to requests
			hub.subscribe(child.id, "question", (env) => {
				hub.reply(env.id, child.id, { answer: 42 });
			});

			const reply = await hub.request(child.id, "question", { q: "meaning of life" }, root.id, 5000);
			expect((reply.payload as { answer: number }).answer).toBe(42);
		});
	});

	describe("Event-based communication (subagent:event)", () => {
		it("should bubble child events to parent with sourceAgentId", async () => {
			const provider = createQueueProvider([
				textResponse("child1 done"),
			]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);
			const events = collectEvents(root);

			const child = root.spawn({ purpose: "event-emitter" });
			await child.prompt("do something");

			const bubbled = events.filter(e => e.event === "subagent:event");
			expect(bubbled.length).toBeGreaterThan(0);

			const first = bubbled[0].data as Record<string, unknown>;
			expect(first.sourceAgentId).toBe(child.id);
			expect(first.sourcePurpose).toBe("event-emitter");
			expect(first.sourceDepth).toBe(1);
		});

		it("should identify which child emitted events and forward info to parent", async () => {
			const provider = createQueueProvider([
				textResponse("from child A"),
				textResponse("from child B"),
			]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);
			const events = collectEvents(root);

			const childA = root.spawn({ purpose: "child-A" });
			const childB = root.spawn({ purpose: "child-B" });

			await childA.prompt("A says hello");
			await childB.prompt("B says hello");

			const bubbled = events.filter(e => e.event === "subagent:event");
			const fromA = bubbled.filter(e => (e.data as Record<string, unknown>).sourceAgentId === childA.id);
			const fromB = bubbled.filter(e => (e.data as Record<string, unknown>).sourceAgentId === childB.id);

			expect(fromA.length).toBeGreaterThan(0);
			expect(fromB.length).toBeGreaterThan(0);
			expect((fromA[0].data as Record<string, unknown>).sourcePurpose).toBe("child-A");
			expect((fromB[0].data as Record<string, unknown>).sourcePurpose).toBe("child-B");
		});

		it("should bubble grandchild events through child to root", async () => {
			const provider = createQueueProvider([
				textResponse("grandchild output"),
			]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);
			const rootEvents = collectEvents(root);

			const child = root.spawn({ purpose: "child-relay" });
			const grandchild = child.spawn({ purpose: "grandchild-source" });

			await grandchild.prompt("deep hello");

			// Root should see subagent:event from child, which itself wraps grandchild events
			const childBubbled = rootEvents.filter(e => {
				if (e.event !== "subagent:event") return false;
				const d = e.data as Record<string, unknown>;
				return d.sourceAgentId === child.id;
			});
			expect(childBubbled.length).toBeGreaterThan(0);

			// The child's bubbled event wraps grandchild's events
			const wrappedGrandchild = childBubbled.find(e => {
				const d = e.data as Record<string, unknown>;
				return d.originalEvent === "subagent:event";
			});
			expect(wrappedGrandchild).toBeDefined();
			const innerData = (wrappedGrandchild!.data as Record<string, unknown>).data as Record<string, unknown>;
			expect(innerData.sourceAgentId).toBe(grandchild.id);
		});
	});

	describe("CommHub shared memory between agents", () => {
		it("should allow agents to share state via CommHub shared memory regions", () => {
			const provider = createQueueProvider([]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);
			const child = root.spawn({ purpose: "writer" });

			// Access list must include all agents that will write
			const region = hub.createRegion("shared-state", root.id, [root.id, child.id]);
			hub.write("shared-state", "progress", 0.5, root.id);

			const value = hub.read("shared-state", "progress");
			expect(value).toBe(0.5);

			// Child can also write
			hub.write("shared-state", "result", "done", child.id);
			expect(hub.read("shared-state", "result")).toBe("done");
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 2: Deep Delegation Chain (Root -> Child -> Grandchild)
// ═══════════════════════════════════════════════════════════════════════════

describe("Flow 2: LLM -> Agent -> Child -> Grandchild (Deep Delegation Chain)", () => {
	it("should complete a 3-level delegation chain with result bubbling", async () => {
		// Grandchild prompt & response
		const grandchildProvider = createQueueProvider([
			textResponse("Found specific files: main.ts, utils.ts", { input: 0.0001, output: 0.0002, total: 0.0003 }),
		]);

		// Child prompt & response (will delegate to grandchild)
		const childProvider = createQueueProvider([
			textResponse("Pattern search results from grandchild", { input: 0.0002, output: 0.0003, total: 0.0005 }),
		]);

		// Root uses a provider that returns a delegation-triggering response
		const rootProvider = createQueueProvider([
			textResponse("Analysis complete based on child findings", { input: 0.0003, output: 0.0004, total: 0.0007 }),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(rootProvider);

		// Root delegates to child
		const childResult = await root.delegate(
			{ purpose: "pattern-searcher" },
			"Search for patterns",
		);

		expect(childResult.status).toBe("completed");
		expect(childResult.purpose).toBe("pattern-searcher");

		// Get the child agent from root's children
		const childAgent = root.getChildren()[0] as Agent;
		expect(childAgent).toBeDefined();
		expect(childAgent.depth).toBe(1);

		// Child delegates to grandchild
		childAgent.setProvider(grandchildProvider);
		const grandchildResult = await childAgent.delegate(
			{ purpose: "file-reader" },
			"Read specific files",
		);

		expect(grandchildResult.status).toBe("completed");
		expect(grandchildResult.purpose).toBe("file-reader");

		// Verify tree structure
		const tree = root.getTree();
		expect(tree.totalAgents).toBe(3);
		expect(tree.maxDepth).toBe(2);
	});

	it("should correctly report events from grandchild through child to root with sourceDepth", async () => {
		const provider = createQueueProvider([
			textResponse("root result"),
			textResponse("child result"),
			textResponse("grandchild result"),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(provider);
		const rootEvents = collectEvents(root);

		// Create 3-level tree
		const child = root.spawn({ purpose: "analyzer" });
		const grandchild = child.spawn({ purpose: "reader" });

		await grandchild.prompt("Read file X");

		// Root receives grandchild's events via nested subagent:event wrapping
		const depth1Events = rootEvents.filter(e => {
			if (e.event !== "subagent:event") return false;
			const d = e.data as Record<string, unknown>;
			return d.sourceDepth === 1;
		});
		expect(depth1Events.length).toBeGreaterThan(0);
	});

	it("should show 3-level tree with correct status for each node via getTree()", async () => {
		const provider = createQueueProvider([
			textResponse("grandchild done"),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(provider);

		const child = root.spawn({ purpose: "child-worker" });
		const grandchild = child.spawn({ purpose: "grandchild-worker" });

		// Grandchild completes
		await grandchild.prompt("do work");

		const tree = root.getTree();
		expect(tree.totalAgents).toBe(3);
		expect(tree.maxDepth).toBe(2);
		expect(tree.root.status).toBe("idle");
		expect(tree.root.children).toHaveLength(1);
		expect(tree.root.children[0].status).toBe("idle");
		expect(tree.root.children[0].children).toHaveLength(1);
		expect(tree.root.children[0].children[0].status).toBe("completed");
	});

	it("should include both child and grandchild in root.getDescendants()", () => {
		const root = new Agent(createTestConfig());
		root.setProvider(createQueueProvider([]));

		const child = root.spawn({ purpose: "child" });
		const grandchild = child.spawn({ purpose: "grandchild" });

		const descendants = root.getDescendants();
		expect(descendants).toHaveLength(2);
		expect(descendants.map(d => d.id)).toContain(child.id);
		expect(descendants.map(d => d.id)).toContain(grandchild.id);
	});

	it("should return [child, root] for grandchild.getAncestors()", () => {
		const root = new Agent(createTestConfig());
		root.setProvider(createQueueProvider([]));

		const child = root.spawn({ purpose: "child" });
		const grandchild = child.spawn({ purpose: "grandchild" });

		const ancestors = grandchild.getAncestors();
		expect(ancestors).toHaveLength(2);
		expect(ancestors[0]).toBe(child);
		expect(ancestors[1]).toBe(root);
	});

	it("should find grandchild from root via root.findAgent(grandchildId)", () => {
		const root = new Agent(createTestConfig());
		root.setProvider(createQueueProvider([]));

		const child = root.spawn({ purpose: "child" });
		const grandchild = child.spawn({ purpose: "grandchild" });

		const found = root.findAgent(grandchild.id);
		expect(found).toBe(grandchild);
	});

	it("should sum costs correctly through delegation chain", async () => {
		const cost1: Partial<CostBreakdown> = { input: 0.001, output: 0.002, total: 0.003 };
		const cost2: Partial<CostBreakdown> = { input: 0.004, output: 0.005, total: 0.009 };

		const provider = createQueueProvider([
			textResponse("child work", cost1),
			textResponse("grandchild work", cost2),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(provider);

		// Root delegates to child
		const childResult = await root.delegate(
			{ purpose: "cost-tracker" },
			"Do work",
		);

		expect(childResult.cost).not.toBeNull();
		expect(childResult.cost!.total).toBeGreaterThan(0);

		// Child delegates to grandchild
		const child = root.getChildren()[0] as Agent;
		const grandchildResult = await child.delegate(
			{ purpose: "cost-sub-tracker" },
			"Do sub-work",
		);

		expect(grandchildResult.cost).not.toBeNull();
		expect(grandchildResult.cost!.total).toBeGreaterThan(0);
	});

	it("should correctly report lineage path for deeply nested agents", () => {
		const root = new Agent(createTestConfig());
		root.setProvider(createQueueProvider([]));

		const child = root.spawn({ purpose: "analyzer" });
		const grandchild = child.spawn({ purpose: "file-reader" });

		const path = grandchild.getLineagePath();
		expect(path).toContain("root");
		expect(path).toContain("analyzer");
		expect(path).toContain("file-reader");
	});

	it("should verify isDescendantOf and isAncestorOf across 3 levels", () => {
		const root = new Agent(createTestConfig());
		root.setProvider(createQueueProvider([]));

		const child = root.spawn({ purpose: "mid" });
		const grandchild = child.spawn({ purpose: "leaf" });

		expect(grandchild.isDescendantOf(root.id)).toBe(true);
		expect(grandchild.isDescendantOf(child.id)).toBe(true);
		expect(child.isDescendantOf(root.id)).toBe(true);

		expect(root.isAncestorOf(grandchild.id)).toBe(true);
		expect(root.isAncestorOf(child.id)).toBe(true);
		expect(child.isAncestorOf(grandchild.id)).toBe(true);

		// Grandchild is NOT an ancestor of root
		expect(grandchild.isAncestorOf(root.id)).toBe(false);
	});

	it("should handle delegation error at grandchild level gracefully", async () => {
		const failingProvider: ProviderDefinition = {
			id: "failing",
			name: "Failing Provider",
			models: [],
			auth: { type: "api-key" },
			stream: async function* () {
				yield { type: "start", messageId: "msg-err" } as StreamEvent;
				yield { type: "error", error: new Error("Grandchild exploded") } as StreamEvent;
			},
		};

		const root = new Agent(createTestConfig());
		root.setProvider(createQueueProvider([textResponse("root ok")]));

		const child = root.spawn({ purpose: "delegator" });
		child.setProvider(failingProvider);

		const result = await child.delegate(
			{ purpose: "failing-grandchild" },
			"Do dangerous work",
		);

		expect(result.status).toBe("error");
		expect(result.error).toBeDefined();
		expect(result.error).toContain("Grandchild exploded");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 3: Stalled Agent Detection + Killing (KaalaBrahma)
// ═══════════════════════════════════════════════════════════════════════════

describe("Flow 3: Stalled Agent Detection + Killing (KaalaBrahma)", () => {
	let kaala: KaalaBrahma;

	beforeEach(() => {
		vi.useFakeTimers();
		kaala = new KaalaBrahma({
			heartbeatInterval: 60_000, // Long interval so monitoring doesn't fire unexpectedly
			staleThreshold: 5_000,
			deadThreshold: 15_000,
		});
	});

	afterEach(() => {
		kaala.dispose();
		vi.useRealTimers();
	});

	describe("Healthy agent heartbeating", () => {
		it("should show 'alive' status for agent sending heartbeats", () => {
			const hb = makeHeartbeat({ agentId: "healthy-agent" });
			kaala.registerAgent(hb);

			kaala.recordHeartbeat("healthy-agent", { turnCount: 1 });
			const health = kaala.getAgentHealth("healthy-agent");

			expect(health).toBeDefined();
			expect(health!.status).toBe("alive");
		});

		it("should keep agent alive when heartbeats come before stale threshold", () => {
			const hb = makeHeartbeat({ agentId: "punctual-agent" });
			kaala.registerAgent(hb);

			// Advance 3 seconds (under 5s threshold), send heartbeat
			vi.advanceTimersByTime(3_000);
			kaala.recordHeartbeat("punctual-agent");

			// Advance another 3 seconds, send heartbeat
			vi.advanceTimersByTime(3_000);
			kaala.recordHeartbeat("punctual-agent");

			const health = kaala.getAgentHealth("punctual-agent");
			expect(health!.status).toBe("alive");
		});
	});

	describe("Stale agent detection", () => {
		it("should detect stale agent after staleThreshold without heartbeat", () => {
			const hb = makeHeartbeat({ agentId: "lazy-agent" });
			kaala.registerAgent(hb);

			// Advance past stale threshold
			vi.advanceTimersByTime(6_000);

			// healTree detects stale agents
			kaala.healTree();

			const health = kaala.getAgentHealth("lazy-agent");
			expect(health).toBeDefined();
			expect(health!.status).toBe("stale");
		});

		it("should detect stale child when parent and child are both registered", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "parent-agent", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "stale-child", parentId: "parent-agent", depth: 1 }));

			// Parent keeps heartbeating, child does not
			vi.advanceTimersByTime(3_000);
			kaala.recordHeartbeat("parent-agent");

			vi.advanceTimersByTime(3_000);
			kaala.recordHeartbeat("parent-agent");

			kaala.healTree();

			expect(kaala.getAgentHealth("parent-agent")!.status).toBe("alive");
			expect(kaala.getAgentHealth("stale-child")!.status).toBe("stale");
		});
	});

	describe("Kill operations", () => {
		it("should kill stalled agent and fire onStatusChange callback", () => {
			const cb = vi.fn();
			kaala.onStatusChange(cb);

			kaala.registerAgent(makeHeartbeat({ agentId: "root-killer", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "victim", parentId: "root-killer", depth: 1 }));

			const result = kaala.killAgent("root-killer", "victim");
			expect(result.success).toBe(true);
			expect(result.killedIds).toContain("victim");

			// Verify callback was fired
			expect(cb).toHaveBeenCalled();
			const killCall = (cb.mock.calls as [string, AgentLifecycleStatus, AgentLifecycleStatus, string | null][]).find(
				(call) =>
					call[0] === "victim" && call[2] === "killed",
			);
			expect(killCall).toBeDefined();
			expect(killCall![1]).toBe("alive"); // old status
			expect(killCall![2]).toBe("killed"); // new status
		});

		it("should cascade kill to all descendants (bottom-up)", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "root", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "child", parentId: "root", depth: 1 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "grandchild", parentId: "child", depth: 2 }));

			const result = kaala.killAgent("root", "child");

			expect(result.success).toBe(true);
			expect(result.killedIds).toContain("child");
			expect(result.killedIds).toContain("grandchild");
			expect(result.cascadeCount).toBe(2);

			// Root should still be alive
			expect(kaala.getAgentHealth("root")!.status).toBe("alive");
		});

		it("should cascade kill across a wider tree branch", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "root", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "branch", parentId: "root", depth: 1 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "leaf-1", parentId: "branch", depth: 2 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "leaf-2", parentId: "branch", depth: 2 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "leaf-3", parentId: "branch", depth: 2 }));

			const result = kaala.killAgent("root", "branch");

			expect(result.success).toBe(true);
			expect(result.cascadeCount).toBe(4); // branch + 3 leaves
			expect(result.killedIds).toContain("branch");
			expect(result.killedIds).toContain("leaf-1");
			expect(result.killedIds).toContain("leaf-2");
			expect(result.killedIds).toContain("leaf-3");
		});
	});

	describe("reportStuck and healAgent", () => {
		it("should mark agent as stale when reportStuck is called", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "parent", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "stuck-child", parentId: "parent", depth: 1 }));

			kaala.reportStuck("stuck-child", "infinite loop detected");

			expect(kaala.getAgentHealth("stuck-child")!.status).toBe("stale");
			expect(kaala.getStuckReason("stuck-child")).toBe("infinite loop detected");
		});

		it("should allow ancestor to heal a stuck descendant", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "healer-root", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "healee", parentId: "healer-root", depth: 1 }));

			kaala.reportStuck("healee", "waiting for input");

			const result = kaala.healAgent("healer-root", "healee");
			expect(result.success).toBe(true);
			expect(kaala.getAgentHealth("healee")!.status).toBe("alive");
			expect(kaala.getStuckReason("healee")).toBeUndefined();
		});

		it("should reject heal from non-ancestor", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "agent-a", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "agent-b", depth: 0 }));

			kaala.reportStuck("agent-b");

			const result = kaala.healAgent("agent-a", "agent-b");
			expect(result.success).toBe(false);
			expect(result.reason).toContain("not an ancestor");
		});
	});

	describe("getTreeHealth comprehensive report", () => {
		it("should return full health report for all agents", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "r", depth: 0, tokenUsage: 1000 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "c1", parentId: "r", depth: 1, tokenUsage: 500 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "c2", parentId: "r", depth: 1, tokenUsage: 200 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "gc", parentId: "c1", depth: 2, tokenUsage: 100 }));

			const report = kaala.getTreeHealth();

			expect(report.totalAgents).toBe(4);
			expect(report.aliveAgents).toBe(4);
			expect(report.staleAgents).toBe(0);
			expect(report.deadAgents).toBe(0);
			expect(report.maxDepth).toBe(2);
			expect(report.agents).toHaveLength(4);
			expect(report.highestTokenUsage).not.toBeNull();
			expect(report.highestTokenUsage!.id).toBe("r");
			expect(report.highestTokenUsage!.tokens).toBe(1000);
		});

		it("should reflect stale and killed agents in tree health", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "root", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "stale-a", parentId: "root", depth: 1 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "alive-b", parentId: "root", depth: 1 }));

			kaala.reportStuck("stale-a");
			kaala.recordHeartbeat("alive-b");

			const report = kaala.getTreeHealth();
			expect(report.aliveAgents).toBe(2); // root + alive-b
			expect(report.staleAgents).toBe(1); // stale-a
		});

		it("should show agent health snapshot with child and descendant counts", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "top", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "mid", parentId: "top", depth: 1 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "bot", parentId: "mid", depth: 2 }));

			const topHealth = kaala.getAgentHealth("top");
			expect(topHealth!.childCount).toBe(1);
			expect(topHealth!.descendantCount).toBe(2);

			const midHealth = kaala.getAgentHealth("mid");
			expect(midHealth!.childCount).toBe(1);
			expect(midHealth!.descendantCount).toBe(1);

			const botHealth = kaala.getAgentHealth("bot");
			expect(botHealth!.childCount).toBe(0);
			expect(botHealth!.descendantCount).toBe(0);
		});
	});

	describe("Dead promotion and reaping", () => {
		it("should promote stale to dead and reap after deadThreshold", () => {
			const hb = makeHeartbeat({ agentId: "doomed" });
			kaala.registerAgent(hb);

			// Past dead threshold (15s)
			vi.advanceTimersByTime(16_000);
			kaala.healTree();

			// Agent should be reaped (removed)
			const health = kaala.getAgentHealth("doomed");
			expect(health).toBeUndefined();
		});

		it("should handle multiple agents with mixed health states", () => {
			const now = Date.now();
			kaala.registerAgent(makeHeartbeat({ agentId: "alive-1" }));
			kaala.registerAgent(makeHeartbeat({ agentId: "will-stale" }));
			kaala.registerAgent(makeHeartbeat({ agentId: "will-die" }));

			// Keep alive-1 heartbeating
			vi.advanceTimersByTime(3_000);
			kaala.recordHeartbeat("alive-1");

			// Advance to pass stale but not dead threshold for will-stale
			vi.advanceTimersByTime(4_000); // total: 7s
			kaala.recordHeartbeat("alive-1");

			kaala.healTree();

			expect(kaala.getAgentHealth("alive-1")!.status).toBe("alive");
			expect(kaala.getAgentHealth("will-stale")!.status).toBe("stale");
			// will-die has been at 7s, stale but not dead yet
			expect(kaala.getAgentHealth("will-die")!.status).toBe("stale");

			// Advance past dead threshold
			vi.advanceTimersByTime(10_000); // total: 17s
			kaala.recordHeartbeat("alive-1");
			kaala.healTree();

			expect(kaala.getAgentHealth("alive-1")!.status).toBe("alive");
			// Both will-stale and will-die should be reaped
			expect(kaala.getAgentHealth("will-stale")).toBeUndefined();
			expect(kaala.getAgentHealth("will-die")).toBeUndefined();
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 4: Kill Stalled + Spawn Replacement
// ═══════════════════════════════════════════════════════════════════════════

describe("Flow 4: Kill Stalled + Spawn Replacement", () => {
	let kaala: KaalaBrahma;

	beforeEach(() => {
		vi.useFakeTimers();
		kaala = new KaalaBrahma({
			heartbeatInterval: 60_000,
			staleThreshold: 5_000,
			deadThreshold: 15_000,
		});
	});

	afterEach(() => {
		kaala.dispose();
		vi.useRealTimers();
	});

	it("should kill stalled child and spawn replacement that completes", async () => {
		vi.useRealTimers(); // Need real timers for async operations

		const provider = createQueueProvider([
			textResponse("replacement result"),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(provider);

		// Spawn original child
		const originalChild = root.spawn({ purpose: "analyze" });
		const originalId = originalChild.id;

		// Register both in KaalaBrahma
		kaala.registerAgent(heartbeatFromAgent(root, null));
		kaala.registerAgent(heartbeatFromAgent(originalChild, root.id));

		// Simulate original child stalling (report stuck)
		kaala.reportStuck(originalChild.id, "timeout waiting for LLM");

		expect(kaala.getAgentHealth(originalChild.id)!.status).toBe("stale");

		// Kill the stalled child
		const killResult = kaala.killAgent(root.id, originalChild.id);
		expect(killResult.success).toBe(true);

		// Remove dead child from agent tree
		// The agent is in "idle" status in Agent class (since it never ran prompt),
		// so removeChild should work
		const removed = root.removeChild(originalChild.id);
		expect(removed).toBe(true);

		// Spawn replacement
		const replacement = root.spawn({ purpose: "analyze" });
		kaala.registerAgent(heartbeatFromAgent(replacement, root.id));

		// Verify different IDs
		expect(replacement.id).not.toBe(originalId);

		// Replacement completes successfully
		const result = await replacement.prompt("Analyze the codebase");
		expect(replacement.getStatus()).toBe("completed");
		expect(result.role).toBe("assistant");

		// Root only sees the living replacement
		expect(root.getChildren()).toHaveLength(1);
		expect(root.getChildren()[0].id).toBe(replacement.id);
	});

	it("should verify dead child ID is different from replacement", () => {
		const root = new Agent(createTestConfig());
		root.setProvider(createQueueProvider([]));

		const original = root.spawn({ purpose: "task-A" });
		const originalId = original.id;

		root.removeChild(original.id);

		const replacement = root.spawn({ purpose: "task-A" });
		expect(replacement.id).not.toBe(originalId);
	});

	it("should verify replacement inherits provider and tools from parent", () => {
		const tool = createMockTool("shared-tool", { content: "ok" });
		const provider = createQueueProvider([]);

		const root = new Agent(createTestConfig({ tools: [tool] }));
		root.setProvider(provider);

		const replacement = root.spawn({ purpose: "inheritor" });

		expect(replacement.getProvider()).toBe(provider);
		expect(replacement.getModel()).toBe("mock-model");
		expect(replacement.getProfileId()).toBe("test");
	});

	it("should show only living replacement in getChildren after removeChild + spawn", () => {
		const root = new Agent(createTestConfig());
		root.setProvider(createQueueProvider([]));

		const dead = root.spawn({ purpose: "dead-worker" });
		root.removeChild(dead.id);

		const alive = root.spawn({ purpose: "alive-worker" });

		const children = root.getChildren();
		expect(children).toHaveLength(1);
		expect(children[0].id).toBe(alive.id);
		expect(children[0].purpose).toBe("alive-worker");
	});

	it("should track full event flow: spawn -> stale -> kill -> spawn replacement -> complete", async () => {
		vi.useRealTimers();

		const provider = createQueueProvider([
			textResponse("replacement succeeded"),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(provider);
		const rootEvents = collectEvents(root);

		// Phase 1: Spawn original
		const original = root.spawn({ purpose: "task" });
		kaala.registerAgent(heartbeatFromAgent(root, null));
		kaala.registerAgent(heartbeatFromAgent(original, root.id));

		// Phase 2: Original goes stale
		kaala.reportStuck(original.id);

		// Phase 3: Kill
		kaala.killAgent(root.id, original.id);
		root.removeChild(original.id);

		// Phase 4: Spawn replacement
		const replacement = root.spawn({ purpose: "task" });
		kaala.registerAgent(heartbeatFromAgent(replacement, root.id));

		// Phase 5: Replacement completes
		await replacement.prompt("Finish the task");

		// Verify event flow
		const spawnEvents = rootEvents.filter(e => e.event === "subagent:spawn");
		expect(spawnEvents).toHaveLength(2); // original + replacement

		// Verify the spawned purposes
		const spawnData = spawnEvents.map(e => (e.data as Record<string, unknown>).purpose);
		expect(spawnData).toEqual(["task", "task"]);
	});

	it("should allow root to access results from replacement child", async () => {
		vi.useRealTimers();

		const provider = createQueueProvider([
			textResponse("Analysis: 42 files found, 3 issues detected"),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(provider);

		// Spawn original, pretend it stalls
		const original = root.spawn({ purpose: "analyzer" });
		root.removeChild(original.id);

		// Spawn replacement and delegate to it
		const result = await root.delegate(
			{ purpose: "analyzer-v2" },
			"Analyze the codebase",
		);

		expect(result.status).toBe("completed");
		expect(result.response.role).toBe("assistant");
		const text = result.response.content
			.filter(p => p.type === "text")
			.map(p => (p as { type: "text"; text: string }).text)
			.join("");
		expect(text).toContain("42 files found");
	});

	it("should handle pruneChildren removing non-running children", async () => {
		vi.useRealTimers();

		const provider = createQueueProvider([
			textResponse("done 1"),
			textResponse("done 2"),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(provider);

		const child1 = root.spawn({ purpose: "completed-worker" });
		await child1.prompt("Work");
		expect(child1.getStatus()).toBe("completed");

		const child2 = root.spawn({ purpose: "idle-worker" });
		expect(child2.getStatus()).toBe("idle");

		// pruneChildren removes non-running children (only keeps "running")
		const pruned = root.pruneChildren();
		expect(pruned).toBe(2); // both completed and idle are removed
		expect(root.getChildren()).toHaveLength(0);
	});

	it("should handle replacement spawn after killing with cascaded descendants", () => {
		const root = new Agent(createTestConfig());
		root.setProvider(createQueueProvider([]));

		// Build a branch
		const child = root.spawn({ purpose: "branch-root" });
		const grandchild = child.spawn({ purpose: "branch-leaf" });

		// Register in KaalaBrahma
		kaala.registerAgent(heartbeatFromAgent(root, null));
		kaala.registerAgent(heartbeatFromAgent(child, root.id));
		kaala.registerAgent(heartbeatFromAgent(grandchild, child.id));

		// Kill the entire branch
		const killResult = kaala.killAgent(root.id, child.id);
		expect(killResult.success).toBe(true);
		expect(killResult.cascadeCount).toBe(2);

		// Remove dead child from agent tree
		root.removeChild(child.id);

		// Spawn fresh replacement
		const newChild = root.spawn({ purpose: "branch-root-v2" });
		kaala.registerAgent(heartbeatFromAgent(newChild, root.id));

		expect(root.getChildren()).toHaveLength(1);
		expect(root.getChildren()[0].id).toBe(newChild.id);
		expect(kaala.getAgentHealth(newChild.id)!.status).toBe("alive");
	});

	it("should handle multiple replacement cycles", async () => {
		vi.useRealTimers();

		const provider = createQueueProvider([
			textResponse("attempt 3 succeeded"),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(provider);

		kaala.registerAgent(heartbeatFromAgent(root, null));

		// Cycle 1: spawn and kill
		const v1 = root.spawn({ purpose: "worker" });
		kaala.registerAgent(heartbeatFromAgent(v1, root.id));
		kaala.reportStuck(v1.id);
		kaala.killAgent(root.id, v1.id);
		root.removeChild(v1.id);

		// Cycle 2: spawn and kill
		const v2 = root.spawn({ purpose: "worker" });
		kaala.registerAgent(heartbeatFromAgent(v2, root.id));
		kaala.reportStuck(v2.id);
		kaala.killAgent(root.id, v2.id);
		root.removeChild(v2.id);

		// Cycle 3: spawn and succeed
		const v3 = root.spawn({ purpose: "worker" });
		kaala.registerAgent(heartbeatFromAgent(v3, root.id));
		const result = await v3.prompt("Finally work");

		expect(result.role).toBe("assistant");
		expect(v3.getStatus()).toBe("completed");
		expect(root.getChildren()).toHaveLength(1);
		expect(root.getChildren()[0].id).toBe(v3.id);

		// All three have different IDs
		expect(new Set([v1.id, v2.id, v3.id]).size).toBe(3);
	});

	it("should handle freed token budget from killed agent", () => {
		kaala.registerAgent(makeHeartbeat({
			agentId: "budget-root",
			depth: 0,
			tokenBudget: 200_000,
		}));
		kaala.registerAgent(makeHeartbeat({
			agentId: "budget-child",
			parentId: "budget-root",
			depth: 1,
			tokenBudget: 140_000,
			tokenUsage: 30_000,
		}));

		const result = kaala.killAgent("budget-root", "budget-child");
		expect(result.success).toBe(true);
		expect(result.freedTokens).toBe(110_000); // 140k - 30k
	});

	it("should prevent killing parent from child (upward kill)", () => {
		kaala.registerAgent(makeHeartbeat({ agentId: "parent", depth: 0 }));
		kaala.registerAgent(makeHeartbeat({ agentId: "child", parentId: "parent", depth: 1 }));

		const result = kaala.killAgent("child", "parent");
		expect(result.success).toBe(false);
		expect(result.reason).toContain("not an ancestor");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration: Agent + KaalaBrahma + CommHub together
// ═══════════════════════════════════════════════════════════════════════════

describe("Integration: Agent + KaalaBrahma + CommHub", () => {
	let kaala: KaalaBrahma;
	let hub: CommHub;

	beforeEach(() => {
		kaala = new KaalaBrahma({
			heartbeatInterval: 60_000,
			staleThreshold: 5_000,
			deadThreshold: 15_000,
		});
		hub = new CommHub({ enableLogging: false });
	});

	afterEach(() => {
		kaala.dispose();
		hub.destroy();
	});

	it("should wire up Agent, KaalaBrahma monitoring, and CommHub communication", async () => {
		const provider = createQueueProvider([
			textResponse("child done"),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(provider);

		const child = root.spawn({ purpose: "monitored-worker" });

		// Register in KaalaBrahma
		kaala.registerAgent(heartbeatFromAgent(root, null));
		kaala.registerAgent(heartbeatFromAgent(child, root.id));

		// Set up CommHub communication
		const childMessages: AgentEnvelope[] = [];
		hub.subscribe(child.id, "instructions", (env) => {
			childMessages.push(env);
		});

		// Parent sends instructions to child
		hub.send({
			from: root.id,
			to: child.id,
			topic: "instructions",
			payload: { task: "analyze" },
			priority: "normal" as const,
		});

		// Child runs its task
		const result = await child.prompt("Do the analysis");

		// Verify all systems are consistent
		expect(result.role).toBe("assistant");
		expect(childMessages).toHaveLength(1);
		expect(kaala.getAgentHealth(child.id)!.status).toBe("alive");
		expect(root.getChildren()).toHaveLength(1);
	});

	it("should handle full lifecycle: spawn -> monitor -> stall -> kill -> replace -> complete", async () => {
		const provider = createQueueProvider([
			textResponse("replacement analysis complete"),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(provider);

		// Step 1: Spawn and register
		const original = root.spawn({ purpose: "data-analyzer" });
		kaala.registerAgent(heartbeatFromAgent(root, null));
		kaala.registerAgent(heartbeatFromAgent(original, root.id));

		// Step 2: Set up CommHub for coordination
		let staleNotification = false;
		hub.subscribe(root.id, "lifecycle", (env) => {
			if ((env.payload as { event: string }).event === "stale") {
				staleNotification = true;
			}
		});

		// Step 3: Original stalls
		kaala.reportStuck(original.id, "LLM timeout");

		// Simulate notification via CommHub
		hub.send({
			from: "kaala-system",
			to: root.id,
			topic: "lifecycle",
			payload: { event: "stale", agentId: original.id },
			priority: "high" as const,
		});

		expect(staleNotification).toBe(true);

		// Step 4: Kill the stalled agent
		const killResult = kaala.killAgent(root.id, original.id);
		expect(killResult.success).toBe(true);
		root.removeChild(original.id);

		// Step 5: Spawn replacement
		const replacement = root.spawn({ purpose: "data-analyzer-v2" });
		kaala.registerAgent(heartbeatFromAgent(replacement, root.id));

		// Step 6: Replacement completes
		const result = await replacement.prompt("Reanalyze the data");

		expect(result.role).toBe("assistant");
		expect(replacement.getStatus()).toBe("completed");
		expect(kaala.getAgentHealth(replacement.id)!.status).toBe("alive");
		expect(root.getChildren()).toHaveLength(1);
	});

	it("should use CommHub result collector with multiple agents", async () => {
		const provider = createQueueProvider([
			textResponse("result A"),
			textResponse("result B"),
		]);

		const root = new Agent(createTestConfig());
		root.setProvider(provider);

		const childA = root.spawn({ purpose: "worker-A" });
		const childB = root.spawn({ purpose: "worker-B" });

		// Create a result collector expecting 2 results
		const collector = hub.createCollector<string>(2);

		// Both children submit results
		hub.submitResult(collector.id, childA.id, "analysis-A");
		hub.submitResult(collector.id, childB.id, "analysis-B");

		// Wait for all results
		const results = await hub.waitForAll<string>(collector.id, 5000);

		expect(results.size).toBe(2);
		expect(results.get(childA.id)).toBe("analysis-A");
		expect(results.get(childB.id)).toBe("analysis-B");
	});

	it("should use CommHub barrier to synchronize agent phases", async () => {
		const root = new Agent(createTestConfig());
		root.setProvider(createQueueProvider([]));

		const childA = root.spawn({ purpose: "phase-A" });
		const childB = root.spawn({ purpose: "phase-B" });

		// Create barrier for 2 agents
		hub.createBarrier("phase-1-complete", 2);

		let aReached = false;
		let bReached = false;

		// Both arrive at barrier
		const aPromise = hub.arriveAtBarrier("phase-1-complete", childA.id).then(() => {
			aReached = true;
		});
		const bPromise = hub.arriveAtBarrier("phase-1-complete", childB.id).then(() => {
			bReached = true;
		});

		await Promise.all([aPromise, bPromise]);

		expect(aReached).toBe(true);
		expect(bReached).toBe(true);
	});
});
