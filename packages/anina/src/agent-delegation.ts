import type { AgentMessage, SpawnConfig, SubAgentResult } from "./types.js";
import type { MemoryBridge } from "./memory-bridge.js";
import {
	bubbleUpDelegatedFindings,
	buildCompletedSubAgentResult,
	buildFailedSubAgentResult,
} from "./agent-runtime-helpers.js";

interface DelegatedChildLike {
	id: string;
	memorySessionId: string | null;
	prompt(message: string): Promise<AgentMessage>;
	getMessages(): readonly AgentMessage[];
}

/**
 * Run one delegated sub-agent prompt with normalized bubbling, event emission,
 * and success/error result shaping outside the main Agent class body.
 */
export async function runDelegatedPrompt(options: {
	child: DelegatedChildLike;
	purpose: string;
	prompt: string;
	memoryBridge: MemoryBridge | null;
	parentSessionId: string | null;
	projectPath: string;
	emit: (event: "subagent:done" | "subagent:error", data: Record<string, unknown>) => void;
	onBubbleError: (error: unknown) => void;
	createMessage: (text: string) => AgentMessage;
}): Promise<SubAgentResult> {
	try {
		const response = await options.child.prompt(options.prompt);
		await bubbleUpDelegatedFindings({
			memoryBridge: options.memoryBridge,
			childSessionId: options.child.memorySessionId,
			parentSessionId: options.parentSessionId,
			projectPath: options.projectPath,
			onError: options.onBubbleError,
		});
		options.emit("subagent:done", {
			childId: options.child.id,
			purpose: options.purpose,
			status: "completed",
		});
		return buildCompletedSubAgentResult(options.child, options.purpose, response);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		options.emit("subagent:error", {
			childId: options.child.id,
			purpose: options.purpose,
			error: errorMessage,
		});
		return buildFailedSubAgentResult({
			child: options.child,
			purpose: options.purpose,
			error,
			createMessage: options.createMessage,
		});
	}
}

/** Ensure a parallel delegation batch respects the caller's sub-agent limit. */
export async function runParallelDelegations(
	delegate: (config: SpawnConfig, prompt: string) => Promise<SubAgentResult>,
	tasks: Array<{ config: SpawnConfig; prompt: string }>,
): Promise<SubAgentResult[]> {
	return Promise.all(tasks.map((task) => delegate(task.config, task.prompt)));
}
