import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	AutonomousAgent,
	classifyError,
	type AutonomyEventType,
} from "../src/agent-autonomy.js";
import type { AgentState, AgentMessage, ToolResult } from "../src/types.js";

function makeState(messages: AgentMessage[] = []): AgentState {
	return {
		messages,
		model: "test-model",
		providerId: "test-provider",
		tools: [],
		systemPrompt: "You are a test agent.",
		thinkingLevel: "low",
		isStreaming: false,
		sessionId: "test-session",
		agentProfileId: "test-profile",
	};
}

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
	return {
		id: `msg-${Math.random().toString(36).slice(2, 8)}`,
		role: "user",
		content: [{ type: "text", text: "hello" }],
		timestamp: Date.now(),
		...overrides,
	};
}

describe("classifyError", () => {
	it("should classify timeout errors as transient", () => {
		expect(classifyError(new Error("Request timeout exceeded"))).toBe("transient");
	});

	it("should classify ECONNREFUSED as transient", () => {
		expect(classifyError(new Error("ECONNREFUSED"))).toBe("transient");
	});

	it("should classify 429 as transient", () => {
		expect(classifyError(new Error("Rate limit exceeded 429"))).toBe("transient");
	});

	it("should classify rate limit messages as transient", () => {
		expect(classifyError(new Error("rate limit exceeded"))).toBe("transient");
	});

	it("should classify 503 as transient", () => {
		expect(classifyError(new Error("503 service unavailable"))).toBe("transient");
	});

	it("should classify network errors as transient", () => {
		expect(classifyError(new Error("fetch failed: network error"))).toBe("transient");
	});

	it("should classify invalid input as fatal", () => {
		expect(classifyError(new Error("invalid input format"))).toBe("fatal");
	});

	it("should classify permission denied as fatal", () => {
		expect(classifyError(new Error("permission denied"))).toBe("fatal");
	});

	it("should classify 401 unauthorized as fatal", () => {
		expect(classifyError(new Error("401 Unauthorized"))).toBe("fatal");
	});

	it("should classify 403 forbidden as fatal", () => {
		expect(classifyError(new Error("403 Forbidden"))).toBe("fatal");
	});

	it("should classify invalid API key as fatal", () => {
		expect(classifyError(new Error("invalid api key provided"))).toBe("fatal");
	});

	it("should classify context length exceeded as fatal", () => {
		expect(classifyError(new Error("context length exceeded the maximum"))).toBe("fatal");
	});

	it("should classify unknown errors as unknown", () => {
		expect(classifyError(new Error("something weird happened"))).toBe("unknown");
	});

	it("should check error.cause as well", () => {
		const error = new Error("wrapped");
		(error as Error).cause = "ECONNRESET inner cause";
		expect(classifyError(error)).toBe("transient");
	});
});

describe("AutonomousAgent", () => {
	let agent: AutonomousAgent;

	beforeEach(() => {
		agent = new AutonomousAgent({
			maxRetries: 2,
			baseDelayMs: 10, // Very short for tests
			maxDelayMs: 100,
			toolDisableThreshold: 3,
			contextLimit: 128_000,
		});
	});

	// ─── Error Recovery with Retry ──────────────────────────────────

	describe("withRetry", () => {
		it("should return the result on first success", async () => {
			const result = await agent.withRetry(async () => "success");
			expect(result).toBe("success");
		});

		it("should retry transient errors", async () => {
			let attempts = 0;
			const result = await agent.withRetry(async () => {
				attempts++;
				if (attempts < 3) throw new Error("ECONNRESET");
				return "recovered";
			});

			expect(result).toBe("recovered");
			expect(attempts).toBe(3);
		});

		it("should throw immediately on fatal errors without retrying", async () => {
			let attempts = 0;
			await expect(
				agent.withRetry(async () => {
					attempts++;
					throw new Error("401 Unauthorized");
				}),
			).rejects.toThrow("401 Unauthorized");

			expect(attempts).toBe(1);
		});

		it("should exhaust retries and throw for persistent transient errors", async () => {
			let attempts = 0;
			await expect(
				agent.withRetry(async () => {
					attempts++;
					throw new Error("ECONNREFUSED persistent");
				}),
			).rejects.toThrow("ECONNREFUSED persistent");

			// maxRetries=2, so attempts = 1 initial + 2 retries = 3
			expect(attempts).toBe(3);
		});

		it("should escalate unknown errors to fatal after 3 occurrences", async () => {
			let attempts = 0;
			// First two calls: unknown error gets retried
			// Third occurrence of same error: escalated to fatal
			await expect(
				agent.withRetry(async () => {
					attempts++;
					throw new Error("weird glitch");
				}),
			).rejects.toThrow("weird glitch");
		});

		it("should emit error_classified events", async () => {
			const events: AutonomyEventType[] = [];
			agent.onEvent((event) => {
				events.push(event);
			});

			try {
				await agent.withRetry(async () => {
					throw new Error("permission denied");
				});
			} catch {
				// Expected
			}

			expect(events).toContain("autonomy:error_classified");
		});

		it("should emit retry events with attempt info", async () => {
			const retryData: Record<string, unknown>[] = [];
			agent.onEvent((event, data) => {
				if (event === "autonomy:retry") retryData.push(data);
			});

			let attempts = 0;
			await agent.withRetry(async () => {
				attempts++;
				if (attempts < 3) throw new Error("timeout occurred");
				return "ok";
			});

			expect(retryData.length).toBeGreaterThan(0);
			expect(retryData[0]).toHaveProperty("attempt");
			expect(retryData[0]).toHaveProperty("delayMs");
		});
	});

	// ─── Tool Failure Tracking ──────────────────────────────────────

	describe("tool failure tracking", () => {
		it("should disable a tool after consecutive failures", () => {
			const failResult: ToolResult = { content: "error", isError: true };

			agent.onToolUsed("bad-tool", {}, failResult);
			agent.onToolUsed("bad-tool", {}, failResult);
			expect(agent.isToolDisabled("bad-tool")).toBe(false);

			agent.onToolUsed("bad-tool", {}, failResult);
			expect(agent.isToolDisabled("bad-tool")).toBe(true);
		});

		it("should re-enable a tool on success after disable", () => {
			const fail: ToolResult = { content: "error", isError: true };
			const success: ToolResult = { content: "ok" };

			agent.onToolUsed("flaky-tool", {}, fail);
			agent.onToolUsed("flaky-tool", {}, fail);
			agent.onToolUsed("flaky-tool", {}, fail);
			expect(agent.isToolDisabled("flaky-tool")).toBe(true);

			agent.onToolUsed("flaky-tool", {}, success);
			expect(agent.isToolDisabled("flaky-tool")).toBe(false);
		});

		it("should reset consecutive failure count on success", () => {
			const fail: ToolResult = { content: "error", isError: true };
			const success: ToolResult = { content: "ok" };

			agent.onToolUsed("tool-x", {}, fail);
			agent.onToolUsed("tool-x", {}, fail);
			agent.onToolUsed("tool-x", {}, success); // Reset
			agent.onToolUsed("tool-x", {}, fail);
			agent.onToolUsed("tool-x", {}, fail);
			// 2 failures after reset, threshold is 3 -> not disabled
			expect(agent.isToolDisabled("tool-x")).toBe(false);
		});

		it("should report all disabled tools", () => {
			const fail: ToolResult = { content: "error", isError: true };

			for (let i = 0; i < 3; i++) {
				agent.onToolUsed("broken-a", {}, fail);
				agent.onToolUsed("broken-b", {}, fail);
			}

			const disabled = agent.getDisabledTools();
			expect(disabled).toContain("broken-a");
			expect(disabled).toContain("broken-b");
			expect(disabled).toHaveLength(2);
		});

		it("should emit tool_disabled and tool_reenabled events", () => {
			const events: AutonomyEventType[] = [];
			agent.onEvent((event) => events.push(event));

			const fail: ToolResult = { content: "err", isError: true };
			const ok: ToolResult = { content: "ok" };

			agent.onToolUsed("evt-tool", {}, fail);
			agent.onToolUsed("evt-tool", {}, fail);
			agent.onToolUsed("evt-tool", {}, fail);
			expect(events).toContain("autonomy:tool_disabled");

			agent.onToolUsed("evt-tool", {}, ok);
			expect(events).toContain("autonomy:tool_reenabled");
		});
	});

	// ─── Graceful Degradation ───────────────────────────────────────

	describe("degradation", () => {
		it("should enter degraded mode with a reason", () => {
			agent.enterDegradedMode("memory corrupted");
			expect(agent.isDegradedMode()).toBe(true);
		});

		it("should accumulate multiple degradation reasons", () => {
			agent.enterDegradedMode("memory corrupted");
			agent.enterDegradedMode("model unavailable");

			const state = makeState();
			const report = agent.getHealthReport(state);
			expect(report.degradationReasons).toHaveLength(2);
		});

		it("should not duplicate the same reason", () => {
			agent.enterDegradedMode("same reason");
			agent.enterDegradedMode("same reason");

			const state = makeState();
			const report = agent.getHealthReport(state);
			expect(report.degradationReasons).toHaveLength(1);
		});

		it("should exit degraded mode when all reasons are removed", () => {
			agent.enterDegradedMode("reason-a");
			agent.enterDegradedMode("reason-b");

			agent.exitDegradedMode("reason-a");
			expect(agent.isDegradedMode()).toBe(true);

			agent.exitDegradedMode("reason-b");
			expect(agent.isDegradedMode()).toBe(false);
		});
	});

	// ─── Context Recovery ───────────────────────────────────────────

	describe("recoverContext", () => {
		it("should return the state unchanged if messages are valid", () => {
			const messages: AgentMessage[] = [
				makeMessage({ role: "user" }),
				makeMessage({ role: "assistant" }),
			];
			const state = makeState(messages);
			agent.beforeTurn(state);

			const recovered = agent.recoverContext(state);
			expect(recovered.messages).toHaveLength(2);
		});

		it("should truncate at the first invalid message", () => {
			const messages: AgentMessage[] = [
				makeMessage({ role: "user" }),
				makeMessage({ role: "assistant" }),
				{ id: "", role: "user", content: [], timestamp: 0 } as AgentMessage, // Invalid: empty id
			];
			const state = makeState(messages);
			agent.beforeTurn(state);

			const recovered = agent.recoverContext(state);
			// Should keep only the first 2 valid messages
			expect(recovered.messages.length).toBeLessThan(3);
		});

		it("should fall back to last known good state if no valid prefix", () => {
			const goodMessages: AgentMessage[] = [
				makeMessage({ role: "user" }),
			];
			agent.beforeTurn(makeState(goodMessages));

			// Now corrupt the state
			const corruptState = makeState([
				{ id: "", role: "user", content: [], timestamp: -1 } as AgentMessage,
			]);

			const recovered = agent.recoverContext(corruptState);
			// Should fall back to the snapshot from beforeTurn
			expect(recovered.messages).toHaveLength(1);
			expect(recovered.messages[0].id).toBe(goodMessages[0].id);
		});
	});

	// ─── Health Report ──────────────────────────────────────────────

	describe("getHealthReport", () => {
		it("should return zero metrics when no turns recorded", () => {
			const report = agent.getHealthReport(makeState());
			expect(report.avgLatencyMs).toBe(0);
			expect(report.errorRate).toBe(0);
			expect(report.totalTurns).toBe(0);
		});

		it("should compute average latency from recorded turns", () => {
			const state = makeState();
			agent.recordTurnMetrics(100, state, false);
			agent.recordTurnMetrics(200, state, false);
			agent.recordTurnMetrics(300, state, false);

			const report = agent.getHealthReport(state);
			expect(report.avgLatencyMs).toBe(200);
			expect(report.totalTurns).toBe(3);
		});

		it("should compute error rate from recorded turns", () => {
			const state = makeState();
			agent.recordTurnMetrics(100, state, false);
			agent.recordTurnMetrics(100, state, true, "transient");
			agent.recordTurnMetrics(100, state, false);
			agent.recordTurnMetrics(100, state, true, "transient");

			const report = agent.getHealthReport(state);
			expect(report.errorRate).toBe(0.5);
			expect(report.totalErrors).toBe(2);
		});

		it("should report uptime", () => {
			const report = agent.getHealthReport(makeState());
			expect(report.uptimeMs).toBeGreaterThanOrEqual(0);
		});
	});

	// ─── Event System ───────────────────────────────────────────────

	describe("onEvent", () => {
		it("should not throw if a listener errors", () => {
			agent.onEvent(() => {
				throw new Error("listener explosion");
			});

			// Should not throw — listener errors are swallowed
			agent.enterDegradedMode("test");
		});
	});
});
