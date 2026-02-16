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
	TaskMetrics,
} from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Per-task outcome data recorded for performance tracking. */
export interface TaskPerformanceRecord {
	/** The task ID. */
	taskId: string;
	/** The strategy used for this task. */
	strategy: OrchestratorStrategy;
	/** Whether the task succeeded. */
	success: boolean;
	/** Computed reward in [0, 1]. */
	reward: number;
	/** Actual duration in milliseconds. */
	durationMs: number;
	/** Actual cost incurred. */
	cost: number;
	/** Expected duration used for speed bonus (ms). */
	expectedDurationMs: number;
	/** Budget cost used for cost bonus. */
	budgetCost: number;
	/** Timestamp when the outcome was recorded. */
	recordedAt: number;
}

/** Temporary strategy ban info. */
export interface StrategyBan {
	/** The banned strategy. */
	strategy: OrchestratorStrategy;
	/** Why the strategy was banned. */
	reason: string;
	/** When the ban was imposed (ms since epoch). */
	bannedAt: number;
	/** When the ban expires (ms since epoch). */
	expiresAt: number;
	/** Failure rate at the time of banning. */
	failureRate: number;
}

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

/** All strategies eligible for selection. */
const ALL_STRATEGIES: OrchestratorStrategy[] = [
	"round-robin", "least-loaded", "specialized",
	"hierarchical", "swarm", "competitive",
];

/** Keyword-to-complexity mappings for task analysis. */
const COMPLEXITY_KEYWORDS: Record<string, number> = {
	refactor: 0.8, rewrite: 0.9, migrate: 0.85, optimize: 0.7,
	test: 0.5, analyze: 0.6, fix: 0.4, bug: 0.4,
	review: 0.5, document: 0.3, format: 0.2, lint: 0.2,
	implement: 0.7, design: 0.8, architect: 0.9,
};

/** Priority-to-complexity weight. */
const PRIORITY_COMPLEXITY: Record<string, number> = {
	critical: 0.9, high: 0.7, normal: 0.5, low: 0.3, background: 0.1,
};

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
	private readonly performanceTracker: Map<string, TaskPerformanceRecord[]>;
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

		// Initialize performance tracker for all strategies
		for (const strategy of ALL_STRATEGIES) {
			this.performanceTracker.set(strategy, []);
		}
	}

	// ─── Strategy Selection ─────────────────────────────────────────────

	/**
	 * Select the best strategy for a task using the bandit.
	 * Builds context features from the task and current orchestrator state.
	 * Respects active bans, falling back to round-robin if all are banned.
	 *
	 * @param task - The task to select a strategy for.
	 * @param stats - Current orchestrator statistics.
	 * @returns The selected strategy.
	 */
	selectStrategy(task: OrchestratorTask, stats: OrchestratorStats): OrchestratorStrategy {
		this.pruneExpiredBans();

		const available = ALL_STRATEGIES.filter((s) => !this.bans.has(s));

		// If all strategies are banned, fall back to round-robin
		if (available.length === 0) {
			return "round-robin";
		}

		const context: BanditContext = {
			taskComplexity: this.estimateComplexity(task),
			agentCount: this.normalizeAgentCount(stats.activeAgents),
			memoryPressure: this.getMemoryPressure(),
			avgLatency: this.normalizeLatency(stats.averageLatency),
			errorRate: this.getRecentErrorRate(),
		};

		// Use the bandit to select, but filter to only available strategies.
		// If the bandit picks a banned strategy, keep re-selecting up to
		// 20 times, then fall back to the first available.
		for (let attempt = 0; attempt < 20; attempt++) {
			const selected = this.bandit.selectStrategy(context);
			if (available.includes(selected)) {
				return selected;
			}
		}

		// Bandit persistently picks banned strategies; fall back
		return available[0];
	}

	// ─── Outcome Recording ──────────────────────────────────────────────

	/**
	 * Record the outcome of a completed task. Computes reward, updates
	 * the bandit, tracks performance, and checks for strategy bans.
	 * Triggers auto-save if the interval is reached.
	 *
	 * @param task - The completed task.
	 * @param result - The task's result.
	 * @param strategy - The strategy that was used.
	 */
	recordOutcome(
		task: OrchestratorTask,
		result: TaskResult,
		strategy: OrchestratorStrategy,
	): void {
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

		// Build context for the bandit's LinUCB update
		const context: BanditContext = {
			taskComplexity: this.estimateComplexity(task),
			agentCount: 0.5, // normalized mid-point as a safe fallback
			memoryPressure: this.getMemoryPressure(),
			avgLatency: this.normalizeLatency(durationMs),
			errorRate: this.getRecentErrorRate(),
		};

		this.bandit.recordReward(strategy, reward, context);

		// Track performance
		const record: TaskPerformanceRecord = {
			taskId: task.id,
			strategy,
			success: result.success,
			reward,
			durationMs,
			cost,
			expectedDurationMs: expectedDuration,
			budgetCost,
			recordedAt: Date.now(),
		};

		const records = this.performanceTracker.get(strategy) ?? [];
		records.push(record);
		this.performanceTracker.set(strategy, records);

		// Check if strategy should be banned
		this.evaluateStrategyBan(strategy);

		// Auto-save
		this.tasksSinceLastSave++;
		if (
			this.config.autoSaveInterval > 0 &&
			this.config.autoSavePath &&
			this.tasksSinceLastSave >= this.config.autoSaveInterval
		) {
			this.tasksSinceLastSave = 0;
			this.saveState(this.config.autoSavePath).catch(() => {
				// Best-effort save; do not propagate errors
			});
		}
	}

	// ─── Reward Computation ─────────────────────────────────────────────

	/**
	 * Compute the reward for a task outcome.
	 *
	 * ```
	 * reward = successWeight * success
	 *        + speedWeight * max(0, 1 - actualTime/expectedTime)
	 *        + costWeight * max(0, 1 - actualCost/budgetCost)
	 * ```
	 *
	 * @param success - Whether the task succeeded.
	 * @param actualMs - Actual duration in ms.
	 * @param expectedMs - Expected duration in ms.
	 * @param actualCost - Actual cost incurred.
	 * @param budgetCost - Budget cost threshold.
	 * @returns Reward in [0, 1].
	 */
	computeReward(
		success: boolean,
		actualMs: number,
		expectedMs: number,
		actualCost: number,
		budgetCost: number,
	): number {
		const successComponent = success ? 1.0 : 0.0;
		const speedBonus = expectedMs > 0
			? Math.max(0, 1 - actualMs / expectedMs)
			: 0;
		const costBonus = budgetCost > 0
			? Math.max(0, 1 - actualCost / budgetCost)
			: 0;

		const raw =
			this.config.successWeight * successComponent +
			this.config.speedWeight * speedBonus +
			this.config.costWeight * costBonus;

		return Math.max(0, Math.min(1, raw));
	}

	// ─── Task Complexity Estimation ─────────────────────────────────────

	/**
	 * Estimate complexity of a task from its description, dependencies,
	 * priority, and keyword analysis.
	 *
	 * Components (each normalized to [0, 1]):
	 * - Description length (longer = more complex)
	 * - Dependency count
	 * - Priority weight
	 * - Keyword-based complexity
	 *
	 * @param task - The task to analyze.
	 * @returns Estimated complexity in [0, 1].
	 */
	estimateComplexity(task: OrchestratorTask): number {
		// Description length component (0 → 0, 500+ chars → 1)
		const descLength = Math.min(1, (task.description?.length ?? 0) / 500);

		// Dependency count component (0 → 0, 5+ deps → 1)
		const depCount = Math.min(1, (task.dependencies?.length ?? 0) / 5);

		// Priority weight
		const priorityWeight = PRIORITY_COMPLEXITY[task.priority] ?? 0.5;

		// Keyword analysis: scan description for known complexity keywords
		const descLower = (task.description ?? "").toLowerCase();
		let keywordScore = 0;
		let keywordMatches = 0;
		for (const [keyword, weight] of Object.entries(COMPLEXITY_KEYWORDS)) {
			if (descLower.includes(keyword)) {
				keywordScore += weight;
				keywordMatches++;
			}
		}
		const keywordComponent = keywordMatches > 0
			? keywordScore / keywordMatches
			: 0.5;

		// Weighted combination
		const complexity =
			0.25 * descLength +
			0.20 * depCount +
			0.25 * priorityWeight +
			0.30 * keywordComponent;

		return Math.max(0, Math.min(1, complexity));
	}

	// ─── Strategy Ban Management ────────────────────────────────────────

	/**
	 * Get all currently active strategy bans.
	 *
	 * @returns Array of active bans (expired bans are pruned first).
	 */
	getActiveBans(): StrategyBan[] {
		this.pruneExpiredBans();
		return [...this.bans.values()];
	}

	/**
	 * Manually lift a strategy ban.
	 *
	 * @param strategy - The strategy to unban.
	 * @returns `true` if a ban was removed, `false` if not banned.
	 */
	unbanStrategy(strategy: OrchestratorStrategy): boolean {
		return this.bans.delete(strategy);
	}

	// ─── Performance History ────────────────────────────────────────────

	/**
	 * Get performance records for a specific strategy.
	 *
	 * @param strategy - The strategy to query.
	 * @returns Array of performance records, or empty if no data.
	 */
	getPerformanceHistory(strategy: OrchestratorStrategy): TaskPerformanceRecord[] {
		return [...(this.performanceTracker.get(strategy) ?? [])];
	}

	/**
	 * Get the bandit's per-strategy statistics.
	 */
	getBanditStats() {
		return this.bandit.getStats();
	}

	// ─── Persistence ────────────────────────────────────────────────────

	/**
	 * Serialize bandit state and performance history to a JSON file.
	 *
	 * @param path - File path to write.
	 */
	async saveState(path: string): Promise<void> {
		const state: PersistedState = {
			banditState: this.bandit.serialize(),
			performanceHistory: this.getAllPerformanceRecords(),
			bans: [...this.bans.values()],
			savedAt: Date.now(),
		};

		const json = JSON.stringify(state, null, "\t");
		const dir = dirname(path);
		await mkdir(dir, { recursive: true });
		await writeFile(path, json, "utf-8");
	}

	/**
	 * Restore bandit state and performance history from a saved JSON file.
	 * Warm-starts the bandit so it does not need to re-explore.
	 *
	 * @param path - File path to read.
	 */
	async loadState(path: string): Promise<void> {
		let raw: string;
		try {
			raw = await readFile(path, "utf-8");
		} catch {
			// File does not exist — start fresh
			return;
		}

		let state: PersistedState;
		try {
			state = JSON.parse(raw) as PersistedState;
		} catch {
			return; // Corrupted state file — start fresh
		}

		// Restore bandit state
		if (state.banditState) {
			this.bandit.deserialize(state.banditState);
		}

		// Restore performance history
		if (state.performanceHistory) {
			// Clear existing records
			for (const strategy of ALL_STRATEGIES) {
				this.performanceTracker.set(strategy, []);
			}
			for (const record of state.performanceHistory) {
				const records = this.performanceTracker.get(record.strategy) ?? [];
				records.push(record);
				this.performanceTracker.set(record.strategy, records);
			}
		}

		// Restore bans that haven't expired
		if (state.bans) {
			const now = Date.now();
			for (const ban of state.bans) {
				if (ban.expiresAt > now) {
					this.bans.set(ban.strategy, ban);
				}
			}
		}
	}

	// ─── Internal: Error Rate ───────────────────────────────────────────

	/**
	 * Compute the recent error rate across all strategies.
	 * Considers the last 50 records globally.
	 */
	private getRecentErrorRate(): number {
		const allRecords = this.getAllPerformanceRecords();
		if (allRecords.length === 0) return 0;

		// Take the last 50 records
		const recent = allRecords
			.sort((a, b) => b.recordedAt - a.recordedAt)
			.slice(0, 50);

		const failures = recent.filter((r) => !r.success).length;
		return failures / recent.length;
	}

	/**
	 * Normalize active agent count to [0, 1].
	 * Assumes a practical maximum of 20 agents.
	 */
	private normalizeAgentCount(count: number): number {
		return Math.min(1, count / 20);
	}

	/**
	 * Normalize latency to [0, 1].
	 * Uses a sigmoid-like mapping: 60s → ~0.86, 120s → ~0.95.
	 */
	private normalizeLatency(latencyMs: number): number {
		// Logistic: 1 / (1 + e^(-k*(x-mid)))
		// k=0.05, mid=30000 (30 seconds)
		const k = 0.00005;
		const mid = 30_000;
		return 1 / (1 + Math.exp(-k * (latencyMs - mid)));
	}

	/**
	 * Estimate current memory pressure using heap usage.
	 * Falls back to 0.5 if process.memoryUsage is unavailable.
	 */
	private getMemoryPressure(): number {
		try {
			const usage = process.memoryUsage();
			// Ratio of heap used to heap total
			return usage.heapUsed / usage.heapTotal;
		} catch {
			return 0.5;
		}
	}

	// ─── Internal: Strategy Ban Evaluation ──────────────────────────────

	/**
	 * Evaluate whether a strategy should be banned based on recent
	 * failure rate. A strategy is banned if it exceeds the failure
	 * threshold over the last `banMinTasks` outcomes.
	 */
	private evaluateStrategyBan(strategy: OrchestratorStrategy): void {
		// Don't re-ban an already banned strategy
		if (this.bans.has(strategy)) return;

		const records = this.performanceTracker.get(strategy) ?? [];
		if (records.length < this.config.banMinTasks) return;

		// Consider only the most recent banMinTasks records
		const recent = records.slice(-this.config.banMinTasks);
		const failures = recent.filter((r) => !r.success).length;
		const failureRate = failures / recent.length;

		if (failureRate > this.config.banFailureThreshold) {
			const now = Date.now();
			this.bans.set(strategy, {
				strategy,
				reason: `Failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold ${(this.config.banFailureThreshold * 100).toFixed(1)}%`,
				bannedAt: now,
				expiresAt: now + this.config.banDurationMs,
				failureRate,
			});
		}
	}

	/**
	 * Remove expired bans.
	 */
	private pruneExpiredBans(): void {
		const now = Date.now();
		for (const [strategy, ban] of this.bans) {
			if (ban.expiresAt <= now) {
				this.bans.delete(strategy);
			}
		}
	}

	/**
	 * Get all performance records across all strategies, sorted by time.
	 */
	private getAllPerformanceRecords(): TaskPerformanceRecord[] {
		const all: TaskPerformanceRecord[] = [];
		for (const records of this.performanceTracker.values()) {
			all.push(...records);
		}
		return all.sort((a, b) => a.recordedAt - b.recordedAt);
	}
}
