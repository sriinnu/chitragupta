import { createHash } from "node:crypto";
import { AbortError } from "@chitragupta/core";
import type { CostBreakdown, Logger } from "@chitragupta/core";
import type { ContentPart, ProviderDefinition } from "@chitragupta/swara";
import type { AgentLoopDeps } from "./agent-loop.js";
import type { LearningLoop } from "./learning-loop.js";
import type { MemoryBridge } from "./memory-bridge.js";
import { broadcastEventToSamiti } from "./agent-comm.js";
import { bridgeEventPayload } from "./agent-events.js";
import { recordTaskCheckpointEvent, type AgentTaskCheckpointBindingState } from "./agent-task-checkpoint-bindings.js";
import { extractTextFromMessage, extractToolCallsFromMessage, findLastAssistantMessage, sumChildCosts } from "./agent-subagent.js";
import type {
	AgentConfig,
	AgentEventType,
	AgentMessage,
	AgentState,
	KaalaLifecycle,
	LokapalaGuardians,
	MeshActorRef,
	MeshActorSystem,
	MeshSamiti,
	SpawnConfig,
	SubAgentResult,
} from "./types.js";
import { buildSubAgentPrompt } from "./agent-subagent.js";
import type { AutonomousAgent } from "./agent-autonomy.js";
import type { ChetanaController } from "./chetana/controller.js";
import type { ContextManager } from "./context-manager.js";
import type { SteeringManager } from "./steering.js";
import type { ToolExecutor } from "./tool-executor.js";

/** Build the inherited child config for a delegated sub-agent. */
export function buildChildAgentConfig(
	parentConfig: AgentConfig,
	spawnConfig: SpawnConfig,
	context: {
		workingDirectory: string;
		maxTurns: number;
		systemPromptBuilder: () => string;
		mesh: {
			actorSystem: AgentConfig["actorSystem"];
			samiti: AgentConfig["samiti"];
			lokapala: LokapalaGuardians | null;
			kaala: KaalaLifecycle | null;
		};
	},
): AgentConfig {
	return {
		profile: spawnConfig.profile ?? parentConfig.profile,
		providerId: spawnConfig.providerId ?? parentConfig.providerId,
		model: spawnConfig.model ?? parentConfig.model,
		tools: spawnConfig.tools ?? parentConfig.tools,
		systemPrompt: spawnConfig.systemPrompt ?? context.systemPromptBuilder(),
		thinkingLevel: spawnConfig.thinkingLevel ?? parentConfig.thinkingLevel,
		workingDirectory: spawnConfig.workingDirectory ?? context.workingDirectory,
		maxTurns: spawnConfig.maxTurns ?? context.maxTurns,
		onEvent: parentConfig.onEvent,
		enableMemory: parentConfig.enableMemory,
		project: parentConfig.project,
		policyEngine: parentConfig.policyEngine,
		commHub: parentConfig.commHub,
		actorSystem: context.mesh.actorSystem ?? undefined,
		samiti: context.mesh.samiti ?? undefined,
		lokapala: context.mesh.lokapala ?? undefined,
		kaala: context.mesh.kaala ?? undefined,
		enableMesh: parentConfig.enableMesh,
		enableLearning: parentConfig.enableLearning,
		enableAutonomy: parentConfig.enableAutonomy,
		consecutiveFailureThreshold: parentConfig.consecutiveFailureThreshold,
		enableChetana: parentConfig.enableChetana,
		chetanaConfig: parentConfig.chetanaConfig,
		taskKey:
			typeof spawnConfig.taskKey === "string" && spawnConfig.taskKey.trim()
				? spawnConfig.taskKey.trim()
				: undefined,
		parentTaskKey:
			typeof parentConfig.taskKeyResolver === "function"
				? parentConfig.taskKeyResolver()?.trim() || parentConfig.taskKey || null
				: parentConfig.taskKey ?? null,
		sessionLineageKey: parentConfig.sessionLineageKey ?? null,
		taskCheckpointStore: parentConfig.taskCheckpointStore,
		taskSessionIdResolver: parentConfig.taskSessionIdResolver,
		taskType: spawnConfig.purpose ? `agent.subtask.${spawnConfig.purpose}` : "agent.subtask",
	};
}

function sanitizeTaskPurpose(purpose: string): string {
	return purpose.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "subtask";
}

/** Assign a durable child task identity once the child agent has a stable runtime id. */
export function assignChildTaskIdentity(config: AgentConfig, childAgentId: string, purpose: string): void {
	if (!config.taskCheckpointStore) return;
	if (typeof config.taskKey === "string" && config.taskKey.trim()) return;
	if (typeof config.taskKeyResolver === "function") return;
	const parentTaskKey = typeof config.parentTaskKey === "string" && config.parentTaskKey.trim()
		? config.parentTaskKey.trim()
		: null;
	if (!parentTaskKey) return;
	const purposeKey = sanitizeTaskPurpose(purpose);
	config.taskKey = `${parentTaskKey}/agent:${purposeKey}:${childAgentId}`;
}

/**
 * Derive a stable logical task key for delegated work from the parent task and
 * delegated prompt. This makes timeout pickup meaningful across reruns instead
 * of binding the durable key to a one-off child agent id.
 */
export function buildDelegatedTaskKey(parentTaskKey: string, purpose: string, prompt: string): string {
	const purposeKey = sanitizeTaskPurpose(purpose);
	const hash = createHash("sha1").update(prompt.trim()).digest("hex").slice(0, 12);
	return `${parentTaskKey}/agent:${purposeKey}:prompt:${hash}`;
}

/** Build the canonical agent message envelope used by prompt, replay, and tests. */
export function createAgentMessage(
	agentId: string,
	role: AgentMessage["role"],
	content: ContentPart[],
	extra?: { model?: string; cost?: CostBreakdown },
): AgentMessage {
	return {
		id: crypto.randomUUID(),
		role,
		content,
		timestamp: Date.now(),
		agentId,
		model: extra?.model,
		cost: extra?.cost,
	};
}

/** Assemble the loop dependency bag outside the hot Agent class file. */
export function buildAgentLoopDeps(options: {
	agentId: string;
	purpose: string;
	state: AgentState;
	config: AgentConfig;
	provider: ProviderDefinition;
	abortController: AbortController | null;
	maxTurns: number;
	workingDirectory: string;
	toolExecutor: ToolExecutor;
	contextManager: ContextManager;
	steeringManager: SteeringManager;
	learningLoop: LearningLoop | null;
	autonomousAgent: AutonomousAgent | null;
	chetana: ChetanaController | null;
	lokapala: LokapalaGuardians | null;
	kaala: KaalaLifecycle | null;
	samiti: MeshSamiti | null;
	emit: AgentLoopDeps["emit"];
	createMessage: AgentLoopDeps["createMessage"];
	memoryRecall: AgentLoopDeps["memoryRecall"];
}): AgentLoopDeps {
	return {
		agentId: options.agentId,
		purpose: options.purpose,
		state: options.state,
		config: options.config,
		provider: options.provider,
		abortController: options.abortController,
		maxTurns: options.maxTurns,
		workingDirectory: options.workingDirectory,
		toolExecutor: options.toolExecutor,
		contextManager: options.contextManager,
		steeringManager: options.steeringManager,
		learningLoop: options.learningLoop,
		autonomousAgent: options.autonomousAgent,
		chetana: options.chetana,
		lokapala: options.lokapala,
		kaala: options.kaala,
		samiti: options.samiti,
		emit: options.emit,
		createMessage: options.createMessage,
		memoryRecall: options.memoryRecall,
		skillGapRecorder: options.config.onSkillGap,
	};
}

/** Best-effort memory bubbling after a delegated child completes. */
export async function bubbleUpDelegatedFindings(options: {
	memoryBridge: MemoryBridge | null;
	childSessionId: string | null;
	parentSessionId: string | null;
	projectPath: string;
	onError: (error: unknown) => void;
}): Promise<void> {
	if (!options.memoryBridge || !options.childSessionId || !options.parentSessionId) return;
	await options.memoryBridge.bubbleUpFindings(
		options.childSessionId,
		options.parentSessionId,
		options.projectPath,
	).catch(options.onError);
}

/** Record the final assistant turn without letting memory persistence break the prompt path. */
export async function recordAssistantTurnForResult(options: {
	memoryBridge: MemoryBridge | null;
	memorySessionId: string | null;
	result: AgentMessage;
	stateMessages: readonly AgentMessage[];
	logger: Logger;
}): Promise<void> {
	if (!options.memoryBridge || !options.memorySessionId) return;
	const text = extractTextFromMessage(options.result);
	const tools = extractToolCallsFromMessage(options.result, options.stateMessages);
	await options.memoryBridge.recordAssistantTurn(
		options.memorySessionId,
		text,
		tools.length > 0 ? tools : undefined,
	).catch((error) => {
		options.logger.debug("assistant turn recording failed", { error: String(error) });
	});
}

/** Emit one runtime event through hooks, checkpoints, Samiti, and the transport bridge. */
export function emitLocalAgentEvent(options: {
	config: AgentConfig;
	taskCheckpoint: AgentTaskCheckpointBindingState;
	samiti: MeshSamiti | null;
	agentId: string;
	purpose: string;
	event: AgentEventType;
	data: unknown;
	messageCount: number;
	sessionId: string;
}): void {
	options.config.onEvent?.(options.event, options.data);
	recordTaskCheckpointEvent(options.taskCheckpoint, options.event, options.data, options.messageCount);
	if (options.samiti) {
		broadcastEventToSamiti(options.event, options.data, options.samiti, options.agentId, options.purpose);
	}
	if (options.config.eventBridge) {
		const payload = bridgeEventPayload(options.event, (options.data ?? {}) as Record<string, unknown>);
		if (payload) {
			options.config.eventBridge.emitTyped(options.agentId, payload.type, payload.payload, options.sessionId);
		}
	}
}

/** Run all queued follow-up prompts and return the final assistant message. */
export async function processQueuedFollowUps(
	steeringManager: SteeringManager,
	runPrompt: (message: string) => Promise<AgentMessage>,
): Promise<AgentMessage | null> {
	let last: AgentMessage | null = null;
	for (let followUp = steeringManager.getNextFollowUp(); followUp !== null; followUp = steeringManager.getNextFollowUp()) {
		last = await runPrompt(followUp);
	}
	return last;
}

/** Remove a non-running child and return it for caller-managed disposal. */
export function removeIdleChild<T extends { id: string; getStatus(): string }>(
	children: T[],
	childId: string,
): { removed: T | null; nextChildren: T[] } {
	const idx = children.findIndex((child) => child.id === childId);
	if (idx === -1 || children[idx].getStatus() === "running") {
		return { removed: null, nextChildren: [...children] };
	}
	const nextChildren = [...children];
	const [removed] = nextChildren.splice(idx, 1);
	return { removed, nextChildren };
}

/** Partition children into still-running vs disposable idle agents. */
export function partitionIdleChildren<T extends { getStatus(): string }>(children: T[]): { active: T[]; removed: T[] } {
	const active = children.filter((child) => child.getStatus() === "running");
	return { active, removed: children.filter((child) => child.getStatus() !== "running") };
}

/** Dispose runtime-owned resources without letting teardown failures mask shutdown. */
export function disposeAgentRuntime(options: {
	abort: () => void;
	pendingInputs: Map<string, { timer?: ReturnType<typeof setTimeout>; reject: (error: Error) => void }>;
	children: Array<{ dispose(): void }>;
	actorSystem: MeshActorSystem | null;
	actorRef: MeshActorRef | null;
	resetRefs: () => void;
	clearMessages: () => void;
	clearTools: () => void;
	setStatus: (status: "aborted") => void;
}): void {
	options.abort();
	for (const [, pending] of options.pendingInputs) {
		if (pending.timer) clearTimeout(pending.timer);
		pending.reject(new Error("Agent disposed"));
	}
	options.pendingInputs.clear();
	for (const child of options.children) child.dispose();
	disposeActorBindings(options.actorSystem, options.actorRef);
	options.resetRefs();
	options.clearMessages();
	options.clearTools();
	options.setStatus("aborted");
}

/** Build the normalized delegated result for a completed child agent. */
export function buildCompletedSubAgentResult(
	child: { id: string; getMessages(): readonly AgentMessage[] },
	purpose: string,
	response: AgentMessage,
): SubAgentResult {
	return {
		agentId: child.id,
		purpose,
		response,
		messages: [...child.getMessages()],
		cost: sumChildCosts(child.getMessages()),
		status: "completed",
	};
}

/** Build the normalized delegated result for a failed or aborted child agent. */
export function buildFailedSubAgentResult(args: {
	child: { id: string; getMessages(): readonly AgentMessage[] };
	purpose: string;
	error: unknown;
	createMessage: (text: string) => AgentMessage;
}): SubAgentResult {
	const isAbort = args.error instanceof AbortError;
	const errorMessage = args.error instanceof Error ? args.error.message : String(args.error);
	return {
		agentId: args.child.id,
		purpose: args.purpose,
		response:
			findLastAssistantMessage(args.child.getMessages())
			?? args.createMessage(isAbort ? "[Sub-agent aborted]" : `[Sub-agent error: ${args.error}]`),
		messages: [...args.child.getMessages()],
		cost: sumChildCosts(args.child.getMessages()),
		status: isAbort ? "aborted" : "error",
		error: errorMessage,
	};
}

/** Stop mesh bindings without letting teardown failures mask agent disposal. */
export function disposeActorBindings(actorSystem: MeshActorSystem | null, actorRef: MeshActorRef | null): void {
	if (!actorSystem || !actorRef) return;
	try {
		actorSystem.stop(`agent:${actorRef.actorId}`);
	} catch {
		// Best-effort during teardown.
	}
}

export { buildSubAgentPrompt };
