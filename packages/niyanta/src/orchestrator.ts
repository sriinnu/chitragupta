/**
 * The Orchestrator — coordinates multiple agents, manages task routing,
 * dynamic agent spawning, and orchestration strategies.
 *
 * Types, constants, error class, and extracted helper functions live in
 * orchestrator-dispatch.ts to keep this file under the 450 LOC limit.
 */

import { createLogger } from "@chitragupta/core";
import type {
	AgentInfo, OrchestrationPlan, OrchestratorEvent,
	OrchestratorStats, OrchestratorTask, TaskResult,
} from "./types.js";
import { TaskRouter } from "./router.js";
import {
	leastLoadedAssign, roundRobinAssign, specializedAssign,
} from "./strategies.js";
import type { SwarmContext } from "./strategies.js";
import {
	type AgentInstance, buildSlotStats, checkAutoScale,
	processCompetitive, processHierarchical, processSwarm,
} from "./orchestrator-scaling.js";
import {
	compareTasks, computeOrchestratorStats, getActiveAgentInfos,
	handleOrchestratorCompletion, handleOrchestratorFailure,
	OrchestratorError,
} from "./orchestrator-dispatch.js";
import type {
	OrchestratorAgentConfig, OrchestratorRealAgent, MetricsBucket,
} from "./orchestrator-dispatch.js";

// Re-export for backward compatibility
export { OrchestratorError } from "./orchestrator-dispatch.js";
export type {
	OrchestratorActorSystem, OrchestratorSamiti, OrchestratorProviderDef,
	OrchestratorRealAgent, OrchestratorAgentConfig,
} from "./orchestrator-dispatch.js";

const log = createLogger("niyanta:orchestrator");

/**
 * Coordinates multiple agent slots, manages task routing, handles dynamic
 * agent spawning/scaling, and supports various orchestration strategies.
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
export class Orchestrator {
	private readonly plan: OrchestrationPlan;
	private readonly onEvent: (event: OrchestratorEvent) => void;
	private readonly router: TaskRouter;
	private readonly tasks = new Map<string, OrchestratorTask>();
	private readonly queue: OrchestratorTask[] = [];
	private readonly results = new Map<string, TaskResult>();
	private readonly agents = new Map<string, AgentInstance>();
	private readonly slotAgents = new Map<string, Set<string>>();
	private readonly slotQueues = new Map<string, OrchestratorTask[]>();
	private readonly roundRobinCounter = { value: 0 };
	private readonly swarmContexts = new Map<string, SwarmContext>();
	private readonly retryCount = new Map<string, number>();
	private readonly agentConfig: OrchestratorAgentConfig | undefined;
	private readonly realAgents = new Map<string, OrchestratorRealAgent>();
	private running = false;
	private paused = false;
	private submissionCounter = 0;
	private processingTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly metrics: MetricsBucket = { totalCost: 0, totalTokens: 0, completionTimes: [] };

	/** Create a new orchestrator for the given plan. */
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

	// ─── Task Management ────────────────────────────────────────────────

	/** Submit a task for orchestration. Returns the task ID. */
	submit(task: OrchestratorTask): string {
		this.submissionCounter++;
		this.tasks.set(task.id, { ...task, status: "pending" });
		this.enqueue(task);
		return task.id;
	}

	/** Submit multiple tasks at once. Returns array of task IDs. */
	submitBatch(tasks: OrchestratorTask[]): string[] {
		return tasks.map((t) => this.submit(t));
	}

	/** Cancel a task by ID. Releases any agent assigned to it. */
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

	/** Retrieve a task by its ID. */
	getTask(taskId: string): OrchestratorTask | undefined {
		return this.tasks.get(taskId);
	}

	// ─── Execution Lifecycle ────────────────────────────────────────────

	/** Start the orchestrator and begin processing the queue. */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.paused = false;
		this.emit({ type: "plan:start", planId: this.plan.id });
		this.processQueue();
	}

	/** Stop the orchestrator and dispose real agents. */
	async stop(): Promise<void> {
		this.running = false;
		this.paused = false;
		if (this.processingTimer) {
			clearTimeout(this.processingTimer);
			this.processingTimer = null;
		}
		for (const agent of this.realAgents.values()) {
			try { (agent as { dispose?: () => void }).dispose?.(); } catch { /* non-fatal */ }
		}
		this.realAgents.clear();
	}

	/** Pause queue processing. */
	pause(): void { this.paused = true; }

	/** Resume queue processing. */
	resume(): void {
		if (!this.paused) return;
		this.paused = false;
		if (this.running) this.processQueue();
	}

	// ─── Agent Management ───────────────────────────────────────────────

	/** Get information about all active agent instances. */
	getActiveAgents(): AgentInfo[] {
		return getActiveAgentInfos(this.agents, this.plan.agents);
	}

	/** Get the real Agent instance for an orchestrator agent ID. */
	getRealAgent(agentId: string): OrchestratorRealAgent | undefined {
		return this.realAgents.get(agentId);
	}

	/** Scale the number of agent instances for a slot. */
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

	// ─── Results ────────────────────────────────────────────────────────

	/** Get a snapshot of all completed task results. */
	getResults(): Map<string, TaskResult> { return new Map(this.results); }

	/** Get orchestrator statistics including task counts, cost, and throughput. */
	getStats(): OrchestratorStats {
		return computeOrchestratorStats(
			this.tasks, this.agents,
			this.metrics.totalCost, this.metrics.totalTokens, this.metrics.completionTimes,
		);
	}

	// ─── Completion & Failure ───────────────────────────────────────────

	/** Handle successful completion of a task. */
	handleCompletion(taskId: string, result: TaskResult): void {
		handleOrchestratorCompletion(
			taskId, result, this.tasks, this.results,
			this.metrics, this.swarmContexts, this.plan.id,
			{
				emit: (evt) => this.emit(evt),
				freeAgent: (id) => this.freeAgent(id),
				cancel: (id) => this.cancel(id),
				processQueue: () => this.processQueue(),
			},
		);
	}

	/** Handle task failure with retry, fallback, and plan-level failure checks. */
	handleFailure(taskId: string, error: Error): void {
		handleOrchestratorFailure(
			taskId, error, this.tasks, this.results, this.retryCount,
			{ id: this.plan.id, fallback: this.plan.fallback, coordination: this.plan.coordination },
			this.running,
			{
				emit: (evt) => this.emit(evt),
				freeAgent: (id) => this.freeAgent(id),
				enqueue: (t) => this.enqueue(t),
				processQueue: () => this.processQueue(),
				stop: () => { this.stop(); },
			},
		);
	}

	// ─── Internal: Routing & Assignment ─────────────────────────────────

	private route(task: OrchestratorTask): string {
		switch (this.plan.strategy) {
			case "round-robin":
				return roundRobinAssign(this.plan.agents, task, this.roundRobinCounter);
			case "least-loaded":
				return leastLoadedAssign(
					this.plan.agents,
					buildSlotStats(this.plan.agents, this.agents, this.slotAgents, this.slotQueues),
				);
			case "specialized":
				return specializedAssign(this.plan.agents, task);
			default:
				return this.router.route(task);
		}
	}

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

	// ─── Internal: Queue Processing ─────────────────────────────────────

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

	// ─── Internal: Helpers ──────────────────────────────────────────────

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
		if (this.agentConfig?.agentFactory) {
			const slot = this.plan.agents.find((s) => s.id === slotId);
			if (slot) {
				const maybeAgent = this.agentConfig.agentFactory(slotId, slot);
				if (maybeAgent && typeof (maybeAgent as Promise<unknown>).then === "function") {
					(maybeAgent as Promise<OrchestratorRealAgent | null>).then((a) => {
						if (a) {
							this.realAgents.set(agentId, a);
							log.debug("real agent created", { agentId, slotId });
						}
					}).catch((err) => {
						log.warn("agent factory failed", {
							agentId, slotId, error: err instanceof Error ? err.message : String(err),
						});
					});
				} else if (maybeAgent) {
					this.realAgents.set(agentId, maybeAgent as OrchestratorRealAgent);
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
					this.executeOnRealAgent(agent.id, nextTask);
				}
				break;
			}
		}
	}

	/** Execute a task on a real Agent instance if available. */
	private executeOnRealAgent(agentId: string, task: OrchestratorTask): void {
		const realAgent = this.realAgents.get(agentId);
		if (!realAgent || !this.agentConfig?.taskExecutor) return;
		this.agentConfig.taskExecutor(realAgent, task)
			.then((result) => this.handleCompletion(task.id, result))
			.catch((err) => this.handleFailure(task.id, err instanceof Error ? err : new Error(String(err))));
	}

	private emit(event: OrchestratorEvent): void {
		try { this.onEvent(event); } catch (err) {
			log.warn("Error in event handler", { error: err instanceof Error ? err.message : String(err) });
		}
	}
}
