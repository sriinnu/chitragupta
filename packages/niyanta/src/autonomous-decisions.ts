/**
 * Autonomous decision helpers — pure functions for strategy evaluation.
 *
 * Sanskrit: Nirnaya (निर्णय) = decision, determination.
 *
 * Extracted from AutonomousOrchestrator. All functions are stateless;
 * the orchestrator passes required state as arguments.
 */

import type { OrchestratorStrategy, OrchestratorTask } from "./types.js";

// ─── Moved Types ────────────────────────────────────────────────────────────

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

// ─── Constants ──────────────────────────────────────────────────────────────

/** All strategies eligible for bandit selection. */
export const ALL_STRATEGIES: OrchestratorStrategy[] = [
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

// ─── Helper Interfaces ──────────────────────────────────────────────────────

/** Weights for the reward formula. */
export interface RewardWeights {
	successWeight: number;
	speedWeight: number;
	costWeight: number;
}

/** Ban evaluation configuration thresholds. */
export interface BanConfig {
	banFailureThreshold: number;
	banMinTasks: number;
	banDurationMs: number;
}

// ─── Reward Computation ─────────────────────────────────────────────────────

/**
 * Compute the reward for a task outcome.
 *
 * ```
 * reward = successWeight * success
 *        + speedWeight  * max(0, 1 - actualTime/expectedTime)
 *        + costWeight   * max(0, 1 - actualCost/budgetCost)
 * ```
 *
 * @returns Reward clamped to [0, 1].
 */
export function computeReward(
	weights: RewardWeights,
	success: boolean,
	actualMs: number,
	expectedMs: number,
	actualCost: number,
	budgetCost: number,
): number {
	const successComponent = success ? 1.0 : 0.0;
	const speedBonus = expectedMs > 0 ? Math.max(0, 1 - actualMs / expectedMs) : 0;
	const costBonus = budgetCost > 0 ? Math.max(0, 1 - actualCost / budgetCost) : 0;

	const raw =
		weights.successWeight * successComponent +
		weights.speedWeight * speedBonus +
		weights.costWeight * costBonus;

	return Math.max(0, Math.min(1, raw));
}

// ─── Task Complexity Estimation ─────────────────────────────────────────────

/**
 * Estimate complexity of a task from description, dependencies, priority, and keywords.
 *
 * @returns Estimated complexity in [0, 1].
 */
export function estimateComplexity(task: OrchestratorTask): number {
	const descLength = Math.min(1, (task.description?.length ?? 0) / 500);
	const depCount = Math.min(1, (task.dependencies?.length ?? 0) / 5);
	const priorityWeight = PRIORITY_COMPLEXITY[task.priority] ?? 0.5;

	const descLower = (task.description ?? "").toLowerCase();
	let keywordScore = 0;
	let keywordMatches = 0;
	for (const [keyword, weight] of Object.entries(COMPLEXITY_KEYWORDS)) {
		if (descLower.includes(keyword)) {
			keywordScore += weight;
			keywordMatches++;
		}
	}
	const keywordComponent = keywordMatches > 0 ? keywordScore / keywordMatches : 0.5;

	const complexity =
		0.25 * descLength +
		0.20 * depCount +
		0.25 * priorityWeight +
		0.30 * keywordComponent;

	return Math.max(0, Math.min(1, complexity));
}

// ─── Normalization Helpers ──────────────────────────────────────────────────

/** Normalize active agent count to [0, 1]. Assumes max 20 agents. */
export function normalizeAgentCount(count: number): number {
	return Math.min(1, count / 20);
}

/** Normalize latency to [0, 1] using logistic mapping. 60s ~ 0.86, 120s ~ 0.95. */
export function normalizeLatency(latencyMs: number): number {
	const k = 0.00005;
	const mid = 30_000;
	return 1 / (1 + Math.exp(-k * (latencyMs - mid)));
}

/** Estimate current memory pressure from heap usage. Falls back to 0.5. */
export function getMemoryPressure(): number {
	try {
		const usage = process.memoryUsage();
		return usage.heapUsed / usage.heapTotal;
	} catch {
		return 0.5;
	}
}

// ─── Error Rate ─────────────────────────────────────────────────────────────

/** Compute recent error rate from the last 50 records across all strategies. */
export function getRecentErrorRate(allRecords: TaskPerformanceRecord[]): number {
	if (allRecords.length === 0) return 0;
	const recent = [...allRecords].sort((a, b) => b.recordedAt - a.recordedAt).slice(0, 50);
	const failures = recent.filter((r) => !r.success).length;
	return failures / recent.length;
}

// ─── Strategy Ban Evaluation ────────────────────────────────────────────────

/**
 * Evaluate whether a strategy should be banned based on recent failure rate.
 * Mutates the bans map if a ban is imposed.
 */
export function evaluateStrategyBan(
	strategy: OrchestratorStrategy,
	records: TaskPerformanceRecord[],
	config: BanConfig,
	bans: Map<OrchestratorStrategy, StrategyBan>,
): void {
	if (bans.has(strategy)) return;
	if (records.length < config.banMinTasks) return;

	const recent = records.slice(-config.banMinTasks);
	const failures = recent.filter((r) => !r.success).length;
	const failureRate = failures / recent.length;

	if (failureRate > config.banFailureThreshold) {
		const now = Date.now();
		bans.set(strategy, {
			strategy,
			reason: `Failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold ${(config.banFailureThreshold * 100).toFixed(1)}%`,
			bannedAt: now,
			expiresAt: now + config.banDurationMs,
			failureRate,
		});
	}
}

/** Remove expired bans from the map. */
export function pruneExpiredBans(bans: Map<OrchestratorStrategy, StrategyBan>): void {
	const now = Date.now();
	for (const [strategy, ban] of bans) {
		if (ban.expiresAt <= now) {
			bans.delete(strategy);
		}
	}
}

// ─── Performance Records ────────────────────────────────────────────────────

/** Collect all performance records from the tracker, sorted by time. */
export function getAllPerformanceRecords(
	tracker: Map<OrchestratorStrategy, TaskPerformanceRecord[]>,
): TaskPerformanceRecord[] {
	const all: TaskPerformanceRecord[] = [];
	for (const records of tracker.values()) {
		all.push(...records);
	}
	return all.sort((a, b) => a.recordedAt - b.recordedAt);
}
