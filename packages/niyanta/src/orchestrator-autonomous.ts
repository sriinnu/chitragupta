/**
 * @chitragupta/niyanta — Autonomous Orchestrator.
 *
 * Wires the StrategyBandit into the orchestrator for autonomous strategy
 * selection. The orchestrator learns which strategies work best through
 * bandit feedback, self-heals by retrying with different strategies on
 * failure, and persists its learned state across sessions.
 *
 * Key features:
 * - Bandit-driven strategy selection with contextual features
 * - Reward computation from task success, speed, and cost
 * - Automatic strategy banning on persistent failure
 * - Performance state persistence (save/load)
 * - Auto-save after configurable task intervals
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { StrategyBandit } from "./strategy-bandit.js";
import type { BanditContext, BanditMode, StrategyBanditState } from "./strategy-bandit.js";
import type {
	OrchestratorStrategy,
	OrchestratorTask,
	OrchestratorStats,
	TaskResult,
} from "./types.js";
import {
	ALL_STRATEGIES,
	computeReward as computeRewardFn,
	estimateComplexity as estimateComplexityFn,
	normalizeAgentCount,
	normalizeLatency,
	getMemoryPressure,
	getRecentErrorRate,
	evaluateStrategyBan as evaluateBan,
	pruneExpiredBans,
	getAllPerformanceRecords,
} from "./autonomous-decisions.js";
import type {
	TaskPerformanceRecord,
	StrategyBan,
	RewardWeights,
	BanConfig,
} from "./autonomous-decisions.js";

// Re-export types that were moved to autonomous-decisions.ts
export type {
	TaskPerformanceRecord, StrategyBan, RewardWeights, BanConfig,
} from "./autonomous-decisions.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the autonomous orchestrator. */
export interface AutonomousOrchestratorConfig {
	/** Bandit selection mode (default: "thompson"). */
	banditMode?: BanditMode;
	/** Reward weight for task success (default: 0.5). */
	successWeight?: number;
	/** Reward weight for speed bonus (default: 0.3). */
	speedWeight?: number;
	/** Reward weight for cost bonus (default: 0.2). */
	costWeight?: number;
	/** Default expected duration for tasks without deadline (ms, default: 30000). */
	defaultExpectedDurationMs?: number;
	/** Default budget cost for tasks without explicit budget (default: 0.10). */
	defaultBudgetCost?: number;
	/** Failure rate threshold to trigger strategy ban (default: 0.5). */
	banFailureThreshold?: number;
	/** Minimum tasks before ban evaluation (default: 10). */
	banMinTasks?: number;
	/** Strategy ban duration in ms (default: 300000 = 5 minutes). */
	banDurationMs?: number;
	/** Auto-save every N tasks (default: 10). 0 disables auto-save. */
	autoSaveInterval?: number;
	/** File path for auto-save persistence. */
	autoSavePath?: string;
}

/** Serializable state for persistence. */
interface PersistedState {
	banditState: StrategyBanditState;
	performanceHistory: TaskPerformanceRecord[];
	bans: StrategyBan[];
	savedAt: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_SUCCESS_WEIGHT = 0.5;
const DEFAULT_SPEED_WEIGHT = 0.3;
const DEFAULT_COST_WEIGHT = 0.2;
const DEFAULT_EXPECTED_DURATION_MS = 30_000;
const DEFAULT_BUDGET_COST = 0.10;
const DEFAULT_BAN_FAILURE_THRESHOLD = 0.5;
const DEFAULT_BAN_MIN_TASKS = 10;
const DEFAULT_BAN_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_AUTO_SAVE_INTERVAL = 10;

// ─── Autonomous Orchestrator ────────────────────────────────────────────────

/**
 * Autonomous orchestrator that uses a multi-armed bandit to learn which
 * strategies perform best. Tracks per-task outcomes, computes rewards
 * from success/speed/cost, bans consistently failing strategies, and
 * persists learned state to disk.
 *
 * @example
 * ```ts
 * const auto = new AutonomousOrchestrator({ banditMode: "linucb" });
 * await auto.loadState("./bandit-state.json");
 *
 * const strategy = auto.selectStrategy(task, stats);
 * // ... execute task with the selected strategy ...
 * auto.recordOutcome(task, result, strategy);
 * ```
 */
export class AutonomousOrchestrator {
	private readonly bandit: StrategyBandit;
	private readonly performanceTracker: Map<OrchestratorStrategy, TaskPerformanceRecord[]>;
	private readonly bans: Map<OrchestratorStrategy, StrategyBan>;
	private readonly config: Required<AutonomousOrchestratorConfig>;
	private tasksSinceLastSave = 0;

	constructor(config?: AutonomousOrchestratorConfig) {
		this.bandit = new StrategyBandit();
		this.performanceTracker = new Map();
		this.bans = new Map();

		this.config = {
			banditMode: config?.banditMode ?? "thompson",
			successWeight: config?.successWeight ?? DEFAULT_SUCCESS_WEIGHT,
			speedWeight: config?.speedWeight ?? DEFAULT_SPEED_WEIGHT,
			costWeight: config?.costWeight ?? DEFAULT_COST_WEIGHT,
			defaultExpectedDurationMs: config?.defaultExpectedDurationMs ?? DEFAULT_EXPECTED_DURATION_MS,
			defaultBudgetCost: config?.defaultBudgetCost ?? DEFAULT_BUDGET_COST,
			banFailureThreshold: config?.banFailureThreshold ?? DEFAULT_BAN_FAILURE_THRESHOLD,
			banMinTasks: config?.banMinTasks ?? DEFAULT_BAN_MIN_TASKS,
			banDurationMs: config?.banDurationMs ?? DEFAULT_BAN_DURATION_MS,
			autoSaveInterval: config?.autoSaveInterval ?? DEFAULT_AUTO_SAVE_INTERVAL,
			autoSavePath: config?.autoSavePath ?? "",
		};

		this.bandit.setMode(this.config.banditMode);

		for (const strategy of ALL_STRATEGIES) {
			this.performanceTracker.set(strategy, []);
		}
	}

	// ─── Strategy Selection ─────────────────────────────────────────────

	/**
	 * Select the best strategy for a task using the bandit.
	 * Respects active bans, falling back to round-robin if all are banned.
	 */
	selectStrategy(task: OrchestratorTask, stats: OrchestratorStats): OrchestratorStrategy {
		pruneExpiredBans(this.bans);
		const available = ALL_STRATEGIES.filter((s) => !this.bans.has(s));
		if (available.length === 0) return "round-robin";

		const context: BanditContext = {
			taskComplexity: this.estimateComplexity(task),
			agentCount: normalizeAgentCount(stats.activeAgents),
			memoryPressure: getMemoryPressure(),
			avgLatency: normalizeLatency(stats.averageLatency),
			errorRate: getRecentErrorRate(getAllPerformanceRecords(this.performanceTracker)),
		};

		for (let attempt = 0; attempt < 20; attempt++) {
			const selected = this.bandit.selectStrategy(context);
			if (available.includes(selected)) return selected;
		}
		return available[0];
	}

	// ─── Outcome Recording ──────────────────────────────────────────────

	/**
	 * Record the outcome of a completed task. Computes reward, updates
	 * the bandit, tracks performance, and checks for strategy bans.
	 */
	recordOutcome(task: OrchestratorTask, result: TaskResult, strategy: OrchestratorStrategy): void {
		const metrics = result.metrics;
		const durationMs = metrics
			? (metrics.endTime - metrics.startTime)
			: this.config.defaultExpectedDurationMs;
		const cost = metrics?.cost ?? 0;

		const expectedDuration = task.deadline
			? (task.deadline - (metrics?.startTime ?? Date.now()))
			: this.config.defaultExpectedDurationMs;
		const budgetCost = this.config.defaultBudgetCost;

		const reward = this.computeReward(result.success, durationMs, expectedDuration, cost, budgetCost);

		const context: BanditContext = {
			taskComplexity: this.estimateComplexity(task),
			agentCount: 0.5,
			memoryPressure: getMemoryPressure(),
			avgLatency: normalizeLatency(durationMs),
			errorRate: getRecentErrorRate(getAllPerformanceRecords(this.performanceTracker)),
		};

		this.bandit.recordReward(strategy, reward, context);

		const record: TaskPerformanceRecord = {
			taskId: task.id, strategy, success: result.success, reward,
			durationMs, cost, expectedDurationMs: expectedDuration,
			budgetCost, recordedAt: Date.now(),
		};

		const records = this.performanceTracker.get(strategy) ?? [];
		records.push(record);
		this.performanceTracker.set(strategy, records);

		evaluateBan(strategy, records, this.banConfig, this.bans);

		this.tasksSinceLastSave++;
		if (
			this.config.autoSaveInterval > 0 &&
			this.config.autoSavePath &&
			this.tasksSinceLastSave >= this.config.autoSaveInterval
		) {
			this.tasksSinceLastSave = 0;
			this.saveState(this.config.autoSavePath).catch(() => {});
		}
	}

	// ─── Delegated Computations ─────────────────────────────────────────

	/** @see computeReward in autonomous-decisions.ts */
	computeReward(
		success: boolean, actualMs: number, expectedMs: number,
		actualCost: number, budgetCost: number,
	): number {
		return computeRewardFn(this.rewardWeights, success, actualMs, expectedMs, actualCost, budgetCost);
	}

	/** @see estimateComplexity in autonomous-decisions.ts */
	estimateComplexity(task: OrchestratorTask): number {
		return estimateComplexityFn(task);
	}

	// ─── Strategy Ban Management ────────────────────────────────────────

	/** Get all currently active strategy bans. */
	getActiveBans(): StrategyBan[] {
		pruneExpiredBans(this.bans);
		return [...this.bans.values()];
	}

	/** Manually lift a strategy ban. Returns `true` if a ban was removed. */
	unbanStrategy(strategy: OrchestratorStrategy): boolean {
		return this.bans.delete(strategy);
	}

	// ─── Performance History ────────────────────────────────────────────

	/** Get performance records for a specific strategy. */
	getPerformanceHistory(strategy: OrchestratorStrategy): TaskPerformanceRecord[] {
		return [...(this.performanceTracker.get(strategy) ?? [])];
	}

	/** Get the bandit's per-strategy statistics. */
	getBanditStats() {
		return this.bandit.getStats();
	}

	// ─── Persistence ────────────────────────────────────────────────────

	/** Serialize bandit state and performance history to a JSON file. */
	async saveState(path: string): Promise<void> {
		const state: PersistedState = {
			banditState: this.bandit.serialize(),
			performanceHistory: getAllPerformanceRecords(this.performanceTracker),
			bans: [...this.bans.values()],
			savedAt: Date.now(),
		};

		const json = JSON.stringify(state, null, "\t");
		const dir = dirname(path);
		await mkdir(dir, { recursive: true });
		await writeFile(path, json, "utf-8");
	}

	/** Restore bandit state and performance history from a saved JSON file. */
	async loadState(path: string): Promise<void> {
		let raw: string;
		try {
			raw = await readFile(path, "utf-8");
		} catch {
			return;
		}

		let state: PersistedState;
		try {
			state = JSON.parse(raw) as PersistedState;
		} catch {
			return;
		}

		if (state.banditState) {
			this.bandit.deserialize(state.banditState);
		}

		if (state.performanceHistory) {
			for (const strategy of ALL_STRATEGIES) {
				this.performanceTracker.set(strategy, []);
			}
			for (const record of state.performanceHistory) {
				const records = this.performanceTracker.get(record.strategy) ?? [];
				records.push(record);
				this.performanceTracker.set(record.strategy, records);
			}
		}

		if (state.bans) {
			const now = Date.now();
			for (const ban of state.bans) {
				if (ban.expiresAt > now) {
					this.bans.set(ban.strategy, ban);
				}
			}
		}
	}

	// ─── Internal Accessors ─────────────────────────────────────────────

	/** Reward weights derived from config. */
	private get rewardWeights(): RewardWeights {
		return {
			successWeight: this.config.successWeight,
			speedWeight: this.config.speedWeight,
			costWeight: this.config.costWeight,
		};
	}

	/** Ban config thresholds derived from config. */
	private get banConfig(): BanConfig {
		return {
			banFailureThreshold: this.config.banFailureThreshold,
			banMinTasks: this.config.banMinTasks,
			banDurationMs: this.config.banDurationMs,
		};
	}
}
