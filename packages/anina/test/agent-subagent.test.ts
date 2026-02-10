import { describe, it, expect } from "vitest";
import {
	buildSubAgentPrompt,
	sumChildCosts,
	extractTextFromMessage,
	extractToolCallsFromMessage,
	findLastAssistantMessage,
	mergeTextParts,
} from "../src/agent-subagent.js";
import type { SubAgentPromptHost } from "../src/agent-subagent.js";
import type { AgentMessage, SpawnConfig } from "../src/types.js";
import { MAX_AGENT_DEPTH } from "../src/types.js";
import type { AgentProfile, CostBreakdown } from "@chitragupta/core";
import type { ContentPart } from "@chitragupta/swara";

// ─── Mock Factories ─────────────────────────────────────────────────────────

function mockProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
	return {
		id: "chitragupta",
		name: "Chitragupta",
		personality: "helpful and precise",
		expertise: ["coding", "review"],
		voice: "bold" as const,
		...overrides,
	};
}

function mockHost(overrides: Partial<SubAgentPromptHost> = {}): SubAgentPromptHost {
	const profile = mockProfile();
	return {
		purpose: "main-task",
		depth: 0,
		getLineagePath: () => "main-task",
		buildDefaultSystemPrompt: (p: AgentProfile) => `System prompt for ${p.id}`,
		getProfile: () => profile,
		...overrides,
	};
}

function mockMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
	return {
		id: `msg-${Math.random().toString(36).slice(2, 8)}`,
		role: "assistant",
		content: [{ type: "text", text: "hello" }],
		timestamp: Date.now(),
		...overrides,
	};
}

function makeCost(input: number, output: number, extra?: { cacheRead?: number; cacheWrite?: number }): CostBreakdown {
	return {
		input,
		output,
		total: input + output + (extra?.cacheRead ?? 0) + (extra?.cacheWrite ?? 0),
		currency: "USD",
		...extra,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("agent-subagent utilities", () => {
	// ─── buildSubAgentPrompt() ──────────────────────────────────

	describe("buildSubAgentPrompt()", () => {
		it("should include the base system prompt", () => {
			const host = mockHost();
			const config: SpawnConfig = { purpose: "code-review" };

			const prompt = buildSubAgentPrompt(host, config);
			expect(prompt).toContain("System prompt for chitragupta");
		});

		it("should include the sub-agent purpose", () => {
			const host = mockHost();
			const config: SpawnConfig = { purpose: "test-runner" };

			const prompt = buildSubAgentPrompt(host, config);
			expect(prompt).toContain('purpose: "test-runner"');
		});

		it("should include the lineage path", () => {
			const host = mockHost({ getLineagePath: () => "root > coder" });
			const config: SpawnConfig = { purpose: "linter" };

			const prompt = buildSubAgentPrompt(host, config);
			expect(prompt).toContain("root > coder > linter");
		});

		it("should include depth information", () => {
			const host = mockHost({ depth: 2 });
			const config: SpawnConfig = { purpose: "sub-task" };

			const prompt = buildSubAgentPrompt(host, config);
			expect(prompt).toContain("Depth: 3");
			expect(prompt).toContain(`max: ${MAX_AGENT_DEPTH}`);
		});

		it("should include parent purpose and profile", () => {
			const host = mockHost({ purpose: "parent-agent" });
			const config: SpawnConfig = { purpose: "child-agent" };

			const prompt = buildSubAgentPrompt(host, config);
			expect(prompt).toContain('Parent agent: "parent-agent"');
			expect(prompt).toContain("[chitragupta]");
		});

		it("should use the override profile from SpawnConfig when provided", () => {
			const host = mockHost();
			const overrideProfile = mockProfile({ id: "custom-profile" });
			const config: SpawnConfig = { purpose: "custom-task", profile: overrideProfile };

			const prompt = buildSubAgentPrompt(host, config);
			// The base prompt is built from the override profile
			expect(prompt).toContain("System prompt for custom-profile");
		});

		it("should fall back to host profile when SpawnConfig has no profile", () => {
			const host = mockHost();
			const config: SpawnConfig = { purpose: "default-task" };

			const prompt = buildSubAgentPrompt(host, config);
			expect(prompt).toContain("System prompt for chitragupta");
		});

		it("should include instructions about tool access and focus", () => {
			const host = mockHost();
			const config: SpawnConfig = { purpose: "focused-task" };

			const prompt = buildSubAgentPrompt(host, config);
			expect(prompt).toContain("same tools as your parent");
			expect(prompt).toContain("Focus on your specific purpose");
		});
	});

	// ─── sumChildCosts() ────────────────────────────────────────

	describe("sumChildCosts()", () => {
		it("should return null for messages with no cost", () => {
			const messages = [mockMessage(), mockMessage()];
			expect(sumChildCosts(messages)).toBeNull();
		});

		it("should return the cost directly when only one message has cost", () => {
			const cost = makeCost(0.01, 0.02);
			const messages = [mockMessage({ cost })];

			const total = sumChildCosts(messages);
			expect(total).not.toBeNull();
			expect(total!.input).toBeCloseTo(0.01);
			expect(total!.output).toBeCloseTo(0.02);
		});

		it("should sum costs across multiple messages", () => {
			const messages = [
				mockMessage({ cost: makeCost(0.01, 0.02) }),
				mockMessage({ cost: makeCost(0.03, 0.04) }),
			];

			const total = sumChildCosts(messages);
			expect(total!.input).toBeCloseTo(0.04);
			expect(total!.output).toBeCloseTo(0.06);
			expect(total!.total).toBeCloseTo(0.1);
		});

		it("should accumulate cache costs when present", () => {
			const messages = [
				mockMessage({ cost: makeCost(0.01, 0.01, { cacheRead: 0.005 }) }),
				mockMessage({ cost: makeCost(0.01, 0.01, { cacheRead: 0.003, cacheWrite: 0.002 }) }),
			];

			const total = sumChildCosts(messages);
			expect(total!.cacheRead).toBeCloseTo(0.008);
			expect(total!.cacheWrite).toBeCloseTo(0.002);
		});

		it("should skip messages without cost fields", () => {
			const messages = [
				mockMessage(), // no cost
				mockMessage({ cost: makeCost(0.05, 0.05) }),
				mockMessage(), // no cost
			];

			const total = sumChildCosts(messages);
			expect(total!.input).toBeCloseTo(0.05);
			expect(total!.output).toBeCloseTo(0.05);
		});

		it("should return null for empty messages array", () => {
			expect(sumChildCosts([])).toBeNull();
		});
	});

	// ─── extractTextFromMessage() ───────────────────────────────

	describe("extractTextFromMessage()", () => {
		it("should extract text from a single text part", () => {
			const msg = mockMessage({
				content: [{ type: "text", text: "Hello world" }],
			});

			expect(extractTextFromMessage(msg)).toBe("Hello world");
		});

		it("should join multiple text parts with newlines", () => {
			const msg = mockMessage({
				content: [
					{ type: "text", text: "First" },
					{ type: "text", text: "Second" },
				],
			});

			expect(extractTextFromMessage(msg)).toBe("First\nSecond");
		});

		it("should ignore non-text parts", () => {
			const msg = mockMessage({
				content: [
					{ type: "text", text: "Before" },
					{ type: "tool_call", id: "tc1", name: "grep", arguments: "{}" },
					{ type: "text", text: "After" },
				],
			});

			expect(extractTextFromMessage(msg)).toBe("Before\nAfter");
		});

		it("should return empty string when no text parts exist", () => {
			const msg = mockMessage({
				content: [
					{ type: "tool_call", id: "tc1", name: "grep", arguments: "{}" },
				],
			});

			expect(extractTextFromMessage(msg)).toBe("");
		});
	});

	// ─── extractToolCallsFromMessage() ──────────────────────────

	describe("extractToolCallsFromMessage()", () => {
		it("should extract tool calls with matching results", () => {
			const callMsg = mockMessage({
				role: "assistant",
				content: [
					{ type: "tool_call", id: "tc1", name: "read_file", arguments: '{"path":"/foo"}' },
				],
			});
			const resultMsg = mockMessage({
				role: "tool_result" as AgentMessage["role"],
				content: [
					{ type: "tool_result", toolCallId: "tc1", content: "file contents here" },
				],
			});

			const calls = extractToolCallsFromMessage(callMsg, [callMsg, resultMsg]);
			expect(calls).toHaveLength(1);
			expect(calls[0].name).toBe("read_file");
			expect(calls[0].input).toBe('{"path":"/foo"}');
			expect(calls[0].result).toBe("file contents here");
			expect(calls[0].isError).toBeUndefined();
		});

		it("should mark error results correctly", () => {
			const callMsg = mockMessage({
				content: [
					{ type: "tool_call", id: "tc2", name: "edit", arguments: "{}" },
				],
			});
			const resultMsg = mockMessage({
				content: [
					{ type: "tool_result", toolCallId: "tc2", content: "permission denied", isError: true },
				],
			});

			const calls = extractToolCallsFromMessage(callMsg, [callMsg, resultMsg]);
			expect(calls[0].isError).toBe(true);
		});

		it("should return empty result when no matching tool_result found", () => {
			const callMsg = mockMessage({
				content: [
					{ type: "tool_call", id: "tc3", name: "search", arguments: '{"q":"test"}' },
				],
			});

			const calls = extractToolCallsFromMessage(callMsg, [callMsg]);
			expect(calls).toHaveLength(1);
			expect(calls[0].result).toBe("");
		});

		it("should handle multiple tool calls in a single message", () => {
			const callMsg = mockMessage({
				content: [
					{ type: "tool_call", id: "tc4", name: "read", arguments: "{}" },
					{ type: "tool_call", id: "tc5", name: "write", arguments: "{}" },
				],
			});
			const resultMsg1 = mockMessage({
				content: [
					{ type: "tool_result", toolCallId: "tc4", content: "read result" },
				],
			});
			const resultMsg2 = mockMessage({
				content: [
					{ type: "tool_result", toolCallId: "tc5", content: "write result" },
				],
			});

			const calls = extractToolCallsFromMessage(callMsg, [callMsg, resultMsg1, resultMsg2]);
			expect(calls).toHaveLength(2);
			expect(calls[0].name).toBe("read");
			expect(calls[1].name).toBe("write");
		});

		it("should ignore non-tool_call parts in the message", () => {
			const msg = mockMessage({
				content: [
					{ type: "text", text: "Let me search for that" },
					{ type: "tool_call", id: "tc6", name: "grep", arguments: '{"pattern":"test"}' },
				],
			});

			const calls = extractToolCallsFromMessage(msg, [msg]);
			expect(calls).toHaveLength(1);
			expect(calls[0].name).toBe("grep");
		});
	});

	// ─── findLastAssistantMessage() ─────────────────────────────

	describe("findLastAssistantMessage()", () => {
		it("should return the last assistant message", () => {
			const messages = [
				mockMessage({ role: "user", content: [{ type: "text", text: "question" }] }),
				mockMessage({ role: "assistant", content: [{ type: "text", text: "answer 1" }] }),
				mockMessage({ role: "user", content: [{ type: "text", text: "follow-up" }] }),
				mockMessage({ role: "assistant", content: [{ type: "text", text: "answer 2" }] }),
			];

			const last = findLastAssistantMessage(messages);
			expect(last).toBeDefined();
			expect((last!.content[0] as { type: "text"; text: string }).text).toBe("answer 2");
		});

		it("should return undefined when no assistant messages exist", () => {
			const messages = [
				mockMessage({ role: "user", content: [{ type: "text", text: "hello" }] }),
			];

			expect(findLastAssistantMessage(messages)).toBeUndefined();
		});

		it("should return undefined for empty array", () => {
			expect(findLastAssistantMessage([])).toBeUndefined();
		});
	});

	// ─── mergeTextParts() ───────────────────────────────────────

	describe("mergeTextParts()", () => {
		it("should merge consecutive text parts into one", () => {
			const parts: ContentPart[] = [
				{ type: "text", text: "Hello " },
				{ type: "text", text: "World" },
			];

			const merged = mergeTextParts(parts);
			expect(merged).toHaveLength(1);
			expect(merged[0]).toEqual({ type: "text", text: "Hello World" });
		});

		it("should preserve non-text parts and merge surrounding text", () => {
			const parts: ContentPart[] = [
				{ type: "text", text: "Before " },
				{ type: "text", text: "tool " },
				{ type: "tool_call", id: "tc1", name: "grep", arguments: "{}" },
				{ type: "text", text: "After" },
			];

			const merged = mergeTextParts(parts);
			expect(merged).toHaveLength(3);
			expect(merged[0]).toEqual({ type: "text", text: "Before tool " });
			expect(merged[1]).toEqual({ type: "tool_call", id: "tc1", name: "grep", arguments: "{}" });
			expect(merged[2]).toEqual({ type: "text", text: "After" });
		});

		it("should return empty array for empty input", () => {
			expect(mergeTextParts([])).toEqual([]);
		});

		it("should not merge non-consecutive text parts separated by other types", () => {
			const parts: ContentPart[] = [
				{ type: "text", text: "A" },
				{ type: "tool_call", id: "tc1", name: "x", arguments: "{}" },
				{ type: "text", text: "B" },
			];

			const merged = mergeTextParts(parts);
			expect(merged).toHaveLength(3);
			expect((merged[0] as { type: "text"; text: string }).text).toBe("A");
			expect((merged[2] as { type: "text"; text: string }).text).toBe("B");
		});

		it("should handle parts with only non-text content", () => {
			const parts: ContentPart[] = [
				{ type: "tool_call", id: "tc1", name: "a", arguments: "{}" },
				{ type: "tool_call", id: "tc2", name: "b", arguments: "{}" },
			];

			const merged = mergeTextParts(parts);
			expect(merged).toHaveLength(2);
		});

		it("should handle a single text part unchanged", () => {
			const parts: ContentPart[] = [
				{ type: "text", text: "Only one" },
			];

			const merged = mergeTextParts(parts);
			expect(merged).toHaveLength(1);
			expect(merged[0]).toEqual({ type: "text", text: "Only one" });
		});
	});
});
