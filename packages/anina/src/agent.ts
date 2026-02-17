/**
 * Agent — the stateful agent loop for Chitragupta.
 *
 * This is the core runtime that ties together LLM streaming, tool execution,
 * context management, steering, and sub-agent spawning into a single
 * coherent agent tree.
 *
 * The loop works as follows:
 * 1. User sends a message via prompt()
 * 2. Agent builds context from state and calls the LLM
 * 3. LLM streams a response; if it includes tool_calls, agent executes them
 * 4. Tool results are appended and the LLM is called again (agentic loop)
 * 5. Loop continues until LLM stops calling tools or maxTurns is reached
 * 6. Final assistant message is stored in state
 */

import { AbortError, createLogger } from "@chitragupta/core";
import type { AgentProfile, CostBreakdown, InputRequest, StopReason, ThinkingLevel } from "@chitragupta/core";
import type {
  ContentPart,
  Context,
  ProviderDefinition,
  StreamOptions,
  ToolCallContent,
  ToolResultContent,
} from "@chitragupta/swara";

import { AutonomousAgent } from "./agent-autonomy.js";
import { ChetanaController } from "./chetana/controller.js";
import type { ChetanaConfig } from "./chetana/types.js";
import { ContextManager } from "./context-manager.js";
import { LearningLoop } from "./learning-loop.js";
import { MemoryBridge } from "./memory-bridge.js";
import { SteeringManager } from "./steering.js";
import { ToolExecutor } from "./tool-executor.js";
import type {
  AgentConfig,
  AgentEventType,
  AgentMessage,
  AgentState,
  AgentTree,
  KaalaLifecycle,
  LokapalaGuardians,
  MeshActorRef,
  MeshActorSystem,
  MeshSamiti,
  SpawnConfig,
  SubAgentResult,
  ToolHandler,
  ToolContext,
} from "./types.js";
import { MAX_SUB_AGENTS, MAX_AGENT_DEPTH } from "./types.js";
import { createAgentBehavior } from "./agent-actor-bridge.js";

import {
  getRoot,
  getAncestors,
  getLineage,
  getLineagePath,
  getDescendants,
  getSiblings,
  findAgent,
  isDescendantOf,
  isAncestorOf,
  getTree,
  renderTree,
} from "./agent-tree.js";
import type { TreeAgent } from "./agent-tree.js";
import {
  buildSubAgentPrompt,
  sumChildCosts,
  extractTextFromMessage,
  extractToolCallsFromMessage,
  findLastAssistantMessage,
  mergeTextParts,
} from "./agent-subagent.js";

const log = createLogger("anina:agent");

/** Default maximum number of tool-use loop iterations before stopping. */
const DEFAULT_MAX_TURNS = 25;

/** Default working directory if none is provided. */
const DEFAULT_WORKING_DIR = process.cwd();

export class Agent implements TreeAgent {
  // ─── Core State ──────────────────────────────────────────────────

  private state: AgentState;
  private config: AgentConfig;
  private toolExecutor: ToolExecutor;
  private contextManager: ContextManager;
  private steeringManager: SteeringManager;
  private provider: ProviderDefinition | null = null;
  private abortController: AbortController | null = null;
  private maxTurns: number;
  private workingDirectory: string;

  // ─── Memory ─────────────────────────────────────────────────────

  private memoryBridge: MemoryBridge | null = null;
  private memorySessionId: string | null = null;

  // ─── Learning & Autonomy ──────────────────────────────────────────

  private learningLoop: LearningLoop | null = null;
  private autonomousAgent: AutonomousAgent | null = null;
  private chetana: ChetanaController | null = null;
  private previousToolName: string = "user";

  // ─── Sandesha Input Routing ─────────────────────────────────────

  private pendingInputs: Map<string, { resolve: (value: string) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> }> = new Map();
  private inputCounter: number = 0;

  // ─── Mesh Integration (Sutra) ──────────────────────────────────

  private actorSystem: MeshActorSystem | null = null;
  private actorRef: MeshActorRef | null = null;
  private samiti: MeshSamiti | null = null;
  private lokapala: LokapalaGuardians | null = null;
  private kaala: KaalaLifecycle | null = null;

  // ─── Tree Structure ──────────────────────────────────────────────

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

    if (parent?.provider) {
      this.provider = parent.provider;
    }

    this.toolExecutor = new ToolExecutor();
    this.contextManager = new ContextManager();
    this.steeringManager = new SteeringManager();

    if (config.tools) {
      for (const tool of config.tools) {
        this.toolExecutor.register(tool);
      }
    }

    this.state = {
      messages: [],
      model: config.model,
      providerId: config.providerId,
      tools: config.tools ?? [],
      systemPrompt: config.systemPrompt ?? this.buildDefaultSystemPrompt(config.profile),
      thinkingLevel: config.thinkingLevel ?? config.profile.preferredThinking ?? "medium",
      isStreaming: false,
      sessionId: crypto.randomUUID(),
      agentProfileId: config.profile.id,
    };

    if (config.enableMemory && config.project) {
      this.memoryBridge = new MemoryBridge({
        enabled: true,
        project: config.project,
        embeddingProvider: config.embeddingProvider,
      });
    }

    if (config.enableLearning) {
      this.learningLoop = new LearningLoop();
    }

    if (config.enableAutonomy) {
      const threshold = config.consecutiveFailureThreshold ?? 3;
      this.autonomousAgent = new AutonomousAgent(
        { toolDisableThreshold: threshold },
        this.learningLoop ?? undefined,
      );
    }

    if (config.enableChetana !== false) {
      this.chetana = new ChetanaController(
        config.chetanaConfig,
        (event, data) => this.emit(event as AgentEventType, data),
      );
    }

    // ─── Mesh: auto-register as actor ─────────────────────────────
    if (config.actorSystem && config.enableMesh !== false) {
      this.actorSystem = config.actorSystem;
      this.samiti = config.samiti ?? null;
      try {
        const behavior = createAgentBehavior(this);
        this.actorRef = config.actorSystem.spawn(`agent:${this.id}`, {
          behavior,
          expertise: [config.profile.id, this.purpose],
          capabilities: config.tools?.map((t) => t.definition.name),
        });
        log.debug("agent registered in mesh", { agentId: this.id, actorId: `agent:${this.id}` });
      } catch (err) {
        log.warn("failed to register agent in mesh", { agentId: this.id, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      this.samiti = config.samiti ?? null;
    }

    // ─── Lokapala: guardians for tool call scanning ────────────────
    this.lokapala = config.lokapala ?? null;

    // ─── KaalaBrahma: agent lifecycle tracking ───────────────────
    this.kaala = config.kaala ?? null;
    if (this.kaala) {
      try {
        this.kaala.registerAgent({
          agentId: this.id,
          lastBeat: Date.now(),
          startedAt: Date.now(),
          turnCount: 0,
          tokenUsage: 0,
          status: "alive",
          parentId: parent?.id ?? null,
          depth: this.depth,
          purpose: this.purpose,
          tokenBudget: 200_000,
        });
      } catch {
        // KaalaBrahma registration is best-effort
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TreeAgent interface implementation
  // ═══════════════════════════════════════════════════════════════

  getParent(): Agent | null { return this.parentAgent; }
  getChildren(): readonly Agent[] { return this.children; }
  getAgentStatus() { return this.agentStatus; }
  getProfileId(): string { return this.config.profile.id; }
  getModel(): string { return this.state.model; }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API -- Core Agent Operations
  // ═══════════════════════════════════════════════════════════════

  setProvider(provider: ProviderDefinition): void {
    this.provider = provider;
  }

  getProvider(): ProviderDefinition | null {
    return this.provider;
  }

  async prompt(message: string): Promise<AgentMessage> {
    if (!this.provider) {
      throw new Error("No provider set. Call setProvider() before prompt().");
    }

    this.abortController = new AbortController();
    this.agentStatus = "running";

    if (this.memoryBridge && !this.memorySessionId) {
      const project = this.config.project ?? this.workingDirectory;
      this.memorySessionId = await this.memoryBridge.initSession(
        this.id, this.config.profile.id, this.config.model, project,
      );

      const memoryContext = await this.memoryBridge.loadMemoryContext(project, this.id);
      if (memoryContext) {
        this.state.systemPrompt = this.state.systemPrompt + "\n\n" + memoryContext;
      }
    }

    const userMessage = this.createMessage("user", [{ type: "text", text: message }]);
    this.state.messages.push(userMessage);

    if (this.memoryBridge && this.memorySessionId) {
      // Silently skip: memory recording is best-effort; failure must not block the agent loop
      await this.memoryBridge.recordUserTurn(this.memorySessionId, message).catch((e) => { log.debug("user turn recording failed", { error: String(e) }); });
    }

    try {
      const result = await this.runAgentLoop();
      this.agentStatus = "completed";
      if (this.kaala) { try { this.kaala.markCompleted(this.id); } catch { /* best-effort */ } }

      if (this.memoryBridge && this.memorySessionId) {
        const textContent = extractTextFromMessage(result);
        const toolCallData = extractToolCallsFromMessage(result, this.state.messages);
        // Silently skip: memory recording is best-effort; failure must not block the agent loop
        await this.memoryBridge.recordAssistantTurn(
          this.memorySessionId, textContent,
          toolCallData.length > 0 ? toolCallData : undefined,
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

  steer(message: string): void {
    this.steeringManager.steer(message);
    this.emit("agent:steer", { message });
  }

  followUp(message: string): void {
    this.steeringManager.queueFollowUp(message);
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.agentStatus = "aborted";
      this.emit("agent:abort", {});
    }

    // Clean up pending input requests to prevent leaked timers and hanging promises.
    // Snapshot to array first — reject() callbacks could modify the map during iteration.
    const pendingEntries = [...this.pendingInputs.values()];
    this.pendingInputs.clear();
    for (const pending of pendingEntries) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error("Agent aborted"));
    }

    for (const child of this.children) {
      child.abort();
    }
  }

  getState(): Readonly<AgentState> { return { ...this.state }; }
  getMessages(): readonly AgentMessage[] { return this.state.messages; }
  getProfile(): AgentProfile { return this.config.profile; }
  getSessionId(): string { return this.state.sessionId; }
  getStatus() { return this.agentStatus; }

  /** Set the current model identifier. */
  setModel(model: string): void {
    this.state.model = model;
  }

  /** Set the thinking/reasoning level. */
  setThinkingLevel(level: ThinkingLevel): void {
    this.state.thinkingLevel = level;
  }

  /** Set the event handler callback. */
  setOnEvent(handler: (event: AgentEventType, data: unknown) => void): void {
    this.config.onEvent = handler;
  }

  /** Get the context manager instance. */
  getContextManager(): ContextManager {
    return this.contextManager;
  }

  /** Clear all messages from the agent's history. */
  clearMessages(): void {
    this.state.messages = [];
  }

  /** Get a read-only copy of the agent configuration. */
  getConfig(): Readonly<AgentConfig> {
    return this.config;
  }

  /** Push a message into the agent's history (for session replay). */
  pushMessage(message: AgentMessage): void {
    this.state.messages.push(message);
  }

  /** Replace agent state (used by context compaction). */
  replaceState(state: AgentState): void {
    this.state = state;
  }

  registerTool(handler: ToolHandler): void {
    this.toolExecutor.register(handler);
    this.state.tools = [...this.state.tools, handler];
  }

  unregisterTool(name: string): void {
    this.toolExecutor.unregister(name);
    this.state.tools = this.state.tools.filter((t) => t.definition.name !== name);
  }

  async processFollowUps(): Promise<AgentMessage | null> {
    let lastResponse: AgentMessage | null = null;
    let followUp = this.steeringManager.getNextFollowUp();
    while (followUp !== null) {
      lastResponse = await this.prompt(followUp);
      followUp = this.steeringManager.getNextFollowUp();
    }
    return lastResponse;
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API -- Learning & Autonomy
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get the LearningLoop instance, if learning is enabled.
   * Returns null when `config.enableLearning` is false.
   */
  getLearningLoop(): LearningLoop | null {
    return this.learningLoop;
  }

  /**
   * Get the autonomy status of the agent.
   * Returns null when `config.enableAutonomy` is false, otherwise returns
   * the health report from the AutonomousAgent wrapper.
   */
  getAutonomyStatus(): { enabled: true; disabledTools: string[]; isDegraded: boolean } | null {
    if (!this.autonomousAgent) return null;
    return {
      enabled: true,
      disabledTools: this.autonomousAgent.getDisabledTools(),
      isDegraded: this.autonomousAgent.isDegradedMode(),
    };
  }

  /** Get the Chetana consciousness controller, if enabled. */
  getChetana(): ChetanaController | null {
    return this.chetana;
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API -- Sandesha Input Routing
  // ═══════════════════════════════════════════════════════════════

  /**
   * Request user input from within the agent loop.
   * Emits an `agent:input_request` event that bubbles up the tree,
   * then awaits resolution via `resolveInput()`.
   *
   * @param prompt - Human-readable prompt to show the user.
   * @param options - Optional choices, default value, and timeout.
   * @returns The user's response string.
   */
  requestInput(
    prompt: string,
    options?: { choices?: string[]; defaultValue?: string; timeoutMs?: number },
  ): Promise<string> {
    const requestId = `input_${this.id}_${this.inputCounter++}`;
    const request: InputRequest = {
      requestId,
      agentId: this.id,
      prompt,
      choices: options?.choices,
      defaultValue: options?.defaultValue,
      timeoutMs: options?.timeoutMs,
    };

    this.emit("agent:input_request", request);

    return new Promise<string>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      if (options?.timeoutMs !== undefined && options.timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pendingInputs.delete(requestId);
          if (options.defaultValue !== undefined) {
            resolve(options.defaultValue);
          } else {
            reject(new Error(`Input request "${requestId}" timed out after ${options.timeoutMs}ms with no default value`));
          }
        }, options.timeoutMs);
      }

      this.pendingInputs.set(requestId, { resolve, reject, timer });
    });
  }

  /**
   * Resolve a pending input request.
   * Called by the TUI or parent agent when the user provides a response.
   *
   * @param requestId - The InputRequest.requestId to resolve.
   * @param value - The user's response value.
   * @param denied - If true, the request was denied by an ancestor.
   * @param denyReason - Reason for denial.
   */
  resolveInput(requestId: string, value: string, denied?: boolean, denyReason?: string): void {
    const pending = this.pendingInputs.get(requestId);
    if (!pending) return;

    // Clear timeout if one was set
    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    this.pendingInputs.delete(requestId);

    if (denied) {
      pending.reject(new Error(denyReason ?? "Input request denied by ancestor"));
    } else {
      pending.resolve(value);
    }
  }

  /**
   * Get all pending input request IDs (useful for inspection/debugging).
   */
  getPendingInputIds(): string[] {
    return [...this.pendingInputs.keys()];
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API -- Mesh Communication (Sutra Integration)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get the ActorRef for this agent in the mesh.
   * Returns null if mesh integration is not enabled.
   */
  getActorRef(): MeshActorRef | null {
    return this.actorRef;
  }

  /**
   * Get the ActorSystem this agent is registered in.
   * Returns null if mesh integration is not enabled.
   */
  getActorSystem(): MeshActorSystem | null {
    return this.actorSystem;
  }

  /**
   * Get the Samiti instance for ambient channel communication.
   * Returns null if Samiti is not configured.
   */
  getSamiti(): MeshSamiti | null {
    return this.samiti;
  }

  /**
   * Send a fire-and-forget message to another agent in the mesh.
   * @param targetAgentId - The target agent's UUID (will be prefixed with "agent:").
   * @param message - The message payload (should conform to AgentMeshMessage).
   */
  sendToAgent(targetAgentId: string, message: unknown): void {
    if (!this.actorRef || !this.actorSystem) {
      throw new Error("Mesh integration not enabled. Provide actorSystem in AgentConfig.");
    }
    const targetActorId = targetAgentId.startsWith("agent:") ? targetAgentId : `agent:${targetAgentId}`;
    this.actorRef.tell(`agent:${this.id}`, { ...message as object }, { topic: "agent-message" });
    this.actorSystem.tell(`agent:${this.id}`, targetActorId, message);
  }

  /**
   * Send a request-reply message to another agent in the mesh.
   * @param targetAgentId - The target agent's UUID (will be prefixed with "agent:").
   * @param message - The message payload (should conform to AgentMeshMessage).
   * @param timeoutMs - Timeout in milliseconds (default: 30000).
   * @returns The reply envelope.
   */
  async askAgent(targetAgentId: string, message: unknown, timeoutMs?: number): Promise<unknown> {
    if (!this.actorRef || !this.actorSystem) {
      throw new Error("Mesh integration not enabled. Provide actorSystem in AgentConfig.");
    }
    const targetActorId = targetAgentId.startsWith("agent:") ? targetAgentId : `agent:${targetAgentId}`;
    const reply = await this.actorSystem.ask(`agent:${this.id}`, targetActorId, message, {
      timeout: timeoutMs ?? 30_000,
    });
    return reply.payload;
  }

  /**
   * Broadcast a message to a Samiti ambient channel.
   * @param channel - Channel name (e.g., "#security", "#performance").
   * @param content - Human-readable message content.
   * @param severity - Message severity (default: "info").
   * @param category - Freeform category tag.
   */
  broadcastToChannel(
    channel: string,
    content: string,
    severity: "info" | "warning" | "critical" = "info",
    category: string = "agent-event",
  ): void {
    if (!this.samiti) return; // silently skip if no Samiti
    try {
      this.samiti.broadcast(channel, {
        sender: this.id,
        severity,
        category,
        content,
        data: { agentId: this.id, purpose: this.purpose, depth: this.depth },
      });
    } catch (err) {
      log.debug("samiti broadcast failed", { channel, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API -- Sub-Agent Spawning
  // ═══════════════════════════════════════════════════════════════

  spawn(spawnConfig: SpawnConfig): Agent {
    if (this.children.length >= MAX_SUB_AGENTS) {
      throw new Error(`Cannot spawn sub-agent: parent already has ${MAX_SUB_AGENTS} children (max).`);
    }
    if (this.depth + 1 > MAX_AGENT_DEPTH) {
      throw new Error(
        `Cannot spawn sub-agent: would exceed max depth of ${MAX_AGENT_DEPTH}. Current depth: ${this.depth}.`,
      );
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
      onEvent: this.config.onEvent,
      enableMemory: this.config.enableMemory,
      project: this.config.project,
      // Inherit critical subsystem configs from parent
      policyEngine: this.config.policyEngine,
      commHub: this.config.commHub,
      actorSystem: this.actorSystem ?? undefined,
      samiti: this.samiti ?? undefined,
      lokapala: this.lokapala ?? undefined,
      kaala: this.kaala ?? undefined,
      enableMesh: this.config.enableMesh,
      enableLearning: this.config.enableLearning,
      enableAutonomy: this.config.enableAutonomy,
      consecutiveFailureThreshold: this.config.consecutiveFailureThreshold,
      enableChetana: this.config.enableChetana,
      chetanaConfig: this.config.chetanaConfig,
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
        // Silently skip: memory bubble-up is best-effort; failure must not block sub-agent result
        await this.memoryBridge.bubbleUpFindings(
          child.memorySessionId, this.memorySessionId, project,
        ).catch((e) => { log.debug("memory bubble-up failed", { error: String(e) }); });
      }

      const result: SubAgentResult = {
        agentId: child.id, purpose: spawnConfig.purpose, response,
        messages: [...child.getMessages()],
        cost: sumChildCosts(child.getMessages()), status: "completed",
      };

      this.emit("subagent:done", {
        parentId: this.id, childId: child.id,
        purpose: spawnConfig.purpose, status: "completed",
      });

      return result;
    } catch (err) {
      const isAbort = err instanceof AbortError;
      const result: SubAgentResult = {
        agentId: child.id, purpose: spawnConfig.purpose,
        response: findLastAssistantMessage(child.getMessages()) ?? this.createMessage("assistant", [
          { type: "text", text: isAbort ? "[Sub-agent aborted]" : `[Sub-agent error: ${err}]` },
        ]),
        messages: [...child.getMessages()],
        cost: sumChildCosts(child.getMessages()),
        status: isAbort ? "aborted" : "error",
        error: err instanceof Error ? err.message : String(err),
      };

      this.emit("subagent:error", {
        parentId: this.id, childId: child.id,
        purpose: spawnConfig.purpose, error: result.error,
      });

      return result;
    }
  }

  async delegateParallel(tasks: Array<{ config: SpawnConfig; prompt: string }>): Promise<SubAgentResult[]> {
    if (tasks.length + this.children.length > MAX_SUB_AGENTS) {
      throw new Error(
        `Cannot spawn ${tasks.length} sub-agents: would exceed limit of ${MAX_SUB_AGENTS}. ` +
        `Currently ${this.children.length} children.`,
      );
    }
    return Promise.all(tasks.map((task) => this.delegate(task.config, task.prompt)));
  }

  removeChild(childId: string): boolean {
    const idx = this.children.findIndex((c) => c.id === childId);
    if (idx === -1) return false;
    if (this.children[idx].agentStatus === "running") return false;
    const removed = this.children.splice(idx, 1)[0];
    removed.dispose();
    return true;
  }

  pruneChildren(): number {
    const before = this.children.length;
    const toRemove = this.children.filter((c) => c.agentStatus !== "running");
    this.children = this.children.filter((c) => c.agentStatus === "running");
    for (const child of toRemove) {
      child.dispose();
    }
    return before - this.children.length;
  }

  /**
   * Clean up all internal resources.
   * Call this when the agent is permanently removed from the tree.
   * After dispose(), the agent should not be used again.
   */
  dispose(): void {
    // Abort any running operations
    this.abort();

    // Clean up pending input requests
    for (const [, pending] of this.pendingInputs) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error("Agent disposed"));
    }
    this.pendingInputs.clear();

    // Clean up children recursively
    for (const child of this.children) {
      child.dispose();
    }
    this.children = [];

    // Clean up mesh registration
    if (this.actorSystem && this.actorRef) {
      try {
        this.actorSystem.stop(`agent:${this.id}`);
      } catch {
        // Non-fatal — actor may already be stopped
      }
    }
    this.actorRef = null;
    this.actorSystem = null;
    this.samiti = null;
    this.kaala = null;

    // Null out subsystems to release memory
    this.memoryBridge = null;
    this.learningLoop = null;
    this.autonomousAgent = null;
    this.chetana = null;
    this.provider = null;

    // Clear message history to free memory
    this.state.messages = [];
    this.state.tools = [];

    this.agentStatus = "aborted";
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API -- Tree Traversal (delegates)
  // ═══════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE -- Agent Loop
  // ═══════════════════════════════════════════════════════════════

  private async runAgentLoop(): Promise<AgentMessage> {
    this.state.isStreaming = true;
    let turn = 0;

    while (turn < this.maxTurns) {
      turn++;
      this.emit("turn:start", { turn, maxTurns: this.maxTurns });

      // KaalaBrahma: heartbeat per turn
      if (this.kaala) { try { this.kaala.recordHeartbeat(this.id, { turnCount: turn }); } catch { /* best-effort */ } }

      const steering = this.steeringManager.getSteeringInstruction();
      if (steering) {
        const steerMsg = this.createMessage("system", [{ type: "text", text: steering }]);
        this.state.messages.push(steerMsg);
      }

      // Chetana: cognitive state before turn
      const userMsg = this.state.messages.filter(m => m.role === "user").pop();
      const userText = userMsg?.content.filter(p => p.type === "text").map(p => (p as { text: string }).text).join("") ?? undefined;
      const chetanaCtx = this.chetana?.beforeTurn(userText);
      if (chetanaCtx && chetanaCtx.steeringSuggestions.length > 0) {
        this.steeringManager.steer(chetanaCtx.steeringSuggestions.join(". "));
      }

      const context = this.contextManager.buildContext(this.state);
      const streamOptions = this.buildStreamOptions();
      const result = await this.streamLLMResponse(context, streamOptions);

      // KaalaBrahma: enrich heartbeat with token usage from LLM response
      if (this.kaala && result.cost) {
        try {
          const tokenUsage = (result.cost.input ?? 0) + (result.cost.output ?? 0);
          this.kaala.recordHeartbeat(this.id, { turnCount: turn, tokenUsage });
        } catch { /* best-effort */ }
      }

      const assistantMessage = this.createMessage("assistant", result.content, {
        model: this.state.model, cost: result.cost,
      });
      this.state.messages.push(assistantMessage);

      const toolCalls = result.content.filter(
        (part): part is ToolCallContent => part.type === "tool_call",
      );

      if (toolCalls.length === 0 || result.stopReason !== "tool_use") {
        this.emit("turn:done", { turn, reason: result.stopReason });
        this.chetana?.afterTurn();
        return assistantMessage;
      }

      await this.executeToolCalls(toolCalls);
      this.emit("turn:done", { turn, reason: "tool_use" });
      this.chetana?.afterTurn();

      if (this.abortController?.signal.aborted) {
        throw new AbortError("Agent loop aborted");
      }
    }

    const lastAssistant = findLastAssistantMessage(this.state.messages);
    if (lastAssistant) return lastAssistant;

    const fallback = this.createMessage("assistant", [
      { type: "text", text: "[Max turns reached without a response]" },
    ]);
    this.state.messages.push(fallback);
    return fallback;
  }

  private async streamLLMResponse(
    context: Context,
    options: StreamOptions,
  ): Promise<{ content: ContentPart[]; stopReason: StopReason; cost?: CostBreakdown }> {
    const provider = this.provider!;
    const content: ContentPart[] = [];
    let stopReason: StopReason = "end_turn";
    let cost: CostBreakdown | undefined;

    this.emit("stream:start", {});
    const signal = this.abortController?.signal;
    if (signal?.aborted) return { content: mergeTextParts(content), stopReason, cost };

    const stream = provider.stream(this.state.model, context, options);

    for await (const event of stream) {
      if (signal?.aborted) throw new AbortError("Stream aborted");

      switch (event.type) {
        case "start":
          this.emit("stream:start", { messageId: event.messageId });
          break;
        case "text":
          content.push({ type: "text", text: event.text });
          this.emit("stream:text", { text: event.text });
          break;
        case "thinking":
          content.push({ type: "thinking", text: event.text });
          this.emit("stream:thinking", { text: event.text });
          break;
        case "tool_call":
          content.push({ type: "tool_call", id: event.id, name: event.name, arguments: event.arguments });
          this.emit("stream:tool_call", { id: event.id, name: event.name, arguments: event.arguments });
          break;
        case "usage":
          this.emit("stream:usage", { usage: event.usage });
          break;
        case "done":
          stopReason = event.stopReason;
          cost = event.cost;
          this.emit("stream:done", { stopReason: event.stopReason, usage: event.usage, cost: event.cost });
          break;
        case "error":
          this.emit("stream:error", { error: event.error });
          throw event.error;
      }
    }

    return { content: mergeTextParts(content), stopReason, cost };
  }

  private async executeToolCalls(toolCalls: ToolCallContent[]): Promise<void> {
    const context: ToolContext = {
      sessionId: this.state.sessionId,
      workingDirectory: this.workingDirectory,
      signal: this.abortController?.signal,
    };

    for (const call of toolCalls) {
      if (this.abortController?.signal.aborted) throw new AbortError("Tool execution aborted");
      this.emit("tool:start", { name: call.name, id: call.id });

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.arguments);
      } catch {
        // Malformed JSON — return error result instead of executing with empty args
        this.emit("stream:error", { error: `Malformed JSON in tool call args for "${call.name}": ${call.arguments.slice(0, 100)}` });
        const errorContent: ToolResultContent = {
          type: "tool_result",
          toolCallId: call.id,
          content: `Error: Failed to parse tool arguments as JSON for "${call.name}"`,
          isError: true,
        };
        this.state.messages.push(this.createMessage("tool_result", [errorContent]));
        continue;
      }

      // WS1.9: Policy engine check — block disallowed tool calls before execution
      if (this.config.policyEngine) {
        try {
          const verdict = this.config.policyEngine.check(call.name, args);
          if (!verdict.allowed) {
            const reason = verdict.reason ?? "Blocked by policy engine";
            this.emit("tool:error", { name: call.name, id: call.id, error: reason });
            const blockedContent: ToolResultContent = {
              type: "tool_result", toolCallId: call.id,
              content: `Policy denied: ${reason}`, isError: true,
            };
            this.state.messages.push(this.createMessage("tool_result", [blockedContent]));
            continue;
          }
        } catch (policyErr) {
          const errMsg = policyErr instanceof Error ? policyErr.message : String(policyErr);
          this.emit("tool:error", { name: call.name, id: call.id, error: `Policy engine error: ${errMsg}` });
          const errorContent: ToolResultContent = {
            type: "tool_result", toolCallId: call.id,
            content: `Policy engine error: ${errMsg}`, isError: true,
          };
          this.state.messages.push(this.createMessage("tool_result", [errorContent]));
          continue;
        }
      }

      // WS1.4: Skip tools disabled by the autonomy layer
      if (this.autonomousAgent?.isToolDisabled(call.name)) {
        const disabledMsg = `Tool "${call.name}" is temporarily disabled due to repeated failures`;
        this.emit("tool:error", { name: call.name, id: call.id, error: disabledMsg });
        const disabledContent: ToolResultContent = {
          type: "tool_result", toolCallId: call.id,
          content: `Error: ${disabledMsg}`, isError: true,
        };
        this.state.messages.push(this.createMessage("tool_result", [disabledContent]));
        continue;
      }

      // WS1.3 + WS1.4: Mark tool start for latency tracking
      this.learningLoop?.markToolStart(call.name);
      this.autonomousAgent?.onToolStart(call.name);
      const toolStartTime = Date.now();

      try {
        const result = await this.toolExecutor.execute(call.name, args, context);
        this.emit("tool:done", { name: call.name, id: call.id, result });

        // WS1.3: Record tool usage in learning loop
        this.learningLoop?.recordToolUsage(call.name, args, result);

        // WS1.4: Track tool result in autonomy layer
        this.autonomousAgent?.onToolUsed(call.name, args, result);

        // WS1.3: Record Markov transition (from previous tool to current)
        this.previousToolName = call.name;

        // Chetana: update cognitive state after tool execution
        this.chetana?.afterToolExecution(call.name, true, Date.now() - toolStartTime, result.content);

        // Lokapala: scan tool execution for security/performance/correctness issues
        if (this.lokapala) {
          try {
            const findings = this.lokapala.afterToolExecution(call.name, args, result.content, Date.now() - toolStartTime);
            for (const finding of findings) {
              if (finding.severity === "critical" && this.samiti) {
                this.samiti.broadcast(`#${finding.domain}`, {
                  sender: this.id,
                  severity: "critical",
                  category: `guardian-${finding.guardianId}`,
                  content: finding.title,
                  data: finding,
                });
              }
            }
          } catch {
            // Guardian scanning is best-effort
          }
        }

        const resultContent: ToolResultContent = {
          type: "tool_result", toolCallId: call.id, content: result.content, isError: result.isError,
        };
        this.state.messages.push(this.createMessage("tool_result", [resultContent]));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emit("tool:error", { name: call.name, id: call.id, error: message });

        // WS1.3: Record error as a failed tool usage
        const errorResult = { content: message, isError: true as const };
        this.learningLoop?.recordToolUsage(call.name, args, errorResult);

        // WS1.4: Track error in autonomy layer
        this.autonomousAgent?.onToolUsed(call.name, args, errorResult);

        // Chetana: update cognitive state after tool error
        this.chetana?.afterToolExecution(call.name, false, Date.now() - toolStartTime, message, false);

        this.previousToolName = call.name;

        const errorContent: ToolResultContent = {
          type: "tool_result", toolCallId: call.id, content: `Error: ${message}`, isError: true,
        };
        this.state.messages.push(this.createMessage("tool_result", [errorContent]));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE -- Helpers
  // ═══════════════════════════════════════════════════════════════

  private buildStreamOptions(): StreamOptions {
    const options: StreamOptions = { signal: this.abortController?.signal };
    if (this.state.thinkingLevel !== "none") {
      const defaults = { low: 2048, medium: 8192, high: 32768 };
      const budgets = { ...defaults, ...this.config.thinkingBudgets };
      options.thinking = { enabled: true, budgetTokens: budgets[this.state.thinkingLevel] ?? 8192 };
    }
    return options;
  }

  buildDefaultSystemPrompt(profile: AgentProfile): string {
    const parts: string[] = [];
    parts.push(`You are ${profile.name}.`);
    if (profile.personality) parts.push(profile.personality);
    if (profile.expertise.length > 0) parts.push(`Your areas of expertise: ${profile.expertise.join(", ")}.`);
    if (profile.voice === "custom" && profile.customVoice) parts.push(profile.customVoice);
    return parts.join("\n\n");
  }

  private createMessage(
    role: AgentMessage["role"],
    content: ContentPart[],
    extra?: { model?: string; cost?: CostBreakdown },
  ): AgentMessage {
    return {
      id: crypto.randomUUID(), role, content, timestamp: Date.now(),
      agentId: this.id, model: extra?.model, cost: extra?.cost,
    };
  }

  private emit(event: AgentEventType, data: unknown): void {
    this.config.onEvent?.(event, data);

    // Samiti: broadcast significant events to ambient channels
    if (this.samiti) {
      this.broadcastEventToSamiti(event, data);
    }

    if (this.parentAgent && this.bubbleChildEvents) {
      this.parentAgent.emit("subagent:event", {
        sourceAgentId: this.id, sourcePurpose: this.purpose,
        sourceDepth: this.depth, originalEvent: event, data,
      });
    }
  }

  /**
   * Route agent events to appropriate Samiti channels.
   * Only broadcasts significant events to avoid noise.
   */
  private broadcastEventToSamiti(event: AgentEventType, data: unknown): void {
    if (!this.samiti) return;
    try {
      switch (event) {
        case "tool:error": {
          const d = data as { name?: string; error?: string };
          this.samiti.broadcast("#correctness", {
            sender: this.id,
            severity: "warning",
            category: "tool-error",
            content: `Tool "${d.name}" failed: ${d.error}`,
            data: { agentId: this.id, purpose: this.purpose, ...d },
          });
          break;
        }
        case "agent:abort": {
          this.samiti.broadcast("#alerts", {
            sender: this.id,
            severity: "info",
            category: "agent-abort",
            content: `Agent "${this.purpose}" (${this.id}) aborted`,
            data: { agentId: this.id, purpose: this.purpose },
          });
          break;
        }
        case "subagent:spawn": {
          const d = data as { childId?: string; purpose?: string };
          this.samiti.broadcast("#alerts", {
            sender: this.id,
            severity: "info",
            category: "agent-spawn",
            content: `Spawned sub-agent "${d.purpose}" (${d.childId})`,
            data: { agentId: this.id, ...d },
          });
          break;
        }
        case "subagent:error": {
          const d = data as { childId?: string; purpose?: string; error?: string };
          this.samiti.broadcast("#correctness", {
            sender: this.id,
            severity: "warning",
            category: "subagent-error",
            content: `Sub-agent "${d.purpose}" failed: ${d.error}`,
            data: { agentId: this.id, ...d },
          });
          break;
        }
        case "chetana:frustrated": {
          this.samiti.broadcast("#alerts", {
            sender: this.id,
            severity: "warning",
            category: "chetana-frustrated",
            content: `Agent "${this.purpose}" is frustrated`,
            data: { agentId: this.id, purpose: this.purpose },
          });
          break;
        }
        // Other events are too noisy for ambient channels
        default:
          break;
      }
    } catch {
      // Samiti broadcast failures are non-fatal
    }
  }
}
