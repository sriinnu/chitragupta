import { describe, expect, it, vi } from "vitest";
import { AgentTaskCheckpointRuntime } from "../src/agent-task-checkpoint-runtime.js";
import type { AgentTaskCheckpointStore } from "../src/agent-task-checkpoint-types.js";

describe("AgentTaskCheckpointRuntime", () => {
	it("rehydrates a prior checkpoint into the next prompt run", async () => {
		const save = vi.fn(async (input) => ({
			id: "cp-1",
			projectPath: input.projectPath,
			taskKey: input.taskKey,
			taskType: input.taskType ?? null,
			agentId: input.agentId ?? null,
			sessionId: input.sessionId ?? null,
			parentTaskKey: input.parentTaskKey ?? null,
			sessionLineageKey: input.sessionLineageKey ?? null,
			status: input.status,
			phase: input.phase,
			checkpoint: input.checkpoint,
			createdAt: 100,
			updatedAt: 200,
		}));
		const store: AgentTaskCheckpointStore = {
			get: vi.fn(async () => ({
				id: "cp-prev",
				projectPath: "/tmp/project",
				taskKey: "cli:test:root",
				taskType: "cli.root",
				agentId: "agent-old",
				sessionId: "session-prev",
				parentTaskKey: null,
				sessionLineageKey: "lineage-1",
				status: "active",
				phase: "tool:start",
				checkpoint: {
					version: 1,
					taskKey: "cli:test:root",
					taskType: "cli.root",
					agentId: "agent-old",
					purpose: "root",
					depth: 0,
					sessionId: "session-prev",
					memorySessionId: "mem-prev",
					parentTaskKey: null,
					sessionLineageKey: "lineage-1",
					promptRunId: "run-prev",
					promptSequence: 4,
					phase: "tool:start",
					latestEvent: "tool:start",
					promptPreview: "previous prompt",
					latestToolName: "bash",
					latestSubagentId: null,
					latestSubagentPurpose: null,
					latestError: null,
					messagesCount: 3,
					updatedAt: 200,
				},
				createdAt: 100,
				updatedAt: 200,
			})),
			save,
			clear: vi.fn(async () => true),
		};

		const runtime = new AgentTaskCheckpointRuntime({
			store,
			projectPath: "/tmp/project",
			taskKey: "cli:test:root",
			taskType: "cli.root",
			agentId: "agent-new",
			purpose: "root",
			depth: 0,
			sessionLineageKey: "lineage-1",
		});

		await runtime.beginPrompt({
			prompt: "resume me",
			sessionId: "session-next",
			memorySessionId: "mem-next",
			messagesCount: 0,
		});

		expect(store.get).toHaveBeenCalledWith({
			projectPath: "/tmp/project",
			taskKey: "cli:test:root",
		});
		const checkpoint = save.mock.calls.at(-1)?.[0]?.checkpoint as Record<string, unknown>;
		expect(checkpoint.promptSequence).toBe(5);
		expect(checkpoint.resumeFromStatus).toBe("active");
		expect(checkpoint.resumeFromPhase).toBe("tool:start");
		expect(checkpoint.resumeFromPromptRunId).toBe("run-prev");
	});

	it("persists a bounded recent-event trail for timeout pickup", async () => {
		const save = vi.fn(async (input) => ({
			id: "cp-2",
			projectPath: input.projectPath,
			taskKey: input.taskKey,
			taskType: input.taskType ?? null,
			agentId: input.agentId ?? null,
			sessionId: input.sessionId ?? null,
			parentTaskKey: input.parentTaskKey ?? null,
			sessionLineageKey: input.sessionLineageKey ?? null,
			status: input.status,
			phase: input.phase,
			checkpoint: input.checkpoint,
			createdAt: 100,
			updatedAt: 200,
		}));
		const store: AgentTaskCheckpointStore = {
			get: vi.fn(async () => null),
			save,
			clear: vi.fn(async () => true),
		};

		const runtime = new AgentTaskCheckpointRuntime({
			store,
			projectPath: "/tmp/project",
			taskKey: "cli:test:bounded",
			taskType: "cli.root",
			agentId: "agent-new",
			purpose: "root",
			depth: 0,
		});

		await runtime.beginPrompt({
			prompt: "trace me",
			sessionId: "session-next",
			memorySessionId: "mem-next",
			messagesCount: 0,
		});
		for (let index = 0; index < 16; index += 1) {
			runtime.recordEvent(
				"tool:start",
				{ toolName: `tool-${index}`, summary: `step-${index}` },
				index + 1,
			);
		}
		await runtime.flush();

		const checkpoint = save.mock.calls.at(-1)?.[0]?.checkpoint as {
			recentEvents: Array<{ event: string; toolName?: string | null; summary?: string | null }>;
		};
		expect(checkpoint.recentEvents).toHaveLength(12);
		expect(checkpoint.recentEvents[0]?.toolName).toBe("tool-4");
		expect(checkpoint.recentEvents.at(-1)?.toolName).toBe("tool-15");
		expect(checkpoint.recentEvents.at(-1)?.summary).toBe("step-15");
	});

	it("preserves the prior durable boundary across repeated prompt restarts with no progress", async () => {
		const save = vi.fn(async (input) => ({
			id: "cp-3",
			projectPath: input.projectPath,
			taskKey: input.taskKey,
			taskType: input.taskType ?? null,
			agentId: input.agentId ?? null,
			sessionId: input.sessionId ?? null,
			parentTaskKey: input.parentTaskKey ?? null,
			sessionLineageKey: input.sessionLineageKey ?? null,
			status: input.status,
			phase: input.phase,
			checkpoint: input.checkpoint,
			createdAt: 100,
			updatedAt: 200,
		}));
		const store: AgentTaskCheckpointStore = {
			get: vi.fn(async () => ({
				id: "cp-prev",
				projectPath: "/tmp/project",
				taskKey: "cli:test:timeout",
				taskType: "cli.root",
				agentId: "agent-old",
				sessionId: "session-prev",
				parentTaskKey: null,
				sessionLineageKey: "lineage-1",
				status: "active",
				phase: "prompt:start",
				checkpoint: {
					version: 1,
					taskKey: "cli:test:timeout",
					taskType: "cli.root",
					agentId: "agent-old",
					purpose: "root",
					depth: 0,
					sessionId: "session-prev",
					memorySessionId: "mem-prev",
					parentTaskKey: null,
					sessionLineageKey: "lineage-1",
					promptRunId: "run-restart-1",
					promptSequence: 4,
					phase: "prompt:start",
					latestEvent: "prompt:start",
					promptPreview: "restarted prompt",
					latestToolName: null,
					latestSubagentId: null,
					latestSubagentPurpose: null,
					latestError: null,
					resumeFromStatus: "active",
					resumeFromPhase: "tool:start",
					resumeFromPromptRunId: "run-prev",
					resumeFromUpdatedAt: 175,
					recentEvents: [],
					messagesCount: 3,
					updatedAt: 200,
				},
				createdAt: 100,
				updatedAt: 200,
			})),
			save,
			clear: vi.fn(async () => true),
		};

		const runtime = new AgentTaskCheckpointRuntime({
			store,
			projectPath: "/tmp/project",
			taskKey: "cli:test:timeout",
			taskType: "cli.root",
			agentId: "agent-new",
			purpose: "root",
			depth: 0,
			sessionLineageKey: "lineage-1",
		});

		await runtime.beginPrompt({
			prompt: "restart again",
			sessionId: "session-next",
			memorySessionId: "mem-next",
			messagesCount: 0,
		});

		const checkpoint = save.mock.calls.at(-1)?.[0]?.checkpoint as Record<string, unknown>;
		expect(checkpoint.resumeFromStatus).toBe("active");
		expect(checkpoint.resumeFromPhase).toBe("tool:start");
		expect(checkpoint.resumeFromPromptRunId).toBe("run-prev");
		expect(checkpoint.resumeFromUpdatedAt).toBe(175);
	});

	it("reuses the persisted terminal status when the same runtime starts a later prompt", async () => {
		const save = vi.fn(async (input) => ({
			id: "cp-4",
			projectPath: input.projectPath,
			taskKey: input.taskKey,
			taskType: input.taskType ?? null,
			agentId: input.agentId ?? null,
			sessionId: input.sessionId ?? null,
			parentTaskKey: input.parentTaskKey ?? null,
			sessionLineageKey: input.sessionLineageKey ?? null,
			status: input.status,
			phase: input.phase,
			checkpoint: input.checkpoint,
			createdAt: 100,
			updatedAt: 200,
		}));
		const store: AgentTaskCheckpointStore = {
			get: vi.fn(async () => null),
			save,
			clear: vi.fn(async () => true),
		};

		const runtime = new AgentTaskCheckpointRuntime({
			store,
			projectPath: "/tmp/project",
			taskKey: "cli:test:complete",
			taskType: "cli.root",
			agentId: "agent-new",
			purpose: "root",
			depth: 0,
			sessionLineageKey: "lineage-1",
		});

		await runtime.beginPrompt({
			prompt: "first run",
			sessionId: "session-1",
			memorySessionId: "mem-1",
			messagesCount: 0,
		});
		await runtime.finish("completed", { messagesCount: 3 });
		await runtime.beginPrompt({
			prompt: "second run",
			sessionId: "session-2",
			memorySessionId: "mem-2",
			messagesCount: 0,
		});

		const checkpoint = save.mock.calls.at(-1)?.[0]?.checkpoint as Record<string, unknown>;
		expect(checkpoint.resumeFromStatus).toBe("completed");
		expect(checkpoint.resumeFromPhase).toBe("prompt:completed");
	});

	it("surfaces durable checkpoint write failures to awaited callers", async () => {
		const store: AgentTaskCheckpointStore = {
			get: vi.fn(async () => null),
			save: vi.fn(async () => {
				throw new Error("checkpoint store unavailable");
			}),
			clear: vi.fn(async () => true),
		};

		const runtime = new AgentTaskCheckpointRuntime({
			store,
			projectPath: "/tmp/project",
			taskKey: "cli:test:checkpoint-fail",
			taskType: "cli.root",
			agentId: "agent-new",
			purpose: "root",
			depth: 0,
		});

		await expect(runtime.beginPrompt({
			prompt: "persist me",
			sessionId: "session-next",
			memorySessionId: "mem-next",
			messagesCount: 0,
		})).rejects.toThrow("checkpoint store unavailable");

		await expect(runtime.flush()).rejects.toThrow("checkpoint store unavailable");
	});

	it("ignores late persisted events after a terminal finish", async () => {
		const save = vi.fn(async (input) => ({
			id: "cp-5",
			projectPath: input.projectPath,
			taskKey: input.taskKey,
			taskType: input.taskType ?? null,
			agentId: input.agentId ?? null,
			sessionId: input.sessionId ?? null,
			parentTaskKey: input.parentTaskKey ?? null,
			sessionLineageKey: input.sessionLineageKey ?? null,
			status: input.status,
			phase: input.phase,
			checkpoint: input.checkpoint,
			createdAt: 100,
			updatedAt: 200,
		}));
		const store: AgentTaskCheckpointStore = {
			get: vi.fn(async () => null),
			save,
			clear: vi.fn(async () => true),
		};

		const runtime = new AgentTaskCheckpointRuntime({
			store,
			projectPath: "/tmp/project",
			taskKey: "cli:test:terminal-freeze",
			taskType: "cli.root",
			agentId: "agent-new",
			purpose: "root",
			depth: 0,
		});

		await runtime.beginPrompt({
			prompt: "terminal freeze",
			sessionId: "session-next",
			memorySessionId: "mem-next",
			messagesCount: 0,
		});
		await runtime.finish("completed", { messagesCount: 1 });
		runtime.recordEvent("tool:error", { toolName: "bash", error: "late timeout" }, 2);
		await runtime.flush();

		expect(save).toHaveBeenCalledTimes(2);
		expect(save.mock.calls.at(-1)?.[0]?.status).toBe("completed");
		expect(save.mock.calls.at(-1)?.[0]?.phase).toBe("prompt:completed");
	});
});
