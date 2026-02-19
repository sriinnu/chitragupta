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
	broadcastEventToSamiti,
} from "./agent-comm.js";
import type { PendingInput } from "./agent-comm.js";
import { runAgentLoop } from "./agent-loop.js";
import type { AgentLoopDeps } from "./agent-loop.js";
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
import {
	buildSubAgentPrompt, sumChildCosts,
	extractTextFromMessage, extractToolCallsFromMessage,
	findLastAssistantMessage,
} from "./agent-subagent.js";

const log = createLogger("anina:agent");
const DEFAULT_MAX_TURNS = 25;
const DEFAULT_WORKING_DIR = process.cwd();

export class Agent implements TreeAgent {
	private state: AgentState;
	private config: AgentConfig;
	private toolExecutor: ToolExecutor;
	private contextManager: ContextManager;
	private steeringManager: SteeringManager;
	private provider: ProviderDefinition | null = null;
	private abortController: AbortController | null = null;
	private maxTurns: number;
	private workingDirectory: string;
	private memoryBridge: MemoryBridge | null = null;
	private memorySessionId: string | null = null;
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

		this.state = {
			messages: [], model: config.model, providerId: config.providerId,
			tools: config.tools ?? [],
			systemPrompt: config.systemPrompt ?? this.buildDefaultSystemPrompt(config.profile),
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
	getProfileId(): string { return this.config.profile.id; }
	getModel(): string { return this.state.model; }

	// ── Core API ─────────────────────────────────────────────────
	setProvider(provider: ProviderDefinition): void { this.provider = provider; }
	getProvider(): ProviderDefinition | null { return this.provider; }

	async prompt(message: string): Promise<AgentMessage> {
		if (!this.provider) throw new Error("No provider set. Call setProvider() before prompt().");
		this.abortController = new AbortController();
		this.agentStatus = "running";

		if (this.memoryBridge && !this.memorySessionId) {
			const project = this.config.project ?? this.workingDirectory;
			this.memorySessionId = await this.memoryBridge.initSession(
				this.id, this.config.profile.id, this.config.model, project,
			);
			const memCtx = await this.memoryBridge.loadMemoryContext(project, this.id);
			if (memCtx) this.state.systemPrompt += "\n\n" + memCtx;
		}

		this.state.messages.push(this.createMessage("user", [{ type: "text", text: message }]));
		if (this.memoryBridge && this.memorySessionId) {
			await this.memoryBridge.recordUserTurn(this.memorySessionId, message)
				.catch((e) => { log.debug("user turn recording failed", { error: String(e) }); });
		}

		try {
			const result = await runAgentLoop(this.buildLoopDeps());
			this.agentStatus = "completed";
			if (this.kaala) { try { this.kaala.markCompleted(this.id); } catch { /* best-effort */ } }
			if (this.memoryBridge && this.memorySessionId) {
				const text = extractTextFromMessage(result);
				const tools = extractToolCallsFromMessage(result, this.state.messages);
				await this.memoryBridge.recordAssistantTurn(
					this.memorySessionId, text, tools.length > 0 ? tools : undefined,
				).catch((e) => { log.debug("assistant turn recording failed", { error: String(e) }); });
			}
			return result;
		} catch (err) {
			this.agentStatus = err instanceof AbortError ? "aborted" : "error";
			if (this.kaala) { try { this.kaala.markError(this.id); } catch { /* best-effort */ } }
			throw err;
		} finally {
			this.state.isStreaming = false;
			this.abortController = null;
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
	replaceState(state: AgentState): void { this.state = state; }
	registerTool(handler: ToolHandler): void {
		this.toolExecutor.register(handler); this.state.tools = [...this.state.tools, handler];
	}
	unregisterTool(name: string): void {
		this.toolExecutor.unregister(name); this.state.tools = this.state.tools.filter((t) => t.definition.name !== name);
	}
	async processFollowUps(): Promise<AgentMessage | null> {
		let last: AgentMessage | null = null;
		let fu = this.steeringManager.getNextFollowUp();
		while (fu !== null) { last = await this.prompt(fu); fu = this.steeringManager.getNextFollowUp(); }
		return last;
	}

	// ── Learning & Autonomy ──────────────────────────────────────
	getLearningLoop(): LearningLoop | null { return this.learningLoop; }

	getAutonomyStatus(): { enabled: true; disabledTools: string[]; isDegraded: boolean } | null {
		if (!this.autonomousAgent) return null;
		return {
			enabled: true,
			disabledTools: this.autonomousAgent.getDisabledTools(),
			isDegraded: this.autonomousAgent.isDegradedMode(),
		};
	}
	getChetana(): ChetanaController | null { return this.chetana; }

	// ── Sandesha Input Routing ───────────────────────────────────
	requestInput(
		prompt: string,
		options?: { choices?: string[]; defaultValue?: string; timeoutMs?: number },
	): Promise<string> {
		return requestInputFn(
			this.pendingInputs, this.id, this.inputCounter,
			(event, data) => this.emit(event, data), prompt, options,
		);
	}

	resolveInput(requestId: string, value: string, denied?: boolean, denyReason?: string): void {
		resolveInputFn(this.pendingInputs, requestId, value, denied, denyReason);
	}
	getPendingInputIds(): string[] { return [...this.pendingInputs.keys()]; }

	// ── Mesh Communication ───────────────────────────────────────
	getActorRef(): MeshActorRef | null { return this.actorRef; }
	getActorSystem(): MeshActorSystem | null { return this.actorSystem; }
	getSamiti(): MeshSamiti | null { return this.samiti; }
	sendToAgent(targetAgentId: string, message: unknown): void {
		sendMeshMessage(this.actorRef, this.actorSystem, this.id, targetAgentId, message);
	}
	async askAgent(targetAgentId: string, message: unknown, timeoutMs?: number): Promise<unknown> {
		return askMeshAgent(this.actorRef, this.actorSystem, this.id, targetAgentId, message, timeoutMs);
	}
	broadcastToChannel(
		channel: string, content: string,
		severity: "info" | "warning" | "critical" = "info",
		category: string = "agent-event",
	): void {
		broadcastToSamitiChannel(
			this.samiti, this.id, this.purpose, this.depth,
			channel, content, severity, category,
		);
	}

	// ── Sub-Agent Spawning ───────────────────────────────────────
	spawn(spawnConfig: SpawnConfig): Agent {
		if (this.children.length >= MAX_SUB_AGENTS) {
			throw new Error(`Cannot spawn sub-agent: parent already has ${MAX_SUB_AGENTS} children (max).`);
		}
		if (this.depth + 1 > MAX_AGENT_DEPTH) {
			throw new Error(`Cannot spawn sub-agent: would exceed max depth of ${MAX_AGENT_DEPTH}. Current depth: ${this.depth}.`);
		}

		const childConfig: AgentConfig = {
			profile: spawnConfig.profile ?? this.config.profile,
			providerId: spawnConfig.providerId ?? this.config.providerId,
			model: spawnConfig.model ?? this.config.model,
			tools: spawnConfig.tools ?? this.config.tools,
			systemPrompt: spawnConfig.systemPrompt ?? buildSubAgentPrompt(this, spawnConfig),
			thinkingLevel: spawnConfig.thinkingLevel ?? this.config.thinkingLevel,
			workingDirectory: spawnConfig.workingDirectory ?? this.workingDirectory,
			maxTurns: spawnConfig.maxTurns ?? this.maxTurns,
			onEvent: this.config.onEvent, enableMemory: this.config.enableMemory,
			project: this.config.project, policyEngine: this.config.policyEngine,
			commHub: this.config.commHub,
			actorSystem: this.actorSystem ?? undefined, samiti: this.samiti ?? undefined,
			lokapala: this.lokapala ?? undefined, kaala: this.kaala ?? undefined,
			enableMesh: this.config.enableMesh, enableLearning: this.config.enableLearning,
			enableAutonomy: this.config.enableAutonomy,
			consecutiveFailureThreshold: this.config.consecutiveFailureThreshold,
			enableChetana: this.config.enableChetana, chetanaConfig: this.config.chetanaConfig,
		};

		const child = new Agent(childConfig, this, spawnConfig);
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
		try {
			const response = await child.prompt(prompt);
			if (this.memoryBridge && this.memorySessionId && child.memorySessionId) {
				const project = this.config.project ?? this.workingDirectory;
				await this.memoryBridge.bubbleUpFindings(
					child.memorySessionId, this.memorySessionId, project,
				).catch((e) => { log.debug("memory bubble-up failed", { error: String(e) }); });
			}
			this.emit("subagent:done", {
				parentId: this.id, childId: child.id,
				purpose: spawnConfig.purpose, status: "completed",
			});
			return {
				agentId: child.id, purpose: spawnConfig.purpose, response,
				messages: [...child.getMessages()],
				cost: sumChildCosts(child.getMessages()), status: "completed",
			};
		} catch (err) {
			const isAbort = err instanceof AbortError;
			const errMsg = err instanceof Error ? err.message : String(err);
			this.emit("subagent:error", { parentId: this.id, childId: child.id, purpose: spawnConfig.purpose, error: errMsg });
			return {
				agentId: child.id, purpose: spawnConfig.purpose,
				response: findLastAssistantMessage(child.getMessages()) ?? this.createMessage("assistant",
					[{ type: "text", text: isAbort ? "[Sub-agent aborted]" : `[Sub-agent error: ${err}]` }]),
				messages: [...child.getMessages()], cost: sumChildCosts(child.getMessages()),
				status: isAbort ? "aborted" : "error", error: errMsg,
			};
		}
	}

	async delegateParallel(tasks: Array<{ config: SpawnConfig; prompt: string }>): Promise<SubAgentResult[]> {
		if (tasks.length + this.children.length > MAX_SUB_AGENTS) {
			throw new Error(
				`Cannot spawn ${tasks.length} sub-agents: would exceed limit of ${MAX_SUB_AGENTS}. ` +
				`Currently ${this.children.length} children.`,
			);
		}
		return Promise.all(tasks.map((t) => this.delegate(t.config, t.prompt)));
	}

	removeChild(childId: string): boolean {
		const idx = this.children.findIndex((c) => c.id === childId);
		if (idx === -1 || this.children[idx].agentStatus === "running") return false;
		this.children.splice(idx, 1)[0].dispose(); return true;
	}
	pruneChildren(): number {
		const before = this.children.length;
		const removing = this.children.filter((c) => c.agentStatus !== "running");
		this.children = this.children.filter((c) => c.agentStatus === "running");
		for (const c of removing) c.dispose();
		return before - this.children.length;
	}
	dispose(): void {
		this.abort();
		for (const [, p] of this.pendingInputs) {
			if (p.timer) clearTimeout(p.timer);
			p.reject(new Error("Agent disposed"));
		}
		this.pendingInputs.clear();
		for (const child of this.children) child.dispose();
		this.children = [];
		if (this.actorSystem && this.actorRef) {
			try { this.actorSystem.stop(`agent:${this.id}`); } catch { /* non-fatal */ }
		}
		this.actorRef = null; this.actorSystem = null; this.samiti = null;
		this.kaala = null; this.lokapala = null;
		this.memoryBridge = null; this.learningLoop = null;
		this.autonomousAgent = null; this.chetana = null; this.provider = null;
		this.state.messages = []; this.state.tools = [];
		this.agentStatus = "aborted";
	}

	// ── Tree Traversal ───────────────────────────────────────────
	getRoot(): Agent { return getRoot(this) as Agent; }
	getAncestors(): Agent[] { return getAncestors(this) as Agent[]; }
	getLineage(): Agent[] { return getLineage(this) as Agent[]; }
	getLineagePath(): string { return getLineagePath(this); }
	getDescendants(): Agent[] { return getDescendants(this) as Agent[]; }
	getSiblings(): Agent[] { return getSiblings(this) as Agent[]; }
	findAgent(agentId: string): Agent | null { return findAgent(this, agentId) as Agent | null; }
	isDescendantOf(ancestorId: string): boolean { return isDescendantOf(this, ancestorId); }
	isAncestorOf(descendantId: string): boolean { return isAncestorOf(this, descendantId); }
	getTree(): AgentTree { return getTree(this); }
	renderTree(): string { return renderTree(this); }

	// ── Helpers ──────────────────────────────────────────────────
	buildDefaultSystemPrompt(profile: AgentProfile): string {
		const parts: string[] = [`You are ${profile.name}.`];
		if (profile.personality) parts.push(profile.personality);
		if (profile.expertise.length > 0) parts.push(`Your areas of expertise: ${profile.expertise.join(", ")}.`);
		if (profile.voice === "custom" && profile.customVoice) parts.push(profile.customVoice);
		return parts.join("\n\n");
	}

	private createMessage(
		role: AgentMessage["role"], content: ContentPart[],
		extra?: { model?: string; cost?: CostBreakdown },
	): AgentMessage {
		return {
			id: crypto.randomUUID(), role, content, timestamp: Date.now(),
			agentId: this.id, model: extra?.model, cost: extra?.cost,
		};
	}

	private emit(event: AgentEventType, data: unknown): void {
		this.config.onEvent?.(event, data);
		if (this.samiti) broadcastEventToSamiti(event, data, this.samiti, this.id, this.purpose);
		if (this.parentAgent && this.bubbleChildEvents) {
			this.parentAgent.emit("subagent:event", {
				sourceAgentId: this.id, sourcePurpose: this.purpose,
				sourceDepth: this.depth, originalEvent: event, data,
			});
		}
	}

	private buildLoopDeps(): AgentLoopDeps {
		return {
			agentId: this.id, purpose: this.purpose,
			state: this.state, config: this.config,
			provider: this.provider!,
			abortController: this.abortController,
			maxTurns: this.maxTurns, workingDirectory: this.workingDirectory,
			toolExecutor: this.toolExecutor,
			contextManager: this.contextManager,
			steeringManager: this.steeringManager,
			learningLoop: this.learningLoop,
			autonomousAgent: this.autonomousAgent,
			chetana: this.chetana,
			lokapala: this.lokapala,
			kaala: this.kaala, samiti: this.samiti,
			emit: (ev, d) => this.emit(ev, d),
			createMessage: (role, content, extra) => this.createMessage(role, content, extra),
		};
	}
}
