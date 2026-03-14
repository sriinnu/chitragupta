import { describe, expect, it, vi } from "vitest";
import {
	beginTaskCheckpointPrompt,
	buildTaskCheckpointResumeContextFromRecord,
	buildTaskCheckpointResumePlanFromRecord,
	type AgentTaskCheckpointBindingState,
} from "../src/agent-task-checkpoint-bindings.js";
import type { AgentConfig } from "../src/types.js";

describe("agent-task-checkpoint-bindings", () => {
	it("rehydrates from the checkpoint store on repeated prompt starts for the same task key", async () => {
		const get = vi.fn(async () => null);
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
			createdAt: 1,
			updatedAt: Date.now(),
		}));
		const config = {
			project: "/tmp/project",
			taskKey: "task-1",
			taskType: "agent.task",
			taskCheckpointStore: {
				get,
				save,
				clear: vi.fn(async () => true),
			},
		} as AgentConfig;
		const state: AgentTaskCheckpointBindingState = { key: null, runtime: null };

		await beginTaskCheckpointPrompt(state, config, "/tmp/project", {
			agentId: "agent-1",
			purpose: "root",
			depth: 0,
			prompt: "first prompt",
			fallbackSessionId: "session-1",
			memorySessionId: null,
			messagesCount: 0,
		});
		await beginTaskCheckpointPrompt(state, config, "/tmp/project", {
			agentId: "agent-1",
			purpose: "root",
			depth: 0,
			prompt: "second prompt",
			fallbackSessionId: "session-1",
			memorySessionId: null,
			messagesCount: 0,
		});

		expect(get).toHaveBeenCalledTimes(2);
	});

	it("derives a machine-usable resume plan from a persisted task checkpoint", () => {
		const plan = buildTaskCheckpointResumePlanFromRecord({
			id: "cp-1",
			projectPath: "/tmp/project",
			taskKey: "task-1",
			taskType: "agent.task",
			agentId: "agent-1",
			sessionId: "session-1",
			parentTaskKey: null,
			sessionLineageKey: null,
			status: "error",
			phase: "tool:error",
			checkpoint: {
				version: 1,
				taskKey: "task-1",
				taskType: "agent.task",
				agentId: "agent-1",
				purpose: "root",
				depth: 0,
				sessionId: "session-1",
				memorySessionId: null,
				parentTaskKey: null,
				sessionLineageKey: null,
				promptRunId: "prompt-2",
				promptSequence: 2,
				phase: "tool:error",
				latestEvent: "tool:error",
				promptPreview: "resume deploy task",
				latestToolName: "bash",
				latestSubagentId: null,
				latestSubagentPurpose: null,
				latestError: "timed out",
				resumeFromStatus: "error",
				resumeFromPhase: "tool:error",
				resumeFromPromptRunId: "prompt-1",
				resumeFromUpdatedAt: Date.now(),
				recentEvents: [],
				messagesCount: 3,
				updatedAt: Date.now(),
			},
			createdAt: 1,
			updatedAt: 2,
		});

		expect(plan).toEqual(expect.objectContaining({
			taskKey: "task-1",
			previousStatus: "error",
			previousPhase: "tool:error",
			nextAction: "resume-error-handling",
			latestToolName: "bash",
			needsHumanReview: true,
		}));
	});

	it("distinguishes the prior durable prompt preview from the current retry prompt preview", () => {
		const context = buildTaskCheckpointResumeContextFromRecord({
			id: "cp-2",
			projectPath: "/tmp/project",
			taskKey: "task-2",
			taskType: "agent.task",
			agentId: "agent-1",
			sessionId: "session-1",
			parentTaskKey: null,
			sessionLineageKey: null,
			status: "active",
			phase: "prompt:start",
			checkpoint: {
				version: 1,
				taskKey: "task-2",
				taskType: "agent.task",
				agentId: "agent-1",
				purpose: "root",
				depth: 0,
				sessionId: "session-1",
				memorySessionId: null,
				parentTaskKey: null,
				sessionLineageKey: null,
				promptRunId: "prompt-3",
				promptSequence: 3,
				phase: "prompt:start",
				latestEvent: "prompt:start",
				promptPreview: "retry the deploy step",
				latestToolName: "bash",
				latestSubagentId: null,
				latestSubagentPurpose: null,
				latestError: "previous timeout",
				resumeFromStatus: "error",
				resumeFromPhase: "tool:error",
				resumeFromPromptRunId: "prompt-2",
				resumeFromPromptPreview: "deploy the build output",
				resumeFromUpdatedAt: Date.now(),
				recentEvents: [],
				messagesCount: 5,
				updatedAt: Date.now(),
			},
			createdAt: 1,
			updatedAt: 2,
		});

		expect(context).toContain("durable prompt preview: deploy the build output");
		expect(context).toContain("current attempt prompt preview: retry the deploy step");
	});

	it("does not suggest more work when the durable task already completed", () => {
		const plan = buildTaskCheckpointResumePlanFromRecord({
			id: "cp-3",
			projectPath: "/tmp/project",
			taskKey: "task-3",
			taskType: "agent.task",
			agentId: "agent-1",
			sessionId: "session-1",
			parentTaskKey: null,
			sessionLineageKey: null,
			status: "completed",
			phase: "prompt:completed",
			checkpoint: {
				version: 1,
				taskKey: "task-3",
				taskType: "agent.task",
				agentId: "agent-1",
				purpose: "root",
				depth: 0,
				sessionId: "session-1",
				memorySessionId: null,
				parentTaskKey: null,
				sessionLineageKey: null,
				promptRunId: "prompt-4",
				promptSequence: 4,
				phase: "prompt:completed",
				latestEvent: "prompt:completed",
				promptPreview: "completed deploy task",
				latestToolName: "bash",
				latestSubagentId: "worker-1",
				latestSubagentPurpose: "validator",
				latestError: "old timeout",
				resumeFromStatus: "completed",
				resumeFromPhase: "prompt:completed",
				resumeFromPromptRunId: "prompt-3",
				resumeFromUpdatedAt: Date.now(),
				recentEvents: [],
				messagesCount: 7,
				updatedAt: Date.now(),
			},
			createdAt: 1,
			updatedAt: 2,
		});

		expect(plan).toEqual(expect.objectContaining({
			taskKey: "task-3",
			previousStatus: "completed",
			nextAction: "none",
			needsHumanReview: false,
			detail: "The last durable task run already completed.",
		}));
	});
});
