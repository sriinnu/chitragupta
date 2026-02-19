/**
 * Kaala Brahma — Agent Tree Lifecycle Manager.
 *
 * "Kaala" (काल) means Time. Kaala Brahma is the time-lord of the agent
 * tree — monitoring heartbeats, detecting stale/stuck agents, allowing
 * ancestors to kill descendants, and auto-healing by pruning dead branches.
 *
 * Kill cascades follow the Shiva principle: bottom-up (leaves first,
 * then branches, then target) to prevent orphans. Resource budgets
 * decay exponentially with depth.
 *
 * Tree traversal, orphan handling, and health reporting live in
 * agent-kaala-health.ts — all pure functions on passed-in agent maps.
 */

import {
	SYSTEM_MAX_AGENT_DEPTH,
	SYSTEM_MAX_SUB_AGENTS,
	DEFAULT_MAX_AGENT_DEPTH,
	DEFAULT_MAX_SUB_AGENTS,
} from "./types.js";
import {
	isAncestor, getDescendantIds, getDirectChildIds,
	countByStatus, handleOrphans, buildTreeHealthReport,
	buildAgentHealthSnapshot,
} from "./agent-kaala-health.js";

// Re-export health utilities for consumers
export {
	isAncestor, getDescendantIds, getDirectChildIds,
	countByStatus, handleOrphans, buildTreeHealthReport,
	buildAgentHealthSnapshot,
} from "./agent-kaala-health.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Lifecycle status tracked by the heartbeat system. */
export type AgentLifecycleStatus =
	| "alive" | "stale" | "dead" | "killed" | "completed" | "error";

/** Callback when an agent's status changes. */
export type StatusChangeCallback = (
	agentId: string,
	oldStatus: AgentLifecycleStatus,
	newStatus: AgentLifecycleStatus,
	parentId: string | null,
) => void;

/** Heartbeat record registered and updated by each agent. */
export interface AgentHeartbeat {
	agentId: string;
	lastBeat: number;
	startedAt: number;
	turnCount: number;
	tokenUsage: number;
	status: AgentLifecycleStatus;
	parentId: string | null;
	depth: number;
	purpose: string;
	tokenBudget: number;
}

/** Configuration for the Kaala Brahma lifecycle manager. */
export interface KaalaConfig {
	heartbeatInterval: number;
	staleThreshold: number;
	deadThreshold: number;
	globalMaxAgents: number;
	budgetDecayFactor: number;
	rootTokenBudget: number;
	orphanPolicy: "cascade" | "reparent" | "promote";
	/** Maximum agent tree depth. Clamped to SYSTEM_MAX_AGENT_DEPTH (10). */
	maxAgentDepth: number;
	/** Maximum sub-agents per parent. Clamped to SYSTEM_MAX_SUB_AGENTS (16). */
	maxSubAgents: number;
	/** Minimum token budget a child must have to allow spawning. */
	minTokenBudgetForSpawn: number;
}

/** Result of a kill operation. */
export interface KillResult {
	success: boolean;
	killedIds: string[];
	cascadeCount: number;
	freedTokens: number;
	reason?: string;
}

/** Report from a tree-healing pass. */
export interface HealReport {
	reapedCount: number;
	reapedIds: string[];
	killedStaleCount: number;
	killedStaleIds: string[];
	orphansHandled: number;
	overBudgetKilled: number;
	timestamp: number;
}

/** Health snapshot of a single agent. */
export interface AgentHealthSnapshot {
	id: string;
	purpose: string;
	depth: number;
	parentId: string | null;
	status: AgentLifecycleStatus;
	age: number;
	lastBeatAge: number;
	turnCount: number;
	tokenUsage: number;
	tokenBudget: number;
	childCount: number;
	descendantCount: number;
}

/** Full health report for the entire agent tree. */
export interface TreeHealthReport {
	totalAgents: number;
	aliveAgents: number;
	staleAgents: number;
	deadAgents: number;
	maxDepth: number;
	oldestAgent: { id: string; age: number } | null;
	highestTokenUsage: { id: string; tokens: number } | null;
	agents: AgentHealthSnapshot[];
}

const DEFAULT_CONFIG: KaalaConfig = {
	heartbeatInterval: 5_000,
	staleThreshold: 30_000,
	deadThreshold: 120_000,
	globalMaxAgents: 16,
	budgetDecayFactor: 0.7,
	rootTokenBudget: 200_000,
	orphanPolicy: "cascade",
	maxAgentDepth: DEFAULT_MAX_AGENT_DEPTH,
	maxSubAgents: DEFAULT_MAX_SUB_AGENTS,
	minTokenBudgetForSpawn: 1000,
};

// ─── Kaala Brahma ───────────────────────────────────────────────────────────

/**
 * Kaala Brahma — time-lord of the agent tree.
 * Monitors heartbeats, detects stale/stuck agents, enforces budgets,
 * and provides kill/heal operations for lifecycle management.
 */
export class KaalaBrahma {
	private agents = new Map<string, AgentHeartbeat>();
	private config: KaalaConfig;
	private monitorTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;
	private statusChangeCallbacks: StatusChangeCallback[] = [];
	private stuckReasons = new Map<string, string>();

	constructor(config?: Partial<KaalaConfig>) {
		const merged = { ...DEFAULT_CONFIG, ...config };
		merged.maxAgentDepth = Math.min(merged.maxAgentDepth, SYSTEM_MAX_AGENT_DEPTH);
		merged.maxSubAgents = Math.min(merged.maxSubAgents, SYSTEM_MAX_SUB_AGENTS);
		this.config = merged;
	}

	/** Subscribe to status change notifications. Returns an unsubscribe function. */
	onStatusChange(cb: StatusChangeCallback): () => void {
		this.statusChangeCallbacks.push(cb);
		return () => {
			const idx = this.statusChangeCallbacks.indexOf(cb);
			if (idx >= 0) this.statusChangeCallbacks.splice(idx, 1);
		};
	}

	/** Set status and fire all registered callbacks. */
	private setStatus(agentId: string, newStatus: AgentLifecycleStatus): void {
		const a = this.agents.get(agentId);
		if (!a) return;
		const old = a.status;
		if (old === newStatus) return;
		a.status = newStatus;
		a.lastBeat = Date.now();
		for (const cb of this.statusChangeCallbacks) {
			try { cb(agentId, old, newStatus, a.parentId); } catch { /* swallow */ }
		}
	}

	/** A child agent reports itself as stuck. Sets status to "stale". */
	reportStuck(agentId: string, reason?: string): void {
		this.assertAlive();
		const a = this.agents.get(agentId);
		if (!a) return;
		if (reason) this.stuckReasons.set(agentId, reason);
		if (a.status === "alive") this.setStatus(agentId, "stale");
	}

	/** An ancestor heals a descendant, resetting it from stale/error to alive. */
	healAgent(healerId: string, targetId: string): { success: boolean; reason?: string } {
		this.assertAlive();
		if (!this.agents.has(healerId))
			return { success: false, reason: `Healer "${healerId}" not found.` };
		if (!this.agents.has(targetId))
			return { success: false, reason: `Target "${targetId}" not found.` };
		if (!isAncestor(this.agents, healerId, targetId))
			return { success: false, reason: `"${healerId}" is not an ancestor of "${targetId}".` };
		const target = this.agents.get(targetId)!;
		if (target.status !== "stale" && target.status !== "error")
			return { success: false, reason: `Cannot heal agent with status "${target.status}".` };
		this.setStatus(targetId, "alive");
		this.stuckReasons.delete(targetId);
		return { success: true };
	}

	/** Get the reason a child reported itself stuck, if any. */
	getStuckReason(agentId: string): string | undefined { return this.stuckReasons.get(agentId); }

	/** Register a new agent in the heartbeat system. */
	registerAgent(heartbeat: AgentHeartbeat): void {
		this.assertAlive();
		this.agents.set(heartbeat.agentId, { ...heartbeat });
	}

	/** Record a heartbeat, updating timestamp and optional partial data. */
	recordHeartbeat(agentId: string, data?: Partial<AgentHeartbeat>): void {
		this.assertAlive();
		const a = this.agents.get(agentId);
		if (!a) return;
		a.lastBeat = Date.now();
		if (data?.turnCount !== undefined) a.turnCount = data.turnCount;
		if (data?.tokenUsage !== undefined) a.tokenUsage = data.tokenUsage;
		if (data?.status !== undefined) a.status = data.status;
		if (a.status === "stale") a.status = "alive";
	}

	/** Mark an agent as naturally completed. */
	markCompleted(agentId: string): void {
		this.assertAlive();
		if (this.agents.has(agentId)) this.setStatus(agentId, "completed");
	}

	/** Mark an agent as errored/crashed. */
	markError(agentId: string): void {
		this.assertAlive();
		if (this.agents.has(agentId)) this.setStatus(agentId, "error");
	}

	/** Force-kill an agent and all descendants. Bottom-up cascade (leaves first). */
	killAgent(killerId: string, targetId: string): KillResult {
		this.assertAlive();
		const fail = (reason: string): KillResult =>
			({ success: false, killedIds: [], cascadeCount: 0, freedTokens: 0, reason });
		if (!this.agents.has(killerId)) return fail(`Killer "${killerId}" not found.`);
		if (!this.agents.has(targetId)) return fail(`Target "${targetId}" not found.`);
		if (!isAncestor(this.agents, killerId, targetId))
			return fail(`"${killerId}" is not an ancestor of "${targetId}".`);
		const target = this.agents.get(targetId)!;
		if (target.status === "killed" || target.status === "completed")
			return fail(`Agent "${targetId}" is already ${target.status}.`);

		const toKill = [...getDescendantIds(this.agents, targetId), targetId]
			.map((id) => this.agents.get(id))
			.filter((a): a is AgentHeartbeat =>
				a !== undefined && a.status !== "killed" && a.status !== "completed")
			.sort((a, b) => b.depth - a.depth);

		let freedTokens = 0;
		const killedIds: string[] = [];
		for (const a of toKill) {
			freedTokens += Math.max(0, a.tokenBudget - a.tokenUsage);
			this.setStatus(a.agentId, "killed");
			killedIds.push(a.agentId);
		}
		return { success: true, killedIds, cascadeCount: killedIds.length, freedTokens };
	}

	/** Check if an agent is allowed to spawn a sub-agent. */
	canSpawn(agentId: string): { allowed: boolean; reason?: string } {
		this.assertAlive();
		const a = this.agents.get(agentId);
		if (!a) return { allowed: false, reason: `Agent "${agentId}" not found.` };
		const effectiveMaxDepth = Math.min(this.config.maxAgentDepth, SYSTEM_MAX_AGENT_DEPTH);
		const effectiveMaxSubs = Math.min(this.config.maxSubAgents, SYSTEM_MAX_SUB_AGENTS);
		if (a.depth >= effectiveMaxDepth)
			return { allowed: false, reason: `At max depth (${effectiveMaxDepth}).` };
		if (getDirectChildIds(this.agents, agentId).length >= effectiveMaxSubs)
			return { allowed: false, reason: `Already has ${effectiveMaxSubs} sub-agents.` };
		if (a.status !== "alive")
			return { allowed: false, reason: `Status is "${a.status}"; only alive agents spawn.` };
		const active = countByStatus(this.agents, "alive") + countByStatus(this.agents, "stale");
		if (active >= this.config.globalMaxAgents)
			return { allowed: false, reason: `Global limit reached (${this.config.globalMaxAgents}).` };
		const childBudget = a.tokenBudget * this.config.budgetDecayFactor;
		if (childBudget < this.config.minTokenBudgetForSpawn)
			return { allowed: false, reason: `Insufficient budget for child (${Math.floor(childBudget)} tokens).` };
		return { allowed: true };
	}

	/** Compute the token budget for a new child of the given parent. */
	computeChildBudget(parentId: string): number {
		const p = this.agents.get(parentId);
		return p ? Math.floor(p.tokenBudget * this.config.budgetDecayFactor) : 0;
	}

	/** Heal the tree: detect stale, promote to dead, reap, handle orphans, kill over-budget. */
	healTree(): HealReport {
		this.assertAlive();
		const now = Date.now();
		const report: HealReport = {
			reapedCount: 0, reapedIds: [], killedStaleCount: 0,
			killedStaleIds: [], orphansHandled: 0, overBudgetKilled: 0, timestamp: now,
		};

		for (const a of this.agents.values()) {
			if (a.status === "alive" && now - a.lastBeat >= this.config.staleThreshold) a.status = "stale";
			if (a.status === "stale" && now - a.lastBeat >= this.config.deadThreshold) a.status = "dead";
		}

		const deadIds = [...this.agents.values()].filter((a) => a.status === "dead").map((a) => a.agentId);
		for (const deadId of deadIds) {
			const desc = getDescendantIds(this.agents, deadId)
				.map((id) => this.agents.get(id))
				.filter((a): a is AgentHeartbeat =>
					a !== undefined && a.status !== "killed" && a.status !== "completed")
				.sort((a, b) => b.depth - a.depth);
			for (const a of desc) {
				a.status = "killed"; a.lastBeat = now;
				report.killedStaleCount++; report.killedStaleIds.push(a.agentId);
			}
		}

		for (const a of [...this.agents.values()]) {
			if (a.status === "dead" || a.status === "killed") {
				this.agents.delete(a.agentId);
				report.reapedCount++; report.reapedIds.push(a.agentId);
			}
		}

		report.orphansHandled = handleOrphans(this.agents, this.config, now);
		for (const a of this.agents.values()) {
			if (a.status === "alive" && a.tokenUsage > a.tokenBudget) {
				a.status = "killed"; a.lastBeat = now; report.overBudgetKilled++;
			}
		}
		return report;
	}

	/** Get a full health snapshot of the entire agent tree. */
	getTreeHealth(): TreeHealthReport {
		this.assertAlive();
		return buildTreeHealthReport(this.agents, Date.now());
	}

	/** Get health snapshot of a single agent. */
	getAgentHealth(agentId: string): AgentHealthSnapshot | undefined {
		this.assertAlive();
		const hb = this.agents.get(agentId);
		if (!hb) return undefined;
		return buildAgentHealthSnapshot(this.agents, hb, Date.now());
	}

	/** Update configuration. Restarts monitoring if active. */
	setConfig(config: Partial<KaalaConfig>): void {
		this.assertAlive();
		const wasOn = this.monitorTimer !== null;
		if (wasOn) this.stopMonitoring();
		this.config = { ...this.config, ...config };
		this.config.maxAgentDepth = Math.min(this.config.maxAgentDepth, SYSTEM_MAX_AGENT_DEPTH);
		this.config.maxSubAgents = Math.min(this.config.maxSubAgents, SYSTEM_MAX_SUB_AGENTS);
		if (wasOn) this.startMonitoring();
	}

	/** Get a read-only copy of the current configuration. */
	getConfig(): Readonly<KaalaConfig> { return { ...this.config }; }

	/** Start periodic health checks (stale detection + auto-heal). */
	startMonitoring(): void {
		this.assertAlive();
		if (this.monitorTimer !== null) return;
		const tick = () => {
			if (this.disposed) return;
			const start = Date.now();
			this.healTree();
			const elapsed = Date.now() - start;
			const next = Math.max(0, this.config.heartbeatInterval - elapsed);
			this.monitorTimer = setTimeout(tick, next);
			if (typeof this.monitorTimer === "object" && "unref" in this.monitorTimer) this.monitorTimer.unref();
		};
		this.monitorTimer = setTimeout(tick, this.config.heartbeatInterval);
		if (typeof this.monitorTimer === "object" && "unref" in this.monitorTimer) this.monitorTimer.unref();
	}

	/** Stop periodic health checks. */
	stopMonitoring(): void {
		if (this.monitorTimer !== null) { clearTimeout(this.monitorTimer); this.monitorTimer = null; }
	}

	/** Dispose: stop monitoring, kill all agents, clear state. */
	dispose(): void {
		if (this.disposed) return;
		this.stopMonitoring();
		const now = Date.now();
		for (const a of this.agents.values()) {
			if (a.status === "alive" || a.status === "stale") { a.status = "killed"; a.lastBeat = now; }
		}
		this.agents.clear();
		this.statusChangeCallbacks.length = 0;
		this.stuckReasons.clear();
		this.disposed = true;
	}

	private assertAlive(): void {
		if (this.disposed) throw new Error("KaalaBrahma has been disposed.");
	}
}
