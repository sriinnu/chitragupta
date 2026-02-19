import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
	KartavyaDispatcher,
} from "../src/kartavya-dispatcher.js";
import type {
	DispatchResult,
	ToolExecutor,
	ToolExecResult,
} from "../src/kartavya-dispatcher.js";
import { KartavyaEngine } from "../src/kartavya.js";
import type {
	Kartavya,
	KartavyaTrigger,
	KartavyaAction,
	TriggerContext,
} from "../src/kartavya.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create an engine with one active kartavya of the given action type. */
function engineWithKartavya(action: KartavyaAction): { engine: KartavyaEngine; kartavya: Kartavya } {
	const engine = new KartavyaEngine({ minConfidenceForProposal: 0.5 });
	const trigger: KartavyaTrigger = { type: "event", condition: "periodic_evaluation", cooldownMs: 10_000 };
	const proposal = engine.proposeNiyama("vas-1", "test-duty", "test", trigger, action, ["evidence"], 0.9);
	const kartavya = engine.approveNiyama(proposal.id);
	return { engine, kartavya };
}

function mockSamiti() {
	return { broadcast: vi.fn() };
}

function mockRta(allowed = true, reason?: string) {
	return { check: vi.fn().mockReturnValue({ allowed, reason }) };
}

function mockToolExecutor(result?: Partial<ToolExecResult>): ToolExecutor {
	return vi.fn().mockResolvedValue({ success: true, output: "ok", ...result });
}

// ─── Action Dispatch Routing ─────────────────────────────────────────────────

describe("KartavyaDispatcher — action routing", () => {
	it("routes notification actions to dispatchNotification", async () => {
		const { engine } = engineWithKartavya({ type: "notification", payload: { message: "hello", channel: "#test" } });
		const samiti = mockSamiti();
		const dispatcher = new KartavyaDispatcher(engine, samiti, null);

		const results = await dispatcher.evaluate();
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].success).toBe(true);
		expect(results[0].action.type).toBe("notification");
	});

	it("routes command actions to dispatchCommand", async () => {
		const { engine } = engineWithKartavya({ type: "command", payload: { command: "echo hi" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null, { enableCommandActions: true });

		const results = await dispatcher.evaluate();
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].action.type).toBe("command");
		expect(results[0].success).toBe(true);
	});

	it("routes tool_sequence actions to dispatchToolSequence", async () => {
		const executor = mockToolExecutor();
		const { engine } = engineWithKartavya({
			type: "tool_sequence",
			payload: { tools: [{ name: "read", args: { path: "/tmp" } }] },
		});
		const dispatcher = new KartavyaDispatcher(engine, null, null, { toolExecutor: executor });

		const results = await dispatcher.evaluate();
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].action.type).toBe("tool_sequence");
		expect(results[0].success).toBe(true);
	});

	it("routes vidhi actions to dispatchVidhi", async () => {
		const executor = mockToolExecutor();
		const vidhiEngine = {
			match: vi.fn().mockReturnValue({
				name: "lint-fix",
				steps: [{ toolName: "bash", args: { command: "echo lint" } }],
			}),
		};
		const { engine } = engineWithKartavya({ type: "vidhi", payload: { vidhi: "lint-fix" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null, { toolExecutor: executor, vidhiEngine });

		const results = await dispatcher.evaluate();
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].action.type).toBe("vidhi");
		expect(results[0].success).toBe(true);
	});

	it("returns error for unknown action types", async () => {
		const { engine } = engineWithKartavya({ type: "unknown_type" as "command", payload: {} });
		const dispatcher = new KartavyaDispatcher(engine, null, null);

		const results = await dispatcher.evaluate();
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("Unknown action type");
	});
});

// ─── Command Execution ───────────────────────────────────────────────────────

describe("KartavyaDispatcher — command execution", () => {
	it("executes safe bash commands and returns output", async () => {
		const { engine } = engineWithKartavya({ type: "command", payload: { command: "echo hello-world" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null, { enableCommandActions: true });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(true);
		expect(results[0].result).toContain("hello-world");
	});

	it("blocks command actions when enableCommandActions is false (default)", async () => {
		const { engine } = engineWithKartavya({ type: "command", payload: { command: "echo hi" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null);

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("Command actions are disabled");
	});

	it("fails when no command is specified in payload", async () => {
		const { engine } = engineWithKartavya({ type: "command", payload: {} });
		const dispatcher = new KartavyaDispatcher(engine, null, null, { enableCommandActions: true });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("No command specified");
	});

	it("captures command failures gracefully", async () => {
		const { engine } = engineWithKartavya({ type: "command", payload: { command: "exit 1" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null, { enableCommandActions: true });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toBeDefined();
	});

	it("truncates command output to 500 chars", async () => {
		const longOutput = "x".repeat(600);
		const { engine } = engineWithKartavya({
			type: "command",
			payload: { command: `printf '${longOutput}'` },
		});
		const dispatcher = new KartavyaDispatcher(engine, null, null, { enableCommandActions: true });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(true);
		expect(results[0].result!.length).toBeLessThanOrEqual(500);
	});
});

// ─── Rta Safety Checks ──────────────────────────────────────────────────────

describe("KartavyaDispatcher — Rta safety", () => {
	it("blocks commands when Rta denies them", async () => {
		const { engine } = engineWithKartavya({ type: "command", payload: { command: "rm -rf /" } });
		const rta = mockRta(false, "Destructive command blocked");
		const dispatcher = new KartavyaDispatcher(engine, null, rta, { enableCommandActions: true });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("Rta blocked");
		expect(results[0].error).toContain("Destructive command blocked");
	});

	it("allows commands when Rta approves them", async () => {
		const { engine } = engineWithKartavya({ type: "command", payload: { command: "echo safe" } });
		const rta = mockRta(true);
		const dispatcher = new KartavyaDispatcher(engine, null, rta, { enableCommandActions: true });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(true);
		expect(rta.check).toHaveBeenCalledWith(
			expect.objectContaining({ toolName: "bash", args: { command: "echo safe" } }),
		);
	});

	it("passes workingDirectory and project to Rta check", async () => {
		const { engine } = engineWithKartavya({ type: "command", payload: { command: "echo test" } });
		const rta = mockRta(true);
		const dispatcher = new KartavyaDispatcher(engine, null, rta, {
			enableCommandActions: true,
			workingDirectory: "/my/project",
			project: "chitragupta",
		});

		await dispatcher.evaluate();
		expect(rta.check).toHaveBeenCalledWith(
			expect.objectContaining({
				workingDirectory: "/my/project",
				project: "chitragupta",
			}),
		);
	});

	it("blocks tool_sequence steps when Rta denies a tool", async () => {
		const executor = mockToolExecutor();
		const rta = mockRta(false, "Blocked tool");
		const { engine } = engineWithKartavya({
			type: "tool_sequence",
			payload: { tools: [{ name: "write", args: { path: "/etc/passwd" } }] },
		});
		const dispatcher = new KartavyaDispatcher(engine, null, rta, { toolExecutor: executor });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("Rta blocked tool");
	});

	it("blocks vidhi steps when Rta denies a step", async () => {
		const executor = mockToolExecutor();
		const rta = mockRta(false, "Step blocked");
		const vidhiEngine = {
			match: vi.fn().mockReturnValue({
				name: "dangerous-vidhi",
				steps: [{ toolName: "bash", args: { command: "rm -rf /" } }],
			}),
		};
		const { engine } = engineWithKartavya({ type: "vidhi", payload: { vidhi: "dangerous-vidhi" } });
		const dispatcher = new KartavyaDispatcher(engine, null, rta, { toolExecutor: executor, vidhiEngine });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("Rta blocked vidhi step");
	});
});

// ─── Notification Dispatch ───────────────────────────────────────────────────

describe("KartavyaDispatcher — notifications", () => {
	it("broadcasts notification via samiti", async () => {
		const { engine } = engineWithKartavya({
			type: "notification",
			payload: { message: "build done", channel: "#builds", severity: "info" },
		});
		const samiti = mockSamiti();
		const dispatcher = new KartavyaDispatcher(engine, samiti, null);

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(true);
		expect(samiti.broadcast).toHaveBeenCalledWith("#builds", expect.objectContaining({
			content: "build done",
			severity: "info",
		}));
	});

	it("uses defaults when payload fields are missing", async () => {
		const { engine } = engineWithKartavya({ type: "notification", payload: {} });
		const samiti = mockSamiti();
		const dispatcher = new KartavyaDispatcher(engine, samiti, null);

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(true);
		expect(results[0].result).toContain("#kartavya"); // default channel
	});

	it("succeeds without samiti (no broadcast target)", async () => {
		const { engine } = engineWithKartavya({ type: "notification", payload: { message: "hi" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null);

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(true);
	});

	it("maps severity correctly for warning and critical", async () => {
		const { engine } = engineWithKartavya({
			type: "notification",
			payload: { message: "alert", severity: "critical" },
		});
		const samiti = mockSamiti();
		const dispatcher = new KartavyaDispatcher(engine, samiti, null);

		await dispatcher.evaluate();
		expect(samiti.broadcast).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ severity: "critical" }),
		);
	});
});

// ─── Tool Sequence Dispatch ──────────────────────────────────────────────────

describe("KartavyaDispatcher — tool_sequence", () => {
	it("executes tools sequentially via executor", async () => {
		const callOrder: string[] = [];
		const executor: ToolExecutor = vi.fn().mockImplementation(async (name: string) => {
			callOrder.push(name);
			return { success: true, output: `${name}-done` };
		});
		const { engine } = engineWithKartavya({
			type: "tool_sequence",
			payload: {
				tools: [
					{ name: "read", args: { path: "/a" } },
					{ name: "write", args: { path: "/b" } },
				],
			},
		});
		const dispatcher = new KartavyaDispatcher(engine, null, null, { toolExecutor: executor });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(true);
		expect(callOrder).toEqual(["read", "write"]);
	});

	it("fails when no tools specified", async () => {
		const { engine } = engineWithKartavya({ type: "tool_sequence", payload: {} });
		const dispatcher = new KartavyaDispatcher(engine, null, null);

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("No tools specified");
	});

	it("stops on first tool failure", async () => {
		const executor: ToolExecutor = vi.fn()
			.mockResolvedValueOnce({ success: true, output: "ok" })
			.mockResolvedValueOnce({ success: false, error: "write denied" });
		const { engine } = engineWithKartavya({
			type: "tool_sequence",
			payload: {
				tools: [
					{ name: "read", args: {} },
					{ name: "write", args: {} },
					{ name: "delete", args: {} },
				],
			},
		});
		const dispatcher = new KartavyaDispatcher(engine, null, null, { toolExecutor: executor });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("write denied");
		expect(executor).toHaveBeenCalledTimes(2); // third never called
	});

	it("broadcasts completion via samiti when executor present", async () => {
		const executor = mockToolExecutor();
		const samiti = mockSamiti();
		const { engine } = engineWithKartavya({
			type: "tool_sequence",
			payload: { tools: [{ name: "lint", args: {} }] },
		});
		const dispatcher = new KartavyaDispatcher(engine, samiti, null, { toolExecutor: executor });

		await dispatcher.evaluate();
		expect(samiti.broadcast).toHaveBeenCalledWith("#kartavya", expect.objectContaining({
			content: expect.stringContaining("Tool sequence complete"),
		}));
	});

	it("falls back to broadcast-only when no executor", async () => {
		const samiti = mockSamiti();
		const { engine } = engineWithKartavya({
			type: "tool_sequence",
			payload: { tools: [{ name: "read", args: {} }] },
		});
		const dispatcher = new KartavyaDispatcher(engine, samiti, null);

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(true);
		expect(results[0].result).toContain("broadcast (no executor)");
	});
});

// ─── Vidhi Dispatch ──────────────────────────────────────────────────────────

describe("KartavyaDispatcher — vidhi", () => {
	it("resolves and executes vidhi steps", async () => {
		const executor = mockToolExecutor();
		const vidhiEngine = {
			match: vi.fn().mockReturnValue({
				name: "auto-format",
				steps: [
					{ toolName: "read", args: { path: "/src" } },
					{ toolName: "write", args: { path: "/src" } },
				],
			}),
		};
		const { engine } = engineWithKartavya({ type: "vidhi", payload: { vidhi: "auto-format" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null, { toolExecutor: executor, vidhiEngine });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(true);
		expect(executor).toHaveBeenCalledTimes(2);
	});

	it("fails when no vidhi name in payload", async () => {
		const { engine } = engineWithKartavya({ type: "vidhi", payload: {} });
		const dispatcher = new KartavyaDispatcher(engine, null, null);

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("No vidhi name specified");
	});

	it("fails when vidhi not found", async () => {
		const executor = mockToolExecutor();
		const vidhiEngine = { match: vi.fn().mockReturnValue(null) };
		const { engine } = engineWithKartavya({ type: "vidhi", payload: { vidhi: "nonexistent" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null, { toolExecutor: executor, vidhiEngine });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("not found");
	});

	it("falls back to broadcast-only when no engine/executor", async () => {
		const samiti = mockSamiti();
		const { engine } = engineWithKartavya({ type: "vidhi", payload: { vidhi: "some-vidhi" } });
		const dispatcher = new KartavyaDispatcher(engine, samiti, null);

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(true);
		expect(results[0].result).toContain("broadcast (no engine/executor)");
	});

	it("stops vidhi on step failure", async () => {
		const executor: ToolExecutor = vi.fn()
			.mockResolvedValueOnce({ success: true, output: "ok" })
			.mockResolvedValueOnce({ success: false, error: "step failed" });
		const vidhiEngine = {
			match: vi.fn().mockReturnValue({
				name: "multi-step",
				steps: [
					{ toolName: "read", args: {} },
					{ toolName: "write", args: {} },
				],
			}),
		};
		const { engine } = engineWithKartavya({ type: "vidhi", payload: { vidhi: "multi-step" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null, { toolExecutor: executor, vidhiEngine });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("step failed");
	});
});

// ─── Lifecycle (start/stop) ──────────────────────────────────────────────────

describe("KartavyaDispatcher — lifecycle", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("start() sets up interval and runs first evaluation", async () => {
		vi.useFakeTimers();
		const { engine } = engineWithKartavya({ type: "notification", payload: { message: "tick" } });
		const samiti = mockSamiti();
		const dispatcher = new KartavyaDispatcher(engine, samiti, null, { evaluationIntervalMs: 1000 });

		dispatcher.start();
		await vi.advanceTimersByTimeAsync(0); // flush immediate evaluation
		expect(samiti.broadcast).toHaveBeenCalled();

		dispatcher.stop();
		vi.useRealTimers();
	});

	it("start() is idempotent — calling twice does not double-schedule", () => {
		vi.useFakeTimers();
		const engine = new KartavyaEngine();
		const dispatcher = new KartavyaDispatcher(engine, null, null, { evaluationIntervalMs: 5000 });

		dispatcher.start();
		dispatcher.start(); // second call should be no-op

		dispatcher.stop();
		vi.useRealTimers();
	});

	it("stop() clears the interval", async () => {
		vi.useFakeTimers();
		const { engine } = engineWithKartavya({ type: "notification", payload: { message: "tick" } });
		const samiti = mockSamiti();
		const dispatcher = new KartavyaDispatcher(engine, samiti, null, { evaluationIntervalMs: 100 });

		dispatcher.start();
		await vi.advanceTimersByTimeAsync(0);
		const callCount = samiti.broadcast.mock.calls.length;

		dispatcher.stop();
		await vi.advanceTimersByTimeAsync(500); // should not trigger more
		expect(samiti.broadcast.mock.calls.length).toBe(callCount);

		vi.useRealTimers();
	});
});

// ─── Result Management ───────────────────────────────────────────────────────

describe("KartavyaDispatcher — results", () => {
	it("getResults() returns recent dispatch results", async () => {
		const { engine } = engineWithKartavya({ type: "notification", payload: { message: "test" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null);

		await dispatcher.evaluate();
		const results = dispatcher.getResults();
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0]).toHaveProperty("kartavyaId");
		expect(results[0]).toHaveProperty("action");
		expect(results[0]).toHaveProperty("success");
	});

	it("getResults(limit) respects limit parameter", async () => {
		const { engine } = engineWithKartavya({ type: "notification", payload: { message: "test" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null);

		await dispatcher.evaluate();
		await dispatcher.evaluate();
		const results = dispatcher.getResults(1);
		expect(results.length).toBeLessThanOrEqual(1);
	});

	it("result ring buffer stays bounded at 100", async () => {
		const engine = new KartavyaEngine({ minConfidenceForProposal: 0.5, maxActive: 100 });
		// Create up to the hard ceiling (100) active kartavyas
		for (let i = 0; i < 100; i++) {
			const trigger: KartavyaTrigger = { type: "event", condition: "periodic_evaluation", cooldownMs: 10_000 };
			const action: KartavyaAction = { type: "notification", payload: { message: `msg-${i}` } };
			const p = engine.proposeNiyama(`vas-${i}`, `duty-${i}`, `test-${i}`, trigger, action, ["e"], 0.9);
			engine.approveNiyama(p.id);
		}
		const dispatcher = new KartavyaDispatcher(engine, null, null);

		// First evaluation dispatches up to maxExecutionsPerHour (60)
		await dispatcher.evaluate();
		const all = dispatcher.getResults(200);
		// Ring buffer always bounded at 100
		expect(all.length).toBeLessThanOrEqual(100);
	});
});

// ─── Concurrency ─────────────────────────────────────────────────────────────

describe("KartavyaDispatcher — concurrency", () => {
	it("evaluate() dispatches kartavyas sequentially via await", async () => {
		const order: number[] = [];
		let call = 0;
		const executor: ToolExecutor = vi.fn().mockImplementation(async () => {
			const idx = call++;
			order.push(idx);
			return { success: true, output: `tool-${idx}` };
		});
		const engine = new KartavyaEngine({ minConfidenceForProposal: 0.5 });
		for (let i = 0; i < 3; i++) {
			const trigger: KartavyaTrigger = { type: "event", condition: "periodic_evaluation", cooldownMs: 10_000 };
			const action: KartavyaAction = {
				type: "tool_sequence",
				payload: { tools: [{ name: `tool-${i}`, args: {} }] },
			};
			const p = engine.proposeNiyama(`vas-${i}`, `duty-${i}`, `test-${i}`, trigger, action, ["e"], 0.9);
			engine.approveNiyama(p.id);
		}
		const dispatcher = new KartavyaDispatcher(engine, null, null, { toolExecutor: executor });

		const results = await dispatcher.evaluate();
		// All dispatched sequentially (order preserved)
		expect(order).toEqual([0, 1, 2]);
		expect(results.length).toBe(3);
	});

	it("records execution result on engine after dispatch", async () => {
		const { engine, kartavya } = engineWithKartavya({ type: "notification", payload: { message: "hi" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null);

		await dispatcher.evaluate();
		// Engine should have recorded the execution (successCount incremented)
		const k = engine.getKartavya(kartavya.id);
		expect(k?.successCount).toBeGreaterThanOrEqual(1);
	});
});

// ─── Error Handling ──────────────────────────────────────────────────────────

describe("KartavyaDispatcher — error handling", () => {
	it("catches dispatch errors and records them", async () => {
		const engine = new KartavyaEngine({ minConfidenceForProposal: 0.5 });
		const trigger: KartavyaTrigger = { type: "event", condition: "periodic_evaluation", cooldownMs: 10_000 };
		const action: KartavyaAction = { type: "tool_sequence", payload: { tools: [{ name: "explode", args: {} }] } };
		const p = engine.proposeNiyama("vas-x", "boom", "test", trigger, action, ["e"], 0.9);
		engine.approveNiyama(p.id);

		const executor: ToolExecutor = vi.fn().mockRejectedValue(new Error("executor exploded"));
		const dispatcher = new KartavyaDispatcher(engine, null, null, { toolExecutor: executor });

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("executor exploded");
	});

	it("evaluate() never throws — errors are captured in results", async () => {
		const { engine } = engineWithKartavya({ type: "command", payload: { command: "false" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null, { enableCommandActions: true });

		// Should not throw
		const results = await dispatcher.evaluate();
		expect(Array.isArray(results)).toBe(true);
	});
});

// ─── Config Defaults ─────────────────────────────────────────────────────────

describe("KartavyaDispatcher — config", () => {
	it("uses default config when none provided", () => {
		const engine = new KartavyaEngine();
		const dispatcher = new KartavyaDispatcher(engine, null, null);
		// Should not throw — defaults applied
		expect(dispatcher).toBeDefined();
	});

	it("merges partial config with defaults", async () => {
		const { engine } = engineWithKartavya({ type: "command", payload: { command: "echo merged" } });
		const dispatcher = new KartavyaDispatcher(engine, null, null, {
			enableCommandActions: true,
			maxConcurrent: 5,
		});

		const results = await dispatcher.evaluate();
		expect(results[0].success).toBe(true);
	});
});
