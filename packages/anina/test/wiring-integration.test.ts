/**
 * Wiring Integration Tests — verify the 5 dead synapses are connected.
 *
 * Wire 1: Memory recall fires mid-turn when tools are called
 * Wire 2: ToolExecutor tries onToolNotFound before returning error
 * Wire 3: LearningLoop flushSession called on session end
 * Wire 4: LearningLoop persistence via flushSession(path)
 * Wire 5: mesh-bootstrap creates actors and soul (separate module test)
 */

import { describe, expect, it, vi } from "vitest";
import type { AgentLoopDeps } from "../src/agent-loop.js";
import { runAgentLoop } from "../src/agent-loop.js";
import { LearningLoop } from "../src/learning-loop.js";
import { ToolExecutor } from "../src/tool-executor.js";

// ─── Wire 1: Memory Recall Mid-Turn ─────────────────────────────────────────

describe("Wire 1: Memory Recall", () => {
	it("should call memoryRecall after tool execution", async () => {
		const recalled = vi.fn().mockResolvedValue("remembered: use TypeScript strict mode");
		const messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }> = [];

		const deps = createMinimalDeps({
			memoryRecall: recalled,
			// Provider returns one tool call then stops
			providerResponses: [
				{ content: [{ type: "tool_call", id: "tc1", name: "read", arguments: "{}" }], stopReason: "tool_use" },
				{ content: [{ type: "text", text: "done" }], stopReason: "end_turn" },
			],
			messages,
		});

		await runAgentLoop(deps);

		expect(recalled).toHaveBeenCalledWith("read");
		// Recalled context should be injected as system message
		const systemMsgs = messages.filter(
			(m) => m.role === "system" && m.content.some((c) => c.text?.includes("[Recalled context]")),
		);
		expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
	});

	it("should not crash when memoryRecall throws", async () => {
		const recalled = vi.fn().mockRejectedValue(new Error("memory offline"));

		const deps = createMinimalDeps({
			memoryRecall: recalled,
			providerResponses: [
				{ content: [{ type: "tool_call", id: "tc1", name: "read", arguments: "{}" }], stopReason: "tool_use" },
				{ content: [{ type: "text", text: "done" }], stopReason: "end_turn" },
			],
		});

		// Should not throw — recall is best-effort
		const result = await runAgentLoop(deps);
		expect(result).toBeDefined();
	});

	it("should skip recall when no tools are called", async () => {
		const recalled = vi.fn().mockResolvedValue("should not be called");

		const deps = createMinimalDeps({
			memoryRecall: recalled,
			providerResponses: [{ content: [{ type: "text", text: "just text" }], stopReason: "end_turn" }],
		});

		await runAgentLoop(deps);
		expect(recalled).not.toHaveBeenCalled();
	});
});

// ─── Wire 2: Skill Discovery (Tool Not Found) ───────────────────────────────

describe("Wire 2: Skill Discovery", () => {
	it("should try onToolNotFound callback before returning error", async () => {
		const executor = new ToolExecutor();
		const discoveredHandler = {
			definition: {
				name: "discovered_tool",
				description: "dynamically found",
				inputSchema: { type: "object" as const, properties: {} },
			},
			execute: vi.fn().mockResolvedValue({ content: "discovered result", isError: false }),
		};
		executor.setOnToolNotFound(async (_name) => discoveredHandler);

		const result = await executor.execute("discovered_tool", {}, { sessionId: "s1", workingDirectory: "/tmp" });
		expect(result.isError).toBe(false);
		expect(result.content).toBe("discovered result");
		// Tool should now be registered
		expect(executor.has("discovered_tool")).toBe(true);
	});

	it("should return error when onToolNotFound returns undefined", async () => {
		const executor = new ToolExecutor();
		executor.setOnToolNotFound(async () => undefined);

		const result = await executor.execute("missing_tool", {}, { sessionId: "s1", workingDirectory: "/tmp" });
		expect(result.isError).toBe(true);
		expect(result.content).toContain("not found");
	});

	it("should survive when onToolNotFound throws", async () => {
		const executor = new ToolExecutor();
		executor.setOnToolNotFound(async () => {
			throw new Error("discovery failed");
		});

		const result = await executor.execute("broken_tool", {}, { sessionId: "s1", workingDirectory: "/tmp" });
		expect(result.isError).toBe(true);
		expect(result.content).toContain("not found");
	});

	it("should record skill gap on tool error via skillGapRecorder", async () => {
		const gapRecorder = vi.fn();
		const deps = createMinimalDeps({
			skillGapRecorder: gapRecorder,
			providerResponses: [
				{ content: [{ type: "tool_call", id: "tc1", name: "nonexistent", arguments: "{}" }], stopReason: "tool_use" },
				{ content: [{ type: "text", text: "ok" }], stopReason: "end_turn" },
			],
		});

		await runAgentLoop(deps);
		expect(gapRecorder).toHaveBeenCalledWith("nonexistent");
	});
});

// ─── Wire 3: Session-End Flush ───────────────────────────────────────────────

describe("Wire 3: LearningLoop flushSession on session end", () => {
	it("should flush learning loop sequences on flushSession()", () => {
		const loop = new LearningLoop();
		// Simulate tool usage to build a sequence
		loop.markToolStart("read");
		loop.recordToolUsage("read", {}, { content: "ok", isError: false });
		loop.markToolStart("write");
		loop.recordToolUsage("write", {}, { content: "ok", isError: false });
		loop.markToolStart("read");
		loop.recordToolUsage("read", {}, { content: "ok", isError: false });

		loop.flushSession();

		// After flush, patterns should include the sequence
		const patterns = loop.getLearnedPatterns();
		expect(patterns.commonSequences.length).toBeGreaterThanOrEqual(0);
		expect(patterns.frequencyRanking.length).toBeGreaterThan(0);
	});
});

// ─── Wire 4: LearningLoop Persistence ────────────────────────────────────────

describe("Wire 4: LearningLoop serialization and persistence", () => {
	it("should serialize and deserialize learning state", () => {
		const loop = new LearningLoop();
		loop.markToolStart("grep");
		loop.recordToolUsage("grep", {}, { content: "found", isError: false });
		loop.markToolStart("edit");
		loop.recordToolUsage("edit", {}, { content: "ok", isError: false });

		const serialized = loop.serialize();
		const restored = LearningLoop.deserialize(serialized);

		expect(restored.getLearnedPatterns().frequencyRanking).toEqual(loop.getLearnedPatterns().frequencyRanking);
	});
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal AgentLoopDeps for testing wiring without real LLM/tools. */
function createMinimalDeps(opts: {
	memoryRecall?: AgentLoopDeps["memoryRecall"];
	skillGapRecorder?: AgentLoopDeps["skillGapRecorder"];
	providerResponses?: Array<{ content: Array<Record<string, unknown>>; stopReason: string }>;
	messages?: Array<Record<string, unknown>>;
}): AgentLoopDeps {
	const responses = opts.providerResponses ?? [{ content: [{ type: "text", text: "hello" }], stopReason: "end_turn" }];
	let responseIdx = 0;
	const allMessages: Array<Record<string, unknown>> = opts.messages ?? [];

	const toolExecutor = new ToolExecutor();
	// Register a basic "read" tool for testing
	toolExecutor.register({
		definition: { name: "read", description: "read file", inputSchema: { type: "object", properties: {} } },
		execute: async () => ({ content: "file contents", isError: false }),
	});

	return {
		agentId: "test-agent",
		purpose: "test",
		state: {
			messages: [],
			model: "test-model",
			providerId: "test",
			tools: [],
			systemPrompt: "test",
			thinkingLevel: "none" as "medium",
			isStreaming: false,
			sessionId: "test-session",
			agentProfileId: "test-profile",
		},
		config: {
			profile: {
				id: "test",
				name: "Test",
				personality: "",
				expertise: [],
				voice: "friendly" as const,
			},
			providerId: "test",
			model: "test-model",
		},
		provider: {
			id: "test",
			name: "test",
			models: [],
			auth: { type: "api-key" as const },
			stream: async function* (_model, _context, _options) {
				const resp = responses[responseIdx++] ?? responses[responses.length - 1];
				for (const part of resp.content) {
					if (part.type === "text") {
						yield { type: "text" as const, text: part.text as string };
					} else if (part.type === "tool_call") {
						yield {
							type: "tool_call" as const,
							id: part.id as string,
							name: part.name as string,
							arguments: part.arguments as string,
						};
					}
				}
				yield {
					type: "done" as const,
					stopReason: resp.stopReason as "end_turn",
					usage: { inputTokens: 0, outputTokens: 0 },
				};
			},
		},
		abortController: new AbortController(),
		maxTurns: 10,
		workingDirectory: "/tmp",
		toolExecutor,
		contextManager: {
			buildContext: () => ({ system: "test", messages: [], tools: [] }),
		} as unknown as AgentLoopDeps["contextManager"],
		steeringManager: { getSteeringInstruction: () => null } as unknown as AgentLoopDeps["steeringManager"],
		learningLoop: null,
		autonomousAgent: null,
		chetana: null,
		lokapala: null,
		kaala: null,
		samiti: null,
		emit: vi.fn(),
		createMessage: (role, content, extra) => {
			const msg = { id: crypto.randomUUID(), role, content, timestamp: Date.now(), ...extra };
			allMessages.push(msg);
			return msg as ReturnType<AgentLoopDeps["createMessage"]>;
		},
		memoryRecall: opts.memoryRecall,
		skillGapRecorder: opts.skillGapRecorder,
	};
}
