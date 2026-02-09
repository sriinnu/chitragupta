/**
 * E2E Test — Full Agent Tree Lifecycle
 *
 * Exercises the REAL cross-module information flow:
 *   agent.ts -> tool-executor.ts -> context-manager.ts -> steering.ts
 *   -> agent-tree.ts -> agent-subagent.ts -> learning-loop.ts -> agent-autonomy.ts
 *
 * Only the LLM provider stream is mocked. Everything else runs for real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@chitragupta/anina";
import { MAX_SUB_AGENTS, MAX_AGENT_DEPTH } from "@chitragupta/anina";
import type { AgentConfig, SpawnConfig, ToolHandler, ToolResult, AgentEventType } from "@chitragupta/anina";
import type { AgentProfile } from "@chitragupta/core";
import type { ProviderDefinition, StreamEvent, ModelDefinition } from "@chitragupta/swara";

// ─── Mock @chitragupta/smriti to avoid real file I/O ──────────────────────────

vi.mock("@chitragupta/smriti", () => ({
	createSession: vi.fn(() => ({ meta: { id: "mock-session" }, turns: [] })),
	loadSession: vi.fn(() => ({ meta: { id: "mock-session" }, turns: [] })),
	addTurn: vi.fn(),
	getMemory: vi.fn(() => null),
	appendMemory: vi.fn(),
}));

// ─── Test Helpers ──────────────────────────────────────────────────────────

function createTestProfile(overrides?: Partial<AgentProfile>): AgentProfile {
	return {
		id: "test-agent",
		name: "Test Agent",
		personality: "You are a test agent for E2E testing.",
		expertise: ["testing", "automation"],
		voice: "minimal",
		...overrides,
	};
}

function createTestConfig(overrides?: Partial<AgentConfig>): AgentConfig {
	return {
		profile: createTestProfile(),
		providerId: "mock",
		model: "mock-model",
		...overrides,
	};
}

/**
 * Create a mock ProviderDefinition with a controllable stream.
 *
 * Each call to stream() shifts the next response from the queue.
 * If the queue is empty, yields a simple text response.
 */
function createMockProvider(
	responses?: StreamEvent[][],
): ProviderDefinition & { streamCalls: Array<{ model: string; context: unknown; options: unknown }> } {
	const queue = responses ? [...responses] : [];
	const streamCalls: Array<{ model: string; context: unknown; options: unknown }> = [];

	return {
		id: "mock",
		name: "Mock Provider",
		models: [{
			id: "mock-model",
			name: "Mock Model",
			contextWindow: 128000,
			maxOutputTokens: 4096,
			pricing: { input: 0, output: 0 },
			capabilities: { vision: false, thinking: false, toolUse: true, streaming: true },
		}] as ModelDefinition[],
		auth: { type: "api-key" },
		streamCalls,
		stream: async function* (model: string, context: unknown, options: unknown) {
			streamCalls.push({ model, context, options });
			const events = queue.shift() ?? [
				{ type: "start" as const, messageId: "msg-default" },
				{ type: "text" as const, text: "Default response" },
				{ type: "done" as const, stopReason: "end_turn" as const, usage: { inputTokens: 10, outputTokens: 5 } },
			];
			for (const event of events) {
				yield event as StreamEvent;
			}
		},
	};
}

/** Create a stream response that returns simple text. */
function textResponse(text: string): StreamEvent[] {
	return [
		{ type: "start", messageId: "msg-1" } as StreamEvent,
		{ type: "text", text } as StreamEvent,
		{ type: "done", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } } as StreamEvent,
	];
}

/** Create a stream response that calls a tool and then returns text. */
function toolCallResponse(toolName: string, toolId: string, args: Record<string, unknown>): StreamEvent[] {
	return [
		{ type: "start", messageId: "msg-tc" } as StreamEvent,
		{ type: "tool_call", id: toolId, name: toolName, arguments: JSON.stringify(args) } as StreamEvent,
		{ type: "done", stopReason: "tool_use", usage: { inputTokens: 15, outputTokens: 10 } } as StreamEvent,
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
		execute: typeof result === "function"
			? result
			: async () => result,
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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Agent Tree E2E", () => {
	// ═══════════════════════════════════════════════════════════════════════
	// 1. Agent Creation + Configuration Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Agent creation + configuration flow", () => {
		it("should create an agent with profile, tools, and systemPrompt", () => {
			const tool = createMockTool("test-tool", { content: "ok" });
			const agent = new Agent(createTestConfig({
				tools: [tool],
				systemPrompt: "You are a specialized test agent.",
			}));

			expect(agent.id).toBeDefined();
			expect(agent.purpose).toBe("root");
			expect(agent.depth).toBe(0);
			expect(agent.getStatus()).toBe("idle");
			expect(agent.getProfile().id).toBe("test-agent");

			const state = agent.getState();
			expect(state.systemPrompt).toBe("You are a specialized test agent.");
			expect(state.model).toBe("mock-model");
			expect(state.providerId).toBe("mock");
			expect(state.tools).toHaveLength(1);
			expect(state.tools[0].definition.name).toBe("test-tool");
		});

		it("should build a default system prompt from profile when none provided", () => {
			const agent = new Agent(createTestConfig());
			const state = agent.getState();
			expect(state.systemPrompt).toContain("Test Agent");
			expect(state.systemPrompt).toContain("testing");
		});

		it("should have unique IDs per agent instance", () => {
			const a = new Agent(createTestConfig());
			const b = new Agent(createTestConfig());
			expect(a.id).not.toBe(b.id);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 2. Provider Wiring + Prompt Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Provider wiring + prompt flow", () => {
		it("should throw if no provider set before prompt", async () => {
			const agent = new Agent(createTestConfig());
			await expect(agent.prompt("Hello")).rejects.toThrow("No provider set");
		});

		it("should transition idle -> running -> completed through prompt", async () => {
			const agent = new Agent(createTestConfig());
			const provider = createMockProvider([textResponse("Hello back!")]);
			agent.setProvider(provider);

			expect(agent.getStatus()).toBe("idle");

			const result = await agent.prompt("Hello");

			expect(agent.getStatus()).toBe("completed");
			expect(result.role).toBe("assistant");
			expect(result.content.some(p => p.type === "text" && p.text === "Hello back!")).toBe(true);
		});

		it("should record user and assistant messages in state", async () => {
			const agent = new Agent(createTestConfig());
			agent.setProvider(createMockProvider([textResponse("Response")]));

			await agent.prompt("User message");

			const messages = agent.getMessages();
			expect(messages.length).toBe(2);
			expect(messages[0].role).toBe("user");
			expect(messages[1].role).toBe("assistant");
		});

		it("should pass model to provider stream", async () => {
			const provider = createMockProvider([textResponse("ok")]);
			const agent = new Agent(createTestConfig({ model: "test-model-7b" }));
			agent.setProvider(provider);

			await agent.prompt("hi");
			expect(provider.streamCalls[0].model).toBe("test-model-7b");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 3. Tool Execution Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Tool execution flow", () => {
		it("should execute tool call from provider and loop back for final response", async () => {
			const executeSpy = vi.fn(async () => ({ content: "tool-result-42" }));
			const tool = createMockTool("calculator", executeSpy);

			const provider = createMockProvider([
				// Turn 1: provider requests tool call
				toolCallResponse("calculator", "tc-1", { expression: "6*7" }),
				// Turn 2: provider gives final text after seeing tool result
				textResponse("The answer is 42."),
			]);

			const agent = new Agent(createTestConfig({ tools: [tool] }));
			agent.setProvider(provider);

			const result = await agent.prompt("What is 6 times 7?");

			// Tool was executed
			expect(executeSpy).toHaveBeenCalledOnce();
			expect((executeSpy.mock.calls[0] as any[])[0]).toEqual({ expression: "6*7" });

			// Final response
			expect(result.content.some(p => p.type === "text" && p.text === "The answer is 42.")).toBe(true);

			// Messages contain user, assistant (tool_call), tool_result, assistant (text)
			const messages = agent.getMessages();
			expect(messages.length).toBe(4);
			expect(messages[0].role).toBe("user");
			expect(messages[1].role).toBe("assistant");
			expect(messages[2].role).toBe("tool_result");
			expect(messages[3].role).toBe("assistant");
		});

		it("should handle tool execution errors gracefully", async () => {
			const tool = createMockTool("failing-tool", async () => {
				throw new Error("Tool crashed!");
			});

			const provider = createMockProvider([
				toolCallResponse("failing-tool", "tc-err", {}),
				textResponse("I see the tool failed."),
			]);

			const agent = new Agent(createTestConfig({ tools: [tool] }));
			agent.setProvider(provider);

			const result = await agent.prompt("Run the failing tool");

			// Agent recovers and returns a response
			expect(result.role).toBe("assistant");

			// Tool result message has isError
			const toolResultMsg = agent.getMessages().find(m => m.role === "tool_result");
			expect(toolResultMsg).toBeDefined();
			const toolContent = toolResultMsg!.content[0];
			expect(toolContent.type).toBe("tool_result");
			if (toolContent.type === "tool_result") {
				expect(toolContent.isError).toBe(true);
				expect(toolContent.content).toContain("Tool crashed!");
			}
		});

		it("should register and unregister tools dynamically", async () => {
			const agent = new Agent(createTestConfig());
			const tool = createMockTool("dynamic-tool", { content: "ok" });

			agent.registerTool(tool);
			expect(agent.getState().tools).toHaveLength(1);

			agent.unregisterTool("dynamic-tool");
			expect(agent.getState().tools).toHaveLength(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 4. Sub-Agent Spawn Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Sub-agent spawn flow", () => {
		it("should spawn a child with correct depth, purpose, and inherited provider", () => {
			const provider = createMockProvider();
			const tool = createMockTool("shared-tool", { content: "ok" });
			const root = new Agent(createTestConfig({ tools: [tool] }));
			root.setProvider(provider);

			const child = root.spawn({ purpose: "researcher" });

			expect(child.depth).toBe(1);
			expect(child.purpose).toBe("researcher");
			expect(child.getParent()).toBe(root);
			expect(child.getProvider()).toBe(provider);
			expect(root.getChildren()).toHaveLength(1);
			expect(root.getChildren()[0]).toBe(child);
		});

		it("should allow child to prompt independently", async () => {
			const provider = createMockProvider([
				textResponse("Child response"),
			]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);

			const child = root.spawn({ purpose: "worker" });
			const result = await child.prompt("Do something");

			expect(result.role).toBe("assistant");
			expect(child.getStatus()).toBe("completed");
		});

		it("should inherit profile and model from parent when not overridden", () => {
			const root = new Agent(createTestConfig({ model: "parent-model" }));
			root.setProvider(createMockProvider());

			const child = root.spawn({ purpose: "inheritor" });

			expect(child.getModel()).toBe("parent-model");
			expect(child.getProfileId()).toBe("test-agent");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 5. Delegation Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Delegation flow", () => {
		it("should delegate to a child and return SubAgentResult", async () => {
			const provider = createMockProvider([
				textResponse("Delegation result"),
			]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);

			const result = await root.delegate(
				{ purpose: "code-reviewer" },
				"Review this code",
			);

			expect(result.status).toBe("completed");
			expect(result.purpose).toBe("code-reviewer");
			expect(result.agentId).toBeDefined();
			expect(result.response.role).toBe("assistant");
			expect(result.messages.length).toBeGreaterThanOrEqual(2); // user + assistant
		});

		it("should handle delegation error gracefully", async () => {
			const provider: ProviderDefinition = {
				id: "failing",
				name: "Failing Provider",
				models: [],
				auth: { type: "api-key" },
				stream: async function* () {
					yield { type: "start", messageId: "msg-1" } as StreamEvent;
					yield { type: "error", error: new Error("Provider exploded") } as StreamEvent;
				},
			};

			const root = new Agent(createTestConfig());
			root.setProvider(provider);

			const result = await root.delegate(
				{ purpose: "risky-task" },
				"Do something risky",
			);

			expect(result.status).toBe("error");
			expect(result.error).toBeDefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 6. Parallel Delegation
	// ═══════════════════════════════════════════════════════════════════════

	describe("Parallel delegation", () => {
		it("should run two delegations in parallel and return both results", async () => {
			const provider = createMockProvider([
				textResponse("Result A"),
				textResponse("Result B"),
			]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);

			const results = await root.delegateParallel([
				{ config: { purpose: "task-a" }, prompt: "Do task A" },
				{ config: { purpose: "task-b" }, prompt: "Do task B" },
			]);

			expect(results).toHaveLength(2);
			expect(results[0].purpose).toBe("task-a");
			expect(results[1].purpose).toBe("task-b");
			expect(results[0].status).toBe("completed");
			expect(results[1].status).toBe("completed");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 7. Event Bubbling
	// ═══════════════════════════════════════════════════════════════════════

	describe("Event bubbling", () => {
		it("should bubble child events to parent via subagent:event", async () => {
			const provider = createMockProvider([
				textResponse("Child says hi"),
			]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);
			const events = collectEvents(root);

			const child = root.spawn({ purpose: "event-source" });
			await child.prompt("Hello from child");

			const bubbled = events.filter(e => e.event === "subagent:event");
			expect(bubbled.length).toBeGreaterThan(0);

			// Verify event data includes source info
			const first = bubbled[0].data as Record<string, unknown>;
			expect(first.sourceAgentId).toBe(child.id);
			expect(first.sourcePurpose).toBe("event-source");
			expect(first.sourceDepth).toBe(1);
			expect(first.originalEvent).toBeDefined();
		});

		it("should not bubble events when bubbleEvents is false", async () => {
			const provider = createMockProvider([
				textResponse("Silent child"),
			]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);
			const events = collectEvents(root);

			const child = root.spawn({ purpose: "silent", bubbleEvents: false });
			await child.prompt("Hello silently");

			const bubbled = events.filter(e => e.event === "subagent:event");
			expect(bubbled).toHaveLength(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 8. Abort Cascading
	// ═══════════════════════════════════════════════════════════════════════

	describe("Abort cascading", () => {
		it("should abort running agents and cascade abort() to all children", () => {
			// abort() sets status = "aborted" only when an abortController exists
			// (i.e., the agent has a running prompt). Children that haven't started
			// prompting still get abort() called but remain "idle".
			const slowProvider: ProviderDefinition = {
				id: "slow",
				name: "Slow Provider",
				models: [],
				auth: { type: "api-key" },
				stream: async function* () {
					yield { type: "start", messageId: "msg-1" } as StreamEvent;
					await new Promise(() => {}); // eternal hang
				},
			};

			const root = new Agent(createTestConfig());
			root.setProvider(slowProvider);

			const child1 = root.spawn({ purpose: "child-1" });

			// Start running prompts on root and child1
			const rootPromise = root.prompt("test").catch(() => {});
			const child1Promise = child1.prompt("test").catch(() => {});

			expect(root.getStatus()).toBe("running");
			expect(child1.getStatus()).toBe("running");

			// Abort root — cascades to child1
			root.abort();

			expect(root.getStatus()).toBe("aborted");
			expect(child1.getStatus()).toBe("aborted");
		});

		it("should emit agent:abort event on abort", () => {
			const slowProvider: ProviderDefinition = {
				id: "slow",
				name: "Slow Provider",
				models: [],
				auth: { type: "api-key" },
				stream: async function* () {
					yield { type: "start", messageId: "msg-1" } as StreamEvent;
					await new Promise(() => {}); // eternal hang
				},
			};

			const agent = new Agent(createTestConfig());
			agent.setProvider(slowProvider);
			const events = collectEvents(agent);

			agent.prompt("test").catch(() => {});
			agent.abort();

			const abortEvents = events.filter(e => e.event === "agent:abort");
			expect(abortEvents.length).toBe(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 9. Tree Traversal
	// ═══════════════════════════════════════════════════════════════════════

	describe("Tree traversal", () => {
		let root: Agent;
		let child1: Agent;
		let child2: Agent;
		let grandchild: Agent;

		beforeEach(() => {
			root = new Agent(createTestConfig());
			root.setProvider(createMockProvider());
			child1 = root.spawn({ purpose: "child-1" });
			child2 = root.spawn({ purpose: "child-2" });
			grandchild = child1.spawn({ purpose: "grandchild" });
		});

		it("getRoot() from any node returns the root", () => {
			expect(grandchild.getRoot()).toBe(root);
			expect(child1.getRoot()).toBe(root);
			expect(root.getRoot()).toBe(root);
		});

		it("getAncestors() returns path to root (excluding self)", () => {
			const ancestors = grandchild.getAncestors();
			expect(ancestors).toHaveLength(2);
			expect(ancestors[0]).toBe(child1);
			expect(ancestors[1]).toBe(root);
		});

		it("getDescendants() returns all descendants", () => {
			const descendants = root.getDescendants();
			expect(descendants).toHaveLength(3); // child1, child2, grandchild
			expect(descendants).toContain(child1);
			expect(descendants).toContain(child2);
			expect(descendants).toContain(grandchild);
		});

		it("getLineage() returns root to self path", () => {
			const lineage = grandchild.getLineage();
			expect(lineage).toHaveLength(3);
			expect(lineage[0]).toBe(root);
			expect(lineage[1]).toBe(child1);
			expect(lineage[2]).toBe(grandchild);
		});

		it("getSiblings() returns siblings (excluding self)", () => {
			const siblings = child1.getSiblings();
			expect(siblings).toHaveLength(1);
			expect(siblings[0]).toBe(child2);
		});

		it("findAgent() finds by ID from any node", () => {
			expect(root.findAgent(grandchild.id)).toBe(grandchild);
			expect(root.findAgent("nonexistent")).toBeNull();
		});

		it("isDescendantOf() and isAncestorOf() work correctly", () => {
			expect(grandchild.isDescendantOf(root.id)).toBe(true);
			expect(grandchild.isDescendantOf(child1.id)).toBe(true);
			expect(grandchild.isDescendantOf(child2.id)).toBe(false);

			expect(root.isAncestorOf(grandchild.id)).toBe(true);
			expect(child1.isAncestorOf(grandchild.id)).toBe(true);
			expect(child2.isAncestorOf(grandchild.id)).toBe(false);
		});

		it("getTree() returns a serializable tree snapshot", () => {
			const tree = root.getTree();
			expect(tree.totalAgents).toBe(4);
			expect(tree.maxDepth).toBe(2);
			expect(tree.root.id).toBe(root.id);
			expect(tree.root.children).toHaveLength(2);
		});

		it("renderTree() returns a non-empty string representation", () => {
			const rendered = root.renderTree();
			expect(rendered.length).toBeGreaterThan(0);
			expect(rendered).toContain("root");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 10. Steering Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Steering flow", () => {
		it("should inject steering instruction into the next turn", async () => {
			const provider = createMockProvider([
				textResponse("First response"),
				textResponse("Steered response"),
			]);
			const agent = new Agent(createTestConfig());
			agent.setProvider(provider);

			// First prompt
			await agent.prompt("Hello");

			// Steer and prompt again
			agent.steer("Focus only on database queries.");
			await agent.prompt("Continue");

			// Verify a system message with steering was inserted
			const messages = agent.getMessages();
			const systemMsgs = messages.filter(m => m.role === "system");
			expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
			const steerMsg = systemMsgs.find(m =>
				m.content.some(p => p.type === "text" && p.text.includes("database queries")),
			);
			expect(steerMsg).toBeDefined();
		});

		it("followUp() queues messages processed by processFollowUps()", async () => {
			const provider = createMockProvider([
				textResponse("Initial"),
				textResponse("Follow-up 1 response"),
				textResponse("Follow-up 2 response"),
			]);
			const agent = new Agent(createTestConfig());
			agent.setProvider(provider);

			await agent.prompt("Start");
			agent.followUp("Follow-up 1");
			agent.followUp("Follow-up 2");

			const result = await agent.processFollowUps();

			// processFollowUps returns the last response
			expect(result).not.toBeNull();
			expect(result!.role).toBe("assistant");

			// All follow-ups were processed (2 user messages + 2 assistant responses added)
			const messages = agent.getMessages();
			const userMsgs = messages.filter(m => m.role === "user");
			expect(userMsgs.length).toBe(3); // initial + 2 follow-ups
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 11. Learning Loop Integration
	// ═══════════════════════════════════════════════════════════════════════

	describe("Learning loop integration", () => {
		it("should track tool usage when learning is enabled", async () => {
			const tool = createMockTool("search-files", { content: "found 3 files" });
			const provider = createMockProvider([
				toolCallResponse("search-files", "tc-1", { pattern: "*.ts" }),
				textResponse("Found the files."),
			]);
			const agent = new Agent(createTestConfig({
				tools: [tool],
				enableLearning: true,
			}));
			agent.setProvider(provider);

			expect(agent.getLearningLoop()).not.toBeNull();

			await agent.prompt("Find TypeScript files");

			const patterns = agent.getLearningLoop()!.getLearnedPatterns();
			const ranking = patterns.frequencyRanking;
			expect(ranking.length).toBeGreaterThanOrEqual(1);
			expect(ranking.find(r => r.tool === "search-files")).toBeDefined();
		});

		it("should record Markov transitions between consecutive tools", async () => {
			const tool1 = createMockTool("grep", { content: "matches" });
			const tool2 = createMockTool("read", { content: "file contents" });

			const provider = createMockProvider([
				toolCallResponse("grep", "tc-1", { query: "TODO" }),
				toolCallResponse("read", "tc-2", { file: "src/main.ts" }),
				textResponse("Done reviewing."),
			]);

			const agent = new Agent(createTestConfig({
				tools: [tool1, tool2],
				enableLearning: true,
			}));
			agent.setProvider(provider);

			await agent.prompt("Find TODOs and read the file");

			const patterns = agent.getLearningLoop()!.getLearnedPatterns();
			const matrix = patterns.transitionMatrix;
			// grep -> read transition should exist
			expect(matrix.has("grep")).toBe(true);
			expect(matrix.get("grep")?.has("read")).toBe(true);
		});

		it("should return null when learning is disabled", () => {
			const agent = new Agent(createTestConfig({ enableLearning: false }));
			expect(agent.getLearningLoop()).toBeNull();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 12. Autonomy Integration
	// ═══════════════════════════════════════════════════════════════════════

	describe("Autonomy integration", () => {
		it("should disable tool after repeated failures", async () => {
			let callCount = 0;
			const failingTool = createMockTool("unstable-api", async () => {
				callCount++;
				throw new Error("API unavailable");
			});

			// Provider that keeps requesting the tool and then gives a final answer
			const responses: StreamEvent[][] = [];
			for (let i = 0; i < 4; i++) {
				responses.push(toolCallResponse("unstable-api", `tc-${i}`, {}));
			}
			responses.push(textResponse("Giving up on the API."));

			const provider = createMockProvider(responses);
			const agent = new Agent(createTestConfig({
				tools: [failingTool],
				enableAutonomy: true,
				enableLearning: true,
				consecutiveFailureThreshold: 3,
			}));
			agent.setProvider(provider);

			await agent.prompt("Call the unstable API");

			const status = agent.getAutonomyStatus();
			expect(status).not.toBeNull();
			expect(status!.enabled).toBe(true);
			// After 3+ consecutive failures, the tool should be disabled
			expect(status!.disabledTools).toContain("unstable-api");
		});

		it("should return null autonomy status when disabled", () => {
			const agent = new Agent(createTestConfig({ enableAutonomy: false }));
			expect(agent.getAutonomyStatus()).toBeNull();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 13. Input Routing (Sandesha)
	// ═══════════════════════════════════════════════════════════════════════

	describe("Input routing (Sandesha)", () => {
		it("requestInput() emits event and resolveInput() resolves the promise", async () => {
			const provider = createMockProvider();
			const root = new Agent(createTestConfig());
			root.setProvider(provider);

			const child = root.spawn({ purpose: "input-requester" });
			const events = collectEvents(root);

			// Request input from the child
			const inputPromise = child.requestInput("What color?", {
				choices: ["red", "blue"],
			});

			// Verify event was emitted and bubbled
			const inputEvents = events.filter(e => e.event === "subagent:event");
			const inputEvent = inputEvents.find(e => {
				const d = e.data as Record<string, unknown>;
				return d.originalEvent === "agent:input_request";
			});
			expect(inputEvent).toBeDefined();

			// Get the request ID from the pending inputs
			const pendingIds = child.getPendingInputIds();
			expect(pendingIds).toHaveLength(1);

			// Resolve the input
			child.resolveInput(pendingIds[0], "blue");

			const answer = await inputPromise;
			expect(answer).toBe("blue");
			expect(child.getPendingInputIds()).toHaveLength(0);
		});

		it("should resolve with default value on timeout", async () => {
			const agent = new Agent(createTestConfig());
			agent.setProvider(createMockProvider());

			const result = await agent.requestInput("Choose", {
				defaultValue: "fallback",
				timeoutMs: 50,
			});

			expect(result).toBe("fallback");
		});

		it("should reject when denied by ancestor", async () => {
			const agent = new Agent(createTestConfig());
			agent.setProvider(createMockProvider());

			const inputPromise = agent.requestInput("Can I proceed?");
			const pendingIds = agent.getPendingInputIds();
			expect(pendingIds).toHaveLength(1);

			agent.resolveInput(pendingIds[0], "", true, "Not allowed");

			await expect(inputPromise).rejects.toThrow("Not allowed");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 14. Policy Engine Integration
	// ═══════════════════════════════════════════════════════════════════════

	describe("Policy engine integration", () => {
		it("should block tool calls denied by the policy engine", async () => {
			const tool = createMockTool("dangerous-tool", { content: "should not run" });
			const executeSpy = vi.spyOn(tool, "execute");

			const policyEngine = {
				check: (toolName: string, _args: Record<string, unknown>) => {
					if (toolName === "dangerous-tool") {
						return { allowed: false, reason: "Tool is banned by policy" };
					}
					return { allowed: true };
				},
			};

			const provider = createMockProvider([
				toolCallResponse("dangerous-tool", "tc-1", {}),
				textResponse("Acknowledged the policy block."),
			]);

			const agent = new Agent(createTestConfig({
				tools: [tool],
				policyEngine,
			}));
			agent.setProvider(provider);

			const result = await agent.prompt("Use dangerous tool");

			// Tool execute was never called
			expect(executeSpy).not.toHaveBeenCalled();

			// A tool_result with error was pushed
			const toolResults = agent.getMessages().filter(m => m.role === "tool_result");
			expect(toolResults.length).toBe(1);
			const content = toolResults[0].content[0];
			expect(content.type).toBe("tool_result");
			if (content.type === "tool_result") {
				expect(content.isError).toBe(true);
				expect(content.content).toContain("Policy denied");
			}
		});

		it("should allow tool calls that pass the policy check", async () => {
			const tool = createMockTool("safe-tool", { content: "success" });
			const executeSpy = vi.spyOn(tool, "execute");

			const policyEngine = {
				check: () => ({ allowed: true }),
			};

			const provider = createMockProvider([
				toolCallResponse("safe-tool", "tc-1", {}),
				textResponse("Tool worked."),
			]);

			const agent = new Agent(createTestConfig({
				tools: [tool],
				policyEngine,
			}));
			agent.setProvider(provider);

			await agent.prompt("Use safe tool");

			expect(executeSpy).toHaveBeenCalledOnce();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 15. Max Depth / Sub-Agent Limits
	// ═══════════════════════════════════════════════════════════════════════

	describe("Max depth / sub-agent limits", () => {
		it("should throw when exceeding MAX_AGENT_DEPTH", () => {
			const root = new Agent(createTestConfig());
			root.setProvider(createMockProvider());

			let current = root;
			// Spawn children up to max depth
			for (let i = 0; i < MAX_AGENT_DEPTH; i++) {
				current = current.spawn({ purpose: `depth-${i + 1}` });
			}

			// Next spawn should fail
			expect(() => current.spawn({ purpose: "too-deep" })).toThrow(
				/exceed max depth/i,
			);
		});

		it("should throw when exceeding MAX_SUB_AGENTS per parent", () => {
			const root = new Agent(createTestConfig());
			root.setProvider(createMockProvider());

			// Spawn up to the limit
			for (let i = 0; i < MAX_SUB_AGENTS; i++) {
				root.spawn({ purpose: `child-${i}` });
			}

			// Next spawn should fail
			expect(() => root.spawn({ purpose: "one-too-many" })).toThrow(
				/max/i,
			);
		});

		it("delegateParallel should refuse if total exceeds limit", async () => {
			const root = new Agent(createTestConfig());
			root.setProvider(createMockProvider());

			// Fill up to almost the limit
			for (let i = 0; i < MAX_SUB_AGENTS - 1; i++) {
				root.spawn({ purpose: `child-${i}` });
			}

			// Try to delegate 2 more (only 1 slot left)
			const tasks = [
				{ config: { purpose: "a" }, prompt: "a" },
				{ config: { purpose: "b" }, prompt: "b" },
			];

			await expect(() => root.delegateParallel(tasks)).rejects.toThrow(/exceed limit/i);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Additional Integration Tests
	// ═══════════════════════════════════════════════════════════════════════

	describe("Additional integration tests", () => {
		it("clearMessages() resets the conversation history", async () => {
			const agent = new Agent(createTestConfig());
			agent.setProvider(createMockProvider([textResponse("Hi")]));

			await agent.prompt("Hello");
			expect(agent.getMessages().length).toBeGreaterThan(0);

			agent.clearMessages();
			expect(agent.getMessages()).toHaveLength(0);
		});

		it("setModel() changes the model for subsequent prompts", async () => {
			const provider = createMockProvider([
				textResponse("Response 1"),
				textResponse("Response 2"),
			]);
			const agent = new Agent(createTestConfig({ model: "model-v1" }));
			agent.setProvider(provider);

			await agent.prompt("First");
			expect(provider.streamCalls[0].model).toBe("model-v1");

			agent.setModel("model-v2");
			await agent.prompt("Second");
			expect(provider.streamCalls[1].model).toBe("model-v2");
		});

		it("spawn emits subagent:spawn event", () => {
			const root = new Agent(createTestConfig());
			root.setProvider(createMockProvider());
			const events = collectEvents(root);

			root.spawn({ purpose: "spawned" });

			const spawnEvents = events.filter(e => e.event === "subagent:spawn");
			expect(spawnEvents).toHaveLength(1);
			const data = spawnEvents[0].data as Record<string, unknown>;
			expect(data.parentId).toBe(root.id);
			expect(data.purpose).toBe("spawned");
		});

		it("removeChild() removes completed children", async () => {
			const provider = createMockProvider([textResponse("Done")]);
			const root = new Agent(createTestConfig());
			root.setProvider(provider);

			const child = root.spawn({ purpose: "removable" });
			await child.prompt("Work");
			expect(child.getStatus()).toBe("completed");

			const removed = root.removeChild(child.id);
			expect(removed).toBe(true);
			expect(root.getChildren()).toHaveLength(0);
		});

		it("removeChild() refuses to remove running children", () => {
			const root = new Agent(createTestConfig());
			const slowProvider: ProviderDefinition = {
				id: "slow", name: "Slow", models: [], auth: { type: "api-key" },
				stream: async function* () {
					yield { type: "start", messageId: "msg" } as StreamEvent;
					await new Promise(() => {});
				},
			};
			root.setProvider(slowProvider);

			const child = root.spawn({ purpose: "busy" });
			child.prompt("hang").catch(() => {});

			// Child should be running now
			const removed = root.removeChild(child.id);
			expect(removed).toBe(false);
			expect(root.getChildren()).toHaveLength(1);

			// Cleanup
			child.abort();
		});

		it("multiple prompts accumulate message history", async () => {
			const provider = createMockProvider([
				textResponse("Response 1"),
				textResponse("Response 2"),
				textResponse("Response 3"),
			]);
			const agent = new Agent(createTestConfig());
			agent.setProvider(provider);

			await agent.prompt("Message 1");
			await agent.prompt("Message 2");
			await agent.prompt("Message 3");

			const messages = agent.getMessages();
			// Each prompt adds a user + assistant message = 6 total
			expect(messages.length).toBe(6);
		});

		it("getLineagePath() returns a readable path string", () => {
			const root = new Agent(createTestConfig());
			root.setProvider(createMockProvider());
			const child = root.spawn({ purpose: "scanner" });
			const grandchild = child.spawn({ purpose: "parser" });

			const path = grandchild.getLineagePath();
			expect(path).toContain("root");
			expect(path).toContain("scanner");
			expect(path).toContain("parser");
		});

		it("thinking level is configurable and defaults from profile", () => {
			const profile = createTestProfile({ preferredThinking: "high" });
			const agent = new Agent(createTestConfig({ profile }));
			expect(agent.getState().thinkingLevel).toBe("high");

			agent.setThinkingLevel("low");
			expect(agent.getState().thinkingLevel).toBe("low");
		});
	});
});
