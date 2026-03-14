/** Agent — stateful agent loop. Loop in agent-loop.ts, comms in agent-comm.ts. */

import { AbortError, createLogger } from "@chitragupta/core";
import type { AgentProfile, CostBreakdown, ThinkingLevel } from "@chitragupta/core";
import type { ContentPart, ProviderDefinition } from "@chitragupta/swara";
import type { AutonomousAgent } from "./agent-autonomy.js";
import type { ChetanaController } from "./chetana/controller.js";
import { ContextManager } from "./context-manager.js";
import type { LearningLoop } from "./learning-loop.js";
import type { MemoryBridge } from "./memory-bridge.js";
import { SteeringManager } from "./steering.js";
import { ToolExecutor } from "./tool-executor.js";
import {
	initializeSubsystems,
	requestInput as requestInputFn,
	resolveInput as resolveInputFn,
	sendMeshMessage,
	askMeshAgent,
	broadcastToSamitiChannel,
} from "./agent-comm.js";
import type { PendingInput } from "./agent-comm.js";
import { runAgentLoop } from "./agent-loop.js";
import type { AgentLoopDeps } from "./agent-loop.js";
import { runDelegatedPrompt, runParallelDelegations } from "./agent-delegation.js";
import {
	beginTaskCheckpointPrompt,
	buildTaskCheckpointResumeContext,
	flushTaskCheckpointPrompt,
	finishTaskCheckpointPrompt,
} from "./agent-task-checkpoint-bindings.js";
import {
	buildDefaultSystemPrompt,
	buildDynamicSystemPrompt,
} from "./agent-prompt-context.js";
import {
	buildAgentLoopDeps as buildAgentLoopDepsHelper,
	assignChildTaskIdentity,
	buildDelegatedTaskKey,
	buildChildAgentConfig,
	buildSubAgentPrompt,
	createAgentMessage,
	disposeAgentRuntime,
	emitLocalAgentEvent,
	partitionIdleChildren,
	processQueuedFollowUps,
	recordAssistantTurnForResult,
	removeIdleChild,
} from "./agent-runtime-helpers.js";
import type {
	AgentConfig, AgentEventType, AgentMessage, AgentState,
	AgentTree, KaalaLifecycle, LokapalaGuardians,
	MeshActorRef, MeshActorSystem, MeshSamiti,
	SpawnConfig, SubAgentResult, ToolHandler,
} from "./types.js";
import { MAX_SUB_AGENTS, MAX_AGENT_DEPTH } from "./types.js";
import {
	getRoot, getAncestors, getLineage, getLineagePath,
	getDescendants, getSiblings, findAgent,
	isDescendantOf, isAncestorOf, getTree, renderTree,
} from "./agent-tree.js";
import type { TreeAgent } from "./agent-tree.js";
const log = createLogger("anina:agent"), DEFAULT_MAX_TURNS = 25, DEFAULT_WORKING_DIR = process.cwd();
export class Agent implements TreeAgent {
	private state: AgentState;
	private config: AgentConfig;
	private readonly baseSystemPrompt: string;
	private cachedMemoryPromptContext: string | null = null;
	private toolExecutor: ToolExecutor;
	private contextManager: ContextManager;
	private steeringManager: SteeringManager;
	private provider: ProviderDefinition | null = null;
	private abortController: AbortController | null = null;
	private maxTurns: number;
	private workingDirectory: string;
	private memoryBridge: MemoryBridge | null = null;
	private memorySessionId: string | null = null;
	private taskCheckpoint = { key: null, runtime: null } as import("./agent-task-checkpoint-bindings.js").AgentTaskCheckpointBindingState;
	private learningLoop: LearningLoop | null = null;
	private autonomousAgent: AutonomousAgent | null = null;
	private chetana: ChetanaController | null = null;
	private pendingInputs: Map<string, PendingInput> = new Map();
	private inputCounter = { value: 0 };
	private actorSystem: MeshActorSystem | null = null;
	private actorRef: MeshActorRef | null = null;
	private samiti: MeshSamiti | null = null;
	private lokapala: LokapalaGuardians | null = null;
	private kaala: KaalaLifecycle | null = null;
	readonly id: string;
	readonly purpose: string;
	readonly depth: number;
	private parentAgent: Agent | null;
	private children: Agent[] = [];
	private agentStatus: "idle" | "running" | "completed" | "aborted" | "error" = "idle";
	private bubbleChildEvents: boolean;

	constructor(config: AgentConfig, parent?: Agent, spawnConfig?: SpawnConfig) {
		this.config = config;
		this.maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
		this.workingDirectory = config.workingDirectory ?? DEFAULT_WORKING_DIR;
		this.id = crypto.randomUUID();
		this.purpose = spawnConfig?.purpose ?? "root";
		this.depth = parent ? parent.depth + 1 : 0;
		this.parentAgent = parent ?? null;
		this.bubbleChildEvents = spawnConfig?.bubbleEvents ?? true;
		if (parent?.provider) this.provider = parent.provider;

		this.toolExecutor = new ToolExecutor();
		this.contextManager = new ContextManager();
		this.steeringManager = new SteeringManager();
		if (config.tools) {
			for (const tool of config.tools) this.toolExecutor.register(tool);
		}
		if (config.onToolNotFound) this.toolExecutor.setOnToolNotFound(config.onToolNotFound);
		this.baseSystemPrompt = config.systemPrompt ?? buildDefaultSystemPrompt(config.profile);

		this.state = {
			messages: [], model: config.model, providerId: config.providerId,
			tools: config.tools ?? [],
			systemPrompt: this.baseSystemPrompt,
			thinkingLevel: config.thinkingLevel ?? config.profile.preferredThinking ?? "medium",
			isStreaming: false, sessionId: crypto.randomUUID(),
			agentProfileId: config.profile.id,
		};

		const refs = initializeSubsystems(
			config, this.id, this.depth, this.purpose,
			parent?.id ?? null, (event, data) => this.emit(event as AgentEventType, data),
		);
		this.memoryBridge = refs.memoryBridge;
		this.learningLoop = refs.learningLoop;
		this.autonomousAgent = refs.autonomousAgent;
		this.chetana = refs.chetana;
		this.actorSystem = refs.actorSystem;
		this.actorRef = refs.actorRef;
		this.samiti = refs.samiti;
		this.lokapala = refs.lokapala;
		this.kaala = refs.kaala;
	}

	// ── TreeAgent ────────────────────────────────────────────────
	getParent(): Agent | null { return this.parentAgent; }
	getChildren(): readonly Agent[] { return this.children; }
	getAgentStatus() { return this.agentStatus; }
	getProfileId(): string { return this.config.profile.id; } getModel(): string { return this.state.model; }
	setProvider(provider: ProviderDefinition): void { this.provider = provider; }
	getProvider(): ProviderDefinition | null { return this.provider; }

	async prompt(message: string): Promise<AgentMessage> {
		if (!this.provider) throw new Error("No provider set. Call setProvider() before prompt().");
		this.abortController = new AbortController();
		this.agentStatus = "running";
		const project = this.config.project ?? this.workingDirectory;

		if (this.memoryBridge && !this.memorySessionId) {
			this.memorySessionId = await this.memoryBridge.initSession(
				this.id, this.config.profile.id, this.config.model, project,
			);
		}
		await beginTaskCheckpointPrompt(this.taskCheckpoint, this.config, this.workingDirectory, {
			agentId: this.id, purpose: this.purpose, depth: this.depth, prompt: message,
			fallbackSessionId: this.state.sessionId, memorySessionId: this.memorySessionId,
			messagesCount: this.state.messages.length,
		});
		const taskCheckpointResumeContext = buildTaskCheckpointResumeContext(this.taskCheckpoint);
		this.state.systemPrompt = await buildDynamicSystemPrompt({
			baseSystemPrompt: this.baseSystemPrompt,
			taskCheckpointResumeContext,
			memoryBridge: this.memoryBridge,
			project,
			agentId: this.id,
			cachedMemoryPromptContext: this.cachedMemoryPromptContext,
			logger: log,
			setCachedMemoryPromptContext: (value) => { this.cachedMemoryPromptContext = value; },
		});

		this.state.messages.push(this.createMessage("user", [{ type: "text", text: message }]));
		if (this.memoryBridge && this.memorySessionId) {
			await this.memoryBridge.recordUserTurn(this.memorySessionId, message)
				.catch((e) => { log.debug("user turn recording failed", { error: String(e) }); });
		}

		try {
			const result = await runAgentLoop(this.buildLoopDeps());
			this.agentStatus = "completed";
			if (this.kaala) { try { this.kaala.markCompleted(this.id); } catch { /* best-effort */ } }
			await recordAssistantTurnForResult({
				memoryBridge: this.memoryBridge,
				memorySessionId: this.memorySessionId,
				result,
				stateMessages: this.state.messages,
				logger: log,
			});
			await finishTaskCheckpointPrompt(this.taskCheckpoint, "completed", this.state.messages.length);
			return result;
		} catch (err) {
			this.agentStatus = err instanceof AbortError ? "aborted" : "error";
			await finishTaskCheckpointPrompt(
				this.taskCheckpoint,
				err instanceof AbortError ? "aborted" : "error",
				this.state.messages.length,
				err,
			);
			if (this.kaala) { try { this.kaala.markError(this.id); } catch { /* best-effort */ } }
			throw err;
		} finally {
			this.state.isStreaming = false; this.abortController = null;
			try { await flushTaskCheckpointPrompt(this.taskCheckpoint); } catch { /* best-effort */ }
			try { this.learningLoop?.flushSession(this.config.learningPersistPath); } catch { /* best-effort */ }
		}
	}

	steer(message: string): void { this.steeringManager.steer(message); this.emit("agent:steer", { message }); }
	followUp(message: string): void { this.steeringManager.queueFollowUp(message); }
	abort(): void {
		if (this.abortController) {
			this.abortController.abort();
			this.agentStatus = "aborted";
			this.emit("agent:abort", {});
		}
		const entries = [...this.pendingInputs.values()];
		this.pendingInputs.clear();
		for (const p of entries) {
			if (p.timer) clearTimeout(p.timer);
			p.reject(new Error("Agent aborted"));
		}
		for (const child of this.children) child.abort();
	}

	getState(): Readonly<AgentState> { return { ...this.state }; }
	getMessages(): readonly AgentMessage[] { return this.state.messages; }
	buildDefaultSystemPrompt(profile: AgentProfile): string { return buildDefaultSystemPrompt(profile); }
	getProfile(): AgentProfile { return this.config.profile; }
	getSessionId(): string { return this.state.sessionId; }
	getStatus() { return this.agentStatus; }
	setModel(model: string): void { this.state.model = model; }
	setThinkingLevel(level: ThinkingLevel): void { this.state.thinkingLevel = level; }
	setOnEvent(h: (event: AgentEventType, data: unknown) => void): void { this.config.onEvent = h; }
	getContextManager(): ContextManager { return this.contextManager; }
	clearMessages(): void { this.state.messages = []; }
	getConfig(): Readonly<AgentConfig> { return this.config; }
	pushMessage(msg: AgentMessage): void { this.state.messages.push(msg); }
	replaceState(state: AgentState): void {
		this.state = state;
		this.cachedMemoryPromptContext = null;
	}
	registerTool(handler: ToolHandler): void {
		this.toolExecutor.register(handler); this.state.tools = [...this.state.tools, handler];
	}
	unregisterTool(name: string): void {
		this.toolExecutor.unregister(name); this.state.tools = this.state.tools.filter((t) => t.definition.name !== name);
	}
	async processFollowUps(): Promise<AgentMessage | null> {
		return processQueuedFollowUps(this.steeringManager, async (followUp) => this.prompt(followUp));
	}

	// ── Learning & Autonomy ──────────────────────────────────────
	getLearningLoop(): LearningLoop | null { return this.learningLoop; }
	getAutonomyStatus(): { enabled: true; disabledTools: string[]; isDegraded: boolean } | null {
		return this.autonomousAgent ? {
			enabled: true,
			disabledTools: this.autonomousAgent.getDisabledTools(),
			isDegraded: this.autonomousAgent.isDegradedMode(),
		} : null;
	}
	getChetana(): ChetanaController | null { return this.chetana; }
	requestInput(prompt: string, options?: { choices?: string[]; defaultValue?: string; timeoutMs?: number }): Promise<string> {
		return requestInputFn(this.pendingInputs, this.id, this.inputCounter, (event, data) => this.emit(event, data), prompt, options);
	}
	resolveInput(requestId: string, value: string, denied?: boolean, denyReason?: string): void { resolveInputFn(this.pendingInputs, requestId, value, denied, denyReason); }
	getPendingInputIds(): string[] { return [...this.pendingInputs.keys()]; }
	getActorRef(): MeshActorRef | null { return this.actorRef; } getActorSystem(): MeshActorSystem | null { return this.actorSystem; }
	getSamiti(): MeshSamiti | null { return this.samiti; }
	sendToAgent(targetAgentId: string, message: unknown): void { sendMeshMessage(this.actorRef, this.actorSystem, this.id, targetAgentId, message); }
	async askAgent(targetAgentId: string, message: unknown, timeoutMs?: number): Promise<unknown> { return askMeshAgent(this.actorRef, this.actorSystem, this.id, targetAgentId, message, timeoutMs); }
	broadcastToChannel(channel: string, content: string, severity: "info" | "warning" | "critical" = "info", category = "agent-event"): void { broadcastToSamitiChannel(this.samiti, this.id, this.purpose, this.depth, channel, content, severity, category); }

	spawn(spawnConfig: SpawnConfig): Agent {
		if (this.children.length >= MAX_SUB_AGENTS) {
			throw new Error(`Cannot spawn sub-agent: parent already has ${MAX_SUB_AGENTS} children (max).`);
		}
		if (this.depth + 1 > MAX_AGENT_DEPTH) {
			throw new Error(`Cannot spawn sub-agent: would exceed max depth of ${MAX_AGENT_DEPTH}. Current depth: ${this.depth}.`);
		}

		const childConfig = buildChildAgentConfig(this.config, spawnConfig, {
			workingDirectory: this.workingDirectory,
			maxTurns: this.maxTurns,
			systemPromptBuilder: () => buildSubAgentPrompt(this, spawnConfig),
			mesh: {
				actorSystem: this.actorSystem ?? undefined,
				samiti: this.samiti ?? undefined,
				lokapala: this.lokapala,
				kaala: this.kaala,
			},
		});

		const child = new Agent(childConfig, this, spawnConfig);
		assignChildTaskIdentity(child.config, child.id, spawnConfig.purpose);
		if (this.provider) child.setProvider(this.provider);
		this.children.push(child);
		this.emit("subagent:spawn", {
			parentId: this.id, childId: child.id, purpose: spawnConfig.purpose,
			depth: child.depth, childIndex: this.children.length - 1,
		});
		return child;
	}

	async delegate(spawnConfig: SpawnConfig, prompt: string): Promise<SubAgentResult> {
		const child = this.spawn(spawnConfig);
		if (
			child.config.taskCheckpointStore
			&& typeof child.config.parentTaskKey === "string"
			&& child.config.parentTaskKey.trim()
			&& !(typeof spawnConfig.taskKey === "string" && spawnConfig.taskKey.trim())
		) {
			// Delegated work has both the parent task and the delegated prompt, so we
			// can upgrade the child from a runtime fallback identity to a stable,
			// prompt-derived durable task key before any checkpoint writes occur.
			child.config.taskKey = buildDelegatedTaskKey(
				child.config.parentTaskKey.trim(),
				spawnConfig.purpose,
				prompt,
			);
		}
		return runDelegatedPrompt({
			child: {
				id: child.id,
				memorySessionId: child.memorySessionId,
				prompt: (message) => child.prompt(message),
				getMessages: () => child.getMessages(),
			},
			purpose: spawnConfig.purpose,
			prompt,
			memoryBridge: this.memoryBridge,
			parentSessionId: this.memorySessionId,
			projectPath: this.config.project ?? this.workingDirectory,
			emit: (event, data) => this.emit(event, { parentId: this.id, ...data }),
			onBubbleError: (error) => { log.debug("memory bubble-up failed", { error: String(error) }); },
			createMessage: (text) => this.createMessage("assistant", [{ type: "text", text }]),
		});
	}

	async delegateParallel(tasks: Array<{ config: SpawnConfig; prompt: string }>): Promise<SubAgentResult[]> {
		if (tasks.length + this.children.length > MAX_SUB_AGENTS) {
			throw new Error(
				`Cannot spawn ${tasks.length} sub-agents: would exceed limit of ${MAX_SUB_AGENTS}. ` +
				`Currently ${this.children.length} children.`,
			);
		}
		return runParallelDelegations((config, prompt) => this.delegate(config, prompt), tasks);
	}

	removeChild(childId: string): boolean {
		const { removed, nextChildren } = removeIdleChild(this.children, childId);
		if (!removed) return false;
		this.children = nextChildren;
		removed.dispose();
		return true;
	}
	pruneChildren(): number {
		const before = this.children.length;
		const { active, removed } = partitionIdleChildren(this.children);
		this.children = active;
		for (const c of removed) c.dispose();
		return before - this.children.length;
	}
	dispose(): void {
		disposeAgentRuntime({
			abort: () => this.abort(),
			pendingInputs: this.pendingInputs,
			children: this.children,
			actorSystem: this.actorSystem,
			actorRef: this.actorRef,
			resetRefs: () => {
				this.children = [];
				this.actorRef = null; this.actorSystem = null; this.samiti = null;
				this.kaala = null; this.lokapala = null;
				this.memoryBridge = null; this.learningLoop = null;
				this.autonomousAgent = null; this.chetana = null; this.provider = null;
				this.cachedMemoryPromptContext = null;
			},
			clearMessages: () => { this.state.messages = []; },
			clearTools: () => { this.state.tools = []; },
			setStatus: (status) => { this.agentStatus = status; },
		});
	}

	// ── Tree Traversal ───────────────────────────────────────────
	getRoot(): Agent { return getRoot(this) as Agent; } getAncestors(): Agent[] { return getAncestors(this) as Agent[]; }
	getLineage(): Agent[] { return getLineage(this) as Agent[]; }
	getLineagePath(): string { return getLineagePath(this); }
	getDescendants(): Agent[] { return getDescendants(this) as Agent[]; } getSiblings(): Agent[] { return getSiblings(this) as Agent[]; }
	findAgent(agentId: string): Agent | null { return findAgent(this, agentId) as Agent | null; }
	isDescendantOf(ancestorId: string): boolean { return isDescendantOf(this, ancestorId); } isAncestorOf(descendantId: string): boolean { return isAncestorOf(this, descendantId); }
	getTree(): AgentTree { return getTree(this); }
	renderTree(): string { return renderTree(this); }

	// ── Helpers ──────────────────────────────────────────────────
	private createMessage(
		role: AgentMessage["role"], content: ContentPart[],
		extra?: { model?: string; cost?: CostBreakdown },
	): AgentMessage {
		return createAgentMessage(this.id, role, content, extra);
	}

	private emit(event: AgentEventType, data: unknown): void {
		emitLocalAgentEvent({
			config: this.config,
			taskCheckpoint: this.taskCheckpoint,
			samiti: this.samiti,
			agentId: this.id,
			purpose: this.purpose,
			event,
			data,
			messageCount: this.state.messages.length,
			sessionId: this.state.sessionId,
		});
		if (this.parentAgent && this.bubbleChildEvents) {
			this.parentAgent.emit("subagent:event", {
				sourceAgentId: this.id, sourcePurpose: this.purpose,
				sourceDepth: this.depth, originalEvent: event, data,
			});
		}
	}

	private buildLoopDeps(): AgentLoopDeps {
		return buildAgentLoopDepsHelper({
			agentId: this.id,
			purpose: this.purpose,
			state: this.state,
			config: this.config,
			provider: this.provider!,
			abortController: this.abortController,
			maxTurns: this.maxTurns,
			workingDirectory: this.workingDirectory,
			toolExecutor: this.toolExecutor,
			contextManager: this.contextManager,
			steeringManager: this.steeringManager,
			learningLoop: this.learningLoop,
			autonomousAgent: this.autonomousAgent,
			chetana: this.chetana,
			lokapala: this.lokapala,
			kaala: this.kaala,
			samiti: this.samiti,
			emit: (ev, d) => this.emit(ev, d),
			createMessage: (role, content, extra) => this.createMessage(role, content, extra),
			memoryRecall: this.memoryBridge ? (q: string) => Promise.resolve(this.memoryBridge!.recallForQuery(q) || undefined) : undefined,
		});
	}
}
