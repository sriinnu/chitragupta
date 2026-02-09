/**
 * @chitragupta/anina/lokapala — Gati — गति — Performance Guardian.
 *
 * Speed and Motion. Monitors resource consumption and execution patterns
 * for anomalies: token burn spikes, latency outliers, infinite loop
 * indicators, memory growth, and context window exhaustion.
 *
 * Like Vayu (wind god) who governs the northwest, Gati watches for
 * velocities that deviate from the norm -- too fast (runaway loops),
 * too slow (latency spikes), or too heavy (token burn).
 *
 * ## Detection Categories
 *
 * | Category             | Severity | Trigger                            |
 * |----------------------|----------|------------------------------------|
 * | Token burn spike     | warning  | > 2x rolling EMA                   |
 * | Latency spike        | warning  | > 2x rolling EMA for that tool     |
 * | Repeated tool call   | warning  | Same tool + same args 3+ times     |
 * | Context overflow     | critical | > 90% context window used          |
 * | Context high usage   | warning  | > 75% context window used          |
 * | Memory growth        | info     | RSS growth > 50% from baseline     |
 *
 * ## Baselines
 *
 * All thresholds are adaptive: baselines are computed via exponential
 * moving average (EMA) with a configurable smoothing factor (alpha).
 *
 * @packageDocumentation
 */

import type {
	Finding,
	GuardianConfig,
	GuardianStats,
	PerformanceMetrics,
} from "./types.js";
import { fnv1a, resolveConfig, FindingRing } from "./types.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** EMA smoothing factor (0 = ignore new data, 1 = ignore history). */
const DEFAULT_EMA_ALPHA = 0.2;

/** Multiplier over EMA baseline to trigger a spike finding. */
const SPIKE_MULTIPLIER = 2.0;

/** Context usage percentage threshold for warning. */
const CONTEXT_WARN_PCT = 75;

/** Context usage percentage threshold for critical. */
const CONTEXT_CRITICAL_PCT = 90;

/** Minimum observations before baselines are reliable. */
const MIN_OBSERVATIONS = 3;

/** Number of repeated identical calls before flagging. */
const REPEAT_THRESHOLD = 3;

/** Memory RSS growth ratio (1.5 = 50% growth) for info finding. */
const MEMORY_GROWTH_RATIO = 1.5;

// ─── EMA Tracker ────────────────────────────────────────────────────────────

/**
 * Exponential Moving Average tracker.
 *
 * Maintains a running average with configurable smoothing factor.
 * Returns `undefined` until at least one observation is recorded.
 */
class EmaTracker {
	private value: number | undefined;
	private observations: number = 0;

	constructor(private readonly alpha: number = DEFAULT_EMA_ALPHA) {}

	/** Update the EMA with a new data point. Returns the new average. */
	update(x: number): number {
		if (this.value === undefined) {
			this.value = x;
		} else {
			this.value = this.alpha * x + (1 - this.alpha) * this.value;
		}
		this.observations++;
		return this.value;
	}

	/** Get the current EMA value. */
	get current(): number | undefined {
		return this.value;
	}

	/** Number of observations recorded. */
	get count(): number {
		return this.observations;
	}

	/** Whether the tracker has enough data for reliable comparisons. */
	get reliable(): boolean {
		return this.observations >= MIN_OBSERVATIONS;
	}
}

// ─── Repeated Call Tracker ──────────────────────────────────────────────────

/**
 * Tracks consecutive identical tool calls.
 *
 * A "repeat" is defined as the same tool name with the same serialized
 * arguments. Resets when a different call is observed.
 */
class RepeatTracker {
	private lastKey: string = "";
	private consecutiveCount: number = 0;

	/**
	 * Record a tool call. Returns the new consecutive count for this key.
	 */
	record(toolName: string, args: Record<string, unknown>): number {
		const key = `${toolName}:${JSON.stringify(args)}`;
		if (key === this.lastKey) {
			this.consecutiveCount++;
		} else {
			this.lastKey = key;
			this.consecutiveCount = 1;
		}
		return this.consecutiveCount;
	}

	/** Reset the tracker. */
	reset(): void {
		this.lastKey = "";
		this.consecutiveCount = 0;
	}
}

// ─── Gati ───────────────────────────────────────────────────────────────────

/**
 * Performance Guardian -- monitors token consumption, tool latency,
 * execution patterns, context usage, and memory growth for anomalies.
 *
 * Uses exponential moving averages for adaptive baselines, so spike
 * detection adjusts to the natural rhythm of each session.
 */
export class Gati {
	private readonly config: GuardianConfig;
	private readonly findings: FindingRing;
	private readonly tokenEma: EmaTracker;
	private readonly toolLatencyEmas: Map<string, EmaTracker> = new Map();
	private readonly repeatTracker: RepeatTracker = new RepeatTracker();
	private scansCompleted: number = 0;
	private autoFixesApplied: number = 0;
	private lastScanAt: number = 0;
	private totalScanDurationMs: number = 0;
	private baselineRss: number | undefined;
	private contextWarnEmitted: boolean = false;
	private contextCriticalEmitted: boolean = false;
	private findingsBySeverity: Record<string, number> = {
		info: 0,
		warning: 0,
		critical: 0,
	};

	constructor(config?: Partial<GuardianConfig>) {
		this.config = resolveConfig(config);
		this.findings = new FindingRing(this.config.maxFindings);
		this.tokenEma = new EmaTracker(DEFAULT_EMA_ALPHA);
	}

	/**
	 * Observe performance metrics and return any anomalies detected.
	 *
	 * Should be called once per turn (or per tool execution) with
	 * the relevant metrics. Builds adaptive baselines via EMA and
	 * flags deviations.
	 */
	observe(metrics: PerformanceMetrics): Finding[] {
		if (!this.config.enabled) return [];

		const startMs = Date.now();
		const newFindings: Finding[] = [];

		// ── Token burn rate ──────────────────────────────────────────────
		this.checkTokenBurn(metrics, newFindings);

		// ── Tool latency ────────────────────────────────────────────────
		if (metrics.toolName && metrics.toolDurationMs !== undefined) {
			this.checkToolLatency(metrics, newFindings);
			this.checkRepeatedCalls(metrics, newFindings);
		}

		// ── Context window usage ────────────────────────────────────────
		this.checkContextUsage(metrics, newFindings);

		// ── Memory growth ───────────────────────────────────────────────
		this.checkMemoryGrowth(newFindings);

		this.scansCompleted++;
		this.lastScanAt = Date.now();
		this.totalScanDurationMs += Date.now() - startMs;

		return newFindings;
	}

	/**
	 * Get the most recent findings, newest first.
	 *
	 * @param limit Maximum number of findings to return (default: all).
	 */
	getFindings(limit?: number): Finding[] {
		return this.findings.toArray(limit);
	}

	/** Get aggregate statistics for this guardian. */
	stats(): GuardianStats {
		return {
			scansCompleted: this.scansCompleted,
			findingsTotal: this.findings.size,
			findingsBySeverity: { ...this.findingsBySeverity },
			autoFixesApplied: this.autoFixesApplied,
			lastScanAt: this.lastScanAt,
			avgScanDurationMs:
				this.scansCompleted > 0
					? this.totalScanDurationMs / this.scansCompleted
					: 0,
		};
	}

	// ─── Internal Checks ───────────────────────────────────────────────────

	/**
	 * Check if token consumption this turn exceeds the adaptive baseline.
	 */
	private checkTokenBurn(
		metrics: PerformanceMetrics,
		accumulator: Finding[],
	): void {
		const prevBaseline = this.tokenEma.current;
		this.tokenEma.update(metrics.tokensThisTurn);

		if (
			this.tokenEma.reliable &&
			prevBaseline !== undefined &&
			prevBaseline > 0 &&
			metrics.tokensThisTurn > prevBaseline * SPIKE_MULTIPLIER
		) {
			this.addFinding(accumulator, {
				guardianId: "gati",
				domain: "performance",
				severity: "warning",
				title: "Token burn spike",
				description: `Turn ${metrics.turnNumber} consumed ${metrics.tokensThisTurn} tokens, which is ${(metrics.tokensThisTurn / prevBaseline).toFixed(1)}x the rolling average (${Math.round(prevBaseline)}).`,
				location: `turn:${metrics.turnNumber}`,
				suggestion: "Consider breaking complex operations into smaller steps or using more targeted tool calls.",
				confidence: 0.7,
				autoFixable: false,
			});
		}
	}

	/**
	 * Check if tool latency exceeds the per-tool adaptive baseline.
	 */
	private checkToolLatency(
		metrics: PerformanceMetrics,
		accumulator: Finding[],
	): void {
		const toolName = metrics.toolName!;
		const durationMs = metrics.toolDurationMs!;

		let ema = this.toolLatencyEmas.get(toolName);
		if (!ema) {
			ema = new EmaTracker(DEFAULT_EMA_ALPHA);
			this.toolLatencyEmas.set(toolName, ema);
		}

		const prevBaseline = ema.current;
		ema.update(durationMs);

		if (
			ema.reliable &&
			prevBaseline !== undefined &&
			prevBaseline > 0 &&
			durationMs > prevBaseline * SPIKE_MULTIPLIER
		) {
			this.addFinding(accumulator, {
				guardianId: "gati",
				domain: "performance",
				severity: "warning",
				title: `Latency spike: ${toolName}`,
				description: `Tool "${toolName}" took ${durationMs}ms, which is ${(durationMs / prevBaseline).toFixed(1)}x the rolling average (${Math.round(prevBaseline)}ms).`,
				location: `tool:${toolName}`,
				suggestion: "Check for large inputs, network issues, or deadlocks.",
				confidence: 0.65,
				autoFixable: false,
			});
		}
	}

	/**
	 * Check for repeated identical tool calls (infinite loop indicator).
	 */
	private checkRepeatedCalls(
		metrics: PerformanceMetrics,
		accumulator: Finding[],
	): void {
		// We need args, but PerformanceMetrics doesn't have them.
		// We use toolName only for repeat detection in the observe() path.
		// The controller passes full args via afterToolExecution.
		// Here, we track by tool name only as a lightweight check.
		const count = this.repeatTracker.record(metrics.toolName!, {});

		if (count === REPEAT_THRESHOLD) {
			this.addFinding(accumulator, {
				guardianId: "gati",
				domain: "performance",
				severity: "warning",
				title: `Repeated tool call: ${metrics.toolName}`,
				description: `Tool "${metrics.toolName}" has been called ${count} times consecutively. This may indicate an infinite loop or stuck retry pattern.`,
				location: `tool:${metrics.toolName}`,
				suggestion: "Check if the tool is producing the expected output. Consider breaking out of the loop.",
				confidence: 0.8,
				autoFixable: false,
			});
		}
	}

	/**
	 * Check context window usage against thresholds.
	 *
	 * Uses hysteresis: warning/critical findings are emitted once and
	 * not repeated until usage drops below the threshold and rises again.
	 */
	private checkContextUsage(
		metrics: PerformanceMetrics,
		accumulator: Finding[],
	): void {
		// Reset hysteresis if usage drops below thresholds
		if (metrics.contextUsedPct < CONTEXT_WARN_PCT) {
			this.contextWarnEmitted = false;
			this.contextCriticalEmitted = false;
		} else if (metrics.contextUsedPct < CONTEXT_CRITICAL_PCT) {
			this.contextCriticalEmitted = false;
		}

		if (
			metrics.contextUsedPct >= CONTEXT_CRITICAL_PCT &&
			!this.contextCriticalEmitted
		) {
			this.contextCriticalEmitted = true;
			this.addFinding(accumulator, {
				guardianId: "gati",
				domain: "performance",
				severity: "critical",
				title: "Context window nearly full",
				description: `Context window is ${metrics.contextUsedPct.toFixed(1)}% full. Agent may lose important context or fail to complete the task.`,
				location: `turn:${metrics.turnNumber}`,
				suggestion: "Trigger context compaction or summarize earlier turns.",
				confidence: 0.95,
				autoFixable: false,
			});
		} else if (
			metrics.contextUsedPct >= CONTEXT_WARN_PCT &&
			!this.contextWarnEmitted
		) {
			this.contextWarnEmitted = true;
			this.addFinding(accumulator, {
				guardianId: "gati",
				domain: "performance",
				severity: "warning",
				title: "Context window high usage",
				description: `Context window is ${metrics.contextUsedPct.toFixed(1)}% full. Consider compacting or summarizing.`,
				location: `turn:${metrics.turnNumber}`,
				suggestion: "Proactively compact context to preserve headroom for complex tasks.",
				confidence: 0.85,
				autoFixable: false,
			});
		}
	}

	/**
	 * Check for memory growth (if process.memoryUsage is available).
	 *
	 * Uses RSS (resident set size) as the primary indicator. Captures
	 * a baseline on first call and reports if growth exceeds the threshold.
	 */
	private checkMemoryGrowth(accumulator: Finding[]): void {
		if (typeof process === "undefined" || !process.memoryUsage) return;

		try {
			const rss = process.memoryUsage().rss;

			if (this.baselineRss === undefined) {
				this.baselineRss = rss;
				return;
			}

			if (rss > this.baselineRss * MEMORY_GROWTH_RATIO) {
				this.addFinding(accumulator, {
					guardianId: "gati",
					domain: "performance",
					severity: "info",
					title: "Memory growth detected",
					description: `RSS has grown from ${(this.baselineRss / 1024 / 1024).toFixed(1)}MB to ${(rss / 1024 / 1024).toFixed(1)}MB (${((rss / this.baselineRss - 1) * 100).toFixed(0)}% increase).`,
					confidence: 0.6,
					autoFixable: false,
				});

				// Update baseline so we don't keep re-reporting
				this.baselineRss = rss;
			}
		} catch {
			// process.memoryUsage() may not be available in all environments
		}
	}

	/**
	 * Create a Finding, apply confidence threshold, and store it.
	 */
	private addFinding(
		accumulator: Finding[],
		partial: Omit<Finding, "id" | "timestamp">,
	): void {
		if (partial.confidence < this.config.confidenceThreshold) return;

		const timestamp = Date.now();
		const id = fnv1a(
			`${partial.guardianId}:${partial.title}:${partial.location ?? ""}:${timestamp}`,
		);

		const finding: Finding = {
			...partial,
			id,
			timestamp,
		};

		this.findings.push(finding);
		this.findingsBySeverity[finding.severity] =
			(this.findingsBySeverity[finding.severity] ?? 0) + 1;
		accumulator.push(finding);
	}
}
