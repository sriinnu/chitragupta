import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcRouter } from "../src/rpc-router.js";
import { registerAgentTaskMethods } from "../src/services-agent-tasks.js";

const getAgentTaskCheckpoint = vi.fn(() => ({
	id: "checkpoint-1",
	projectPath: "/repo/project",
	taskKey: "task-1",
	taskType: "cli.root",
	agentId: "agent-1",
	sessionId: "session-1",
	parentTaskKey: null,
	sessionLineageKey: "lineage-a",
	status: "active",
	phase: "tool:done",
		checkpoint: {
			version: 1,
			taskKey: "task-1",
			phase: "tool:done",
			latestEvent: "tool:done",
			latestToolName: "bash",
			latestError: "timeout",
			resumeFromStatus: "error",
			resumeFromPhase: "tool:done",
			resumeFromPromptRunId: "prompt-1",
			promptPreview: "Continue the deploy recovery",
			recentEvents: [
				{ event: "tool:start", phase: "tool:start", at: 123, toolName: "bash" },
				{ event: "tool:error", phase: "tool:done", at: 124, error: "timeout" },
			],
		},
	createdAt: 1,
	updatedAt: 2,
}));
const listAgentTaskCheckpoints = vi.fn(() => [
	{
		id: "checkpoint-1",
		projectPath: "/repo/project",
		taskKey: "task-1",
		taskType: "cli.root",
		agentId: "agent-1",
		sessionId: "session-1",
		parentTaskKey: null,
		sessionLineageKey: "lineage-a",
		status: "aborted",
		phase: "tool:done",
			checkpoint: {
				version: 1,
				taskKey: "task-1",
				phase: "tool:done",
				resumeFromStatus: "aborted",
				resumeFromPhase: "tool:done",
				promptPreview: "Resume after timeout",
				recentEvents: [
					{ event: "tool:done", phase: "tool:done", at: 123, summary: "Timed out after bash" },
				],
			},
		createdAt: 1,
		updatedAt: 2,
	},
]);
const upsertAgentTaskCheckpoint = vi.fn((input: Record<string, unknown>) => ({
	id: "checkpoint-1",
	projectPath: String(input.projectPath),
	taskKey: String(input.taskKey),
	taskType: typeof input.taskType === "string" ? input.taskType : null,
	agentId: typeof input.agentId === "string" ? input.agentId : null,
	sessionId: typeof input.sessionId === "string" ? input.sessionId : null,
	parentTaskKey: typeof input.parentTaskKey === "string" ? input.parentTaskKey : null,
	sessionLineageKey: typeof input.sessionLineageKey === "string" ? input.sessionLineageKey : null,
	status: String(input.status),
	phase: String(input.phase),
	checkpoint: input.checkpoint,
	createdAt: 1,
	updatedAt: 2,
}));
const clearAgentTaskCheckpoint = vi.fn(() => true);

vi.mock("@chitragupta/smriti", () => ({
	getAgentTaskCheckpoint,
	listAgentTaskCheckpoints,
	upsertAgentTaskCheckpoint,
	clearAgentTaskCheckpoint,
}));

describe("services-agent-tasks", () => {
	let router: RpcRouter;

	beforeEach(() => {
		router = new RpcRouter();
		registerAgentTaskMethods(router);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("loads persisted task checkpoints through the daemon RPC surface", async () => {
		const result = await router.handle("agent.tasks.checkpoint.get", {
			projectPath: "/repo/project",
			taskKey: "task-1",
		}, {});

		expect(getAgentTaskCheckpoint).toHaveBeenCalledWith("/repo/project", "task-1");
		expect(result).toEqual({
			checkpoint: expect.objectContaining({
				id: "checkpoint-1",
				taskKey: "task-1",
				phase: "tool:done",
			}),
			resumeContext: expect.stringContaining("Durable resume context:"),
			resumePlan: expect.objectContaining({
				taskKey: "task-1",
				nextAction: "resume-error-handling",
			}),
		});
	});

	it("lists recent persisted task checkpoints through the daemon RPC surface", async () => {
		const result = await router.handle("agent.tasks.checkpoint.list", {
			projectPath: "/repo/project",
			status: "active",
			limit: 10,
		}, {});

		expect(listAgentTaskCheckpoints).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			status: "active",
			taskType: undefined,
			sessionId: undefined,
			limit: 10,
		});
		expect(result).toEqual({
			checkpoints: [
				expect.objectContaining({
					id: "checkpoint-1",
					taskKey: "task-1",
					status: "aborted",
					resumeContext: expect.stringContaining("Durable resume context:"),
					resumePlan: expect.objectContaining({
						taskKey: "task-1",
						nextAction: "inspect-abort",
					}),
				}),
			],
		});
	});

	it("derives resume plans from canonical stored status and phase over nested checkpoint hints", async () => {
		getAgentTaskCheckpoint.mockReturnValueOnce({
			id: "checkpoint-2",
			projectPath: "/repo/project",
			taskKey: "task-2",
			taskType: "cli.root",
			agentId: "agent-2",
			sessionId: "session-2",
			parentTaskKey: null,
			sessionLineageKey: "lineage-b",
			status: "aborted",
			phase: "subagent:error",
			checkpoint: {
				version: 1,
				taskKey: "task-2",
				phase: "subagent:error",
				latestEvent: "subagent:error",
				latestSubagentPurpose: "review",
				latestError: "tool timed out earlier",
				resumeFromStatus: "error",
				resumeFromPhase: "tool:error",
				promptPreview: "Inspect the aborted branch",
				recentEvents: [],
			},
			createdAt: 3,
			updatedAt: 4,
		});

		const result = await router.handle("agent.tasks.checkpoint.get", {
			projectPath: "/repo/project",
			taskKey: "task-2",
		}, {});

		expect((result as { resumePlan: { previousStatus: string; previousPhase: string; nextAction: string } }).resumePlan)
			.toEqual(expect.objectContaining({
				previousStatus: "aborted",
				previousPhase: "subagent:error",
				nextAction: "inspect-abort",
			}));
	});

	it("falls back to canonical row state when older checkpoints lack resumeFrom hints", async () => {
		getAgentTaskCheckpoint.mockReturnValueOnce({
			id: "checkpoint-3",
			projectPath: "/repo/project",
			taskKey: "task-3",
			taskType: "cli.root",
			agentId: "agent-3",
			sessionId: "session-3",
			parentTaskKey: null,
			sessionLineageKey: "lineage-c",
			status: "error",
			phase: "tool:error",
			checkpoint: {
				version: 1,
				taskKey: "task-3",
				phase: "tool:error",
				latestEvent: "tool:error",
				latestToolName: "bash",
				promptPreview: "Retry the failed task",
				recentEvents: [],
			},
			createdAt: 5,
			updatedAt: 6,
		});

		const result = await router.handle("agent.tasks.checkpoint.get", {
			projectPath: "/repo/project",
			taskKey: "task-3",
		}, {});

		expect((result as { resumePlan: { previousStatus: string; previousPhase: string; nextAction: string } }).resumePlan)
			.toEqual(expect.objectContaining({
				previousStatus: "error",
				previousPhase: "tool:error",
				nextAction: "resume-error-handling",
			}));
	});

	it("persists task checkpoints through the daemon RPC surface", async () => {
		const result = await router.handle("agent.tasks.checkpoint.save", {
			projectPath: "/repo/project",
			taskKey: "task-1",
			taskType: "cli.root",
			agentId: "agent-1",
			sessionId: "session-1",
			sessionLineageKey: "lineage-a",
			status: "completed",
			phase: "prompt:completed",
			checkpoint: {
				version: 1,
				taskKey: "task-1",
				phase: "prompt:completed",
				recentEvents: [
					{ event: "tool:start", phase: "tool:start", at: 123, toolName: "bash" },
				],
			},
		}, {});

		expect(upsertAgentTaskCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			taskKey: "task-1",
			taskType: "cli.root",
			agentId: "agent-1",
			sessionId: "session-1",
			sessionLineageKey: "lineage-a",
			status: "completed",
			phase: "prompt:completed",
		}));
		expect(result).toEqual({
			checkpoint: expect.objectContaining({
				id: "checkpoint-1",
				taskKey: "task-1",
				status: "completed",
			}),
		});
		expect(
			(result as { checkpoint: { checkpoint: { recentEvents: Array<{ toolName?: string }> } } }).checkpoint
				.checkpoint.recentEvents[0]?.toolName,
		).toBe("bash");
	});

	it("normalizes bounded checkpoint payloads before persisting them", async () => {
		const result = await router.handle("agent.tasks.checkpoint.save", {
			projectPath: "/repo/project",
			taskKey: "task-1",
			status: "active",
			phase: "tool:done",
			checkpoint: {
				version: 1,
				taskKey: "task-1",
				phase: "tool:done",
				promptPreview: "x".repeat(400),
				recentEvents: Array.from({ length: 20 }, (_, index) => ({
					event: "tool:done",
					phase: `tool:${index}`,
					at: index,
					summary: `summary-${index}`,
				})),
			},
		}, {});

		const savedCheckpoint = upsertAgentTaskCheckpoint.mock.calls.at(-1)?.[0]?.checkpoint as {
			promptPreview?: string;
			recentEvents?: Array<{ phase?: string; summary?: string }>;
		};
		expect(savedCheckpoint.promptPreview?.length).toBe(280);
		expect(savedCheckpoint.recentEvents).toHaveLength(12);
		expect(savedCheckpoint.recentEvents?.[0]?.phase).toBe("tool:8");
		expect(
			(result as { checkpoint: { checkpoint: { recentEvents: Array<{ phase?: string }> } } }).checkpoint
				.checkpoint.recentEvents.at(-1)?.phase,
		).toBe("tool:19");
	});

	it("clears persisted task checkpoints through the daemon RPC surface", async () => {
		const result = await router.handle("agent.tasks.checkpoint.clear", {
			projectPath: "/repo/project",
			taskKey: "task-1",
		}, {});

		expect(clearAgentTaskCheckpoint).toHaveBeenCalledWith("/repo/project", "task-1");
		expect(result).toEqual({ cleared: true });
	});
});
