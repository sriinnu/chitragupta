/**
 * The Orchestrator -- the brain that coordinates multiple agents, manages
 * agent-of-agents patterns, handles dynamic agent spawning, and provides
 * high-level orchestration patterns.
 */

import { ChitraguptaError, createLogger } from "@chitragupta/core";
import type { AgentProfile } from "@chitragupta/core";
import type {
	AgentInfo,
	AgentSlot,
	OrchestrationPlan,
	OrchestratorEvent,
	OrchestratorStats,
	OrchestratorTask,
	TaskResult,
} from "./types.js";
import { TaskRouter } from "./router.js";
import {
	leastLoadedAssign,
	roundRobinAssign,
	specializedAssign,
} from "./strategies.js";
import type { SlotStats, SwarmContext } from "./strategies.js";
import {
	type AgentInstance,
	applyFallback,
	cancelRaceSiblings,
	checkAutoScale,
	checkPlanCompletion,
	collectSwarmResult,
	handleTaskFailure,
	processCompetitive,
	processHierarchical,
	processSwarm,
} from "./orchestrator-scaling.js";

// ─── Priority Queue ──────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = {
	critical: 0,
	high: 1,
	normal: 2,
	low: 3,
	background: 4,
};

function compareTasks(a: OrchestratorTask, b: OrchestratorTask): number {
	const pa = PRIORITY_ORDER[a.priority] ?? 2;
	const pb = PRIORITY_ORDER[b.priority] ?? 2;
	if (pa !== pb) return pa - pb;
	const da = a.deadline ?? Infinity;
	const db = b.deadline ?? Infinity;
	if (da !== db) return da - db;
	return 0;
}

// ─── Orchestrator Error ──────────────────────────────────────────────────────

/**
 * Error class for orchestrator-specific failures.
 *
 * Extends `ChitraguptaError` with a fixed error code of `"ORCHESTRATOR_ERROR"`.
 */
export class OrchestratorError extends ChitraguptaError {
	/**
	 * @param message - Human-readable error description.
	 */
	constructor(message: string) {
		super(message, "ORCHESTRATOR_ERROR");
		this.name = "OrchestratorError";
	}
}

// ─── Optional Agent Runtime Config ──────────────────────────────────────────

/**
 * Optional configuration for wiring the orchestrator to real agent instances.
 * When provided, spawnAgent() creates actual Agent objects that can execute tasks.
 */
export interface OrchestratorAgentConfig {
	/** ActorSystem for inter-agent mesh communication. */
	actorSystem?: import("@chitragupta/sutra").ActorSystem;
	/** Samiti for ambient channel communication. */
	samiti?: import("@chitragupta/sutra").Samiti;
	/** LLM provider definition to set on spawned agents. */
	provider?: import("@chitragupta/swara").ProviderDefinition;
	/** Default agent profile for spawned agents. */
	defaultProfile?: AgentProfile;
	/** Default model for spawned agents. */
	defaultModel?: string;
	/** Default provider ID for spawned agents. */
	defaultProviderId?: string;
	/**
	 * Factory function to create an Agent for a given slot.
	 * When provided, this overrides the default agent creation.
	 * Return null to fall back to the default dummy AgentInstance.
	 */
	agentFactory?: (slotId: string, slot: import("./types.js").AgentSlot) => Promise<import("@chitragupta/anina").Agent | null> | import("@chitragupta/anina").Agent | null;
	/**
	 * Callback invoked when a task is assigned to a real agent.
	 * The callback should call agent.prompt() or equivalent and return the result.
	 * When not provided, the orchestrator only tracks task state without executing.
	 */
	taskExecutor?: (agent: import("@chitragupta/anina").Agent, task: import("./types.js").OrchestratorTask) => Promise<import("./types.js").TaskResult>;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * The Orchestrator coordinates multiple agent slots, manages task routing,
 * handles dynamic agent spawning/scaling, and supports various orchestration
 * strategies (round-robin, least-loaded, specialized, competitive, swarm,
 * hierarchical).
 *
 * @example
 * ```ts
 * const orch = new Orchestrator(plan, (evt) => console.log(evt));
 * await orch.start();
 * orch.submit({ id: "t1", type: "code", input: "...", priority: "normal" });
 * orch.handleCompletion("t1", { success: true, output: "done" });
 * await orch.stop();
 * ```
 */
const log = createLogger("niyanta:orchestrator");

export class Orchestrator {
	private readonly plan: OrchestrationPlan;
	private readonly onEvent: (event: OrchestratorEvent) => void;
	private readonly router: TaskRouter;

	// Task management
	private readonly tasks = new Map<string, OrchestratorTask>();
	private readonly queue: OrchestratorTask[] = [];
	private readonly results = new Map<string, TaskResult>();

	// Agent management
	private readonly agents = new Map<string, AgentInstance>();
	private readonly slotAgents = new Map<string, Set<string>>();
	private readonly slotQueues = new Map<string, OrchestratorTask[]>();

	// Strategy state
	private readonly roundRobinCounter = { value: 0 };
	private readonly swarmContexts = new Map<string, SwarmContext>();
	private readonly retryCount = new Map<string, number>();

	// Agent runtime (optional — when wired to real agents)
	private readonly agentConfig: OrchestratorAgentConfig | undefined;
	private readonly realAgents = new Map<string, import("@chitragupta/anina").Agent>();

	// Lifecycle
	private running = false;
	private paused = false;
	private submissionCounter = 0;
	private processingTimer: ReturnType<typeof setTimeout> | null = null;

	// Stats
	private totalCost = 0;
	private totalTokens = 0;
	private completionTimes: number[] = [];

	/**
	 * Create a new orchestrator for the given plan.
	 *
	 * Initializes agent slots, spawns minimum required instances per slot,
	 * and configures the task router from the plan's routing rules.
	 *
	 * @param plan - The orchestration plan defining agents, strategy, routing, and coordination.
	 * @param onEvent - Optional callback invoked for every orchestrator event.
	 */
	constructor(
		plan: OrchestrationPlan,
		onEvent?: (event: OrchestratorEvent) => void,
		agentConfig?: OrchestratorAgentConfig,
	) {
		this.plan = plan;
		this.onEvent = onEvent ?? (() => {});
		this.agentConfig = agentConfig;
		this.router = new TaskRouter(plan.routing, plan.agents);

		for (const slot of plan.agents) {
			this.slotAgents.set(slot.id, new Set());
			this.slotQueues.set(slot.id, []);
			const minInstances = slot.minInstances ?? 1;
			for (let i = 0; i < minInstances; i++) this.spawnAgent(slot.id);
		}
	}

	// ─── Task Management ───────────────────────────────────────────────────

	/**
	 * Submit a task for orchestration.
	 *
	 * @param task - The task to submit. Must have a unique `id`.
	 * @returns The submitted task's ID.
	 */
	submit(task: OrchestratorTask): string {
		this.submissionCounter++;
		this.tasks.set(task.id, { ...task, status: "pending" });
		this.enqueue(task);
		return task.id;
	}

	/**
	 * Submit multiple tasks at once.
	 *
	 * @param tasks - Array of tasks to submit.
	 * @returns Array of submitted task IDs, in the same order.
	 */
	submitBatch(tasks: OrchestratorTask[]): string[] {
		return tasks.map((t) => this.submit(t));
	}

	/**
	 * Cancel a task by ID. Releases any agent assigned to it.
	 *
	 * @param taskId - The task to cancel.
	 * @returns `true` if the task was cancelled, `false` if it was not found or already terminal.
	 */
	cancel(taskId: string): boolean {
		const task = this.tasks.get(taskId);
		if (!task) return false;
		if (task.status === "completed" || task.status === "cancelled") return false;

		task.status = "cancelled";
		this.tasks.set(taskId, task);
		this.removeFromQueue(taskId);

		for (const agent of this.agents.values()) {
			if (agent.currentTask === taskId) {
				agent.currentTask = undefined;
				agent.status = "idle";
				this.emit({ type: "agent:idle", agentSlot: agent.slotId, agentId: agent.id });
			}
		}
		return true;
	}

	/**
	 * Retrieve a task by its ID.
	 *
	 * @param taskId - The task ID to look up.
	 * @returns The task object, or `undefined` if not found.
	 */
	getTask(taskId: string): OrchestratorTask | undefined {
		return this.tasks.get(taskId);
	}

	// ─── Execution Lifecycle ───────────────────────────────────────────────

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.paused = false;
		this.emit({ type: "plan:start", planId: this.plan.id });
		this.processQueue();
	}

	async stop(): Promise<void> {
		this.running = false;
		this.paused = false;
		if (this.processingTimer) {
			clearTimeout(this.processingTimer);
			this.processingTimer = null;
		}
		// Dispose real agents
		for (const agent of this.realAgents.values()) {
			try { agent.dispose(); } catch { /* non-fatal */ }
		}
		this.realAgents.clear();
	}

	pause(): void { this.paused = true; }

	resume(): void {
		if (!this.paused) return;
		this.paused = false;
		if (this.running) this.processQueue();
	}

	// ─── Agent Management ──────────────────────────────────────────────────

	/**
	 * Get information about all active agent instances.
	 *
	 * @returns Array of agent info objects with ID, slot, role, status, and task data.
	 */
	getActiveAgents(): AgentInfo[] {
		const infos: AgentInfo[] = [];
		for (const agent of this.agents.values()) {
			const slot = this.plan.agents.find((s) => s.id === agent.slotId);
			infos.push({
				id: agent.id, slotId: agent.slotId, role: slot?.role ?? "unknown",
				currentTask: agent.currentTask, tasksCompleted: agent.tasksCompleted,
				status: agent.status,
			});
		}
		return infos;
	}

	/**
	 * Get the real Agent instance for an orchestrator agent ID.
	 * Returns undefined if the agent was not created with a real Agent
	 * (i.e., no agentFactory was provided or it returned null).
	 */
	getRealAgent(agentId: string): import("@chitragupta/anina").Agent | undefined {
		return this.realAgents.get(agentId);
	}

	/**
	 * Scale the number of agent instances for a slot.
	 *
	 * If `count` exceeds current instances, new agents are spawned.
	 * If `count` is less, idle agents are removed (busy agents are kept).
	 *
	 * @param slotId - The agent slot to scale.
	 * @param count - The desired number of instances (capped at slot's maxInstances).
	 * @throws {OrchestratorError} If the slot ID is not found.
	 */
	scaleAgent(slotId: string, count: number): void {
		const slot = this.plan.agents.find((s) => s.id === slotId);
		if (!slot) throw new OrchestratorError(`Unknown agent slot: ${slotId}`);

		const current = this.slotAgents.get(slotId)?.size ?? 0;
		const target = Math.min(count, slot.maxInstances ?? Infinity);

		if (target > current) {
			for (let i = current; i < target; i++) this.spawnAgent(slotId);
		} else if (target < current) {
			const agentSet = this.slotAgents.get(slotId);
			if (!agentSet) return;
			let toRemove = current - target;
			for (const agentId of agentSet) {
				if (toRemove <= 0) break;
				const agent = this.agents.get(agentId);
				if (agent && agent.status === "idle") {
					this.agents.delete(agentId);
					agentSet.delete(agentId);
					toRemove--;
				}
			}
		}
	}

	// ─── Results ───────────────────────────────────────────────────────────

	/** Get a snapshot of all completed task results. */
	getResults(): Map<string, TaskResult> { return new Map(this.results); }

	/**
	 * Get orchestrator statistics including task counts, cost, and throughput.
	 *
	 * @returns Snapshot of current orchestrator metrics.
	 */
	getStats(): OrchestratorStats {
		let pending = 0, running = 0, completed = 0, failed = 0;
		for (const task of this.tasks.values()) {
			switch (task.status) {
				case "pending": case "queued": pending++; break;
				case "assigned": case "running": case "retrying": running++; break;
				case "completed": completed++; break;
				case "failed": case "cancelled": failed++; break;
				default: pending++; break; // Unknown status counts as pending
			}
		}

		const avgLatency = this.completionTimes.length > 0
			? this.completionTimes.reduce((a, b) => a + b, 0) / this.completionTimes.length : 0;
		const elapsed = this.completionTimes.length > 1
			? (Math.max(...this.completionTimes) - Math.min(...this.completionTimes)) / 60000 : 0;
		const throughput = elapsed > 0 ? completed / elapsed : 0;

		return {
			totalTasks: this.tasks.size, pendingTasks: pending, runningTasks: running,
			completedTasks: completed, failedTasks: failed, activeAgents: this.agents.size,
			totalCost: this.totalCost, totalTokens: this.totalTokens,
			averageLatency: avgLatency, throughput,
		};
	}

	// ─── Internal: Routing ─────────────────────────────────────────────────

	private route(task: OrchestratorTask): string {
		switch (this.plan.strategy) {
			case "round-robin":
				return roundRobinAssign(this.plan.agents, task, this.roundRobinCounter);
			case "least-loaded":
				return leastLoadedAssign(this.plan.agents, this.buildSlotStats());
			case "specialized":
				return specializedAssign(this.plan.agents, task);
			default:
				return this.router.route(task);
		}
	}

	// ─── Internal: Assignment ──────────────────────────────────────────────

	private assign(task: OrchestratorTask, slotId: string): void {
		task.assignedAgent = slotId;
		task.status = "assigned";
		this.tasks.set(task.id, task);

		const slotAgentIds = this.slotAgents.get(slotId);
		if (!slotAgentIds) return;

		let assignedAgent: AgentInstance | undefined;
		for (const agentId of slotAgentIds) {
			const agent = this.agents.get(agentId);
			if (agent && agent.status === "idle") { assignedAgent = agent; break; }
		}

		if (assignedAgent) {
			assignedAgent.currentTask = task.id;
			assignedAgent.status = "busy";
			task.status = "running";
			this.tasks.set(task.id, task);
			this.emit({ type: "task:assigned", taskId: task.id, agentId: assignedAgent.id });
			// Execute task on real agent if available
			this.executeOnRealAgent(assignedAgent.id, task);
		} else {
			const slotQueue = this.slotQueues.get(slotId) ?? [];
			slotQueue.push(task);
			this.slotQueues.set(slotId, slotQueue);
			task.status = "queued";
			this.tasks.set(task.id, task);
			this.emit({ type: "task:queued", taskId: task.id, agentSlot: slotId });

			checkAutoScale(
				slotId, this.plan.agents, this.slotQueues, this.slotAgents,
				(sid) => this.spawnAgent(sid), (evt) => this.emit(evt),
			);
		}
	}

	// ─── Internal: Queue Processing ────────────────────────────────────────

	private processQueue(): void {
		if (!this.running || this.paused) return;

		while (this.queue.length > 0) {
			const task = this.queue[0];
			if (!this.areDependenciesMet(task)) break;
			this.queue.shift();

			switch (this.plan.strategy) {
				case "competitive":
					processCompetitive(task, this.plan.agents, this.tasks, (t, s) => this.assign(t, s));
					break;
				case "swarm":
					processSwarm(
						task, this.plan.agents, this.plan.coordination.sharedContext,
						this.tasks, this.swarmContexts, (t, s) => this.assign(t, s),
					);
					break;
				case "hierarchical":
					processHierarchical(
						task, this.tasks, (t) => this.route(t),
						(t, s) => this.assign(t, s), (t) => this.enqueue(t),
					);
					break;
				default: {
					const slotId = this.route(task);
					this.assign(task, slotId);
					break;
				}
			}
		}

		if (this.running && !this.paused) {
			this.processingTimer = setTimeout(() => this.processQueue(), 100);
		}
	}

	// ─── Internal: Completion & Failure ────────────────────────────────────

	/**
	 * Handle successful completion of a task.
	 *
	 * Updates task status, records metrics, frees the assigned agent,
	 * and handles race/swarm sub-task propagation. Triggers plan
	 * completion check and resumes queue processing.
	 *
	 * @param taskId - The completed task's ID.
	 * @param result - The task's result data.
	 */
	handleCompletion(taskId: string, result: TaskResult): void {
		const task = this.tasks.get(taskId);
		if (!task) return;

		task.status = "completed";
		task.result = result;
		this.tasks.set(taskId, task);
		this.results.set(taskId, result);

		if (result.metrics) {
			this.totalCost += result.metrics.cost;
			this.totalTokens += result.metrics.tokenUsage;
			this.completionTimes.push(result.metrics.endTime - result.metrics.startTime);
		}

		this.emit({ type: "task:completed", taskId, result });
		this.freeAgent(taskId);

		const raceParent = task.metadata?.raceParent as string | undefined;
		if (raceParent) {
			cancelRaceSiblings(taskId, raceParent, this.tasks, this.results, (id) => this.cancel(id));
		}

		const swarmParent = task.metadata?.swarmParent as string | undefined;
		if (swarmParent) {
			collectSwarmResult(taskId, swarmParent, result, this.tasks, this.results, this.swarmContexts);
		}

		checkPlanCompletion(this.tasks, this.plan.id, (evt) => this.emit(evt));
		if (this.running && !this.paused) this.processQueue();
	}

	/**
	 * Handle task failure with retry, fallback, and plan-level failure checks.
	 *
	 * Delegates retry logic to {@link handleTaskFailure}. If retries are
	 * exhausted, applies fallback configuration. If max failures are exceeded,
	 * stops the orchestrator.
	 *
	 * @param taskId - The failed task's ID.
	 * @param error - The error that caused the failure.
	 */
	handleFailure(taskId: string, error: Error): void {
		const retried = handleTaskFailure(
			taskId, error, this.tasks, this.results, this.retryCount,
			(id) => this.freeAgent(id), (t) => this.enqueue(t),
			() => this.processQueue(), (evt) => this.emit(evt), this.running,
		);
		if (retried) return;

		const task = this.tasks.get(taskId);
		if (task) {
			applyFallback(
				task, error, this.plan.fallback, this.tasks,
				(t) => this.enqueue(t), (evt) => this.emit(evt),
			);
		}

		const failedCount = [...this.tasks.values()].filter((t) => t.status === "failed").length;
		const maxFailures = this.plan.coordination.maxFailures;
		if (maxFailures !== undefined && failedCount >= maxFailures) {
			this.emit({ type: "plan:failed", planId: this.plan.id, error: `Max failures (${maxFailures}) reached` });
			this.stop();
			return;
		}

		if (this.plan.coordination.tolerateFailures) {
			checkPlanCompletion(this.tasks, this.plan.id, (evt) => this.emit(evt));
			if (this.running && !this.paused) this.processQueue();
		} else {
			this.emit({ type: "plan:failed", planId: this.plan.id, error: error.message });
			this.stop();
		}
	}

	// ─── Internal: Helpers ─────────────────────────────────────────────────

	private enqueue(task: OrchestratorTask): void {
		task.status = "pending";
		this.queue.push(task);
		this.queue.sort(compareTasks);
	}

	private removeFromQueue(taskId: string): void {
		const idx = this.queue.findIndex((t) => t.id === taskId);
		if (idx !== -1) this.queue.splice(idx, 1);
		for (const [, slotQueue] of this.slotQueues) {
			const slotIdx = slotQueue.findIndex((t) => t.id === taskId);
			if (slotIdx !== -1) slotQueue.splice(slotIdx, 1);
		}
	}

	private areDependenciesMet(task: OrchestratorTask): boolean {
		if (!task.dependencies || task.dependencies.length === 0) return true;
		return task.dependencies.every((depId) => this.tasks.get(depId)?.status === "completed");
	}

	private spawnAgent(slotId: string): void {
		const agentId = `${slotId}:agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const agent: AgentInstance = { id: agentId, slotId, tasksCompleted: 0, status: "idle" };
		this.agents.set(agentId, agent);
		const slotSet = this.slotAgents.get(slotId) ?? new Set();
		slotSet.add(agentId);
		this.slotAgents.set(slotId, slotSet);
		this.emit({ type: "agent:spawned", agentSlot: slotId, agentId });

		// Optionally create a real Agent instance via factory
		if (this.agentConfig?.agentFactory) {
			const slot = this.plan.agents.find((s) => s.id === slotId);
			if (slot) {
				const maybeAgent = this.agentConfig.agentFactory(slotId, slot);
				if (maybeAgent && typeof (maybeAgent as Promise<unknown>).then === "function") {
					(maybeAgent as Promise<import("@chitragupta/anina").Agent | null>).then((a) => {
						if (a) {
							this.realAgents.set(agentId, a);
							log.debug("real agent created", { agentId, slotId });
						}
					}).catch((err) => {
						log.warn("agent factory failed", { agentId, slotId, error: err instanceof Error ? err.message : String(err) });
					});
				} else if (maybeAgent) {
					this.realAgents.set(agentId, maybeAgent as import("@chitragupta/anina").Agent);
					log.debug("real agent created", { agentId, slotId });
				}
			}
		}
	}

	private freeAgent(taskId: string): void {
		for (const agent of this.agents.values()) {
			if (agent.currentTask === taskId) {
				agent.currentTask = undefined;
				agent.tasksCompleted++;
				agent.status = "idle";
				this.emit({ type: "agent:idle", agentSlot: agent.slotId, agentId: agent.id });

				const slotQueue = this.slotQueues.get(agent.slotId);
				if (slotQueue && slotQueue.length > 0) {
					const nextTask = slotQueue.shift()!;
					agent.currentTask = nextTask.id;
					agent.status = "busy";
					nextTask.status = "running";
					this.tasks.set(nextTask.id, nextTask);
					this.emit({ type: "task:assigned", taskId: nextTask.id, agentId: agent.id });
					// Execute next task on real agent if available
					this.executeOnRealAgent(agent.id, nextTask);
				}
				break;
			}
		}
	}

	/**
	 * Execute a task on a real Agent instance if one is available.
	 * Falls back gracefully — if no real agent exists, the orchestrator
	 * continues in state-tracking-only mode.
	 */
	private executeOnRealAgent(agentId: string, task: OrchestratorTask): void {
		const realAgent = this.realAgents.get(agentId);
		if (!realAgent || !this.agentConfig?.taskExecutor) return;

		const executor = this.agentConfig.taskExecutor;
		executor(realAgent, task)
			.then((result) => {
				this.handleCompletion(task.id, result);
			})
			.catch((err) => {
				this.handleFailure(task.id, err instanceof Error ? err : new Error(String(err)));
			});
	}

	private buildSlotStats(): Map<string, SlotStats> {
		const stats = new Map<string, SlotStats>();
		for (const slot of this.plan.agents) {
			let running = 0, completed = 0;
			const agentIds = this.slotAgents.get(slot.id);
			if (agentIds) {
				for (const agentId of agentIds) {
					const agent = this.agents.get(agentId);
					if (agent) {
						if (agent.status === "busy") running++;
						completed += agent.tasksCompleted;
					}
				}
			}
			stats.set(slot.id, {
				slotId: slot.id, runningTasks: running,
				queuedTasks: this.slotQueues.get(slot.id)?.length ?? 0, completedTasks: completed,
			});
		}
		return stats;
	}

	private emit(event: OrchestratorEvent): void {
		try { this.onEvent(event); } catch (err) {
			log.warn("Error in event handler", { error: err instanceof Error ? err.message : String(err) });
		}
	}
}
